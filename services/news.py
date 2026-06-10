"""News tape — RSS aggregator over Yahoo Finance, Reuters Business, MarketWatch.

Returns the latest 10 headlines merged + sorted desc by publish time. Cached
5 minutes via TTLCache. Failures per feed are swallowed silently — empty
contribution rather than 500.
"""

from __future__ import annotations

import logging
import time
from typing import Any
from urllib.parse import urlparse

import feedparser

from services._cache import TTLCache

log = logging.getLogger(__name__)

FEEDS = [
    "https://finance.yahoo.com/rss/topstories",
    "https://feeds.reuters.com/reuters/businessNews",
    "https://feeds.marketwatch.com/marketwatch/topstories/",
]

_SOURCE_MAP = {
    "finance.yahoo.com": "YAHOO",
    "feeds.reuters.com": "RTRS",
    "reuters.com": "RTRS",
    "feeds.marketwatch.com": "WSJ",
    "marketwatch.com": "WSJ",
}

_cache = TTLCache(ttl_seconds=300)


def _entry_to_item(entry: Any, host: str) -> dict[str, Any]:
    pp = getattr(entry, "published_parsed", None)
    if pp:
        hh = f"{pp[3]:02d}"
        mm = f"{pp[4]:02d}"
        ts_str = f"{hh}:{mm}"
        ts_epoch = int(time.mktime(tuple(pp)))
    else:
        ts_str = "--:--"
        ts_epoch = 0
    source = _SOURCE_MAP.get(host, host.split(".")[0].upper())
    return {
        "time": ts_str,
        "ts_epoch": ts_epoch,
        "source": source,
        "text": getattr(entry, "title", ""),
        "url": getattr(entry, "link", ""),
    }


def fetch_news() -> list[dict[str, Any]]:
    def _compute():
        items: list[dict[str, Any]] = []
        for url in FEEDS:
            try:
                parsed = feedparser.parse(url)
                host = urlparse(url).netloc
                for e in getattr(parsed, "entries", [])[:8]:
                    items.append(_entry_to_item(e, host))
            except Exception as e:
                log.warning("feed fetch failed for %s: %s: %s", url, type(e).__name__, e)
                continue
        items.sort(key=lambda x: x.get("ts_epoch", 0), reverse=True)
        return items[:10]

    return _cache.get_or_compute("news", _compute, stale_ok=True)
