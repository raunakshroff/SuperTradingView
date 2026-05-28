# tests/test_app.py
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

import app as app_module
from app import app


@pytest.fixture
def client():
    app.config["TESTING"] = True
    return app.test_client()


# --- Static / index ------------------------------------------------------------

def test_index_serves_index_html(client):
    r = client.get("/")
    assert r.status_code == 200
    assert b"<html" in r.data.lower()


def test_static_route_serves_file(client):
    r = client.get("/static/app.js")
    assert r.status_code == 200


# --- /sources ------------------------------------------------------------------

def test_sources_returns_registered_list(client):
    r = client.get("/sources")
    assert r.status_code == 200
    body = r.get_json()
    names = {s["name"] for s in body}
    assert "yfinance" in names and "hyperliquid" in names


# --- /symbols ------------------------------------------------------------------

def test_symbols_no_query_returns_curated_plus_timeframes(client):
    r = client.get("/symbols")
    assert r.status_code == 200
    body = r.get_json()
    assert isinstance(body["symbols"], list)
    assert isinstance(body["timeframes"], list) and body["timeframes"]


def test_symbols_with_query_merges_curated_and_sources(client):
    fake_source = MagicMock()
    fake_source.search_symbols.return_value = [
        {"symbol": "AAPL", "label": "Apple", "source": "yfinance", "asset_class": "stock"},
        {"symbol": "aapl", "label": "dup",   "source": "yfinance", "asset_class": "stock"},
    ]
    with patch.dict("app.REGISTRY", {"yfinance": fake_source}, clear=True):
        r = client.get("/symbols?q=AAPL")
    body = r.get_json()
    upper_syms = [s["symbol"].upper() for s in body["symbols"]]
    assert upper_syms.count("AAPL") == 1


def test_symbols_one_broken_source_doesnt_kill_response(client):
    good = MagicMock()
    good.search_symbols.return_value = [
        {"symbol": "GOOD", "label": "Good", "source": "good", "asset_class": "stock"},
    ]
    bad = MagicMock()
    bad.search_symbols.side_effect = RuntimeError("boom")
    with patch.dict("app.REGISTRY", {"good": good, "bad": bad}, clear=True):
        r = client.get("/symbols?q=anything")
    assert r.status_code == 200
    syms = [s["symbol"] for s in r.get_json()["symbols"]]
    assert "GOOD" in syms


# --- Service-backed routes (all mocked at app.* import) -----------------------

def test_narratives_returns_list(client):
    with patch.object(app_module, "list_narratives", return_value=[{"id": "x"}]):
        r = client.get("/narratives")
    assert r.status_code == 200
    assert r.get_json() == {"narratives": [{"id": "x"}]}


def test_news_returns_list(client):
    with patch.object(app_module, "fetch_news", return_value=[{"title": "T"}]):
        r = client.get("/news")
    assert r.status_code == 200
    assert r.get_json() == {"news": [{"title": "T"}]}


def test_events_parses_symbols_param(client):
    captured = {}
    def fake(path, syms):
        captured["syms"] = syms
        return [{"sym": s} for s in syms]
    with patch.object(app_module, "list_events", side_effect=fake):
        r = client.get("/events?symbols=AAPL,%20MSFT%20,,TSLA")
    assert r.status_code == 200
    assert captured["syms"] == ["AAPL", "MSFT", "TSLA"]


def test_factors_uses_factor_universe(client):
    with patch.object(app_module, "factors_cached", return_value=[1, 2, 3]) as m:
        r = client.get("/factors")
    assert r.status_code == 200
    assert r.get_json() == {"factors": [1, 2, 3]}
    m.assert_called_once()


def test_signals_uses_factor_universe(client):
    with patch.object(app_module, "signals_cached", return_value=[{"sig": 1}]):
        r = client.get("/signals")
    assert r.status_code == 200
    assert r.get_json() == {"signals": [{"sig": 1}]}


def test_quote_breadth_returns_breadth_dict(client):
    with patch.object(app_module, "breadth_cached",
                      return_value={"adv": 5, "dec": 2, "us10y": 4.3, "vix": 15}):
        r = client.get("/quote/breadth")
    assert r.status_code == 200
    assert r.get_json()["adv"] == 5
