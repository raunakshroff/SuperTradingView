import math
from unittest.mock import patch

import pytest

from services.signals import sma, rsi, hidden_bull_div, hidden_bear_div, scan_signals, _cache


@pytest.fixture(autouse=True)
def _clear_cache():
    _cache._store.clear()
    yield
    _cache._store.clear()


def test_sma_basic():
    assert sma([1, 2, 3, 4, 5], 3) == [None, None, 2.0, 3.0, 4.0]


def test_sma_too_short():
    assert sma([1, 2], 3) == [None, None]


def test_rsi_constant_returns_none():
    # All gains == 0 → undefined RSI
    out = rsi([100] * 20, 14)
    assert out[-1] is None


def test_rsi_monotonic_up_approaches_100():
    closes = [100 + i for i in range(30)]
    out = rsi(closes, 14)
    assert out[-1] is not None and out[-1] > 99


def test_hidden_bull_div_detects():
    # Price makes higher low, RSI makes lower low → hidden bullish divergence
    # Two lows: oldest first
    prices_at_lows = [100, 102]
    rsis_at_lows = [40, 35]
    assert hidden_bull_div(prices_at_lows, rsis_at_lows) is True


def test_hidden_bull_div_no_signal():
    prices_at_lows = [100, 95]
    rsis_at_lows = [40, 35]
    assert hidden_bull_div(prices_at_lows, rsis_at_lows) is False


def test_hidden_bear_div_detects():
    prices_at_highs = [110, 108]
    rsis_at_highs = [65, 70]
    assert hidden_bear_div(prices_at_highs, rsis_at_highs) is True


def test_scan_signals_returns_signals():
    def fake_closes(sym):
        # Symbol "BULL" trending up, "BEAR" trending down
        if sym == "BULL":
            return [100 + i * 0.5 for i in range(300)]
        if sym == "BEAR":
            return [200 - i * 0.5 for i in range(300)]
        return [100] * 300  # flat

    with patch("services.signals.fetch_closes", side_effect=fake_closes):
        out = scan_signals(["BULL", "BEAR", "FLAT"])
    # Expect at least one trend-break or breakout per non-flat symbol
    syms = {s["symbol"] for s in out}
    assert "BULL" in syms or "BEAR" in syms


def test_scan_signals_handles_missing_data():
    def fake_closes(sym):
        return None

    with patch("services.signals.fetch_closes", side_effect=fake_closes):
        out = scan_signals(["NULL"])
    assert out == []
