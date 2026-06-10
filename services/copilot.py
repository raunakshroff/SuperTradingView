"""Copilot — LLM-backed market Q&A grounded in the active pane's chart data.

Builds a compact market-context block from recent candles, then streams a
Claude answer (Anthropic SDK, `claude-opus-4-8`). The `anthropic` package and
an ANTHROPIC_API_KEY in the environment are required; without them the
endpoint returns a clear 503 instead of failing mid-stream.
"""

from __future__ import annotations

import logging
import math
import os
from datetime import datetime, timezone
from typing import Any, Iterator

from services.signals import rsi, sma

log = logging.getLogger(__name__)

MODEL = "claude-opus-4-8"
RECENT_BARS = 30  # raw OHLCV rows included in the prompt

SYSTEM_PROMPT = (
    "You are the SuperTradingView copilot, a market-analysis assistant embedded "
    "in a charting dashboard. You receive a snapshot of recent OHLCV data and "
    "derived statistics for the symbol the user is viewing. Ground every claim "
    "in that snapshot; if the data does not support an answer, say so plainly.\n"
    "\n"
    "Rules:\n"
    "- Be concise: a few short sentences or a tight list. No headers.\n"
    "- Plain text only, no markdown formatting.\n"
    "- Quote concrete numbers from the context when relevant.\n"
    "- Frame observations as technical analysis, never as personalized "
    "investment advice or a recommendation to buy or sell."
)


class CopilotUnavailable(RuntimeError):
    """Raised when the copilot cannot run (missing package or credentials)."""


def _pct(now: float, then: float) -> float | None:
    if then == 0:
        return None
    return (now / then - 1) * 100


def _fmt(v: float | None, suffix: str = "") -> str:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "n/a"
    return f"{v:.2f}{suffix}"


def build_context(symbol: str, source: str, tf: str, candles: list[dict[str, Any]]) -> str:
    """Render a compact, token-cheap context block from /history-shaped candles."""
    head = f"Symbol: {symbol} (source: {source}, timeframe: {tf})"
    if not candles:
        return f"{head}\nNo candle data is available for this symbol/timeframe."

    closes = [float(c["close"]) for c in candles]
    last = closes[-1]
    lines = [head, f"Bars available: {len(candles)}"]

    start = datetime.fromtimestamp(int(candles[0]["time"]), tz=timezone.utc)
    end = datetime.fromtimestamp(int(candles[-1]["time"]), tz=timezone.utc)
    lines.append(f"Data range: {start:%Y-%m-%d %H:%M} to {end:%Y-%m-%d %H:%M} UTC")
    lines.append(f"Last close: {_fmt(last)}")

    for n, label in ((1, "1-bar"), (5, "5-bar"), (20, "20-bar")):
        if len(closes) > n:
            lines.append(f"{label} change: {_fmt(_pct(last, closes[-1 - n]), '%')}")

    window = closes[-20:]
    lines.append(f"20-bar high/low: {_fmt(max(window))} / {_fmt(min(window))}")

    rsi14 = rsi(closes, 14)
    if rsi14 and rsi14[-1] is not None:
        lines.append(f"RSI(14): {_fmt(rsi14[-1])}")
    for n in (50, 200):
        ma = sma(closes, n)
        if ma and ma[-1] is not None:
            rel = "above" if last > ma[-1] else "below"
            lines.append(f"SMA{n}: {_fmt(ma[-1])} (price {rel})")

    lines.append(f"\nMost recent {min(RECENT_BARS, len(candles))} bars (time,open,high,low,close,volume):")
    for c in candles[-RECENT_BARS:]:
        t = datetime.fromtimestamp(int(c["time"]), tz=timezone.utc)
        lines.append(
            f"{t:%Y-%m-%d %H:%M},{c['open']},{c['high']},{c['low']},{c['close']},{c['volume']}"
        )
    return "\n".join(lines)


def _make_client():
    try:
        import anthropic
    except ImportError as e:
        raise CopilotUnavailable(
            "Copilot is not installed on the server: pip install anthropic"
        ) from e
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        raise CopilotUnavailable(
            "Copilot is not configured: set ANTHROPIC_API_KEY in the server environment"
        )
    try:
        return anthropic, anthropic.Anthropic()
    except Exception as e:
        raise CopilotUnavailable(f"Copilot client failed to initialise: {e}") from e


def stream_answer(question: str, context: str) -> Iterator[str]:
    """Yield answer text chunks. Raises CopilotUnavailable before the first
    chunk if the SDK or credentials are missing, so the route can 503 cleanly;
    errors mid-stream are yielded as readable text instead."""
    anthropic, client = _make_client()

    def gen() -> Iterator[str]:
        try:
            with client.messages.stream(
                model=MODEL,
                max_tokens=16000,
                thinking={"type": "adaptive"},
                system=SYSTEM_PROMPT,
                messages=[{
                    "role": "user",
                    "content": f"{context}\n\nQuestion: {question}",
                }],
            ) as stream:
                for text in stream.text_stream:
                    yield text
        except anthropic.AuthenticationError:
            yield "\n[copilot error: invalid ANTHROPIC_API_KEY]"
        except anthropic.RateLimitError:
            yield "\n[copilot error: rate limited, try again shortly]"
        except anthropic.APIConnectionError:
            yield "\n[copilot error: could not reach the Anthropic API]"
        except anthropic.APIStatusError as e:
            log.warning("copilot API error: %s: %s", type(e).__name__, e)
            yield f"\n[copilot error: API returned {e.status_code}]"

    return gen()
