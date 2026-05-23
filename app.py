"""SuperTradingView Flask backend.

Bridges yfinance into the browser via SSE, proxies Hyperliquid history to
avoid CORS issues, and serves the static frontend.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

from data_source import (
    REGISTRY,
    TIMEFRAMES,
    get_source,
    list_sources,
    load_symbols,
)
from services.events import list_events
from services.factors import factors_cached
from services.narratives import list_narratives
from services.news import fetch_news

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
SYMBOLS_FILE = BASE_DIR / "symbols.json"
NARRATIVES_FILE = BASE_DIR / "narratives.json"
EVENTS_FILE = BASE_DIR / "events.json"
FACTOR_UNIVERSE_FILE = BASE_DIR / "factor_universe.json"


def _factor_universe():
    try:
        with FACTOR_UNIVERSE_FILE.open("r", encoding="utf-8") as f:
            return json.load(f).get("symbols", [])
    except (OSError, json.JSONDecodeError):
        return []

app = Flask(__name__, static_folder=None)  # we serve static manually


# --- Static --------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/static/<path:path>")
def static_files(path):
    return send_from_directory(STATIC_DIR, path)


# --- Metadata ------------------------------------------------------------------

@app.route("/sources")
def sources():
    return jsonify(list_sources())


@app.route("/symbols")
def symbols():
    """Symbol search.

    - No `q`: return the curated symbols.json list (instant, no network).
    - With `q`: return curated matches first, then live results from every
      data source's `search_symbols(q)` (Hyperliquid meta + Yahoo Search via
      yfinance). De-duped by symbol (case-insensitive).
    """
    q = (request.args.get("q") or "").strip()
    curated = load_symbols(str(SYMBOLS_FILE))

    if not q:
        return jsonify({"symbols": curated, "timeframes": TIMEFRAMES})

    ql = q.lower()
    seen: set[str] = set()
    merged: list[dict] = []

    def add(item: dict) -> None:
        key = item["symbol"].upper()
        if key in seen:
            return
        seen.add(key)
        merged.append(item)

    # Curated matches first
    for s in curated:
        if ql in s["symbol"].lower() or ql in s["label"].lower():
            add(s)

    # Live searches from every registered source
    for src in REGISTRY.values():
        try:
            for s in src.search_symbols(q):
                add(s)
        except Exception:
            # Don't let one broken source kill the response
            continue

    return jsonify({"symbols": merged[:50], "timeframes": TIMEFRAMES})


@app.route("/narratives")
def narratives():
    return jsonify({"narratives": list_narratives(NARRATIVES_FILE)})


@app.route("/news")
def news():
    return jsonify({"news": fetch_news()})


@app.route("/events")
def events():
    syms_arg = request.args.get("symbols", "")
    symbols = [s.strip() for s in syms_arg.split(",") if s.strip()]
    return jsonify({"events": list_events(EVENTS_FILE, symbols)})


@app.route("/factors")
def factors():
    return jsonify({"factors": factors_cached(_factor_universe())})


# --- History -------------------------------------------------------------------

@app.route("/history")
def history():
    source_name = request.args.get("source", "")
    symbol = request.args.get("symbol", "")
    tf = request.args.get("tf", "1m")
    limit = int(request.args.get("limit", "500"))
    try:
        src = get_source(source_name)
        candles = src.get_history(symbol, tf, limit)
        return jsonify([c.to_dict() for c in candles])
    except KeyError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# --- Live stream (SSE) ---------------------------------------------------------

@app.route("/stream/quotes")
def stream_quotes():
    source_name = request.args.get("source", "")
    symbol = request.args.get("symbol", "")
    tf = request.args.get("tf", "1m")

    try:
        src = get_source(source_name)
    except KeyError as e:
        return jsonify({"error": str(e)}), 404

    def gen():
        # initial comment so the connection opens immediately in the browser
        yield ": connected\n\n"
        try:
            for quote in src.stream_quotes(symbol, tf):
                payload = json.dumps({
                    "time":   quote.time,
                    "price":  quote.price,
                    "source": quote.source,
                    "symbol": quote.symbol,
                })
                yield f"data: {payload}\n\n"
        except GeneratorExit:
            return
        except NotImplementedError:
            yield "event: error\ndata: \"streaming not supported for this source\"\n\n"
        except Exception as e:
            err = json.dumps(str(e))
            yield f"event: error\ndata: {err}\n\n"

    return Response(
        gen(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# --- Main ----------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5173"))
    # threaded=True so SSE connections don't block other requests
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
