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

    _universe_cache: list[dict] | None = None
    _universe_cache_at: float = 0.0
    _UNIVERSE_TTL = 3600  # seconds

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

    def _get_universe(self) -> list[dict]:
        """Fetch (and cache) the full Hyperliquid perp universe from /info?meta."""
        now = time.time()
        if self._universe_cache is not None and now - self._universe_cache_at < self._UNIVERSE_TTL:
            return self._universe_cache
        try:
            r = requests.post(self.INFO_URL, json={"type": "meta"}, timeout=10)
            r.raise_for_status()
            HyperliquidSource._universe_cache = r.json().get("universe", []) or []
            HyperliquidSource._universe_cache_at = now
        except Exception:
            # Keep stale cache rather than wiping it on a transient failure
            if self._universe_cache is None:
                HyperliquidSource._universe_cache = []
        return self._universe_cache or []

    def search_symbols(self, query: str) -> list[dict]:
        q = (query or "").strip().upper()
        if not q:
            return []
        out: list[dict] = []
        for coin in self._get_universe():
            name = coin.get("name") or ""
            if not name or coin.get("isDelisted"):
                continue
            if q in name.upper():
                out.append({
                    "symbol": name,
                    "label": f"{name} perp",
                    "source": self.name,
                    "asset_class": "crypto",
                })
        # Exact prefix matches first, then substring
        out.sort(key=lambda s: (not s["symbol"].upper().startswith(q), s["symbol"]))
        return out[:25]


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

    # Map Yahoo quoteType -> our asset_class
    _ASSET_CLASS_MAP = {
        "EQUITY": "stock",
        "ETF": "stock",
        "MUTUALFUND": "stock",
        "INDEX": "stock",
        "FUTURE": "stock",
        "OPTION": "stock",
        "CRYPTOCURRENCY": "crypto",
        "CURRENCY": "fx",
        "COMMODITY": "commodity",
    }

    def search_symbols(self, query: str) -> list[dict]:
        """Live ticker search via yfinance.Search (Yahoo's search endpoint).

        Returns up to ~15 matches. Falls back to empty list on any failure
        so the curated symbols.json results always still surface.
        """
        q = (query or "").strip()
        if not q:
            return []
        try:
            yf = self._yf()
            res = yf.Search(
                q,
                max_results=15,
                news_count=0,
                lists_count=0,
                include_research=False,
                enable_fuzzy_query=False,
                raise_errors=False,
                timeout=15,
            )
            quotes = getattr(res, "quotes", None) or []
        except Exception:
            return []

        out: list[dict] = []
        for it in quotes:
            sym = it.get("symbol")
            if not sym:
                continue
            label = (
                it.get("shortname")
                or it.get("longname")
                or it.get("name")
                or sym
            )
            exch = it.get("exchDisp") or it.get("exchange") or ""
            qt = (it.get("quoteType") or "").upper()
            asset_class = self._ASSET_CLASS_MAP.get(qt, "stock")
            display_label = f"{label} · {exch}" if exch else str(label)
            out.append({
                "symbol": sym,
                "label": display_label,
                "source": self.name,
                "asset_class": asset_class,
            })
        return out


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
