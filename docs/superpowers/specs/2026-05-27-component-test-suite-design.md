# Component Test Suite — Design

**Date:** 2026-05-27
**Status:** Approved (scope), pending plan
**Goal:** Catch regressions in pure logic when any component changes — backend Flask routes, the pluggable `DataSource` layer, frontend indicator math, and frontend drawing geometry. Service tests already exist and are not in scope.

## Motivation

The project currently relies on manual smoke testing (curl + browser). All eight `services/*` modules already have pytest coverage. Three components have no automated tests:

- `app.py` — Flask routes (`/sources`, `/symbols`, `/history`, `/stream/quotes`, `/narratives`, `/news`, `/events`, `/factors`, `/signals`, `/quote/breadth`, `/`, `/static/<path>`).
- `data_source.py` — `Candle`/`Quote` types, `_tf_to_seconds`, `HyperliquidSource`, `YFinanceSource`, registry helpers, curated symbol loader.
- `static/indicators.js`, `static/drawings.js` — pure indicator math and drawing geometry, both invoked through dispatch tables (`Indicators.DEFS`, `Drawings.TOOL_DEFS`).

These are the highest-leverage areas for regression tests: indicator math errors are silent, route contract changes break the frontend, and drawing geometry bugs surface only on mouse interaction.

## Scope

**In scope**
- `tests/test_app.py` — Flask route contracts via `app.test_client()`, all services and sources mocked.
- `tests/test_data_source.py` — `DataSource` interface, registry, both source implementations with `requests` and `yfinance` mocked.
- `tests/frontend/test_indicators.js` — `compute()` for every indicator in `Indicators.DEFS`.
- `tests/frontend/test_drawings.js` — `hitTest`, `handles`, `moveHandle`, `moveAll` for every entry in `Drawings.TOOL_DEFS`, plus `DrawingStore` and `PrefsStore` persistence shape validation.

**Out of scope**
- DOM rendering, chart interactions, layout switching, `app.js` integration glue — would require jsdom or Playwright.
- Real network calls. Every external service (Hyperliquid HTTP, yfinance, RSS feeds) is mocked.
- CI workflow files. Developer-local runs only; CI can be added later without touching test code.

## Architecture

### Backend tests (pytest)

Follow the existing `tests/services/` pattern: `unittest.mock.patch` at the seam, no fixtures for the Flask app beyond a module-level `client = app.test_client()`. Tests live at `tests/` root so `pytest.ini`'s `testpaths = tests` picks them up alongside the existing service tests.

**`tests/test_app.py`** — Flask routes
- One `client` fixture wrapping `app.test_client()`.
- For data routes (`/narratives`, `/news`, `/events`, `/factors`, `/signals`, `/quote/breadth`), patch the imported service function in `app` module namespace and assert response shape and status.
- `/symbols` — three tests: no `q` returns curated + timeframes; with `q` merges curated + each source's `search_symbols`, de-dupes case-insensitively; one broken source doesn't kill the response.
- `/history` — success, unknown source → 404, source raises → 500.
- `/stream/quotes` — consume the generator directly (don't run a server). Verify: comment prelude, `data:` framing for normal quotes, `event: error` for `NotImplementedError`, `event: error` with JSON-encoded message for generic exceptions.

**`tests/test_data_source.py`** — Source layer
- `Candle.to_dict` round-trip; `_tf_to_seconds("1m"|"5m"|"1h"|"4h"|"1d")`; `TIMEFRAMES` non-empty and all entries parseable.
- `get_source` unknown name → `KeyError`; `list_sources` returns name + asset_class for each registered.
- `load_symbols` reads a temp JSON file.
- `HyperliquidSource.get_history` — patch `requests.post`, assert request payload (`type=candleSnapshot`, `coin`, `interval`, time window), parse response into `Candle` list, propagate HTTP errors.
- `HyperliquidSource._get_universe` — TTL hit returns cached, TTL miss refetches, request exception keeps prior cache (no wipe).
- `HyperliquidSource.search_symbols` — empty query → `[]`, delisted filtered out, sort puts prefix matches first, truncated to 25.
- `HyperliquidSource.stream_quotes` → `NotImplementedError`.
- `YFinanceSource.get_history` — patch `yf.Ticker.history` to return a fake DataFrame; empty df → `[]`; `limit` slices to last N; row → `Candle` field mapping.
- `YFinanceSource.search_symbols` — patch `yf.Search`; `quoteType` → `asset_class` mapping (`EQUITY`, `CRYPTOCURRENCY`, `CURRENCY`, unknown → `stock`), label fallback chain (`shortname` → `longname` → `name` → `symbol`), `exchDisp` appended when present, internal exception swallowed → `[]`.
- `YFinanceSource.stream_quotes` — one-iteration test: mock `time.sleep` to raise `StopIteration` after first call, mock `fast_info.last_price`, assert one `Quote` is yielded with the right price/source/symbol.

### Frontend tests (Node built-in test runner)

**Why `node:test`** — Node 24 ships it; zero npm dependencies. The IIFE-wrapped scripts attach to `window.Indicators` / `window.Drawings`, so we load them in a `vm` context with a fake `window`/`localStorage`/`document` and read the globals back out. No source edits.

**`tests/frontend/_sandbox.js`** — bootstrap shim
```js
// Provides loadBrowserScript(relativePath) -> sandbox object
// (sandbox.window.Indicators / sandbox.window.Drawings)
```
The shim creates a fresh sandbox per call so tests don't leak `localStorage` state.

**`tests/frontend/test_indicators.js`** — Indicator math
- Setup: `const { Indicators } = loadBrowserScript('../../static/indicators.js')`.
- Per-indicator generic checks (one `test()` block per `def.id`):
  - `compute([], def.params.defaults)` returns an empty-shaped result without throwing.
  - `compute([oneCandle], def.params.defaults)` doesn't throw.
- Targeted math checks (deterministic input → known output):
  - SMA(period=3) on `[1,2,3,4,5]` close → `[NaN,NaN,2,3,4]` (or whatever the def emits for warmup — test locks in current behavior).
  - EMA(period=3) seed value and steady-state propagation.
  - RSI(period=14) on a monotonically rising series → 100 after warmup.
  - MACD signal/histogram sign on a known cross.
  - Bollinger Bands: upper - lower = 2 × mult × σ.
  - VWAP cumulative — sum-of-price-×-vol / sum-of-vol matches manual calc.
  - ATR(14) on constant range = the range.
  - AO / MACD-hist / Volume — bar colour flips at zero crossing / up-down volume boundary.
- Edge cases: `period > candles.length`; param at min boundary.

**`tests/frontend/test_drawings.js`** — Drawing geometry + storage
- Setup: `const { Drawings } = loadBrowserScript('../../static/drawings.js')`.
- `DrawingStore.get/set`:
  - Round-trip a list keyed by `"yfinance|AAPL"` and confirm case-insensitive lookup (`"YFINANCE|aapl"` returns same list).
  - Corrupt entries (invalid hex `#zzz`, width = -5, opacity = 9, dash = "rainbow") silently dropped on load.
- `PrefsStore.get` returns defaults when empty; `set` merges over defaults.
- Per-tool generic checks (loop over `TOOL_DEFS`):
  - `handles(drawing, layer).length === pointsNeeded` after constructing a fresh drawing.
  - `moveAll(drawing, 10, 5, layer)` shifts every point's `x` by +10, `y` by +5.
  - `moveHandle(drawing, handleId, x, y, layer)` updates exactly the targeted point.
- Targeted hit-test checks:
  - Line: point on the segment hits, point off by 2×tolerance misses, point at endpoint hits.
  - Ray: hits beyond the second point, misses before the first.
  - Rect: hits on border, misses inside (or hits inside per current behavior — test locks it in).
  - Fib retracement: hits on each level line, miss between.
- Layer fixture is a minimal stub: `{ width, height, timeToPx(t), priceToPx(p), pxToTime(x), pxToPrice(y), getCandles: () => [] }` — drawings store `(time, price)` and project through the layer.

### Tooling additions

- **`package.json`** at repo root (new file, ~10 lines):
  ```json
  {
    "name": "supertradingview-tests",
    "private": true,
    "scripts": { "test": "node --test tests/frontend" }
  }
  ```
- **No new Python deps.** `pytest>=8.0` is already in `requirements.txt`.
- **README update** — single new "Tests" section: `pytest` for backend, `node --test tests/frontend` (or `npm test`) for frontend.

## Data flow

```
                ┌────────────────────────────────┐
                │  developer runs `pytest`       │
                └──────────────┬─────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
   tests/services/*    tests/test_app.py  tests/test_data_source.py
   (already exists)    (new)              (new)
              │                │                │
              ▼                ▼                ▼
   services/* code    app.routes +       data_source.py +
                      mocked services    mocked requests/yfinance

                ┌────────────────────────────────┐
                │  developer runs `npm test`     │
                └──────────────┬─────────────────┘
                               │
                  ┌────────────┴────────────┐
                  ▼                         ▼
        tests/frontend/             tests/frontend/
        test_indicators.js          test_drawings.js
                  │                         │
                  └──────────┬──────────────┘
                             ▼
              tests/frontend/_sandbox.js
                             │
                             ▼
              vm context with fake window
                             │
                             ▼
              static/indicators.js  &  static/drawings.js
              (loaded as-is, no edits)
```

## Error handling

- Backend tests assert HTTP status codes and JSON `error` shape, not exception bubbling.
- Frontend tests assert pure functions never throw on empty / undersized input. If an indicator currently throws on empty input, the test will be marked TODO with a one-line comment rather than rewritten to swallow the bug.

## Testing strategy for the test suite itself

- Run `pytest` after backend tests are added — must pass green, including the 8 existing service tests untouched.
- Run `node --test tests/frontend` — must pass green and complete in under 5 seconds.
- Negative-control sanity check: temporarily flip a sign in one indicator and confirm the matching test fails. Revert.

## Things deliberately skipped (and why)

- **CI workflow** — out of scope; can be added later without touching test code.
- **DOM/integration tests** — would need jsdom or Playwright. The user opted for pure-logic only.
- **`app.js`** — orchestration glue; minimal pure logic worth covering without DOM.
- **Behavior-fixing** — tests lock in *current* behavior. Anything that looks wrong gets flagged in the PR description, not silently rewritten.

## File manifest

New files:
- `tests/test_app.py`
- `tests/test_data_source.py`
- `tests/frontend/_sandbox.js`
- `tests/frontend/test_indicators.js`
- `tests/frontend/test_drawings.js`
- `package.json`

Modified files:
- `README.md` — add "Tests" section.

No existing tests or source files modified.
