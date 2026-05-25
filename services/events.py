"""Events — economic calendar + per-symbol earnings dates.

Calendar comes from `events.json` (hand-curated weekly). Earnings dates from
yfinance.Ticker(sym).calendar. Returns next 7 days, sorted asc.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import yfinance as yf

from services._cache import TTLCache

_earnings_cache = TTLCache(ttl_seconds=3600)


def load_calendar(path: Path) -> list[dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        items = data.get("calendar", [])
        return items if isinstance(items, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def humanize_when(when_dt: datetime, *, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    delta = when_dt - now
    mins = int(delta.total_seconds() // 60)
    if 0 <= mins < 60:
        return f"in {mins}m"
    if when_dt.date() == now.date():
        return when_dt.strftime("%H:%M")
    if when_dt.date() == (now.date() + timedelta(days=1)):
        return "Tomorrow"
    days_ahead = (when_dt.date() - now.date()).days
    if 1 < days_ahead < 7:
        return when_dt.strftime("%a")
    return when_dt.strftime("%b %d")


def _earnings_for(sym: str) -> datetime | None:
    def _compute():
        try:
            cal = yf.Ticker(sym).calendar
            if isinstance(cal, dict):
                dates = cal.get("Earnings Date")
                if dates and len(dates) > 0:
                    d = dates[0]
                    if isinstance(d, datetime):
                        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
            return None
        except Exception:
            return None

    return _earnings_cache.get_or_compute(f"earn:{sym}", _compute, stale_ok=True)


def list_events(
    calendar_path: Path,
    symbols: Iterable[str],
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    horizon = now + timedelta(days=7)
    out: list[dict[str, Any]] = []

    for item in load_calendar(calendar_path):
        try:
            dt_str = f"{item['date']} {item.get('time', '00:00')}"
            when_dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        except (KeyError, ValueError):
            continue
        if when_dt < now or when_dt > horizon:
            continue
        out.append({
            "when": humanize_when(when_dt, now=now),
            "label": item.get("label", ""),
            "tone": item.get("tone", "neutral"),
            "ts": when_dt.isoformat(),
        })

    for sym in symbols:
        when_dt = _earnings_for(sym)
        if when_dt is None:
            continue
        if when_dt < now or when_dt > horizon:
            continue
        delta_hours = (when_dt - now).total_seconds() / 3600
        tone = "acid" if delta_hours < 24 else "neutral"
        out.append({
            "when": humanize_when(when_dt, now=now),
            "label": f"{sym} earnings",
            "tone": tone,
            "ts": when_dt.isoformat(),
        })

    out.sort(key=lambda x: x["ts"])
    return out
