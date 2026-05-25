"""Factor Pulse — cross-sectional z-scores + factor-portfolio Sharpe-like strength.

Six factors:
  Momentum  — classical 12-1 (252d - 21d return)
  Quality   — return on equity
  Value     — earnings yield (1 / trailingPE)
  Low Vol   — negative of 60d realized vol
  Growth    — revenue YoY growth
  Size      — negative of log(marketCap)

For each factor:
  1. Compute raw value per symbol over the universe
  2. z-score across the universe
  3. Sort by z; long top quintile, short bottom quintile (equal-weight)
  4. Compute the factor portfolio's 60d cumulative return / 60d return stdev
  5. Return that Sharpe-like ratio as `z`; `weight` is |z| clipped to [0,1]

Cached 30 minutes server-side with stale-while-revalidate.
"""

from __future__ import annotations

import math
from typing import Callable

import yfinance as yf

from services._cache import TTLCache

_cache = TTLCache(ttl_seconds=30 * 60)
_LOOKBACK_DAYS = 260


def zscore(values: list[float]) -> list[float]:
    if not values:
        return []
    mean = sum(values) / len(values)
    if len(values) < 2:
        return [0.0] * len(values)
    var = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    stdev = math.sqrt(var)
    if stdev == 0:
        return [0.0] * len(values)
    return [(v - mean) / stdev for v in values]


def momentum_12m_1m(closes: list[float]) -> float | None:
    if len(closes) < 252:
        return None
    last = closes[-1]
    return last / closes[-252] - last / closes[-21]


def realized_vol(closes: list[float], *, lookback: int = 60) -> float | None:
    if len(closes) < lookback + 1:
        return None
    rets = []
    for i in range(-lookback, 0):
        if closes[i - 1] == 0:
            continue
        rets.append(math.log(closes[i] / closes[i - 1]))
    if len(rets) < 2:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var) * math.sqrt(252)


def factor_portfolio_strength(
    symbols: list[str],
    scores: list[float],
    returns_by_sym: dict[str, list[float]],
) -> float:
    if not symbols or not scores:
        return 0.0
    n = len(symbols)
    if n < 5:
        return 0.0
    paired = sorted(zip(symbols, scores), key=lambda p: p[1])
    quintile = max(1, n // 5)
    short_set = [s for s, _ in paired[:quintile]]
    long_set = [s for s, _ in paired[-quintile:]]

    def portfolio_returns(syms):
        # Daily mean across the symbols in the basket
        per_day = []
        for d in range(60):
            rs = []
            for s in syms:
                lst = returns_by_sym.get(s, [])
                if d < len(lst):
                    rs.append(lst[d])
            if rs:
                per_day.append(sum(rs) / len(rs))
        return per_day

    long_d = portfolio_returns(long_set)
    short_d = portfolio_returns(short_set)
    if not long_d or not short_d:
        return 0.0

    diff = [l - s for l, s in zip(long_d, short_d)]
    cum = 1.0
    for d in diff:
        cum *= (1 + d)
    cum_return = cum - 1
    if len(diff) < 2:
        return 0.0
    mean = sum(diff) / len(diff)
    var = sum((d - mean) ** 2 for d in diff) / (len(diff) - 1)
    stdev = math.sqrt(var)
    if stdev == 0:
        return 0.0
    return cum_return / (stdev * math.sqrt(len(diff)))


def fetch_closes(symbol: str, lookback: int = _LOOKBACK_DAYS) -> list[float] | None:
    try:
        hist = yf.Ticker(symbol).history(period="2y", interval="1d")
        closes = [float(c) for c in hist["Close"].tolist() if c is not None and not math.isnan(float(c))]
        return closes[-lookback:] if len(closes) >= lookback else closes
    except Exception:
        return None


def fetch_info(symbol: str) -> dict:
    try:
        info = yf.Ticker(symbol).info
        return info if isinstance(info, dict) else {}
    except Exception:
        return {}


def _safe_div(a, b):
    try:
        return a / b
    except (TypeError, ZeroDivisionError):
        return None


def compute_factors(symbols: list[str]) -> list[dict]:
    closes_by_sym: dict[str, list[float]] = {}
    info_by_sym: dict[str, dict] = {}
    for s in symbols:
        c = fetch_closes(s)
        if c and len(c) >= 60:
            closes_by_sym[s] = c
            info_by_sym[s] = fetch_info(s) or {}

    universe = list(closes_by_sym.keys())
    returns_by_sym: dict[str, list[float]] = {}
    for s, c in closes_by_sym.items():
        rets = []
        for i in range(-60, 0):
            if c[i - 1] == 0:
                rets.append(0.0)
            else:
                rets.append(c[i] / c[i - 1] - 1)
        returns_by_sym[s] = rets

    def raw_per_factor(fname: str) -> list[float | None]:
        out = []
        for s in universe:
            c = closes_by_sym[s]
            info = info_by_sym[s]
            if fname == "Momentum":
                out.append(momentum_12m_1m(c))
            elif fname == "Low Vol":
                v = realized_vol(c)
                out.append(-v if v is not None else None)
            elif fname == "Quality":
                roe = info.get("returnOnEquity")
                out.append(float(roe) if isinstance(roe, (int, float)) else None)
            elif fname == "Value":
                pe = info.get("trailingPE")
                ey = _safe_div(1.0, float(pe)) if isinstance(pe, (int, float)) and pe > 0 else None
                out.append(ey)
            elif fname == "Growth":
                g = info.get("revenueGrowth")
                out.append(float(g) if isinstance(g, (int, float)) else None)
            elif fname == "Size (SMB)":
                mc = info.get("marketCap")
                out.append(-math.log(float(mc)) if isinstance(mc, (int, float)) and mc > 0 else None)
        return out

    factor_order = ["Momentum", "Quality", "Value", "Low Vol", "Growth", "Size (SMB)"]
    results = []
    for fname in factor_order:
        raw = raw_per_factor(fname)
        filtered = [(s, r) for s, r in zip(universe, raw) if r is not None]
        if len(filtered) < 5:
            results.append({"name": fname, "z": 0.0, "weight": 0.0})
            continue
        syms, vals = zip(*filtered)
        scores = zscore(list(vals))
        strength = factor_portfolio_strength(list(syms), scores, returns_by_sym)
        z = max(-2.0, min(2.0, strength * 10))  # rescale into [-2, 2]
        weight = min(1.0, abs(z) / 1.0)
        results.append({"name": fname, "z": round(z, 2), "weight": round(weight, 2)})
    return results


def factors_cached(symbols: list[str]) -> list[dict]:
    return _cache.get_or_compute(
        "factors", lambda: compute_factors(symbols), stale_ok=True
    )
