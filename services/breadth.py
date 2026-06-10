"""Breadth — advancers/decliners over universe + ^TNX + ^VIX."""

from __future__ import annotations

import logging
import math
from typing import Any

import yfinance as yf

from services._cache import TTLCache

log = logging.getLogger(__name__)

_cache = TTLCache(ttl_seconds=60)


def fetch_last_two(symbol: str) -> list[float] | None:
    try:
        hist = yf.Ticker(symbol).history(period="5d", interval="1d")
        closes = [float(c) for c in hist["Close"].tolist() if c is not None and not math.isnan(float(c))]
        return closes[-2:] if len(closes) >= 2 else None
    except Exception as e:
        log.warning("close fetch failed for %s: %s: %s", symbol, type(e).__name__, e)
        return None


def compute_breadth(symbols: list[str]) -> dict[str, Any]:
    adv = 0
    dec = 0
    for s in symbols:
        cl = fetch_last_two(s)
        if not cl or len(cl) < 2:
            continue
        if cl[-1] > cl[-2]:
            adv += 1
        elif cl[-1] < cl[-2]:
            dec += 1

    tnx = fetch_last_two("^TNX")
    vix = fetch_last_two("^VIX")
    us10y = round(tnx[-1] / 10, 3) if tnx else None
    vix_val = round(vix[-1], 2) if vix else None

    return {"adv": adv, "dec": dec, "us10y": us10y, "vix": vix_val}


def breadth_cached(symbols: list[str]) -> dict[str, Any]:
    return _cache.get_or_compute(
        "breadth", lambda: compute_breadth(symbols), stale_ok=True
    )
