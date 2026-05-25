import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from services.events import load_calendar, humanize_when, list_events, _earnings_cache


@pytest.fixture(autouse=True)
def _clear_cache():
    _earnings_cache._store.clear()
    yield
    _earnings_cache._store.clear()


def test_load_calendar_reads_json(tmp_path):
    p = tmp_path / "events.json"
    p.write_text(json.dumps({"calendar": [
        {"date": "2026-05-22", "time": "14:00", "label": "FOMC", "tone": "warn"},
    ]}))
    items = load_calendar(p)
    assert len(items) == 1
    assert items[0]["label"] == "FOMC"


def test_humanize_when_in_minutes():
    now = datetime(2026, 5, 22, 13, 42, tzinfo=timezone.utc)
    when_dt = datetime(2026, 5, 22, 14, 0, tzinfo=timezone.utc)
    assert humanize_when(when_dt, now=now) == "in 18m"


def test_humanize_when_today_time():
    now = datetime(2026, 5, 22, 10, 0, tzinfo=timezone.utc)
    when_dt = datetime(2026, 5, 22, 15, 30, tzinfo=timezone.utc)
    assert humanize_when(when_dt, now=now) == "15:30"


def test_humanize_when_tomorrow():
    now = datetime(2026, 5, 22, 10, 0, tzinfo=timezone.utc)
    when_dt = datetime(2026, 5, 23, 8, 30, tzinfo=timezone.utc)
    assert humanize_when(when_dt, now=now) == "Tomorrow"


def test_humanize_when_dow_for_week():
    now = datetime(2026, 5, 22, 10, 0, tzinfo=timezone.utc)  # Friday
    when_dt = datetime(2026, 5, 28, 10, 0, tzinfo=timezone.utc)  # next Thursday
    assert humanize_when(when_dt, now=now) == "Thu"


def test_list_events_merges_calendar_and_earnings(tmp_path):
    p = tmp_path / "events.json"
    now = datetime(2026, 5, 22, 10, 0, tzinfo=timezone.utc)
    # Calendar event today at 14:00 UTC
    p.write_text(json.dumps({"calendar": [
        {"date": "2026-05-22", "time": "14:00", "label": "FOMC", "tone": "warn"},
    ]}))

    fake_ticker = MagicMock()
    fake_ticker.calendar = {"Earnings Date": [datetime(2026, 5, 22, 21, 0, tzinfo=timezone.utc)]}

    with patch("services.events.yf.Ticker", return_value=fake_ticker):
        items = list_events(p, ["NVDA"], now=now)

    labels = [it["label"] for it in items]
    assert "FOMC" in labels
    assert any("NVDA earnings" in lbl for lbl in labels)


def test_list_events_handles_yf_error(tmp_path):
    p = tmp_path / "events.json"
    p.write_text(json.dumps({"calendar": []}))
    with patch("services.events.yf.Ticker", side_effect=Exception("network")):
        items = list_events(p, ["NVDA"])
    assert items == []
