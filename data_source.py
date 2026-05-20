"""Pluggable data source layer.

To add a new broker (Alpaca, Binance, Zerodha, Groww, Polygon, ...):
    1. Subclass DataSource and implement the four methods.
    2. Add an instance to REGISTRY at the bottom of this file.
The Flask routes and frontend will pick it up automatically.
"""

from __future__ import annotations

import json
import time
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass
from typing import Iterator

import requests


# --- Wire types ---------------------------------------------------------------

@dataclass
class Candle:
    time: int     # unix seconds (Lightweight Charts expects seconds for intraday)
    open: float
    high: float
    low: float
    close: float
    volume: float

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Quote:
    time: int
    price: float
    source: str
    symbol: str


# --- Timeframes ---------------------------------------------------------------

TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"]


def _tf_to_seconds(tf: str) -> int:
    units = {"m": 60, "h": 3600, "d": 86400}
    return int(tf[:-1]) * units[tf[-1]]


# --- Base ---------------------------------------------------------------------

class DataSource(ABC):
    name: str = ""
    asset_class: str = ""   # "crypto" | "stock"

    @abstractmethod
    def get_history(self, symbol: str, timeframe: str, limit: int = 500) -> list[Candle]:
        ...

    @abstractmethod
    def stream_quotes(self, symbol: str, timeframe: str) -> Iterator[Quote]:
        """Yield Quote objects as new prices arrive. Used by SSE."""
        ...

    @abstractmethod
    def search_symbols(self, query: str) -> list[dict]:
        ...


# --- Hyperliquid (crypto) -----------------------------------------------------

class HyperliquidSource(DataSource):
    name = "hyperliquid"
    asset_class = "crypto"
    INFO_URL = "https://api.hyperliquid.xyz/info"

    # Hyperliquid interval mapping
    _TF_MAP = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d"}

    def get_history(self, symbol: str, timeframe: str, limit: int = 500) -> list[Candle]:
        interval = self._TF_MAP.get(timeframe, "1m")
        now_ms = int(time.time() * 1000)
        span_ms = _tf_to_seconds(timeframe) * 1000 * limit
        payload = {
            "type": "candleSnapshot",
            "req": {
                "coin": symbol.upper(),
                "interval": interval,
                "startTime": now_ms - span_ms,
                "endTime": now_ms,
            },
        }
        r = requests.post(self.INFO_URL, json=payload, timeout=10)
        r.raise_for_status()
        out = []
        for c in r.json():
            out.append(Candle(
                time=int(c["t"]) // 1000,
                open=float(c["o"]),
                high=float(c["h"]),
                low=float(c["l"]),
                close=float(c["c"]),
                volume=float(c["v"]),
            ))
        return out

    def stream_quotes(self, symbol: str, timeframe: str) -> Iterator[Quote]:
        # Browser opens Hyperliquid WS directly; the backend SSE path is unused
        # for crypto. Kept here so the interface is uniform.
        raise NotImplementedError("Hyperliquid streams via browser WebSocket directly")

    def search_symbols(self, query: str) -> list[dict]:
        # Hyperliquid has a fixed perp universe; we expose it via the curated
        # JSON list. This method is here for symmetry / future broker fits.
        return []


# --- yfinance (Indian stocks etc.) -------------------------------------------

class YFinanceSource(DataSource):
    name = "yfinance"
    asset_class = "stock"

    _TF_MAP = {
        "1m":  ("1m",  "1d"),
        "5m":  ("5m",  "5d"),
        "15m": ("15m", "1mo"),
        "1h":  ("60m", "1mo"),
        "4h":  ("60m", "3mo"),  # aggregate client-side if needed; yfinance has no 4h
        "1d":  ("1d",  "1y"),
    }

    def _yf(self):
        # Lazy import so the module loads even if yfinance is missing.
        import yfinance as yf
        return yf

    def get_history(self, symbol: str, timeframe: str, limit: int = 500) -> list[Candle]:
        yf = self._yf()
        interval, period = self._TF_MAP.get(timeframe, ("1m", "1d"))
        df = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=False)
        if df.empty:
            return []
        out = []
        for ts, row in df.iterrows():
            out.append(Candle(
                time=int(ts.timestamp()),
                open=float(row["Open"]),
                high=float(row["High"]),
                low=float(row["Low"]),
                close=float(row["Close"]),
                volume=float(row.get("Volume", 0) or 0),
            ))
        return out[-limit:]

    def stream_quotes(self, symbol: str, timeframe: str) -> Iterator[Quote]:
        """Poll yfinance every 2s and emit when price changes."""
        yf = self._yf()
        interval, period = self._TF_MAP.get(timeframe, ("1m", "1d"))
        last_price = None
        last_keepalive = 0.0
        ticker = yf.Ticker(symbol)
        while True:
            try:
                # fast_info is the cheapest live price call yfinance offers
                price = None
                try:
                    fi = ticker.fast_info
                    price = float(fi["last_price"]) if "last_price" in fi else float(fi.last_price)
                except Exception:
                    df = ticker.history(period=period, interval=interval)
                    if not df.empty:
                        price = float(df["Close"].iloc[-1])

                now = int(time.time())
                if price is not None and price != last_price:
                    last_price = price
                    yield Quote(time=now, price=price, source=self.name, symbol=symbol)
                    last_keepalive = time.time()
                elif time.time() - last_keepalive > 15:
                    # SSE keepalive comment so the client knows we're alive
                    yield Quote(time=now, price=last_price or 0.0, source=self.name, symbol=symbol)
                    last_keepalive = time.time()
            except Exception:
                # swallow transient errors; the client stays connected
                pass
            time.sleep(2)

    def search_symbols(self, query: str) -> list[dict]:
        return []


# --- Registry -----------------------------------------------------------------

REGISTRY: dict[str, DataSource] = {
    "hyperliquid": HyperliquidSource(),
    "yfinance":    YFinanceSource(),
}


def get_source(name: str) -> DataSource:
    if name not in REGISTRY:
        raise KeyError(f"Unknown data source: {name}. Available: {list(REGISTRY)}")
    return REGISTRY[name]


def list_sources() -> list[dict]:
    return [
        {"name": s.name, "asset_class": s.asset_class}
        for s in REGISTRY.values()
    ]


# --- Curated symbol list ------------------------------------------------------

def load_symbols(symbols_path: str) -> list[dict]:
    with open(symbols_path, "r", encoding="utf-8") as f:
        return json.load(f)
