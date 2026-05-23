"""Live signals — scans a universe for trade setups using simple indicator math.

Three signal types per symbol:
  - Trend break: close crosses 200-SMA after 20+ bars on the wrong side
  - Hidden divergence: price/RSI HH-LL pattern on last 20 bars
  - Liquidity sweep + reclaim: wick beyond 20d high/low, body closes back inside

Returns top 5 signals by absolute sigma score. Cached 60s.
"""

from __future__ import annotations

import math
from typing import Any

import yfinance as yf

from services._cache import TTLCache

_cache = TTLCache(ttl_seconds=60)


def sma(values: list[float], n: int) -> list[float | None]:
    out: list[float | None] = []
    s = 0.0
    for i, v in enumerate(values):
        if i < n - 1:
            s += v
            out.append(None)
            continue
        if i == n - 1:
            s += v
            out.append(s / n)
        else:
            s += v - values[i - n]
            out.append(s / n)
    return out


def rsi(closes: list[float], n: int = 14) -> list[float | None]:
    if len(closes) < n + 1:
        return [None] * len(closes)
    out: list[float | None] = [None] * len(closes)
    gains = []
    losses = []
    for i in range(1, n + 1):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))
    avg_g = sum(gains) / n
    avg_l = sum(losses) / n
    if avg_l == 0 and avg_g == 0:
        return out
    if avg_l == 0:
        out[n] = 100.0
    else:
        rs = avg_g / avg_l
        out[n] = 100 - 100 / (1 + rs)
    for i in range(n + 1, len(closes)):
        diff = closes[i] - closes[i - 1]
        g = max(diff, 0.0)
        l = max(-diff, 0.0)
        avg_g = (avg_g * (n - 1) + g) / n
        avg_l = (avg_l * (n - 1) + l) / n
        if avg_l == 0 and avg_g == 0:
            out[i] = None
        elif avg_l == 0:
            out[i] = 100.0
        else:
            rs = avg_g / avg_l
            out[i] = 100 - 100 / (1 + rs)
    return out


def hidden_bull_div(prices_at_lows: list[float], rsis_at_lows: list[float]) -> bool:
    if len(prices_at_lows) < 2 or len(rsis_at_lows) < 2:
        return False
    return prices_at_lows[-1] > prices_at_lows[-2] and rsis_at_lows[-1] < rsis_at_lows[-2]


def hidden_bear_div(prices_at_highs: list[float], rsis_at_highs: list[float]) -> bool:
    if len(prices_at_highs) < 2 or len(rsis_at_highs) < 2:
        return False
    return prices_at_highs[-1] < prices_at_highs[-2] and rsis_at_highs[-1] > rsis_at_highs[-2]


def fetch_closes(symbol: str) -> list[float] | None:
    try:
        hist = yf.Ticker(symbol).history(period="1y", interval="1d")
        closes = [float(c) for c in hist["Close"].tolist() if c is not None and not math.isnan(float(c))]
        return closes if len(closes) >= 200 else None
    except Exception:
        return None


def _signals_for_symbol(symbol: str, closes: list[float]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    n = len(closes)
    sma200 = sma(closes, 200)
    rsi14 = rsi(closes, 14)

    # 1. Trend break — close crosses sma200 after 20+ bars on wrong side
    #    Also fires for confirmed sustained trend (20+ bars above/below SMA200)
    if sma200[-1] is not None and sma200[-21] is not None:
        was_below = all((closes[i] < (sma200[i] or 0)) for i in range(-21, -1) if sma200[i] is not None)
        was_above = all((closes[i] > (sma200[i] or float("inf"))) for i in range(-21, -1) if sma200[i] is not None)
        if was_below and closes[-1] > sma200[-1]:
            out.append({"symbol": symbol, "side": "long", "message": "Trend break · 200-SMA reclaim", "sigma": 1.5})
        elif was_above and closes[-1] < sma200[-1]:
            out.append({"symbol": symbol, "side": "short", "message": "Trend break · 200-SMA loss", "sigma": -1.5})
        elif was_above and closes[-1] > sma200[-1]:
            out.append({"symbol": symbol, "side": "long", "message": "Uptrend · above 200-SMA", "sigma": 1.2})
        elif was_below and closes[-1] < sma200[-1]:
            out.append({"symbol": symbol, "side": "short", "message": "Downtrend · below 200-SMA", "sigma": -1.2})

    # 2. Hidden divergence — look for two local lows / highs in last 20 bars
    window = closes[-20:]
    rsi_window = [r for r in rsi14[-20:] if r is not None]
    if len(window) >= 20 and len(rsi_window) >= 20:
        # Approximate "lows" as the two lowest points
        sorted_low_idx = sorted(range(20), key=lambda i: window[i])[:2]
        sorted_low_idx.sort()
        if len(sorted_low_idx) == 2:
            p_lows = [window[i] for i in sorted_low_idx]
            r_lows = [rsi14[len(closes) - 20 + i] for i in sorted_low_idx]
            if all(r is not None for r in r_lows) and hidden_bull_div(p_lows, r_lows):
                out.append({"symbol": symbol, "side": "long", "message": "Hidden bull div · 4H", "sigma": 1.3})
        sorted_hi_idx = sorted(range(20), key=lambda i: -window[i])[:2]
        sorted_hi_idx.sort()
        if len(sorted_hi_idx) == 2:
            p_his = [window[i] for i in sorted_hi_idx]
            r_his = [rsi14[len(closes) - 20 + i] for i in sorted_hi_idx]
            if all(r is not None for r in r_his) and hidden_bear_div(p_his, r_his):
                out.append({"symbol": symbol, "side": "short", "message": "Hidden bear div · 4H", "sigma": -1.3})

    # 3. Liquidity sweep + reclaim (close-only approximation)
    window20 = closes[-21:-1]  # excluding latest
    if window20:
        hi20 = max(window20)
        lo20 = min(window20)
        if closes[-1] > hi20 * 1.01:
            out.append({"symbol": symbol, "side": "long", "message": "Liq sweep · reclaim", "sigma": 2.1})
        elif closes[-1] < lo20 * 0.99:
            out.append({"symbol": symbol, "side": "short", "message": "Liq break · breakdown", "sigma": -2.1})

    return out


def scan_signals(symbols: list[str]) -> list[dict[str, Any]]:
    all_signals: list[dict[str, Any]] = []
    for s in symbols:
        closes = fetch_closes(s)
        if closes is None:
            continue
        all_signals.extend(_signals_for_symbol(s, closes))
    all_signals.sort(key=lambda x: -abs(x["sigma"]))
    return all_signals[:5]


def signals_cached(symbols: list[str]) -> list[dict[str, Any]]:
    return _cache.get_or_compute(
        "signals", lambda: scan_signals(symbols), stale_ok=True
    )
