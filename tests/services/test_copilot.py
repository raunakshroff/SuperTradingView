import sys
import types

import pytest

from services.copilot import (
    CopilotUnavailable,
    SYSTEM_PROMPT,
    build_context,
    stream_answer,
)


def _candles(n=60, start_price=100.0):
    out = []
    price = start_price
    for i in range(n):
        price += 0.5
        out.append({
            "time": 1_700_000_000 + i * 86400,
            "open": price - 0.3,
            "high": price + 0.5,
            "low": price - 0.6,
            "close": price,
            "volume": 1000 + i,
        })
    return out


# --- build_context -------------------------------------------------------------

def test_build_context_includes_symbol_and_stats():
    ctx = build_context("BTC", "hyperliquid", "1h", _candles(60))
    assert "Symbol: BTC (source: hyperliquid, timeframe: 1h)" in ctx
    assert "Bars available: 60" in ctx
    assert "Last close:" in ctx
    assert "RSI(14):" in ctx
    assert "SMA50:" in ctx
    assert "20-bar high/low:" in ctx


def test_build_context_limits_raw_bars():
    ctx = build_context("BTC", "hyperliquid", "1h", _candles(200))
    # Only the trailing RECENT_BARS rows of raw OHLCV should be included
    csv_rows = [l for l in ctx.splitlines() if l[:4].isdigit() and l.count(",") == 5]
    assert len(csv_rows) == 30


def test_build_context_empty_candles():
    ctx = build_context("BTC", "hyperliquid", "1h", [])
    assert "No candle data" in ctx
    assert "BTC" in ctx


def test_build_context_short_history_omits_unavailable_stats():
    ctx = build_context("X", "yfinance", "1d", _candles(10))
    assert "SMA200" not in ctx
    assert "Bars available: 10" in ctx


# --- stream_answer -------------------------------------------------------------

class _FakeStream:
    def __init__(self, chunks):
        self.text_stream = iter(chunks)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _fake_anthropic(chunks, captured):
    mod = types.ModuleType("anthropic")

    class _Messages:
        def stream(self, **kwargs):
            captured.update(kwargs)
            return _FakeStream(chunks)

    class Anthropic:
        def __init__(self, *a, **k):
            self.messages = _Messages()

    class _Err(Exception):
        pass

    mod.Anthropic = Anthropic
    mod.AuthenticationError = _Err
    mod.RateLimitError = _Err
    mod.APIConnectionError = _Err
    mod.APIStatusError = _Err
    return mod


def test_stream_answer_yields_chunks_and_passes_context(monkeypatch):
    captured = {}
    monkeypatch.setitem(sys.modules, "anthropic", _fake_anthropic(["foo", "bar"], captured))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    chunks = list(stream_answer("Is the trend up?", "CONTEXT BLOCK"))

    assert chunks == ["foo", "bar"]
    assert captured["model"] == "claude-opus-4-8"
    assert captured["thinking"] == {"type": "adaptive"}
    assert captured["system"] == SYSTEM_PROMPT
    assert "CONTEXT BLOCK" in captured["messages"][0]["content"]
    assert "Is the trend up?" in captured["messages"][0]["content"]


def test_stream_answer_raises_without_api_key(monkeypatch):
    captured = {}
    monkeypatch.setitem(sys.modules, "anthropic", _fake_anthropic([], captured))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)

    with pytest.raises(CopilotUnavailable, match="ANTHROPIC_API_KEY"):
        stream_answer("q", "ctx")


def test_stream_answer_raises_without_package(monkeypatch):
    # A None entry in sys.modules makes `import anthropic` raise ImportError
    monkeypatch.setitem(sys.modules, "anthropic", None)

    with pytest.raises(CopilotUnavailable, match="pip install anthropic"):
        stream_answer("q", "ctx")
