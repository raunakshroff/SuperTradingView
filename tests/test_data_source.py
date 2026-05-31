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


# --- YFinanceSource ------------------------------------------------------------

from unittest.mock import MagicMock, patch

from data_source import YFinanceSource


class _FakeRow(dict):
    """Acts like a pandas Series row for .get() / item access."""
    pass


class _FakeDF:
    def __init__(self, rows):
        # rows: list of (timestamp, dict) tuples.
        self._rows = rows
        self.empty = not rows

    def iterrows(self):
        for ts, row in self._rows:
            yield ts, _FakeRow(row)


class _FakeTs:
    def __init__(self, secs):
        self._s = secs

    def timestamp(self):
        return self._s


class _FakeTicker:
    def __init__(self, df=None, fast_info=None):
        self._df = df if df is not None else _FakeDF([])
        self.fast_info = fast_info or {}

    def history(self, period=None, interval=None, auto_adjust=False):
        return self._df


class _FakeYF:
    def __init__(self, ticker=None, search_quotes=None, search_raises=False):
        self._ticker = ticker or _FakeTicker()
        self._search_quotes = search_quotes or []
        self._search_raises = search_raises

    def Ticker(self, symbol):
        return self._ticker

    def Search(self, *args, **kwargs):
        if self._search_raises:
            raise RuntimeError("yahoo down")
        r = MagicMock()
        r.quotes = self._search_quotes
        return r


@pytest.fixture
def yfs():
    return YFinanceSource()


def test_yf_get_history_empty_df_returns_empty(yfs):
    fake = _FakeYF(ticker=_FakeTicker(df=_FakeDF([])))
    with patch.object(YFinanceSource, "_yf", return_value=fake):
        assert yfs.get_history("AAPL", "1m") == []


def test_yf_get_history_maps_row_fields(yfs):
    rows = [
        (_FakeTs(1_700_000_000), {"Open": 1.0, "High": 2.0, "Low": 0.5, "Close": 1.5, "Volume": 10}),
        (_FakeTs(1_700_000_060), {"Open": 1.5, "High": 2.5, "Low": 1.0, "Close": 2.0, "Volume": 20}),
    ]
    fake = _FakeYF(ticker=_FakeTicker(df=_FakeDF(rows)))
    with patch.object(YFinanceSource, "_yf", return_value=fake):
        out = yfs.get_history("AAPL", "1m", limit=10)
    assert len(out) == 2
    assert out[0].time == 1_700_000_000
    assert out[0].close == 1.5 and out[0].volume == 10.0


def test_yf_get_history_truncates_to_limit(yfs):
    rows = [(_FakeTs(i), {"Open": 1, "High": 1, "Low": 1, "Close": 1, "Volume": 0}) for i in range(20)]
    fake = _FakeYF(ticker=_FakeTicker(df=_FakeDF(rows)))
    with patch.object(YFinanceSource, "_yf", return_value=fake):
        out = yfs.get_history("AAPL", "1m", limit=5)
    assert len(out) == 5
    assert [c.time for c in out] == [15, 16, 17, 18, 19]


def test_yf_search_empty_query(yfs):
    assert yfs.search_symbols("") == []


def test_yf_search_exception_returns_empty(yfs):
    fake = _FakeYF(search_raises=True)
    with patch.object(YFinanceSource, "_yf", return_value=fake):
        assert yfs.search_symbols("AAPL") == []


def test_yf_search_maps_quote_type_to_asset_class(yfs):
    quotes = [
        {"symbol": "AAPL", "shortname": "Apple", "quoteType": "EQUITY",         "exchDisp": "NMS"},
        {"symbol": "BTC-USD", "shortname": "Bitcoin", "quoteType": "CRYPTOCURRENCY"},
        {"symbol": "EURUSD=X", "shortname": "EUR/USD", "quoteType": "CURRENCY"},
        {"symbol": "WEIRD", "shortname": "Mystery", "quoteType": "UNKNOWN_TYPE"},
    ]
    fake = _FakeYF(search_quotes=quotes)
    with patch.object(YFinanceSource, "_yf", return_value=fake):
        out = yfs.search_symbols("x")
    by_sym = {s["symbol"]: s for s in out}
    assert by_sym["AAPL"]["asset_class"] == "stock"
    assert by_sym["AAPL"]["label"] == "Apple · NMS"
    assert by_sym["BTC-USD"]["asset_class"] == "crypto"
    assert by_sym["EURUSD=X"]["asset_class"] == "fx"
    assert by_sym["WEIRD"]["asset_class"] == "stock"  # unknown defaults to stock


def test_yf_search_label_fallback_chain(yfs):
    quotes = [
        {"symbol": "A", "longname": "Long A"},
        {"symbol": "B", "name": "Just B"},
        {"symbol": "C"},  # nothing => label is the symbol
    ]
    fake = _FakeYF(search_quotes=quotes)
    with patch.object(YFinanceSource, "_yf", return_value=fake):
        out = yfs.search_symbols("x")
    by_sym = {s["symbol"]: s for s in out}
    assert by_sym["A"]["label"] == "Long A"
    assert by_sym["B"]["label"] == "Just B"
    assert by_sym["C"]["label"] == "C"


def test_yf_search_skips_quote_with_no_symbol(yfs):
    quotes = [{"shortname": "no symbol here"}, {"symbol": "OK"}]
    fake = _FakeYF(search_quotes=quotes)
    with patch.object(YFinanceSource, "_yf", return_value=fake):
        out = yfs.search_symbols("x")
    assert [s["symbol"] for s in out] == ["OK"]


def test_yf_stream_quotes_yields_one_quote(yfs):
    """Run one iteration of the polling loop and stop.

    Strategy: mock fast_info so a price is available, then patch `time.sleep`
    on the *first call* to raise StopIteration, which breaks out of `while True`.
    """
    fake = _FakeYF(ticker=_FakeTicker(fast_info={"last_price": 123.45}))
    with patch.object(YFinanceSource, "_yf", return_value=fake), \
         patch("data_source.time.sleep", side_effect=StopIteration):
        gen = yfs.stream_quotes("AAPL", "1m")
        q = next(gen)
        with pytest.raises(RuntimeError):
            next(gen)
    assert q.price == 123.45
    assert q.source == "yfinance"
    assert q.symbol == "AAPL"


# --- HyperliquidSource ---------------------------------------------------------

from data_source import HyperliquidSource


def _resp(json_body):
    r = MagicMock()
    r.json.return_value = json_body
    r.raise_for_status.return_value = None
    return r


@pytest.fixture
def hl():
    s = HyperliquidSource()
    # Reset class-level caches so tests don't bleed into one another.
    HyperliquidSource._universe_cache = None
    HyperliquidSource._universe_cache_at = 0.0
    return s


def test_hl_get_history_parses_response(hl):
    body = [
        {"t": 1_700_000_000_000, "o": "1", "h": "2", "l": "0.5", "c": "1.5", "v": "10"},
        {"t": 1_700_000_060_000, "o": "1.5", "h": "2.5", "l": "1.0", "c": "2.0", "v": "20"},
    ]
    with patch("data_source.requests.post", return_value=_resp(body)) as post:
        out = hl.get_history("BTC", "1m", limit=10)
    assert len(out) == 2
    assert out[0].time == 1_700_000_000  # ms -> s
    assert out[0].open == 1.0 and out[0].close == 1.5 and out[0].volume == 10.0
    sent = post.call_args.kwargs["json"]
    assert sent["type"] == "candleSnapshot"
    assert sent["req"]["coin"] == "BTC"
    assert sent["req"]["interval"] == "1m"
    assert sent["req"]["endTime"] - sent["req"]["startTime"] == 60 * 1000 * 10


def test_hl_get_history_propagates_http_error(hl):
    bad = MagicMock()
    bad.raise_for_status.side_effect = RuntimeError("boom")
    with patch("data_source.requests.post", return_value=bad), pytest.raises(RuntimeError):
        hl.get_history("BTC", "1m")


def test_hl_stream_quotes_raises_not_implemented(hl):
    with pytest.raises(NotImplementedError):
        next(hl.stream_quotes("BTC", "1m"))


def test_hl_search_empty_query_returns_empty(hl):
    assert hl.search_symbols("") == []
    assert hl.search_symbols("   ") == []


def test_hl_universe_cached_after_first_fetch(hl):
    body = {"universe": [{"name": "BTC"}, {"name": "ETH"}]}
    with patch("data_source.requests.post", return_value=_resp(body)) as post:
        hl.search_symbols("B")
        hl.search_symbols("E")
    assert post.call_count == 1, "universe should be cached across calls"


def test_hl_universe_failure_keeps_prior_cache(hl):
    body = {"universe": [{"name": "BTC"}, {"name": "ETH"}]}
    with patch("data_source.requests.post", return_value=_resp(body)):
        hl.search_symbols("B")
    HyperliquidSource._universe_cache_at = 0.0
    with patch("data_source.requests.post", side_effect=RuntimeError("net down")):
        out = hl.search_symbols("B")
    assert any(s["symbol"] == "BTC" for s in out)


def test_hl_search_filters_delisted(hl):
    body = {"universe": [
        {"name": "BTC"},
        {"name": "OLD", "isDelisted": True},
    ]}
    with patch("data_source.requests.post", return_value=_resp(body)):
        out = hl.search_symbols("O")
    assert all(s["symbol"] != "OLD" for s in out)


def test_hl_search_prefix_matches_sort_first(hl):
    body = {"universe": [
        {"name": "ZZBT"},
        {"name": "BTC"},
        {"name": "BTA"},
    ]}
    with patch("data_source.requests.post", return_value=_resp(body)):
        out = hl.search_symbols("BT")
    syms = [s["symbol"] for s in out]
    assert syms.index("BTA") < syms.index("ZZBT")
    assert syms.index("BTC") < syms.index("ZZBT")


def test_hl_search_truncates_to_25(hl):
    body = {"universe": [{"name": f"X{i:03d}"} for i in range(40)]}
    with patch("data_source.requests.post", return_value=_resp(body)):
        out = hl.search_symbols("X")
    assert len(out) == 25
