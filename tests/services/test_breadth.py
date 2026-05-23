from unittest.mock import patch

import pytest

from services.breadth import compute_breadth, _cache


@pytest.fixture(autouse=True)
def _clear_cache():
    _cache._store.clear()
    yield
    _cache._store.clear()


def test_compute_breadth_returns_dict():
    def fake_history(sym):
        if sym == "^TNX": return [42.0, 43.17]
        if sym == "^VIX": return [15.5, 16.2]
        # adv vs dec
        if sym in ("AAPL", "MSFT"): return [99.0, 100.0]
        return [101.0, 100.0]  # decliners

    with patch("services.breadth.fetch_last_two", side_effect=fake_history):
        out = compute_breadth(["AAPL", "MSFT", "X1", "X2", "X3"])
    assert out["adv"] == 2
    assert out["dec"] == 3
    assert out["us10y"] == 4.317  # ^TNX is yields * 10 in yfinance
    assert out["vix"] == 16.2


def test_compute_breadth_handles_missing_data():
    with patch("services.breadth.fetch_last_two", return_value=None):
        out = compute_breadth(["AAPL"])
    assert out == {"adv": 0, "dec": 0, "us10y": None, "vix": None}
