# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Run

This is a single-process Flask app with a vanilla-JS frontend, no build step. On this Windows machine, use the `py` launcher:

```
py -3 -m pip install -r requirements.txt
py -3 app.py            # serves on http://127.0.0.1:5173
```

There are no unit tests. Smoke testing is done by hitting endpoints with curl and by running the dashboard in a browser. A headless Playwright check used during development:

```
node -e "require('playwright')"   # confirms playwright is installed
```

For backend-only changes, hit endpoints directly: `/sources`, `/symbols?q=...`, `/history?source=...&symbol=...&tf=...`, `/stream/quotes?source=...&symbol=...&tf=...` (SSE).

## Architecture

The codebase is intentionally small and is held together by three design patterns. Internalising them makes nearly every change a one-file edit.

### 1. Pluggable data sources (`data_source.py`)

Every broker / exchange is a `DataSource` subclass implementing `get_history`, `stream_quotes`, and `search_symbols`. Instances are registered in the module-level `REGISTRY` dict. The Flask routes (`/history`, `/stream/quotes`, `/symbols`) look up sources by name from this dict; the frontend dropdowns route by the `source` field stamped on each symbol. **Adding a broker is one new class + one `REGISTRY[name] = ...` line — no frontend changes.**

Two important conventions:

- **`stream_quotes` is a generator.** Yielding a `Quote` causes the Flask SSE endpoint to push a `data:` line to the browser. Sleep/poll inside the generator at whatever cadence the source supports.
- **Crypto via Hyperliquid does *not* use `stream_quotes`** — the browser opens the public Hyperliquid WebSocket directly. `HyperliquidSource.stream_quotes` deliberately raises `NotImplementedError`. Only stocks/yfinance go through the SSE bridge. If you add a broker that needs server-side streaming, follow the yfinance pattern.

### 2. Lightweight Charts v5 with multi-pane (`static/app.js`, `static/indicators.js`)

The chart library is **v5.x**, not v4. The differences matter:

- Use `chart.addSeries(LightweightCharts.CandlestickSeries, opts, paneIndex)` — `addCandlestickSeries` / `addLineSeries` / `addHistogramSeries` were removed.
- **`panes[i].getHTMLElement()` returns `null` synchronously after `addSeries`.** The pane's HTML element is created on the next layout pass. Any code that needs that element (legends, custom overlays) must defer via `requestAnimationFrame` and guard against null. See `Pane._refreshLegends` in `static/app.js` for the pattern.
- Sub-pane indicators (RSI, MACD, ADX, etc.) are placed in their own pane via the `paneIndex` arg; they get their own visible right-side price axis for free. Overlay indicators (SMA, EMA, BB, VWAP, etc.) go to pane 0 alongside the candles.
- Pane sizing uses `chart.panes()[i].setStretchFactor(N)`, **not** the old v4 `scaleMargins` trick. The candle pane gets factor 3; each sub-pane gets 1.
- When a sub-pane indicator is added or removed, the whole sub-pane stack is torn down and rebuilt (see `Pane._rebuildSubPanes`). This keeps pane indices contiguous — adding RSI then MACD then disabling RSI leaves MACD in pane 1, not orphaned in pane 2.

### 3. Self-contained indicator defs (`static/indicators.js`)

Every indicator is one entry in the `DEFS` array, with embedded `build` / `compute` / `apply` functions. Adding an indicator is a one-file change:

```js
{
  id: "myind", name: "...", category: "...", overlay: true/false,
  params: [{ key, default, min, max, step? }, ...],
  colors: [{ key, label, default: "#rrggbb" }, ...],
  build:   (chart, paneIndex, colors) => [series, ...],
  compute: (candles, params, colors)  => data,
  apply:   (series, data)             => series[0].setData(data),
}
```

The indicators modal, legend chips, sub-pane layout, colour pickers, and `localStorage` persistence all auto-pick up new entries. **Do not add per-indicator switch statements anywhere else** — every place that touches indicators iterates `Indicators.DEFS` and dispatches through `def.build` / `def.compute` / `def.apply`.

`build` receives a `paneIndex`: 0 for overlay indicators, N for sub-pane indicators (assigned by `Pane._paneIndexFor`). Use `ohlcLine(chart, color, paneIndex, extra)` and `histSeries(chart, paneIndex, extra)` helpers — they wrap v5's `addSeries` correctly.

For histogram-coloured indicators (AO, MACD histogram, Volume) the per-point colour is set inside `compute` using the resolved colours, not at series creation time. The `withAlpha(hex, a)` helper converts hex to `rgba(...)` so picker output (always `#rrggbb`) gets the right transparency.

### 4. Self-contained drawing tool defs (`static/drawings.js`)

Same def-driven pattern as indicators. Each drawing tool is one entry in `TOOL_DEFS`:

```js
{
  id, name, pointsNeeded, defaultStyle, defaultScope,
  render(svg, drawing, layer),
  hitTest(drawing, x, y, layer, tol),
  handles(drawing, layer),
  moveHandle(drawing, handleId, x, y, layer),
  moveAll(drawing, dx, dy, layer),
  // optional: promptLabel(layer, screenPt) for tools that need inline input (text)
}
```

`TOOL_DEFS_BY_ID` is built from the array via `Object.fromEntries` — adding a new tool just appends to the array. The `DrawingLayer` class owns one SVG overlay + one DOM handle layer per pane and iterates `TOOL_DEFS` for rendering + hit-testing. **No per-tool switches anywhere else.**

Drawings store **absolute `(time, price)` points**, projected to pixels every redraw via `chart.timeScale().timeToCoordinate(...)` / `series.priceToCoordinate(...)`. They re-render correctly across timeframe switches and zooms automatically.

Persistence: `localStorage["stv.drawings"]` keyed by `${source}|${symbol}` (case-insensitive). UI prefs (toolbar mode, snap default, undo depth) live in `localStorage["stv.drawingPrefs"]`. `DrawingStore.get` validates persisted shape — invalid entries (bad colour hex, out-of-range width/opacity, unknown dash key) are silently dropped on load.

Undo/redo is per-pane, 50-entry stack (configurable via settings popover), in-memory only. Global `Ctrl+Z`/`Ctrl+Y` routes to `DrawingLayer._activeLayer` — the most-recently-clicked layer; falls back to the only layer in single-pane mode.

**Gotchas:**
- The SVG overlay attaches to `chart.panes()[0].getHTMLElement()`, which is `null` synchronously after `addSeries` in LWC v5. `DrawingLayer._attach()` defers via `requestAnimationFrame` and retries until the element is ready — same pattern as the indicator legends.
- Snap-to-OHLC reads the candle array via `layer.getCandles()` (assigned by `Pane` to point at `this.candles`). Don't store a snapshot of candles inside `DrawingLayer` — the lazy getter keeps it current as data streams in.
- `setActiveTool` for an unknown tool ID falls through to cursor mode and fires `_notifyToolChange("cursor")` so the toolbar UI tracks the actual layer state (the original click-to-reflect-active pattern in `Pane._setActiveTool` was removed; the notify callback is now the source of truth).

### Symbol search

`/symbols?q=...` is a merged search across every `DataSource.search_symbols(q)` plus the curated `symbols.json` list (instant). `HyperliquidSource` caches the full perp universe from `/info?meta` (1-hour TTL); `YFinanceSource` wraps `yfinance.Search` (Yahoo's global search endpoint). The frontend debounces input by 250 ms and uses a request token to discard out-of-order responses (`querySymbolsNow` in `static/app.js`). New brokers gain live search just by implementing `search_symbols` — frontend wiring is generic.

### State persistence

`localStorage` keys: `stv.chartCount` (int) and `stv.panes` (array indexed by pane position). Per-pane shape:

```
{ source, symbol, tf, indicators: { [id]: { ...params, colors: { [slot]: "#hex" } } } }
```

`loadState()` in `static/app.js` backfills missing fields from `DEFAULT_PANES`, so old persisted state from prior schema versions keeps working. Don't introduce required new fields without a backfill.

## Things that have bitten us

- **After upgrading any CDN-loaded library or major-version-bumping the frontend, tell the user to hard-refresh (Ctrl+Shift+R).** Symptom: "I can't see charts." Caching of `app.js` against a new bundle was the actual issue both times this came up.
- **Don't `cd` then run `git`** — current working directory is already correct, and chaining `cd <dir> && git ...` triggers a permission prompt.
- **`gh` is installed at `C:\Program Files\GitHub CLI`** but not always on PowerShell's PATH. Prepend `$env:Path = "$env:Path;C:\Program Files\GitHub CLI"` before `gh` calls.
- **Flask runs `threaded=True`** so SSE clients don't block other requests. Don't change this without thinking through long-poll behaviour.
- **yfinance first call is slow** (TLS handshake, etc.). The 15 s timeout in `YFinanceSource.search_symbols` exists for this reason — don't tighten it.

## Reference

The [README.md](README.md) is the user-facing description (features, quick start, how to extend). It and this file should agree; if they diverge, the README is the spec.
