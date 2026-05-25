import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from services.sectors import SectorLookup


def test_get_sector_caches_in_memory(tmp_path):
    fake_ticker = MagicMock()
    fake_ticker.info = {"sector": "Technology"}
    with patch("services.sectors.yf.Ticker", return_value=fake_ticker) as ticker_cls:
        s = SectorLookup(tmp_path / "cache.json")
        assert s.get("NVDA") == "Technology"
        assert s.get("NVDA") == "Technology"  # second call — no new ticker fetch
        assert ticker_cls.call_count == 1


def test_get_sector_persists_to_disk(tmp_path):
    fake_ticker = MagicMock()
    fake_ticker.info = {"sector": "Energy"}
    cache_file = tmp_path / "cache.json"
    with patch("services.sectors.yf.Ticker", return_value=fake_ticker):
        s = SectorLookup(cache_file)
        s.get("XOM")
        s.flush()
    assert cache_file.exists()
    on_disk = json.loads(cache_file.read_text())
    assert on_disk["XOM"] == "Energy"


def test_get_sector_loads_existing_cache(tmp_path):
    cache_file = tmp_path / "cache.json"
    cache_file.write_text(json.dumps({"AAPL": "Technology"}))
    with patch("services.sectors.yf.Ticker") as ticker_cls:
        s = SectorLookup(cache_file)
        assert s.get("AAPL") == "Technology"
        ticker_cls.assert_not_called()


def test_get_sector_unknown_returns_unknown(tmp_path):
    fake_ticker = MagicMock()
    fake_ticker.info = {}
    with patch("services.sectors.yf.Ticker", return_value=fake_ticker):
        s = SectorLookup(tmp_path / "cache.json")
        assert s.get("WHAT") == "Unknown"


def test_get_sector_yf_error_returns_unknown(tmp_path):
    with patch("services.sectors.yf.Ticker", side_effect=Exception("net")):
        s = SectorLookup(tmp_path / "cache.json")
        assert s.get("XXX") == "Unknown"


def test_bulk_returns_dict(tmp_path):
    def make_ticker(sym):
        m = MagicMock()
        m.info = {"sector": {"AAPL": "Technology", "XOM": "Energy"}.get(sym, "Unknown")}
        return m
    with patch("services.sectors.yf.Ticker", side_effect=make_ticker):
        s = SectorLookup(tmp_path / "cache.json")
        out = s.bulk(["AAPL", "XOM"])
    assert out == {"AAPL": "Technology", "XOM": "Energy"}
