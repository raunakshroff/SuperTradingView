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
    TIMEFRAMES,
    get_source,
    list_sources,
    load_symbols,
)

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
SYMBOLS_FILE = BASE_DIR / "symbols.json"

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
    q = (request.args.get("q") or "").strip().lower()
    items = load_symbols(str(SYMBOLS_FILE))
    if q:
        items = [
            s for s in items
            if q in s["symbol"].lower() or q in s["label"].lower()
        ]
    return jsonify({"symbols": items, "timeframes": TIMEFRAMES})


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
