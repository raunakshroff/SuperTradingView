import math
from unittest.mock import patch, MagicMock

import pytest

from services.factors import (
    zscore,
    momentum_12m_1m,
    realized_vol,
    factor_portfolio_strength,
    compute_factors,
    _cache,
)


@pytest.fixture(autouse=True)
def _clear_cache():
    _cache._store.clear()
    yield
    _cache._store.clear()


def test_zscore_basic():
    vals = [1.0, 2.0, 3.0, 4.0, 5.0]
    z = zscore(vals)
    # mean=3, stdev=~1.581
    assert z[0] == pytest.approx(-1.2649, abs=1e-3)
    assert z[2] == pytest.approx(0.0, abs=1e-3)
    assert z[4] == pytest.approx(1.2649, abs=1e-3)


def test_zscore_constant_returns_zeros():
    assert zscore([3.0, 3.0, 3.0]) == [0.0, 0.0, 0.0]


def test_zscore_empty_returns_empty():
    assert zscore([]) == []


def test_momentum_12m_1m_classical():
    # 252 days of data — last close = 100; 1mo ago (21 days) close = 110;
    # 12mo ago (252 days) close = 80. Expected: (100/80) - (100/110)
    closes = [80.0] + [80.0] * 230 + [110.0] + [110.0] * 19 + [100.0]
    assert len(closes) == 252
    m = momentum_12m_1m(closes)
    assert m == pytest.approx(100/80 - 100/110, abs=1e-6)


def test_momentum_short_history_returns_none():
    assert momentum_12m_1m([1.0, 2.0]) is None


def test_realized_vol_returns_float():
    closes = [100, 101, 99, 102, 98, 103, 100]
    v = realized_vol(closes, lookback=5)
    assert isinstance(v, float)
    assert v > 0


def test_realized_vol_too_short_returns_none():
    assert realized_vol([100, 101], lookback=10) is None


def test_factor_portfolio_strength_uses_top_bottom_quintiles():
    syms = ["A","B","C","D","E","F","G","H","I","J"]
    scores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    # 60d cum returns — top quintile (J,I) returns +5%, bottom (A,B) returns -5%
    returns = {
        "A": [-0.01]*60, "B": [-0.01]*60, "C": [0.0]*60, "D": [0.0]*60, "E": [0.0]*60,
        "F": [0.0]*60, "G": [0.0]*60, "H": [0.0]*60, "I": [0.005]*60, "J": [0.005]*60,
    }
    s = factor_portfolio_strength(syms, scores, returns)
    # Long (I+J) cum return ~ (1.005)^60 - 1; Short (A+B) ~ (0.99)^60 - 1
    # Positive number since long > short
    assert s > 0


def test_factor_portfolio_strength_empty_returns_zero():
    assert factor_portfolio_strength([], [], {}) == 0.0


def test_compute_factors_returns_six_factors():
    syms = [f"S{i}" for i in range(20)]

    def fake_history(sym, lookback=260):
        # Each symbol gets a slightly different price history
        base = 100 + (hash(sym) % 50)
        return [base + i * 0.1 for i in range(260)]

    fake_info = {
        f"S{i}": {"trailingPE": 10 + i, "returnOnEquity": 0.1 + i * 0.01,
                  "revenueGrowth": 0.05 + i * 0.005, "marketCap": 1e9 * (i + 1)}
        for i in range(20)
    }

    with patch("services.factors.fetch_closes", side_effect=fake_history), \
         patch("services.factors.fetch_info", side_effect=lambda s: fake_info[s]):
        out = compute_factors(syms)

    names = [f["name"] for f in out]
    assert names == ["Momentum", "Quality", "Value", "Low Vol", "Growth", "Size (SMB)"]
    for f in out:
        assert "z" in f
        assert "weight" in f
