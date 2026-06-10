#!/usr/bin/env python3
"""Regenerate the README screenshots in docs/.

Boots the Flask app, seeds localStorage with a known workspace state, waits
for live data to render, and captures:

  docs/screenshot.png            — hero: 2x2 grid with indicators across panes
  docs/chart-patterns-modal.png  — single pane with the Chart Patterns indicator

Requires internet access (Hyperliquid/Yahoo data + the Lightweight Charts CDN)
and Playwright:

    pip install playwright && python -m playwright install chromium
    python scripts/capture_screenshots.py

Pass --base-url http://127.0.0.1:5173 to attach to an already-running server
instead of spawning one.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs"

VIEWPORT = {"width": 1600, "height": 900}

# Eight slots are always persisted; the visible count comes from the layout.
_DEFAULT = {"source": "hyperliquid", "symbol": "BTC", "tf": "1m", "indicators": {}}

HERO_STATE = {
    "stv.theme": "dark",
    "stv.personality": "Quant",  # any value — stops boot from re-applying a preset
    "stv.layoutId": "5",         # 2x2
    "stv.panes": json.dumps([
        {"source": "hyperliquid", "symbol": "BTC", "tf": "1m",
         "indicators": {"ema": {"period": 20}, "rsi": {"period": 14}}},
        {"source": "hyperliquid", "symbol": "ETH", "tf": "1m",
         "indicators": {"bb": {"period": 20, "mult": 2}}},
        {"source": "hyperliquid", "symbol": "SOL", "tf": "1m",
         "indicators": {"macd": {"fast": 12, "slow": 26, "signal": 9}}},
        {"source": "yfinance", "symbol": "RELIANCE.NS", "tf": "1d",
         "indicators": {"sma": {"period": 20}, "volume": {}}},
        _DEFAULT, _DEFAULT, _DEFAULT, _DEFAULT,
    ]),
}

PATTERNS_STATE = {
    "stv.theme": "dark",
    "stv.personality": "Minimalist",
    "stv.layoutId": "1",  # single pane
    "stv.panes": json.dumps([
        {"source": "yfinance", "symbol": "AAPL", "tf": "1d",
         "indicators": {"chartpatterns": {"lookback": 200, "strength": 5, "tol": 4}}},
        _DEFAULT, _DEFAULT, _DEFAULT, _DEFAULT, _DEFAULT, _DEFAULT, _DEFAULT,
    ]),
}


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_server(url: str, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"{url}/sources", timeout=2)
            return
        except OSError:
            time.sleep(0.4)
    raise RuntimeError(f"server at {url} did not come up within {timeout}s")


def _seed_script(state: dict[str, str]) -> str:
    return "".join(
        f"localStorage.setItem({json.dumps(k)}, {json.dumps(v)});" for k, v in state.items()
    )


def _capture(browser, base_url: str, state: dict[str, str], out: Path,
             min_live_panes: int, settle_ms: int = 5000) -> None:
    ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=1)
    ctx.add_init_script(_seed_script(state))
    page = ctx.new_page()
    page.goto(base_url, wait_until="networkidle")
    page.wait_for_selector(".pane canvas", timeout=30_000)
    # A pane is "live" once its ticker shows a price instead of the — placeholder
    page.wait_for_function(
        """(n) => [...document.querySelectorAll('.ticker-price')]
                  .filter((e) => e.textContent.trim() !== '—').length >= n""",
        arg=min_live_panes,
        timeout=60_000,
    )
    page.wait_for_timeout(settle_ms)  # let sub-panes, markers, and rails settle
    page.screenshot(path=str(out))
    ctx.close()
    print(f"wrote {out.relative_to(REPO)}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base-url", help="attach to a running server instead of spawning one")
    args = ap.parse_args()

    proc = None
    if args.base_url:
        base_url = args.base_url.rstrip("/")
    else:
        port = _free_port()
        base_url = f"http://127.0.0.1:{port}"
        proc = subprocess.Popen(
            [sys.executable, str(REPO / "app.py")],
            env={**os.environ, "PORT": str(port)},
            cwd=str(REPO),
        )

    try:
        _wait_for_server(base_url)
        DOCS.mkdir(exist_ok=True)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            _capture(browser, base_url, HERO_STATE, DOCS / "screenshot.png", min_live_panes=3)
            _capture(browser, base_url, PATTERNS_STATE, DOCS / "chart-patterns-modal.png",
                     min_live_panes=1, settle_ms=7000)
            browser.close()
    finally:
        if proc is not None:
            proc.terminate()
            proc.wait(timeout=10)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
