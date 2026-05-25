import pytest
from unittest.mock import patch, MagicMock

from services.news import _entry_to_item, fetch_news, _cache


@pytest.fixture(autouse=True)
def _clear_cache():
    _cache._store.clear()
    yield
    _cache._store.clear()


def test_entry_to_item_yahoo():
    e = MagicMock()
    e.title = "Headline about NVDA"
    e.link = "https://finance.yahoo.com/news/abc"
    e.published_parsed = (2026, 5, 22, 14, 12, 0, 0, 0, 0)
    item = _entry_to_item(e, "finance.yahoo.com")
    assert item["text"] == "Headline about NVDA"
    assert item["url"] == "https://finance.yahoo.com/news/abc"
    assert item["source"] == "YAHOO"
    assert item["time"] == "14:12"


def test_entry_to_item_reuters():
    e = MagicMock()
    e.title = "Markets close higher"
    e.link = "https://reuters.com/business/abc"
    e.published_parsed = (2026, 5, 22, 13, 48, 0, 0, 0, 0)
    item = _entry_to_item(e, "feeds.reuters.com")
    assert item["source"] == "RTRS"


def test_fetch_news_merges_and_sorts():
    fake_y = MagicMock()
    fake_y.entries = [MagicMock(title="Y1", link="https://finance.yahoo.com/y1",
                                 published_parsed=(2026, 5, 22, 12, 0, 0, 0, 0, 0))]
    fake_r = MagicMock()
    fake_r.entries = [MagicMock(title="R1", link="https://reuters.com/r1",
                                 published_parsed=(2026, 5, 22, 14, 0, 0, 0, 0, 0))]
    fake_m = MagicMock()
    fake_m.entries = []

    with patch("services.news.feedparser.parse", side_effect=[fake_y, fake_r, fake_m]):
        items = fetch_news()

    # Newer first
    assert items[0]["text"] == "R1"
    assert items[1]["text"] == "Y1"


def test_fetch_news_handles_failing_feed():
    fake_ok = MagicMock()
    fake_ok.entries = [MagicMock(title="OK", link="https://reuters.com/x",
                                  published_parsed=(2026, 5, 22, 14, 0, 0, 0, 0, 0))]

    with patch("services.news.feedparser.parse", side_effect=[Exception("boom"), fake_ok, Exception("boom")]):
        items = fetch_news()
    assert len(items) == 1
    assert items[0]["text"] == "OK"
