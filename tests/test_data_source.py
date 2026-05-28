# tests/test_data_source.py
from __future__ import annotations

import json
from pathlib import Path

import pytest

from data_source import (
    Candle,
    Quote,
    REGISTRY,
    TIMEFRAMES,
    _tf_to_seconds,
    get_source,
    list_sources,
    load_symbols,
)


# --- Wire types ----------------------------------------------------------------

def test_candle_to_dict_round_trip():
    c = Candle(time=1_700_000_000, open=1.0, high=2.0, low=0.5, close=1.5, volume=100.0)
    d = c.to_dict()
    assert d == {
        "time": 1_700_000_000,
        "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5,
        "volume": 100.0,
    }
    c2 = Candle(**d)
    assert c2 == c


def test_quote_dataclass_fields():
    q = Quote(time=42, price=3.14, source="hyperliquid", symbol="BTC")
    assert (q.time, q.price, q.source, q.symbol) == (42, 3.14, "hyperliquid", "BTC")


# --- Timeframe helpers ---------------------------------------------------------

@pytest.mark.parametrize("tf,sec", [
    ("1m", 60), ("5m", 300), ("15m", 900),
    ("1h", 3600), ("4h", 14400), ("1d", 86400),
])
def test_tf_to_seconds(tf, sec):
    assert _tf_to_seconds(tf) == sec


def test_timeframes_all_parseable():
    assert TIMEFRAMES, "TIMEFRAMES must be non-empty"
    for tf in TIMEFRAMES:
        assert _tf_to_seconds(tf) > 0


# --- Registry ------------------------------------------------------------------

def test_list_sources_includes_registered():
    out = list_sources()
    names = {s["name"] for s in out}
    assert "hyperliquid" in names
    assert "yfinance" in names
    for s in out:
        assert "asset_class" in s


def test_get_source_unknown_raises():
    with pytest.raises(KeyError):
        get_source("not_a_real_source")


def test_get_source_returns_instance():
    src = get_source("hyperliquid")
    assert src is REGISTRY["hyperliquid"]


# --- Curated symbol loader -----------------------------------------------------

def test_load_symbols_reads_json(tmp_path: Path):
    p = tmp_path / "symbols.json"
    p.write_text(json.dumps([
        {"symbol": "AAPL", "label": "Apple", "source": "yfinance", "asset_class": "stock"},
    ]))
    got = load_symbols(str(p))
    assert len(got) == 1
    assert got[0]["symbol"] == "AAPL"
