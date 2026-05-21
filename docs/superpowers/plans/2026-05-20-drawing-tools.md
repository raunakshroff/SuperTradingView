# Drawing Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-pane drawing layer with 9 drawing tools (trendline, horizontal, vertical, rectangle, fib, channel, arc, ruler, text), circular drag handles, full per-drawing styling, snap-to-OHLC, undo, and a configurable toolbar.

**Architecture:** A new `DrawingLayer` class is attached to each `Pane`. It owns an SVG overlay layered on top of `chart.panes()[0].getHTMLElement()` plus a DOM-handle layer above it. Tools are def-driven (mirrors the indicator pattern) — each tool implements `render / hitTest / handles / moveHandle / moveAll`. Drawings store absolute `(time, price)` points; rendering re-projects to pixels via Lightweight Charts' `timeToCoordinate` / `priceToCoordinate` on every redraw. State persists in `localStorage["stv.drawings"]` keyed by `${source}|${symbol}`.

**Tech Stack:** Vanilla JS (no framework), Lightweight Charts v5.2.0, inline SVG, CSS Grid, `localStorage`. No backend changes. Smoke testing via headless Playwright (already installed) and manual browser checks.

**Testing model:** This codebase has no unit-test runner. Pure helpers (geometry, store) get inline `node -e` smoke checks. Interactive code is verified with a brief Playwright script per task that exercises the relevant UI and asserts post-conditions.

**Spec:** [docs/superpowers/specs/2026-05-20-drawing-tools-design.md](../specs/2026-05-20-drawing-tools-design.md)

---

## File map

**Create:**
- `static/drawings.js` — `DrawingStore`, `DrawingLayer`, `TOOL_DEFS`, geometry helpers. Single IIFE-wrapped module exposing `window.Drawings = { DrawingLayer, DrawingStore, TOOL_DEFS, util }`.
- `static/drawings.css` — Toolbar, handles, mini-toolbar, style-modal, settings-popover styles. Linked from `index.html` separately so the file stays focused.

**Modify:**
- `static/index.html` — Add `<link>` to `drawings.css`, `<script>` to `drawings.js` (before `app.js`), the drawing-toolbar template (inside `<template id="pane-template">`), the drawing style-modal markup, and the drawing settings-popover markup.
- `static/app.js` — In the `Pane` class: instantiate a `DrawingLayer` after `_buildChart()`; tear it down in `destroy()`; reload drawings on symbol change; expose tool-button click handlers; keyboard shortcut routing (`Esc`, `Del`, `Ctrl+Z`).

**No changes to:** `app.py`, `data_source.py`, `static/style.css`, `static/indicators.js`, `symbols.json`, `requirements.txt`.

---

## Conventions used in this plan

- **Verify in browser** means: start the Flask server (`py -3 app.py`), open `http://127.0.0.1:5173` in a hard-refreshed browser (Ctrl+Shift+R), perform the listed actions, confirm the listed outcomes. Pre-seed `localStorage` via DevTools where noted.
- **Playwright check** means: a small Node script using the already-installed `/tmp/node_modules/playwright`. Each task that has a Playwright check shows the exact script to run.
- Each task ends with a commit on `main`. No long-lived feature branch — small commits, easy to revert.

---

## Task 1: Skeleton — drawings.js / drawings.css / prefs store + persistence prefs

**Files:**
- Create: `static/drawings.js`
- Create: `static/drawings.css`
- Modify: `static/index.html`

- [ ] **Step 1: Create `static/drawings.js` with the IIFE shell and `DrawingStore`/`PrefsStore`**

```js
/* SuperTradingView drawing layer.
 *
 * Public exports (on `window.Drawings`):
 *   - DrawingStore: per-(source, symbol) drawing list in localStorage
 *   - PrefsStore:   user UI prefs (toolbar mode, default snap, undo depth)
 *   - DrawingLayer: per-pane drawing layer (added in a later task)
 *   - TOOL_DEFS:    list of available drawing tools (added in a later task)
 *   - util:         geometry + ID helpers
 */
(function () {
  const LS_DRAWINGS = "stv.drawings";
  const LS_PREFS    = "stv.drawingPrefs";

  const DEFAULT_PREFS = {
    toolbarMode: "left",      // "left" | "floating"
    snapDefault: "shift",     // "shift" | "always" | "never"
    undoDepth: 50,
  };

  function _readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch { return fallback; }
  }

  function _writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
  }

  const DrawingStore = {
    _key(source, symbol) { return `${source}|${symbol.toUpperCase()}`; },

    get(source, symbol) {
      const all = _readJSON(LS_DRAWINGS, {});
      const arr = all[this._key(source, symbol)] || [];
      // Drop any persisted entries that fail a basic shape check
      return arr.filter((d) =>
        d && typeof d.id === "string"
          && typeof d.tool === "string"
          && Array.isArray(d.points)
          && d.points.every((p) => typeof p.time === "number" && typeof p.price === "number"));
    },

    set(source, symbol, drawings) {
      const all = _readJSON(LS_DRAWINGS, {});
      all[this._key(source, symbol)] = drawings;
      _writeJSON(LS_DRAWINGS, all);
    },

    clear(source, symbol) {
      const all = _readJSON(LS_DRAWINGS, {});
      delete all[this._key(source, symbol)];
      _writeJSON(LS_DRAWINGS, all);
    },
  };

  const PrefsStore = {
    get() { return { ...DEFAULT_PREFS, ..._readJSON(LS_PREFS, {}) }; },
    set(partial) { _writeJSON(LS_PREFS, { ...this.get(), ...partial }); },
  };

  const util = {
    newId() { return "drw_" + Math.random().toString(36).slice(2, 10); },
  };

  window.Drawings = { DrawingStore, PrefsStore, util };
})();
```

- [ ] **Step 2: Smoke test the store via Node**

Run:
```
node -e "
global.window = {};
global.localStorage = { _s: {}, getItem(k){return this._s[k]||null}, setItem(k,v){this._s[k]=v}, removeItem(k){delete this._s[k]} };
new Function(require('fs').readFileSync('static/drawings.js','utf8'))();
const { DrawingStore, PrefsStore, util } = window.Drawings;

// roundtrip
DrawingStore.set('hyperliquid','BTC',[{id:'a',tool:'trendline',points:[{time:1,price:2},{time:3,price:4}]}]);
const out = DrawingStore.get('hyperliquid','BTC');
console.log('drawings:', out.length, out[0].id);

// drop invalid
DrawingStore.set('hyperliquid','BAD',[{id:'x'},{wrong:'shape'}]);
console.log('invalid filtered:', DrawingStore.get('hyperliquid','BAD').length);

// case-insensitive key
DrawingStore.set('hyperliquid','eth',[{id:'b',tool:'horizontal',points:[{time:1,price:2}]}]);
console.log('case key:', DrawingStore.get('hyperliquid','ETH').length);

// prefs defaults + override
console.log('default prefs:', JSON.stringify(PrefsStore.get()));
PrefsStore.set({ toolbarMode: 'floating' });
console.log('after set:', JSON.stringify(PrefsStore.get()));

// newId shape
const id = util.newId();
console.log('id ok:', id.startsWith('drw_') && id.length > 5);
"
```

Expected output:
```
drawings: 1 a
invalid filtered: 0
case key: 1
default prefs: {"toolbarMode":"left","snapDefault":"shift","undoDepth":50}
after set: {"toolbarMode":"floating","snapDefault":"shift","undoDepth":50}
id ok: true
```

- [ ] **Step 3: Create `static/drawings.css` with the toolbar shell only**

```css
/* Drawing layer styles. Loaded after style.css so theme tokens (var(--panel),
 * var(--border), var(--accent), etc.) are available. */

.draw-toolbar {
  width: 30px;
  background: var(--panel-2);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 0;
  flex-shrink: 0;
}

.draw-tool {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 12px;
  background: transparent;
  border: none;
  font-family: inherit;
  user-select: none;
}
.draw-tool:hover { background: var(--border); color: var(--text); }
.draw-tool.active { background: var(--accent); color: white; }

.draw-tool-sep {
  width: 16px;
  height: 1px;
  background: var(--border);
}

/* When the pane is in "floating palette" mode, the left toolbar is hidden
 * and the toolbar's contents float instead. Added in a later task. */
.pane.draw-floating .draw-toolbar { display: none; }

/* The pane's body row needs to host the toolbar beside the chart. */
.pane-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
```

- [ ] **Step 4: Wire `drawings.css` and `drawings.js` into `index.html`**

In `static/index.html`, add the CSS link in `<head>` (after `style.css`) and the script tag just before `app.js`:

```html
<link rel="stylesheet" href="/static/style.css" />
<link rel="stylesheet" href="/static/drawings.css" />
<!-- ... -->
<script src="/static/indicators.js"></script>
<script src="/static/drawings.js"></script>
<script src="/static/app.js"></script>
```

Also restructure the `<template id="pane-template">` so the chart sits inside a `.pane-body` that can hold the toolbar beside it:

```html
<template id="pane-template">
  <section class="pane">
    <div class="pane-header">
      <!-- ... existing header content ... -->
    </div>
    <div class="pane-body">
      <div class="draw-toolbar">
        <button class="draw-tool active" data-tool="cursor" title="Select">⤤</button>
        <div class="draw-tool-sep"></div>
        <button class="draw-tool" data-tool="trendline" title="Trendline">╱</button>
        <button class="draw-tool" data-tool="horizontal" title="Horizontal line">─</button>
        <button class="draw-tool" data-tool="vertical" title="Vertical line">│</button>
        <button class="draw-tool" data-tool="rectangle" title="Rectangle">▭</button>
        <button class="draw-tool" data-tool="fib" title="Fibonacci">⌘</button>
        <button class="draw-tool" data-tool="channel" title="Parallel channel">∥</button>
        <button class="draw-tool" data-tool="arc" title="Arc">◠</button>
        <button class="draw-tool" data-tool="ruler" title="Measurement ruler">📏</button>
        <button class="draw-tool" data-tool="text" title="Text">T</button>
        <div class="draw-tool-sep"></div>
        <button class="draw-tool" data-action="undo" title="Undo (Ctrl+Z)">↺</button>
        <button class="draw-tool" data-action="erase" title="Erase all">×</button>
        <div class="draw-tool-sep"></div>
        <button class="draw-tool" data-action="settings" title="Drawing settings">⚙</button>
      </div>
      <div class="chart"></div>
    </div>
  </section>
</template>
```

- [ ] **Step 5: Verify in browser**

1. Run the Flask server: `py -3 app.py`
2. Hard-refresh `http://127.0.0.1:5173`
3. Confirm each pane now shows a thin vertical toolbar on the left of the chart, with 13 icon buttons (cursor + 9 drawings + undo + erase + settings) and two thin separators.
4. Click each button — nothing should happen yet (no handlers wired). No JS errors in the console.
5. In DevTools console run `Drawings.DrawingStore.set('test','X',[{id:'a',tool:'trendline',points:[{time:1,price:2}]}]); Drawings.DrawingStore.get('test','X')` and confirm it returns the array.

- [ ] **Step 6: Commit**

```
git add static/drawings.js static/drawings.css static/index.html
git commit -m "drawings: scaffold toolbar, DrawingStore, PrefsStore"
```

---

## Task 2: SVG overlay + chart coordinate helpers

**Files:**
- Modify: `static/drawings.js`
- Modify: `static/app.js`

- [ ] **Step 1: Add `DrawingLayer` skeleton to `drawings.js`**

Insert just before `window.Drawings = ...`:

```js
class DrawingLayer {
  /**
   * @param {Object} opts
   * @param {IChartApi} opts.chart      Lightweight Charts chart instance
   * @param {ISeriesApi} opts.series    The candle series (used as the price-scale source)
   * @param {string} opts.source        e.g. "hyperliquid"
   * @param {string} opts.symbol        e.g. "BTC"
   * @param {string} opts.timeframe     e.g. "1m"
   */
  constructor(opts) {
    this.chart = opts.chart;
    this.series = opts.series;
    this.source = opts.source;
    this.symbol = opts.symbol;
    this.timeframe = opts.timeframe;

    this.wrapper = null;  // <div> overlay attached to chart.panes()[0]
    this.svg = null;      // <svg> for shapes
    this.handleHost = null; // <div> for handles + mini-toolbar (siblings)
    this.drawings = [];   // current list, hydrated from store

    this._destroyed = false;
    this._onResize = null;
    this._unsubVisRange = null;

    // Defer DOM attach until the pane HTML element exists (v5 layout pass).
    requestAnimationFrame(() => this._attach());
  }

  _attach() {
    if (this._destroyed) return;
    const panes = this.chart.panes();
    if (panes.length === 0) { requestAnimationFrame(() => this._attach()); return; }
    const paneEl = panes[0].getHTMLElement();
    if (!paneEl) { requestAnimationFrame(() => this._attach()); return; }

    if (window.getComputedStyle(paneEl).position === "static") {
      paneEl.style.position = "relative";
    }

    this.wrapper = document.createElement("div");
    this.wrapper.className = "draw-overlay";
    Object.assign(this.wrapper.style, {
      position: "absolute", inset: "0", pointerEvents: "none", zIndex: "3",
    });

    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    Object.assign(this.svg.style, {
      position: "absolute", inset: "0", width: "100%", height: "100%",
      pointerEvents: "none",
    });

    this.handleHost = document.createElement("div");
    Object.assign(this.handleHost.style, {
      position: "absolute", inset: "0", pointerEvents: "none",
    });

    this.wrapper.appendChild(this.svg);
    this.wrapper.appendChild(this.handleHost);
    paneEl.appendChild(this.wrapper);

    this._onResize = () => this._redraw();
    this._unsubVisRange = this.chart.timeScale()
      .subscribeVisibleTimeRangeChange(() => this._redraw());
    window.addEventListener("resize", this._onResize);

    this.load();
    this._redraw();
  }

  /**
   * Project (time, price) -> {x, y} pixels in the overlay. Returns null if
   * the point is outside the visible time range.
   */
  toPx(point) {
    const x = this.chart.timeScale().timeToCoordinate(point.time);
    const y = this.series.priceToCoordinate(point.price);
    if (x == null || y == null) return null;
    return { x, y };
  }

  /**
   * Inverse projection. Returns null if the cursor is outside the chart
   * plotting area.
   */
  fromPx(x, y) {
    const time  = this.chart.timeScale().coordinateToTime(x);
    const price = this.series.coordinateToPrice(y);
    if (time == null || price == null) return null;
    return { time: typeof time === "number" ? time : Number(time), price };
  }

  load() {
    this.drawings = DrawingStore.get(this.source, this.symbol);
  }

  save() {
    DrawingStore.set(this.source, this.symbol, this.drawings);
  }

  /** Re-render every drawing. Placeholder until tools are added. */
  _redraw() {
    if (!this.svg) return;
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    // Tools render in later tasks.
  }

  setSymbol(source, symbol, timeframe) {
    this.source = source;
    this.symbol = symbol;
    this.timeframe = timeframe;
    // Abort any in-progress placement / selection (spec: symbol change mid-edit)
    this.mode = "idle";
    this.activeTool = null;
    this.placePoints = [];
    this.selectedId = null;
    this.load();
    this._redraw();
  }

  destroy() {
    this._destroyed = true;
    if (this._unsubVisRange) {
      this.chart.timeScale().unsubscribeVisibleTimeRangeChange(this._onResize);
      this._unsubVisRange = null;
    }
    if (this._onResize) {
      window.removeEventListener("resize", this._onResize);
      this._onResize = null;
    }
    if (this.wrapper && this.wrapper.parentNode) {
      this.wrapper.parentNode.removeChild(this.wrapper);
    }
    this.wrapper = this.svg = this.handleHost = null;
  }
}
```

Update the export at the bottom of the IIFE:
```js
window.Drawings = { DrawingStore, PrefsStore, DrawingLayer, util };
```

- [ ] **Step 2: Instantiate `DrawingLayer` on each `Pane` in `app.js`**

Find the `Pane` constructor (the block ending in `this.subscribe();`). After `this._buildChart()` and the initial indicator-build loop, add:

```js
this.drawingLayer = new Drawings.DrawingLayer({
  chart:     this.chart,
  series:    this.series,
  source:    this.state.source,
  symbol:    this.state.symbol,
  timeframe: this.state.tf,
});
```

In `Pane.destroy()`, add `this.drawingLayer.destroy()` before `this.chart.remove()`.

In `Pane._onSymbolChange()` (right after `this.symbolInput.value = resolved.symbol;`), add:

```js
this.drawingLayer.setSymbol(resolved.source, resolved.symbol, this.state.tf);
```

In `Pane._onTfChange()` (after `this.setState({ tf });`), add:

```js
this.drawingLayer.timeframe = tf;
```

- [ ] **Step 3: Smoke test coordinate helpers in browser**

1. Hard-refresh the dashboard.
2. In DevTools console:
   ```js
   const p = panes[0];
   const layer = p.drawingLayer;
   const last = p.candles[p.candles.length - 1];
   const xy = layer.toPx({ time: last.time, price: last.close });
   console.log("toPx:", xy);              // expect {x: <number>, y: <number>}
   const back = layer.fromPx(xy.x, xy.y);
   console.log("fromPx:", back);           // expect {time: <≈last.time>, price: <≈last.close>}
   ```
3. Confirm no JS errors. Confirm the overlay div exists: `document.querySelector('.draw-overlay')` returns a node.

- [ ] **Step 4: Commit**

```
git add static/drawings.js static/app.js
git commit -m "drawings: SVG overlay + coordinate helpers, per-pane DrawingLayer lifecycle"
```

---

## Task 3: Trendline tool — placement + render + persistence

**Files:**
- Modify: `static/drawings.js`
- Modify: `static/app.js`

- [ ] **Step 1: Add `TOOL_DEFS` with a trendline entry**

Below the helpers in `drawings.js` (just before `class DrawingLayer`):

```js
const TOOL_DEFS = [
  {
    id: "trendline",
    name: "Trendline",
    pointsNeeded: 2,
    defaultStyle: { color: "#ffca28", width: 2, dash: "solid", opacity: 1 },
    defaultScope: { showAllTimeframes: true, extend: "none" },

    render(svg, drawing, layer) {
      const [a, b] = drawing.points;
      const pa = layer.toPx(a);
      const pb = layer.toPx(b);
      if (!pa || !pb) return;
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("data-drawing-id", drawing.id);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", pa.x);
      line.setAttribute("y1", pa.y);
      line.setAttribute("x2", pb.x);
      line.setAttribute("y2", pb.y);
      line.setAttribute("stroke", drawing.style.color);
      line.setAttribute("stroke-width", drawing.style.width);
      line.setAttribute("stroke-opacity", drawing.style.opacity);
      line.setAttribute("stroke-linecap", "round");
      const dash = DASH_MAP[drawing.style.dash] || null;
      if (dash) line.setAttribute("stroke-dasharray", dash);
      g.appendChild(line);
      svg.appendChild(g);
    },
  },
];

const DASH_MAP = {
  solid: null,
  dashed: "8,4",
  dotted: "2,3",
  dashdot: "8,4,2,4",
};
```

Export at the bottom: `window.Drawings = { DrawingStore, PrefsStore, DrawingLayer, TOOL_DEFS, util };`

- [ ] **Step 2: Wire placement state machine on the `DrawingLayer`**

Add these fields to the `DrawingLayer` constructor:

```js
this.mode = "idle";           // "idle" | "placing"
this.activeTool = null;       // TOOL_DEFS entry while placing
this.placePoints = [];        // accumulated {time, price} so far
```

Add methods to `DrawingLayer`:

```js
setActiveTool(toolId) {
  if (toolId === "cursor" || toolId == null) {
    this.mode = "idle";
    this.activeTool = null;
    this.placePoints = [];
    this._setCursor("default");
    this._setOverlayInteractive(false);
    return;
  }
  const def = TOOL_DEFS.find((t) => t.id === toolId);
  if (!def) return;
  this.mode = "placing";
  this.activeTool = def;
  this.placePoints = [];
  this._setCursor("crosshair");
  this._setOverlayInteractive(true);
}

_setCursor(c) { if (this.wrapper) this.wrapper.style.cursor = c; }

_setOverlayInteractive(on) {
  if (!this.wrapper) return;
  this.wrapper.style.pointerEvents = on ? "auto" : "none";
}

_onClick(ev) {
  if (this.mode !== "placing" || !this.activeTool) return;
  const rect = this.wrapper.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  const pt = this.fromPx(x, y);
  if (!pt) return;
  this.placePoints.push(pt);

  if (this.placePoints.length >= this.activeTool.pointsNeeded) {
    const drawing = {
      id: util.newId(),
      tool: this.activeTool.id,
      points: this.placePoints.slice(),
      style: { ...this.activeTool.defaultStyle },
      scope: { ...this.activeTool.defaultScope },
      z: this.drawings.length,
      createdAt: Math.floor(Date.now() / 1000),
    };
    this.drawings.push(drawing);
    this.save();
    this.placePoints = [];
    // One-shot: return to cursor.
    this.setActiveTool("cursor");
    this._notifyToolChange && this._notifyToolChange("cursor");
    this._redraw();
  }
}
```

In `_attach()`, after appending `this.wrapper`, register the click listener:

```js
this.wrapper.addEventListener("click", (ev) => this._onClick(ev));
```

Update `_redraw()` to iterate drawings:

```js
_redraw() {
  if (!this.svg) return;
  while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
  // Sort by z so higher-z draws on top
  const sorted = this.drawings.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  for (const d of sorted) {
    const def = TOOL_DEFS.find((t) => t.id === d.tool);
    if (def && def.render) def.render(this.svg, d, this);
  }
}
```

- [ ] **Step 3: Wire toolbar buttons in `app.js`**

In the `Pane` constructor, after creating `drawingLayer`, query the toolbar and bind clicks:

```js
this.toolBtns = this.root.querySelectorAll(".draw-tool[data-tool]");
this.toolBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.tool;
    this._setActiveTool(id);
  });
});
// Let the layer flip the toolbar back to "cursor" after a one-shot draw.
this.drawingLayer._notifyToolChange = (id) => this._reflectActiveTool(id);
```

Add methods to `Pane`:

```js
_setActiveTool(id) {
  this.drawingLayer.setActiveTool(id);
  this._reflectActiveTool(id);
}

_reflectActiveTool(id) {
  this.toolBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tool === id);
  });
}
```

- [ ] **Step 4: Verify in browser**

1. Hard-refresh.
2. In one pane, click the **╱** (Trendline) icon — confirm it gets the blue "active" background and the cursor turns crosshair when hovering the chart.
3. Click two points on the chart — a yellow trendline appears between them. Toolbar reverts to **⤤** (Cursor).
4. Refresh the page (no clear localStorage). The trendline is still there.
5. Run in console: `JSON.parse(localStorage.getItem('stv.drawings'))` — confirm the entry exists keyed by `hyperliquid|BTC` (or whatever pane symbol).
6. Change the pane's symbol to `ETH`. Trendline vanishes. Switch back to `BTC` — trendline returns.

- [ ] **Step 5: Playwright check (regression)**

Create `/tmp/test-trendline.js`:

```js
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('stv.chartCount', '1');
    localStorage.setItem('stv.panes', JSON.stringify([
      { source: 'hyperliquid', symbol: 'BTC', tf: '1m', indicators: {} }
    ]));
    localStorage.removeItem('stv.drawings');
  });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load' });
  await page.waitForTimeout(3500);

  await page.locator('.draw-tool[data-tool="trendline"]').first().click();
  const chart = page.locator('.chart').first();
  const box = await chart.boundingBox();
  await page.mouse.click(box.x + 50, box.y + box.height - 60);
  await page.mouse.click(box.x + box.width - 80, box.y + 50);
  await page.waitForTimeout(500);

  const svgChildren = await page.evaluate(() => {
    const svg = document.querySelector('.draw-overlay svg');
    return svg ? svg.children.length : -1;
  });
  const storedCount = await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('stv.drawings') || '{}');
    return (all['hyperliquid|BTC'] || []).length;
  });
  console.log('svg children:', svgChildren);
  console.log('stored drawings:', storedCount);
  console.log('errors:', errs.length === 0 ? '(none)' : errs);
  await browser.close();
})();
```

Run: `node /tmp/test-trendline.js`.
Expected: `svg children: 1`, `stored drawings: 1`, `errors: (none)`.

- [ ] **Step 6: Commit**

```
git add static/drawings.js static/app.js
git commit -m "drawings: trendline placement, render, persist roundtrip"
```

---

## Task 4: Selection + circular handles + mini-toolbar

**Files:**
- Modify: `static/drawings.js`
- Modify: `static/drawings.css`

- [ ] **Step 1: Add selection state + hit-test on `DrawingLayer`**

Add to constructor:
```js
this.selectedId = null;
this.miniToolbar = null;
```

Add `handles()` and `hitTest()` to the trendline def in `TOOL_DEFS`:

```js
handles(drawing, layer) {
  const [a, b] = drawing.points;
  const pa = layer.toPx(a);
  const pb = layer.toPx(b);
  if (!pa || !pb) return [];
  return [
    { id: 0,   kind: "endpoint", x: pa.x, y: pa.y },
    { id: 1,   kind: "endpoint", x: pb.x, y: pb.y },
    { id: "mid", kind: "mid",    x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
  ];
},

hitTest(drawing, x, y, layer, tol = 6) {
  const [a, b] = drawing.points;
  const pa = layer.toPx(a);
  const pb = layer.toPx(b);
  if (!pa || !pb) return false;
  return distPointToSegment(x, y, pa.x, pa.y, pb.x, pb.y) <= tol;
},
```

Add the geometry helper alongside `DASH_MAP`:

```js
function distPointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
```

- [ ] **Step 2: Override the click handler to do hit-testing when not placing**

Replace `_onClick` body with:

```js
_onClick(ev) {
  const rect = this.wrapper.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;

  if (this.mode === "placing" && this.activeTool) {
    const pt = this.fromPx(x, y);
    if (!pt) return;
    this.placePoints.push(pt);
    if (this.placePoints.length >= this.activeTool.pointsNeeded) {
      // Spec: discard zero-length drawings (two clicks at the same point).
      if (this.placePoints.length >= 2) {
        const p0 = this.placePoints[0];
        const pN = this.placePoints[this.placePoints.length - 1];
        if (p0.time === pN.time && p0.price === pN.price) {
          this.placePoints = [];
          this.setActiveTool("cursor");
          this._notifyToolChange && this._notifyToolChange("cursor");
          return;
        }
      }
      const drawing = {
        id: util.newId(),
        tool: this.activeTool.id,
        points: this.placePoints.slice(),
        style: { ...this.activeTool.defaultStyle },
        scope: { ...this.activeTool.defaultScope },
        z: this.drawings.length,
        createdAt: Math.floor(Date.now() / 1000),
      };
      this.drawings.push(drawing);
      this.save();
      this.placePoints = [];
      this.setActiveTool("cursor");
      this._notifyToolChange && this._notifyToolChange("cursor");
      this._redraw();
    }
    return;
  }

  // Cursor mode: hit-test against drawings (top-z first)
  const sorted = this.drawings.slice().sort((a, b) => (b.z || 0) - (a.z || 0));
  for (const d of sorted) {
    const def = TOOL_DEFS.find((t) => t.id === d.tool);
    if (def && def.hitTest && def.hitTest(d, x, y, this)) {
      this.select(d.id);
      return;
    }
  }
  this.deselect();
}
```

Always keep the overlay interactive in cursor mode so it can receive clicks for selection. Update `setActiveTool`:

```js
setActiveTool(toolId) {
  if (toolId === "cursor" || toolId == null) {
    this.mode = "idle";
    this.activeTool = null;
    this.placePoints = [];
    this._setCursor("default");
    this._setOverlayInteractive(true);   // ← changed: stay interactive for selection
    return;
  }
  const def = TOOL_DEFS.find((t) => t.id === toolId);
  if (!def) return;
  this.mode = "placing";
  this.activeTool = def;
  this.placePoints = [];
  this._setCursor("crosshair");
  this._setOverlayInteractive(true);
}
```

The overlay defaults to interactive immediately. Update `_attach()`:
```js
this._setOverlayInteractive(true);
```
(Remove the earlier `this.wrapper.style.pointerEvents = "none"` if you set it inline.)

- [ ] **Step 3: Implement `select` / `deselect` / `_renderHandles`**

Add to `DrawingLayer`:

```js
select(id) {
  this.selectedId = id;
  this._renderHandles();
}

deselect() {
  this.selectedId = null;
  this._renderHandles();
}

_clearHandleHost() {
  if (!this.handleHost) return;
  while (this.handleHost.firstChild) this.handleHost.removeChild(this.handleHost.firstChild);
}

_renderHandles() {
  this._clearHandleHost();
  if (!this.selectedId) return;
  const d = this.drawings.find((x) => x.id === this.selectedId);
  if (!d) return;
  const def = TOOL_DEFS.find((t) => t.id === d.tool);
  if (!def || !def.handles) return;
  const handles = def.handles(d, this);

  for (const h of handles) {
    const el = document.createElement("div");
    el.className = "draw-handle " + h.kind;     // "endpoint" or "mid"
    el.style.left = h.x + "px";
    el.style.top  = h.y + "px";
    el.dataset.handleId = String(h.id);
    this.handleHost.appendChild(el);
  }

  // Mini-toolbar above the topmost point
  const top = handles.reduce((p, c) => (c.y < p.y ? c : p), handles[0]);
  this.miniToolbar = this._buildMiniToolbar();
  this.miniToolbar.style.left = top.x + "px";
  this.miniToolbar.style.top  = Math.max(8, top.y - 36) + "px";
  this.handleHost.appendChild(this.miniToolbar);
}

_buildMiniToolbar() {
  const bar = document.createElement("div");
  bar.className = "draw-mini-toolbar";
  bar.innerHTML = `
    <button class="dmt-btn" data-act="edit" title="Edit style">✏</button>
    <button class="dmt-btn" data-act="dup"  title="Duplicate">⎘</button>
    <button class="dmt-btn" data-act="top"  title="Bring to front">↑</button>
    <button class="dmt-btn danger" data-act="del" title="Delete">×</button>
  `;
  bar.addEventListener("click", (ev) => {
    const act = ev.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    ev.stopPropagation();
    this._handleMiniAction(act);
  });
  return bar;
}

_handleMiniAction(act) {
  const d = this.drawings.find((x) => x.id === this.selectedId);
  if (!d) return;
  if (act === "del") {
    this.drawings = this.drawings.filter((x) => x.id !== d.id);
    this.selectedId = null;
    this.save();
    this._redraw();
    this._renderHandles();
  } else if (act === "dup") {
    const copy = { ...d, id: util.newId(),
      points: d.points.map((p) => ({ ...p })),
      style: { ...d.style }, scope: { ...d.scope },
      z: this.drawings.length };
    this.drawings.push(copy);
    this.save();
    this.select(copy.id);
    this._redraw();
  } else if (act === "top") {
    d.z = Math.max(...this.drawings.map((x) => x.z || 0)) + 1;
    this.save();
    this._redraw();
    this._renderHandles();
  }
  // "edit" wired in the Style Modal task
}
```

Also call `_renderHandles()` from `_redraw()` at the end:
```js
_redraw() {
  // ... existing render loop ...
  this._renderHandles();
}
```

(`setSymbol` already resets `selectedId` because Task 2 wired it in; no changes here.)

- [ ] **Step 4: Add handle + mini-toolbar styles to `drawings.css`**

```css
.draw-overlay { /* set by JS inline; nothing extra here */ }

.draw-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  box-sizing: border-box;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  cursor: grab;
}
.draw-handle.endpoint {
  background: #fff;
  border: 2px solid var(--accent);
}
.draw-handle.mid {
  width: 9px;
  height: 9px;
  background: var(--accent);
  opacity: 0.9;
  cursor: move;
}
.draw-handle:hover {
  background: var(--accent);
  border: 2px solid #fff;
}

.draw-mini-toolbar {
  position: absolute;
  transform: translate(-50%, 0);
  background: rgba(21, 26, 35, 0.95);
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 2px;
  display: flex;
  gap: 1px;
  pointer-events: auto;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  z-index: 6;
}
.dmt-btn {
  width: 22px; height: 22px;
  background: transparent; border: none;
  color: var(--text); font-size: 11px;
  cursor: pointer; border-radius: 3px;
}
.dmt-btn:hover { background: var(--accent); }
.dmt-btn.danger { color: var(--down); }
```

- [ ] **Step 5: Verify in browser**

1. Draw a trendline.
2. Click on the line — three blue-ringed circles appear at the two endpoints and one solid blue circle at the midpoint. A small toolbar (`✏ ⎘ ↑ ×`) hovers above the highest point.
3. Click `×` — trendline disappears. Storage cleared.
4. Draw two trendlines. Click one. Click `⎘` (duplicate). Confirm a copy appears and the new copy is selected.
5. Click `↑` (bring to front). Click an empty area — the bar disappears (deselected).
6. Resize the browser window — handles stay attached to the line ends.

- [ ] **Step 6: Commit**

```
git add static/drawings.js static/drawings.css
git commit -m "drawings: selection, circular handles, mini-toolbar (delete/dup/top)"
```

---

## Task 5: Drag-to-edit handles + drag-whole-shape

**Files:**
- Modify: `static/drawings.js`

- [ ] **Step 1: Add `moveHandle` and `moveAll` to the trendline def**

```js
moveHandle(drawing, handleId, x, y, layer) {
  const pt = layer.fromPx(x, y);
  if (!pt) return;
  if (handleId === 0 || handleId === "0") drawing.points[0] = pt;
  else if (handleId === 1 || handleId === "1") drawing.points[1] = pt;
},

moveAll(drawing, dx, dy, layer) {
  const oldA = layer.toPx(drawing.points[0]);
  const oldB = layer.toPx(drawing.points[1]);
  if (!oldA || !oldB) return;
  const newA = layer.fromPx(oldA.x + dx, oldA.y + dy);
  const newB = layer.fromPx(oldB.x + dx, oldB.y + dy);
  if (newA) drawing.points[0] = newA;
  if (newB) drawing.points[1] = newB;
},
```

- [ ] **Step 2: Wire drag handlers on each handle in `_renderHandles`**

Replace the handle creation block in `_renderHandles` with:

```js
for (const h of handles) {
  const el = document.createElement("div");
  el.className = "draw-handle " + h.kind;
  el.style.left = h.x + "px";
  el.style.top  = h.y + "px";
  el.dataset.handleId = String(h.id);
  this._attachHandleDrag(el, d, h);
  this.handleHost.appendChild(el);
}
```

Add the drag method:

```js
_attachHandleDrag(el, drawing, handle) {
  const def = TOOL_DEFS.find((t) => t.id === drawing.tool);
  if (!def) return;
  el.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    el.setPointerCapture(ev.pointerId);
    const rect = this.wrapper.getBoundingClientRect();
    let lastX = ev.clientX - rect.left;
    let lastY = ev.clientY - rect.top;
    const onMove = (mv) => {
      const x = mv.clientX - rect.left;
      const y = mv.clientY - rect.top;
      if (handle.kind === "mid" && def.moveAll) {
        def.moveAll(drawing, x - lastX, y - lastY, this);
      } else if (def.moveHandle) {
        def.moveHandle(drawing, handle.id, x, y, this);
      }
      lastX = x; lastY = y;
      this._redraw();
    };
    const onUp = () => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      this.save();
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  });
}
```

- [ ] **Step 3: Add keyboard shortcuts (Esc deselect, Del delete)**

In `_attach()`, register a document-level keydown listener that's scoped to this layer:

```js
this._onKeyDown = (ev) => {
  if (this._destroyed) return;
  // Only act when this pane has focus or a drawing is selected here.
  if (!this.selectedId) return;
  if (ev.key === "Escape") {
    this.deselect();
    ev.stopPropagation();
  } else if (ev.key === "Delete" || ev.key === "Backspace") {
    // Don't hijack typing in an input/textarea
    if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
    this._handleMiniAction("del");
    ev.preventDefault();
  }
};
document.addEventListener("keydown", this._onKeyDown);
```

In `destroy()`:
```js
if (this._onKeyDown) {
  document.removeEventListener("keydown", this._onKeyDown);
  this._onKeyDown = null;
}
```

- [ ] **Step 4: Verify in browser**

1. Draw a trendline. Click it to select.
2. Drag an endpoint handle — the endpoint follows the mouse; the line redraws live.
3. Drag the mid handle — the whole line moves with the cursor.
4. Release the mouse; reload the page. The new position persists.
5. Select a line, press `Del` — it's gone. Storage updated.
6. Select a line, press `Esc` — deselected.

- [ ] **Step 5: Commit**

```
git add static/drawings.js
git commit -m "drawings: drag-to-edit handles, drag-whole-shape, Esc/Del shortcuts"
```

---

## Task 6: Style modal — color / width / dash / opacity / label / extend

**Files:**
- Modify: `static/index.html`
- Modify: `static/drawings.css`
- Modify: `static/drawings.js`

- [ ] **Step 1: Add the style modal markup to `index.html`**

Place this just before the closing `</body>`:

```html
<div id="draw-style-modal" class="modal" hidden>
  <div class="modal-backdrop" data-close></div>
  <div class="modal-panel" style="width: min(360px, 92vw); max-height: 70vh;">
    <div class="modal-header">
      <span class="modal-title">Drawing style</span>
      <span class="modal-sub" id="dsm-sub"></span>
      <button class="modal-close" type="button" data-close>×</button>
    </div>
    <div class="modal-body" id="dsm-body"></div>
    <div class="modal-footer">
      <button id="dsm-delete" class="btn-danger">Delete</button>
      <div>
        <button class="btn-secondary" data-close>Close</button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add style-modal-specific CSS to `drawings.css`**

```css
#draw-style-modal .modal-body { padding: 6px 14px 10px 14px; }

.dsm-row {
  display: grid; grid-template-columns: 84px 1fr;
  align-items: center; gap: 10px; padding: 6px 0;
  border-bottom: 1px solid rgba(35,42,57,0.5);
}
.dsm-row:last-child { border-bottom: none; }
.dsm-lbl { font-size: 11px; color: var(--text-dim); }
.dsm-color {
  width: 28px; height: 18px; border-radius: 3px; border: 1px solid var(--border);
  display: inline-block; cursor: pointer; padding: 0;
}
.dsm-pill-row { display: flex; gap: 4px; flex-wrap: wrap; }
.dsm-pill {
  padding: 2px 8px; border-radius: 3px; font-size: 10px;
  background: var(--panel-2); border: 1px solid var(--border);
  color: var(--text-dim); cursor: pointer; font-family: inherit;
}
.dsm-pill.active { background: var(--accent); color: white; border-color: var(--accent); }
.dsm-num, .dsm-text {
  background: var(--panel-2); border: 1px solid var(--border); border-radius: 3px;
  padding: 4px 6px; font-size: 11px; color: var(--text); width: 100%;
}
```

- [ ] **Step 3: Implement the style modal in `drawings.js`**

Add a standalone helper inside the IIFE (not a method):

```js
const DASH_OPTIONS = ["solid", "dashed", "dotted", "dashdot"];
const EXTEND_OPTIONS = ["none", "left", "right", "both"];

const StyleModal = {
  el: null,
  body: null,
  sub: null,
  deleteBtn: null,
  current: null,   // { drawing, layer }

  ensure() {
    if (this.el) return;
    this.el = document.getElementById("draw-style-modal");
    this.body = document.getElementById("dsm-body");
    this.sub = document.getElementById("dsm-sub");
    this.deleteBtn = document.getElementById("dsm-delete");
    this.el.addEventListener("click", (ev) => {
      if (ev.target.matches("[data-close]")) this.close();
    });
    this.deleteBtn.addEventListener("click", () => {
      if (!this.current) return;
      const { drawing, layer } = this.current;
      layer.drawings = layer.drawings.filter((x) => x.id !== drawing.id);
      layer.save();
      layer.deselect();
      layer._redraw();
      this.close();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !this.el.hidden) this.close();
    });
  },

  open(drawing, layer) {
    this.ensure();
    this.current = { drawing, layer };
    const def = TOOL_DEFS.find((t) => t.id === drawing.tool);
    this.sub.textContent = def ? def.name : drawing.tool;
    this._render();
    this.el.hidden = false;
  },

  close() {
    if (!this.el) return;
    this.el.hidden = true;
    this.current = null;
  },

  _render() {
    const { drawing, layer } = this.current;
    this.body.innerHTML = "";

    const rows = [
      this._row("Color", this._colorInput(drawing)),
      this._row("Width", this._numberInput(drawing, "width", 1, 8, 1, " px")),
      this._row("Dash", this._pillRow(drawing, "dash", DASH_OPTIONS,
        { solid: "──", dashed: "- -", dotted: "···", dashdot: "─·" })),
      this._row("Opacity", this._numberInput(drawing, "opacity", 0.1, 1, 0.1, "")),
      this._row("Label", this._textInput(drawing, "label")),
      this._row("Extend", this._pillRow(drawing, "extend", EXTEND_OPTIONS,
        { none: "none", left: "←", right: "→", both: "↔" }, "scope")),
    ];
    rows.forEach((r) => this.body.appendChild(r));
  },

  _row(label, control) {
    const r = document.createElement("div");
    r.className = "dsm-row";
    const l = document.createElement("span");
    l.className = "dsm-lbl";
    l.textContent = label;
    r.append(l, control);
    return r;
  },

  _colorInput(drawing) {
    const wrap = document.createElement("span");
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "6px";
    const inp = document.createElement("input");
    inp.type = "color";
    inp.className = "dsm-color";
    inp.value = drawing.style.color;
    inp.addEventListener("input", () => {
      drawing.style.color = inp.value;
      this._apply();
    });
    const label = document.createElement("span");
    label.style.fontSize = "11px";
    label.style.color = "var(--text)";
    label.textContent = inp.value;
    inp.addEventListener("input", () => { label.textContent = inp.value; });
    wrap.append(inp, label);
    return wrap;
  },

  _numberInput(drawing, key, min, max, step, suffix) {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.className = "dsm-num";
    inp.min = min; inp.max = max; inp.step = step;
    inp.value = drawing.style[key];
    inp.addEventListener("input", () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v)) return;
      drawing.style[key] = v;
      this._apply();
    });
    return inp;
  },

  _textInput(drawing, key) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "dsm-text";
    inp.value = drawing.style[key] || "";
    inp.addEventListener("input", () => {
      drawing.style[key] = inp.value;
      this._apply();
    });
    return inp;
  },

  _pillRow(drawing, key, options, glyphs, group = "style") {
    const wrap = document.createElement("div");
    wrap.className = "dsm-pill-row";
    options.forEach((opt) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dsm-pill";
      if (drawing[group][key] === opt) b.classList.add("active");
      b.textContent = glyphs[opt] || opt;
      b.title = opt;
      b.addEventListener("click", () => {
        drawing[group][key] = opt;
        this._apply();
        this._render(); // re-render to flip active class
      });
      wrap.appendChild(b);
    });
    return wrap;
  },

  _apply() {
    const { layer } = this.current;
    layer.save();
    layer._redraw();
  },
};
```

Export it: `window.Drawings = { ..., StyleModal };`

- [ ] **Step 4: Wire the mini-toolbar `edit` action to open the modal**

In `_handleMiniAction`, add a branch:

```js
} else if (act === "edit") {
  StyleModal.open(d, this);
}
```

- [ ] **Step 5: Update the trendline render to honour `extend`**

Replace the trendline's `render` with:

```js
render(svg, drawing, layer) {
  const [a, b] = drawing.points;
  const pa = layer.toPx(a);
  const pb = layer.toPx(b);
  if (!pa || !pb) return;
  const rect = layer.svg.getBoundingClientRect();
  let x1 = pa.x, y1 = pa.y, x2 = pb.x, y2 = pb.y;
  const dx = x2 - x1, dy = y2 - y1;
  const slope = dx === 0 ? Infinity : dy / dx;
  const ext = drawing.scope.extend || "none";
  if (slope !== Infinity && (ext === "left" || ext === "both")) {
    const ny = y1 - slope * x1;
    x1 = 0; y1 = ny;
  }
  if (slope !== Infinity && (ext === "right" || ext === "both")) {
    const ny = y2 + slope * (rect.width - x2);
    x2 = rect.width; y2 = ny;
  }
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("data-drawing-id", drawing.id);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", x1); line.setAttribute("y1", y1);
  line.setAttribute("x2", x2); line.setAttribute("y2", y2);
  line.setAttribute("stroke", drawing.style.color);
  line.setAttribute("stroke-width", drawing.style.width);
  line.setAttribute("stroke-opacity", drawing.style.opacity);
  line.setAttribute("stroke-linecap", "round");
  const dash = DASH_MAP[drawing.style.dash] || null;
  if (dash) line.setAttribute("stroke-dasharray", dash);
  g.appendChild(line);
  if (drawing.style.label) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", pb.x + 6);
    t.setAttribute("y", pb.y - 4);
    t.setAttribute("fill", drawing.style.color);
    t.setAttribute("font-size", "10");
    t.textContent = drawing.style.label;
    g.appendChild(t);
  }
  svg.appendChild(g);
},
```

- [ ] **Step 6: Verify in browser**

1. Draw a trendline; click the line; click `✏` on the mini-toolbar — modal opens with the trendline's style.
2. Change color — line updates immediately.
3. Change width to 5 — line thickens.
4. Switch dash to dotted — line becomes dotted.
5. Lower opacity to 0.4 — line is faint.
6. Type "Resistance" in Label — text appears next to the end of the line.
7. Click `→` Extend — line extends to the right edge of the chart.
8. Reload the page. All styling persists.
9. Open the modal again; click the trash/Delete button — drawing is removed.

- [ ] **Step 7: Commit**

```
git add static/index.html static/drawings.css static/drawings.js
git commit -m "drawings: full style modal (color/width/dash/opacity/label/extend)"
```

---

## Task 7: Snap-to-OHLC (Shift modifier)

**Files:**
- Modify: `static/drawings.js`

- [ ] **Step 1: Expose pane candles to the drawing layer**

In `app.js` `Pane` constructor, after creating `drawingLayer`:

```js
this.drawingLayer.getCandles = () => this.candles;
```

This avoids hard-coupling — the layer pulls candles on demand without storing a stale reference.

- [ ] **Step 2: Add snap logic to `DrawingLayer`**

```js
_snapPoint(pt, modifiers) {
  const prefs = PrefsStore.get();
  const mode = prefs.snapDefault;       // "shift" | "always" | "never"
  const shouldSnap =
    mode === "always" ||
    (mode === "shift" && modifiers && modifiers.shiftKey);
  if (!shouldSnap || !this.getCandles) return pt;
  const candles = this.getCandles();
  if (!candles || candles.length === 0) return pt;
  // Find the candle whose time is closest to pt.time
  let best = candles[0], bestDiff = Math.abs(candles[0].time - pt.time);
  for (let i = 1; i < candles.length; i++) {
    const d = Math.abs(candles[i].time - pt.time);
    if (d < bestDiff) { best = candles[i]; bestDiff = d; }
  }
  const ohlc = [best.open, best.high, best.low, best.close];
  let nearest = ohlc[0], minDist = Math.abs(ohlc[0] - pt.price);
  for (let i = 1; i < ohlc.length; i++) {
    const d = Math.abs(ohlc[i] - pt.price);
    if (d < minDist) { nearest = ohlc[i]; minDist = d; }
  }
  return { time: best.time, price: nearest };
}
```

- [ ] **Step 3: Apply snap on click placement**

In `_onClick`, replace the placement branch's `this.placePoints.push(pt)` with:

```js
this.placePoints.push(this._snapPoint(pt, ev));
```

- [ ] **Step 4: Apply snap on drag**

In `_attachHandleDrag`'s `onMove`, replace the existing call to `def.moveHandle` with:

```js
const raw = this.fromPx(x, y);
const snapped = raw ? this._snapPoint(raw, mv) : null;
if (handle.kind === "mid" && def.moveAll) {
  def.moveAll(drawing, x - lastX, y - lastY, this);
} else if (def.moveHandle && snapped) {
  // Re-project the snapped point back to px for the move call
  const px = this.toPx(snapped);
  if (px) def.moveHandle(drawing, handle.id, px.x, px.y, this);
}
```

- [ ] **Step 5: Verify in browser**

1. Draw a trendline with Shift held — each endpoint snaps to a candle's open/high/low/close. The price tag (visible in console: `Drawings.DrawingStore.get('hyperliquid','BTC')[0]`) should exactly equal an OHLC value of a real candle.
2. Draw a trendline without Shift — endpoint lands wherever you click (not snapped).
3. Select a trendline, drag an endpoint while holding Shift — the endpoint snaps as you drag.

- [ ] **Step 6: Commit**

```
git add static/drawings.js static/app.js
git commit -m "drawings: Shift-to-snap endpoints to nearest OHLC"
```

---

## Task 8: Horizontal line + Vertical line tools

**Files:**
- Modify: `static/drawings.js`

- [ ] **Step 1: Add horizontal line def to `TOOL_DEFS`**

Insert into the `TOOL_DEFS` array:

```js
{
  id: "horizontal",
  name: "Horizontal line",
  pointsNeeded: 1,
  defaultStyle: { color: "#42a5f5", width: 1, dash: "dashed", opacity: 1 },
  defaultScope: { showAllTimeframes: true, extend: "both" },

  render(svg, drawing, layer) {
    const [a] = drawing.points;
    const py = layer.series.priceToCoordinate(a.price);
    if (py == null) return;
    const w = layer.svg.getBoundingClientRect().width;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("data-drawing-id", drawing.id);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", 0); line.setAttribute("y1", py);
    line.setAttribute("x2", w); line.setAttribute("y2", py);
    line.setAttribute("stroke", drawing.style.color);
    line.setAttribute("stroke-width", drawing.style.width);
    line.setAttribute("stroke-opacity", drawing.style.opacity);
    const dash = DASH_MAP[drawing.style.dash] || null;
    if (dash) line.setAttribute("stroke-dasharray", dash);
    g.appendChild(line);
    // price label on the right
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", w - 4);
    label.setAttribute("y", py - 2);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("fill", drawing.style.color);
    label.setAttribute("font-size", "10");
    label.textContent = drawing.style.label || (a.price >= 1000
      ? a.price.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : a.price.toLocaleString(undefined, { maximumFractionDigits: 4 }));
    g.appendChild(label);
    svg.appendChild(g);
  },

  hitTest(drawing, x, y, layer, tol = 5) {
    const py = layer.series.priceToCoordinate(drawing.points[0].price);
    if (py == null) return false;
    return Math.abs(y - py) <= tol;
  },

  handles(drawing, layer) {
    const py = layer.series.priceToCoordinate(drawing.points[0].price);
    if (py == null) return [];
    const w = layer.svg.getBoundingClientRect().width;
    return [{ id: 0, kind: "endpoint", x: w / 2, y: py }];
  },

  moveHandle(drawing, handleId, x, y, layer) {
    const pt = layer.fromPx(x, y);
    if (pt) drawing.points[0].price = pt.price;
  },

  moveAll(drawing, dx, dy, layer) {
    const py = layer.series.priceToCoordinate(drawing.points[0].price);
    if (py == null) return;
    const newPrice = layer.series.coordinateToPrice(py + dy);
    if (newPrice != null) drawing.points[0].price = newPrice;
  },
},
```

- [ ] **Step 2: Add vertical line def to `TOOL_DEFS`**

```js
{
  id: "vertical",
  name: "Vertical line",
  pointsNeeded: 1,
  defaultStyle: { color: "#ab47bc", width: 1, dash: "dashed", opacity: 1 },
  defaultScope: { showAllTimeframes: true, extend: "both" },

  render(svg, drawing, layer) {
    const [a] = drawing.points;
    const px = layer.chart.timeScale().timeToCoordinate(a.time);
    if (px == null) return;
    const h = layer.svg.getBoundingClientRect().height;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("data-drawing-id", drawing.id);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", px); line.setAttribute("y1", 0);
    line.setAttribute("x2", px); line.setAttribute("y2", h);
    line.setAttribute("stroke", drawing.style.color);
    line.setAttribute("stroke-width", drawing.style.width);
    line.setAttribute("stroke-opacity", drawing.style.opacity);
    const dash = DASH_MAP[drawing.style.dash] || null;
    if (dash) line.setAttribute("stroke-dasharray", dash);
    g.appendChild(line);
    if (drawing.style.label) {
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", px + 4);
      t.setAttribute("y", 14);
      t.setAttribute("fill", drawing.style.color);
      t.setAttribute("font-size", "10");
      t.textContent = drawing.style.label;
      g.appendChild(t);
    }
    svg.appendChild(g);
  },

  hitTest(drawing, x, y, layer, tol = 5) {
    const px = layer.chart.timeScale().timeToCoordinate(drawing.points[0].time);
    if (px == null) return false;
    return Math.abs(x - px) <= tol;
  },

  handles(drawing, layer) {
    const px = layer.chart.timeScale().timeToCoordinate(drawing.points[0].time);
    if (px == null) return [];
    const h = layer.svg.getBoundingClientRect().height;
    return [{ id: 0, kind: "endpoint", x: px, y: h / 2 }];
  },

  moveHandle(drawing, handleId, x, y, layer) {
    const pt = layer.fromPx(x, y);
    if (pt) drawing.points[0].time = pt.time;
  },

  moveAll(drawing, dx, dy, layer) {
    const px = layer.chart.timeScale().timeToCoordinate(drawing.points[0].time);
    if (px == null) return;
    const newTime = layer.chart.timeScale().coordinateToTime(px + dx);
    if (newTime != null) drawing.points[0].time = typeof newTime === "number" ? newTime : Number(newTime);
  },
},
```

- [ ] **Step 3: Verify in browser**

1. Click **─** Horizontal line. Click anywhere — a blue dashed line spans the full width at that price. A price label appears on the right edge.
2. Click **│** Vertical line. Click anywhere — a purple dashed line spans the full height at that time.
3. Select each, change color/width in the style modal — works.
4. Drag each handle — line follows.
5. Reload — both persist.

- [ ] **Step 4: Commit**

```
git add static/drawings.js
git commit -m "drawings: horizontal + vertical line tools"
```

---

## Task 9: Rectangle / zone tool

**Files:**
- Modify: `static/drawings.js`

- [ ] **Step 1: Add helper `withAlpha(hex, a)` to the IIFE**

```js
function withAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
```

- [ ] **Step 2: Add rectangle def to `TOOL_DEFS`**

```js
{
  id: "rectangle",
  name: "Rectangle",
  pointsNeeded: 2,
  defaultStyle: { color: "#26a69a", width: 1, dash: "solid", opacity: 1 },
  defaultScope: { showAllTimeframes: true, extend: "none" },

  render(svg, drawing, layer) {
    const pa = layer.toPx(drawing.points[0]);
    const pb = layer.toPx(drawing.points[1]);
    if (!pa || !pb) return;
    const x = Math.min(pa.x, pb.x), y = Math.min(pa.y, pb.y);
    const w = Math.abs(pb.x - pa.x), h = Math.abs(pb.y - pa.y);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("data-drawing-id", drawing.id);
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", x); r.setAttribute("y", y);
    r.setAttribute("width", w); r.setAttribute("height", h);
    r.setAttribute("fill", withAlpha(drawing.style.color, 0.18 * drawing.style.opacity));
    r.setAttribute("stroke", drawing.style.color);
    r.setAttribute("stroke-width", drawing.style.width);
    r.setAttribute("stroke-opacity", drawing.style.opacity);
    const dash = DASH_MAP[drawing.style.dash] || null;
    if (dash) r.setAttribute("stroke-dasharray", dash);
    g.appendChild(r);
    svg.appendChild(g);
  },

  hitTest(drawing, x, y, layer, tol = 4) {
    const pa = layer.toPx(drawing.points[0]);
    const pb = layer.toPx(drawing.points[1]);
    if (!pa || !pb) return false;
    const x1 = Math.min(pa.x, pb.x) - tol, x2 = Math.max(pa.x, pb.x) + tol;
    const y1 = Math.min(pa.y, pb.y) - tol, y2 = Math.max(pa.y, pb.y) + tol;
    return x >= x1 && x <= x2 && y >= y1 && y <= y2;
  },

  handles(drawing, layer) {
    const pa = layer.toPx(drawing.points[0]);
    const pb = layer.toPx(drawing.points[1]);
    if (!pa || !pb) return [];
    return [
      { id: 0,   kind: "endpoint", x: pa.x, y: pa.y },
      { id: 1,   kind: "endpoint", x: pb.x, y: pb.y },
      { id: "mid", kind: "mid",    x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
    ];
  },

  moveHandle(drawing, handleId, x, y, layer) {
    const pt = layer.fromPx(x, y);
    if (!pt) return;
    if (handleId == 0) drawing.points[0] = pt;
    else if (handleId == 1) drawing.points[1] = pt;
  },

  moveAll(drawing, dx, dy, layer) {
    const newPts = drawing.points.map((p) => {
      const px = layer.toPx(p);
      if (!px) return p;
      return layer.fromPx(px.x + dx, px.y + dy) || p;
    });
    drawing.points = newPts;
  },
},
```

- [ ] **Step 2: Verify in browser**

1. Click **▭** Rectangle. Click two opposite corners — a translucent teal box appears.
2. Drag handles to resize. Drag mid handle to move.
3. Open the style modal — change fill colour, width, dash. Verify the fill follows the colour (with low alpha) and the border follows colour + dash.
4. Delete via Del or the trash button.
5. Reload — persists.

- [ ] **Step 3: Commit**

```
git add static/drawings.js
git commit -m "drawings: rectangle / zone tool"
```

---

## Task 10: Fibonacci retracement tool

**Files:**
- Modify: `static/drawings.js`

- [ ] **Step 1: Add fib def to `TOOL_DEFS`**

```js
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];

// (Insert FIB_LEVELS near DASH_MAP)
// Then in TOOL_DEFS:
{
  id: "fib",
  name: "Fibonacci retracement",
  pointsNeeded: 2,
  defaultStyle: { color: "#ec407a", width: 1, dash: "dashed", opacity: 0.9 },
  defaultScope: { showAllTimeframes: true, extend: "none" },

  render(svg, drawing, layer) {
    const pa = layer.toPx(drawing.points[0]);
    const pb = layer.toPx(drawing.points[1]);
    if (!pa || !pb) return;
    const xMin = Math.min(pa.x, pb.x), xMax = Math.max(pa.x, pb.x);
    const priceHi = Math.max(drawing.points[0].price, drawing.points[1].price);
    const priceLo = Math.min(drawing.points[0].price, drawing.points[1].price);
    const range = priceHi - priceLo;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("data-drawing-id", drawing.id);
    for (const lvl of FIB_LEVELS) {
      const price = priceHi - range * lvl;
      const py = layer.series.priceToCoordinate(price);
      if (py == null) continue;
      const isEdge = lvl === 0 || lvl === 1;
      const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
      ln.setAttribute("x1", xMin); ln.setAttribute("y1", py);
      ln.setAttribute("x2", xMax); ln.setAttribute("y2", py);
      ln.setAttribute("stroke", drawing.style.color);
      ln.setAttribute("stroke-width", isEdge ? drawing.style.width + 1 : drawing.style.width);
      ln.setAttribute("stroke-opacity", drawing.style.opacity);
      if (!isEdge && drawing.style.dash !== "solid") {
        const dash = DASH_MAP[drawing.style.dash] || "4,3";
        ln.setAttribute("stroke-dasharray", dash);
      }
      g.appendChild(ln);
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", xMax + 4);
      t.setAttribute("y", py + 3);
      t.setAttribute("fill", drawing.style.color);
      t.setAttribute("font-size", "9");
      t.textContent = lvl.toFixed(3).replace(/\.?0+$/, "");
      g.appendChild(t);
    }
    svg.appendChild(g);
  },

  hitTest(drawing, x, y, layer, tol = 5) {
    // Hit if the cursor is within tol px of any level line in the x-range
    const pa = layer.toPx(drawing.points[0]);
    const pb = layer.toPx(drawing.points[1]);
    if (!pa || !pb) return false;
    if (x < Math.min(pa.x, pb.x) - tol || x > Math.max(pa.x, pb.x) + tol) return false;
    const priceHi = Math.max(drawing.points[0].price, drawing.points[1].price);
    const priceLo = Math.min(drawing.points[0].price, drawing.points[1].price);
    const range = priceHi - priceLo;
    for (const lvl of FIB_LEVELS) {
      const py = layer.series.priceToCoordinate(priceHi - range * lvl);
      if (py != null && Math.abs(y - py) <= tol) return true;
    }
    return false;
  },

  handles(drawing, layer) {
    const pa = layer.toPx(drawing.points[0]);
    const pb = layer.toPx(drawing.points[1]);
    if (!pa || !pb) return [];
    return [
      { id: 0, kind: "endpoint", x: pa.x, y: pa.y },
      { id: 1, kind: "endpoint", x: pb.x, y: pb.y },
      { id: "mid", kind: "mid", x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
    ];
  },

  moveHandle(drawing, handleId, x, y, layer) {
    const pt = layer.fromPx(x, y);
    if (!pt) return;
    if (handleId == 0) drawing.points[0] = pt;
    else if (handleId == 1) drawing.points[1] = pt;
  },

  moveAll(drawing, dx, dy, layer) {
    const newPts = drawing.points.map((p) => {
      const px = layer.toPx(p);
      if (!px) return p;
      return layer.fromPx(px.x + dx, px.y + dy) || p;
    });
    drawing.points = newPts;
  },
},
```

- [ ] **Step 2: Verify in browser**

1. Click **⌘** Fibonacci. Click a recent high then a recent low — 7 horizontal lines appear, labelled 0 / 0.236 / 0.382 / 0.5 / 0.618 / 0.786 / 1.
2. Edge lines (0 and 1) are slightly thicker than the intermediates.
3. Drag an endpoint — all 7 levels recompute in real time.
4. Reload — persists.

- [ ] **Step 3: Commit**

```
git add static/drawings.js
git commit -m "drawings: fibonacci retracement tool"
```

---

## Task 11: Parallel channel tool (3-point)

**Files:**
- Modify: `static/drawings.js`

- [ ] **Step 1: Add channel def to `TOOL_DEFS`**

```js
{
  id: "channel",
  name: "Parallel channel",
  pointsNeeded: 3,
  defaultStyle: { color: "#9ccc65", width: 1, dash: "solid", opacity: 0.9 },
  defaultScope: { showAllTimeframes: true, extend: "none" },

  /**
   * points[0], points[1] = base trendline (A, B)
   * points[2]            = offset reference (C) — the parallel line passes through C
   *                        parallel to AB
   */
  render(svg, drawing, layer) {
    const A = layer.toPx(drawing.points[0]);
    const B = layer.toPx(drawing.points[1]);
    const C = layer.toPx(drawing.points[2]);
    if (!A || !B || !C) return;
    // perpendicular offset from AB to C
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // unit normal
    const t = (C.x - A.x) * nx + (C.y - A.y) * ny; // signed distance
    const D = { x: A.x + nx * t, y: A.y + ny * t };
    const E = { x: B.x + nx * t, y: B.y + ny * t };

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("data-drawing-id", drawing.id);

    // translucent fill
    const fill = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    fill.setAttribute("points", `${A.x},${A.y} ${B.x},${B.y} ${E.x},${E.y} ${D.x},${D.y}`);
    fill.setAttribute("fill", withAlpha(drawing.style.color, 0.12 * drawing.style.opacity));
    fill.setAttribute("stroke", "none");
    g.appendChild(fill);

    // base line A-B
    const base = document.createElementNS("http://www.w3.org/2000/svg", "line");
    base.setAttribute("x1", A.x); base.setAttribute("y1", A.y);
    base.setAttribute("x2", B.x); base.setAttribute("y2", B.y);
    base.setAttribute("stroke", drawing.style.color);
    base.setAttribute("stroke-width", drawing.style.width);
    base.setAttribute("stroke-opacity", drawing.style.opacity);
    const dash = DASH_MAP[drawing.style.dash] || null;
    if (dash) base.setAttribute("stroke-dasharray", dash);
    g.appendChild(base);

    // parallel line D-E
    const par = document.createElementNS("http://www.w3.org/2000/svg", "line");
    par.setAttribute("x1", D.x); par.setAttribute("y1", D.y);
    par.setAttribute("x2", E.x); par.setAttribute("y2", E.y);
    par.setAttribute("stroke", drawing.style.color);
    par.setAttribute("stroke-width", drawing.style.width);
    par.setAttribute("stroke-opacity", drawing.style.opacity);
    if (dash) par.setAttribute("stroke-dasharray", dash);
    g.appendChild(par);

    svg.appendChild(g);
  },

  hitTest(drawing, x, y, layer, tol = 5) {
    const A = layer.toPx(drawing.points[0]);
    const B = layer.toPx(drawing.points[1]);
    const C = layer.toPx(drawing.points[2]);
    if (!A || !B || !C) return false;
    if (distPointToSegment(x, y, A.x, A.y, B.x, B.y) <= tol) return true;
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const t = (C.x - A.x) * nx + (C.y - A.y) * ny;
    const D = { x: A.x + nx * t, y: A.y + ny * t };
    const E = { x: B.x + nx * t, y: B.y + ny * t };
    return distPointToSegment(x, y, D.x, D.y, E.x, E.y) <= tol;
  },

  handles(drawing, layer) {
    const out = [];
    drawing.points.forEach((p, i) => {
      const px = layer.toPx(p);
      if (px) out.push({ id: i, kind: "endpoint", x: px.x, y: px.y });
    });
    return out;
  },

  moveHandle(drawing, handleId, x, y, layer) {
    const pt = layer.fromPx(x, y);
    if (pt) drawing.points[+handleId] = pt;
  },

  moveAll(drawing, dx, dy, layer) {
    drawing.points = drawing.points.map((p) => {
      const px = layer.toPx(p);
      if (!px) return p;
      return layer.fromPx(px.x + dx, px.y + dy) || p;
    });
  },
},
```

- [ ] **Step 2: Verify in browser**

1. Click **∥** Channel. Click three points: A (line start), B (line end), C (parallel offset reference).
2. Two parallel green lines appear with translucent fill between them.
3. Drag any of the three handles to reshape.
4. Reload — persists.

- [ ] **Step 3: Commit**

```
git add static/drawings.js
git commit -m "drawings: parallel channel tool (3-point)"
```

---

## Task 12: Arc tool

**Files:**
- Modify: `static/drawings.js`

- [ ] **Step 1: Add arc def to `TOOL_DEFS`**

```js
{
  id: "arc",
  name: "Arc",
  pointsNeeded: 2,
  defaultStyle: { color: "#42a5f5", width: 1.5, dash: "solid", opacity: 1 },
  defaultScope: { showAllTimeframes: true, extend: "none" },

  render(svg, drawing, layer) {
    const pa = layer.toPx(drawing.points[0]);
    const pb = layer.toPx(drawing.points[1]);
    if (!pa || !pb) return;
    // Elliptical arc from A to B, bowing upward.
    const rx = Math.abs(pb.x - pa.x) / 2;
    const ry = Math.abs(pb.y - pa.y) / 2 + Math.abs(pb.x - pa.x) / 4;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("data-drawing-id", drawing.id);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    // sweep-flag 0 = bow upward when going left→right
    path.setAttribute("d", `M ${pa.x},${pa.y} A ${rx},${ry} 0 0 0 ${pb.x},${pb.y}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", drawing.style.color);
    path.setAttribute("stroke-width", drawing.style.width);
    path.setAttribute("stroke-opacity", drawing.style.opacity);
    const dash = DASH_MAP[drawing.style.dash] || null;
    if (dash) path.setAttribute("stroke-dasharray", dash);
    g.appendChild(path);
    svg.appendChild(g);
  },

  hitTest(drawing, x, y, layer, tol = 6) {
    // Bounding-box test (cheap approximation). Refine if false-positive rate is high.
    const pa = layer.toPx(drawing.points[0]);
    const pb = layer.toPx(drawing.points[1]);
    if (!pa || !pb) return false;
    const x1 = Math.min(pa.x, pb.x) - tol, x2 = Math.max(pa.x, pb.x) + tol;
    const yMin = Math.min(pa.y, pb.y) - Math.abs(pb.x - pa.x) / 4 - tol;
    const yMax = Math.max(pa.y, pb.y) + tol;
    return x >= x1 && x <= x2 && y >= yMin && y <= yMax;
  },

  handles(drawing, layer) {
    return drawing.points.map((p, i) => {
      const px = layer.toPx(p);
      return px ? { id: i, kind: "endpoint", x: px.x, y: px.y } : null;
    }).filter(Boolean);
  },

  moveHandle(drawing, handleId, x, y, layer) {
    const pt = layer.fromPx(x, y);
    if (pt) drawing.points[+handleId] = pt;
  },

  moveAll(drawing, dx, dy, layer) {
    drawing.points = drawing.points.map((p) => {
      const px = layer.toPx(p);
      if (!px) return p;
      return layer.fromPx(px.x + dx, px.y + dy) || p;
    });
  },
},
```

- [ ] **Step 2: Verify in browser**

1. Click **◠** Arc. Click two points — a curved arc bows up between them.
2. Drag handles — arc reshapes.
3. Reload — persists.

- [ ] **Step 3: Commit**

```
git add static/drawings.js
git commit -m "drawings: arc tool"
```

---

## Task 13: Measurement ruler

**Files:**
- Modify: `static/drawings.js`
- Modify: `static/drawings.css`

- [ ] **Step 1: Add ruler def to `TOOL_DEFS`**

```js
{
  id: "ruler",
  name: "Measurement ruler",
  pointsNeeded: 2,
  defaultStyle: { color: "#26c6da", width: 1, dash: "solid", opacity: 1 },
  defaultScope: { showAllTimeframes: true, extend: "none" },

  render(svg, drawing, layer) {
    const a = drawing.points[0], b = drawing.points[1];
    const pa = layer.toPx(a), pb = layer.toPx(b);
    if (!pa || !pb) return;
    const x = Math.min(pa.x, pb.x), y = Math.min(pa.y, pb.y);
    const w = Math.abs(pb.x - pa.x), h = Math.abs(pb.y - pa.y);
    const isUp = b.price >= a.price;
    const color = isUp ? "#26a69a" : "#ef5350";
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("data-drawing-id", drawing.id);

    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", x); r.setAttribute("y", y);
    r.setAttribute("width", w); r.setAttribute("height", h);
    r.setAttribute("fill", withAlpha(color, 0.15));
    r.setAttribute("stroke", color);
    r.setAttribute("stroke-width", 1);
    r.setAttribute("stroke-dasharray", "3,3");
    g.appendChild(r);

    // Readout HTML overlay
    if (!drawing._readout) drawing._readout = null;
    svg.appendChild(g);

    // Compute readout numbers
    const dPrice = b.price - a.price;
    const dPct = a.price === 0 ? 0 : (dPrice / a.price) * 100;
    const dTime = Math.abs(b.time - a.time);
    // bars: assume the layer's pane knows the timeframe → use it
    const tfSec = ({ "1m":60, "5m":300, "15m":900, "1h":3600, "4h":14400, "1d":86400 })[layer.timeframe] || 60;
    const bars = Math.round(dTime / tfSec);
    const dHours = (dTime / 3600);
    const tStr = dHours >= 24 ? `${(dHours/24).toFixed(1)}d`
               : dHours >= 1  ? `${dHours.toFixed(1)}h`
                              : `${Math.round(dTime/60)}m`;

    // Render readout as a foreignObject so we can use HTML
    const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
    fo.setAttribute("x", (pa.x + pb.x) / 2 - 70);
    fo.setAttribute("y", Math.min(pa.y, pb.y) - 38);
    fo.setAttribute("width", 140);
    fo.setAttribute("height", 36);
    const div = document.createElement("div");
    div.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    div.className = "draw-ruler-readout";
    div.innerHTML = `
      <div class="line1">${dPrice >= 0 ? "+" : ""}${dPrice.toFixed(2)} (${dPct >= 0 ? "+" : ""}${dPct.toFixed(2)}%)</div>
      <div class="line2">${bars} bar${bars === 1 ? "" : "s"} · ${tStr}</div>
    `;
    fo.appendChild(div);
    g.appendChild(fo);
  },

  hitTest(drawing, x, y, layer, tol = 4) {
    const pa = layer.toPx(drawing.points[0]);
    const pb = layer.toPx(drawing.points[1]);
    if (!pa || !pb) return false;
    const x1 = Math.min(pa.x, pb.x) - tol, x2 = Math.max(pa.x, pb.x) + tol;
    const y1 = Math.min(pa.y, pb.y) - tol, y2 = Math.max(pa.y, pb.y) + tol;
    return x >= x1 && x <= x2 && y >= y1 && y <= y2;
  },

  handles(drawing, layer) {
    const pa = layer.toPx(drawing.points[0]);
    const pb = layer.toPx(drawing.points[1]);
    if (!pa || !pb) return [];
    return [
      { id: 0, kind: "endpoint", x: pa.x, y: pa.y },
      { id: 1, kind: "endpoint", x: pb.x, y: pb.y },
    ];
  },

  moveHandle(drawing, handleId, x, y, layer) {
    const pt = layer.fromPx(x, y);
    if (pt) drawing.points[+handleId] = pt;
  },

  moveAll(drawing, dx, dy, layer) {
    drawing.points = drawing.points.map((p) => {
      const px = layer.toPx(p);
      if (!px) return p;
      return layer.fromPx(px.x + dx, px.y + dy) || p;
    });
  },
},
```

- [ ] **Step 2: Add readout styles to `drawings.css`**

```css
.draw-ruler-readout {
  background: rgba(21, 26, 35, 0.95);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 6px;
  font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 10px;
  color: var(--text);
  text-align: center;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.draw-ruler-readout .line1 { font-weight: 600; }
.draw-ruler-readout .line2 { color: var(--text-dim); font-size: 9px; margin-top: 1px; }
```

- [ ] **Step 3: Verify in browser**

1. Click **📏** Ruler. Click two points — translucent green box (or red, if price went down) appears with a small readout above showing `Δprice (Δ%) / N bars · time`.
2. Drag handles — readout updates live.
3. Switch the pane to a different timeframe — bar count updates accordingly.
4. Reload — persists.

- [ ] **Step 4: Commit**

```
git add static/drawings.js static/drawings.css
git commit -m "drawings: measurement ruler with delta-price/percent/bars readout"
```

---

## Task 14: Text annotation tool

**Files:**
- Modify: `static/drawings.js`
- Modify: `static/drawings.css`

- [ ] **Step 1: Add text def to `TOOL_DEFS`**

```js
{
  id: "text",
  name: "Text",
  pointsNeeded: 1,
  defaultStyle: { color: "#9ccc65", width: 1, dash: "solid", opacity: 1, label: "" },
  defaultScope: { showAllTimeframes: true, extend: "none" },

  render(svg, drawing, layer) {
    const pa = layer.toPx(drawing.points[0]);
    if (!pa) return;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("data-drawing-id", drawing.id);
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", pa.x);
    dot.setAttribute("cy", pa.y);
    dot.setAttribute("r", 2);
    dot.setAttribute("fill", drawing.style.color);
    g.appendChild(dot);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", pa.x + 6);
    text.setAttribute("y", pa.y + 4);
    text.setAttribute("fill", drawing.style.color);
    text.setAttribute("font-size", "11");
    text.setAttribute("opacity", drawing.style.opacity);
    text.textContent = drawing.style.label || "(text)";
    g.appendChild(text);
    svg.appendChild(g);
  },

  hitTest(drawing, x, y, layer, tol = 6) {
    const pa = layer.toPx(drawing.points[0]);
    if (!pa) return false;
    // Hit if close to the anchor or within ~80 px to the right (rough text bbox)
    return x >= pa.x - tol && x <= pa.x + 80 && Math.abs(y - pa.y) <= 10;
  },

  handles(drawing, layer) {
    const pa = layer.toPx(drawing.points[0]);
    if (!pa) return [];
    return [{ id: 0, kind: "endpoint", x: pa.x, y: pa.y }];
  },

  moveHandle(drawing, handleId, x, y, layer) {
    const pt = layer.fromPx(x, y);
    if (pt) drawing.points[0] = pt;
  },

  moveAll(drawing, dx, dy, layer) {
    const px = layer.toPx(drawing.points[0]);
    if (!px) return;
    const np = layer.fromPx(px.x + dx, px.y + dy);
    if (np) drawing.points[0] = np;
  },

  /**
   * Called by DrawingLayer after the user clicks once. Prompts the user
   * for label text via an inline DOM input anchored to the click position.
   * Resolves with the entered text (empty string cancels).
   */
  promptLabel(layer, screenPt) {
    return new Promise((resolve) => {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "draw-text-inline";
      Object.assign(inp.style, {
        position: "absolute",
        left: screenPt.x + "px",
        top: (screenPt.y - 10) + "px",
        zIndex: 7,
      });
      layer.handleHost.appendChild(inp);
      inp.focus();
      const cleanup = () => {
        if (inp.parentNode) inp.parentNode.removeChild(inp);
      };
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { resolve(inp.value); cleanup(); }
        else if (e.key === "Escape") { resolve(""); cleanup(); }
      });
      inp.addEventListener("blur", () => { resolve(inp.value); cleanup(); });
    });
  },
},
```

- [ ] **Step 2: Handle the inline-prompt flow in `DrawingLayer._onClick`**

In the placing branch, special-case `text`:

```js
if (this.placePoints.length >= this.activeTool.pointsNeeded) {
  let labelPromise = Promise.resolve(undefined);
  if (this.activeTool.id === "text" && this.activeTool.promptLabel) {
    labelPromise = this.activeTool.promptLabel(this, { x, y });
  }
  labelPromise.then((labelText) => {
    if (this.activeTool && this.activeTool.id === "text" && labelText === "") {
      // empty cancel
      this.placePoints = [];
      this.setActiveTool("cursor");
      this._notifyToolChange && this._notifyToolChange("cursor");
      return;
    }
    const drawing = {
      id: util.newId(),
      tool: this.activeTool.id,
      points: this.placePoints.slice(),
      style: { ...this.activeTool.defaultStyle,
        ...(labelText !== undefined ? { label: labelText } : {}) },
      scope: { ...this.activeTool.defaultScope },
      z: this.drawings.length,
      createdAt: Math.floor(Date.now() / 1000),
    };
    this.drawings.push(drawing);
    this.save();
    this.placePoints = [];
    this.setActiveTool("cursor");
    this._notifyToolChange && this._notifyToolChange("cursor");
    this._redraw();
  });
  return;
}
```

- [ ] **Step 3: Add inline-input styles to `drawings.css`**

```css
.draw-text-inline {
  background: rgba(21, 26, 35, 0.95);
  border: 1px solid var(--accent);
  border-radius: 3px;
  padding: 2px 6px;
  font-size: 11px;
  color: var(--text);
  font-family: inherit;
  outline: none;
  width: 140px;
  pointer-events: auto;
}
```

- [ ] **Step 4: Verify in browser**

1. Click **T** Text. Click on the chart — an inline input field appears at the click point.
2. Type "breakout", press Enter — input disappears; "breakout" appears on the chart in green, with a small green dot at the anchor.
3. Click on the text → selected, can drag, can edit color via style modal (Label field updates the text).
4. Click empty text + press Esc — drawing cancels (nothing committed).
5. Reload — persists.

- [ ] **Step 5: Commit**

```
git add static/drawings.js static/drawings.css
git commit -m "drawings: text annotation with inline-prompt creation"
```

---

## Task 15: Drawing settings popover (toolbar mode, snap default, undo depth)

**Files:**
- Modify: `static/index.html`
- Modify: `static/drawings.css`
- Modify: `static/drawings.js`
- Modify: `static/app.js`

- [ ] **Step 1: Add settings popover markup to `index.html`**

Before `</body>`:

```html
<div id="draw-settings-pop" class="draw-settings-pop" hidden>
  <div class="dsp-header">Drawing settings</div>
  <div class="dsp-row">
    <span class="dsp-lbl">Toolbar</span>
    <div class="dsp-pill-row">
      <button class="dsp-pill" data-pref-toolbar="left">Left edge</button>
      <button class="dsp-pill" data-pref-toolbar="floating">Floating</button>
    </div>
  </div>
  <div class="dsp-row">
    <span class="dsp-lbl">Snap to OHLC</span>
    <div class="dsp-pill-row">
      <button class="dsp-pill" data-pref-snap="shift">Shift held</button>
      <button class="dsp-pill" data-pref-snap="always">Always</button>
      <button class="dsp-pill" data-pref-snap="never">Never</button>
    </div>
  </div>
  <div class="dsp-row">
    <span class="dsp-lbl">Undo depth</span>
    <input type="number" id="dsp-undo" min="1" max="500" step="1" class="dsm-num" style="width:64px;">
  </div>
</div>
```

- [ ] **Step 2: Add popover styles to `drawings.css`**

```css
.draw-settings-pop {
  position: fixed;
  z-index: 999;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  padding: 8px 10px;
  min-width: 220px;
}
.dsp-header {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.dsp-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 0; }
.dsp-lbl { font-size: 11px; color: var(--text); }
.dsp-pill-row { display: flex; gap: 4px; }
.dsp-pill {
  padding: 2px 8px; border-radius: 3px; font-size: 10px; font-family: inherit;
  background: var(--panel-2); border: 1px solid var(--border); color: var(--text-dim); cursor: pointer;
}
.dsp-pill.active { background: var(--accent); color: white; border-color: var(--accent); }
```

- [ ] **Step 3: Implement `SettingsPopover` in `drawings.js`**

```js
const SettingsPopover = {
  el: null,
  open(anchorEl, onChange) {
    if (!this.el) this.el = document.getElementById("draw-settings-pop");
    const rect = anchorEl.getBoundingClientRect();
    this.el.style.left = (rect.right + 6) + "px";
    this.el.style.top  = rect.top + "px";
    this._render(onChange);
    this.el.hidden = false;
    setTimeout(() => {
      const close = (ev) => {
        if (!this.el.contains(ev.target) && ev.target !== anchorEl) {
          this.close();
          document.removeEventListener("mousedown", close);
        }
      };
      document.addEventListener("mousedown", close);
    }, 0);
  },
  close() { if (this.el) this.el.hidden = true; },
  _render(onChange) {
    const prefs = PrefsStore.get();
    this.el.querySelectorAll("[data-pref-toolbar]").forEach((b) => {
      b.classList.toggle("active", b.dataset.prefToolbar === prefs.toolbarMode);
      b.onclick = () => {
        PrefsStore.set({ toolbarMode: b.dataset.prefToolbar });
        this._render(onChange);
        onChange && onChange();
      };
    });
    this.el.querySelectorAll("[data-pref-snap]").forEach((b) => {
      b.classList.toggle("active", b.dataset.prefSnap === prefs.snapDefault);
      b.onclick = () => {
        PrefsStore.set({ snapDefault: b.dataset.prefSnap });
        this._render(onChange);
        onChange && onChange();
      };
    });
    const undoInp = document.getElementById("dsp-undo");
    undoInp.value = prefs.undoDepth;
    undoInp.oninput = () => {
      const v = Number(undoInp.value);
      if (Number.isFinite(v) && v >= 1) {
        PrefsStore.set({ undoDepth: v });
        onChange && onChange();
      }
    };
  },
};
```

Export it: `window.Drawings = { ..., SettingsPopover };`

- [ ] **Step 4: Wire the ⚙ button in `app.js`**

In the `Pane` constructor, after binding tool buttons:

```js
const gearBtn = this.root.querySelector('.draw-tool[data-action="settings"]');
gearBtn?.addEventListener("click", () => {
  Drawings.SettingsPopover.open(gearBtn, () => {
    // Re-apply toolbar mode across all panes
    document.dispatchEvent(new CustomEvent("stv:drawing-prefs-changed"));
  });
});
```

Add a global listener (once, in the boot `main()` block):

```js
document.addEventListener("stv:drawing-prefs-changed", () => {
  const prefs = Drawings.PrefsStore.get();
  for (const p of panes) {
    p.root.classList.toggle("draw-floating", prefs.toolbarMode === "floating");
  }
});
```

And on initial pane build (end of `Pane` constructor):

```js
const prefs = Drawings.PrefsStore.get();
this.root.classList.toggle("draw-floating", prefs.toolbarMode === "floating");
```

- [ ] **Step 5: Verify in browser**

1. Click ⚙ on any pane's toolbar — settings popover appears anchored to the right of the toolbar.
2. Change Toolbar to "Floating" — every pane's left toolbar disappears.
3. Change snap default to "Always" — drawing now snaps regardless of Shift.
4. Change snap default to "Never" — Shift is ignored, no snap.
5. Click outside popover — closes.
6. Reload — preferences persist; toolbar starts in whatever mode you left it.

- [ ] **Step 6: Commit**

```
git add static/index.html static/drawings.css static/drawings.js static/app.js
git commit -m "drawings: settings popover (toolbar mode, snap default, undo depth)"
```

---

## Task 16: Floating palette mode

**Files:**
- Modify: `static/index.html`
- Modify: `static/drawings.css`
- Modify: `static/app.js`

- [ ] **Step 1: Add the "✏ Draw" header button + floating palette container to the pane template**

In `index.html` inside `<template id="pane-template">`, in the `.pane-header` row, after the ƒx button:

```html
<button class="ph-draw-toggle" type="button" data-action="draw-toggle" title="Drawing tools">✏</button>
```

And in the `.pane-body` after the `.draw-toolbar` (but still inside the body), add a hidden floating palette placeholder:

```html
<div class="draw-floating-palette" hidden></div>
```

- [ ] **Step 2: Add styles for the toggle + palette in `drawings.css`**

```css
.ph-draw-toggle {
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 2px 7px;
  border-radius: 3px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  display: none;          /* hidden when toolbar mode is "left" */
}
.pane.draw-floating .ph-draw-toggle { display: inline-flex; align-items: center; justify-content: center; }
.ph-draw-toggle.active { border-color: var(--accent); color: var(--accent); }

.draw-floating-palette {
  position: absolute;
  top: 8px; left: 8px;
  z-index: 5;
  background: rgba(21, 26, 35, 0.95);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px;
  display: flex;
  gap: 2px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  flex-wrap: wrap;
  max-width: 280px;
}
.pane:not(.draw-floating) .draw-floating-palette { display: none; }
```

- [ ] **Step 3: Wire toggle + populate palette in `app.js`**

In the `Pane` constructor:

```js
this.drawToggleBtn = this.root.querySelector('[data-action="draw-toggle"]');
this.floatingPalette = this.root.querySelector(".draw-floating-palette");

// Mirror every left-toolbar button into the floating palette
if (this.floatingPalette) {
  for (const src of this.toolBtns) {
    const clone = src.cloneNode(true);
    clone.addEventListener("click", () => {
      this._setActiveTool(clone.dataset.tool);
    });
    this.floatingPalette.appendChild(clone);
  }
}

this.drawToggleBtn?.addEventListener("click", () => {
  const showing = !this.floatingPalette.hidden;
  this.floatingPalette.hidden = showing;
  this.drawToggleBtn.classList.toggle("active", !showing);
});
```

Update `_reflectActiveTool` to also flip the palette clones:

```js
_reflectActiveTool(id) {
  this.toolBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.tool === id));
  if (this.floatingPalette) {
    this.floatingPalette.querySelectorAll(".draw-tool[data-tool]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === id);
    });
  }
}
```

- [ ] **Step 4: Verify in browser**

1. Open settings, switch toolbar to **Floating**.
2. Every pane: left toolbar disappears; a small `✏` button appears in the pane header.
3. Click `✏` — a small floating palette appears in the top-left of the chart with all the tool buttons.
4. Click a tool there — works exactly like the left-toolbar version.
5. Switch back to **Left edge** — palette hides, left toolbar returns.

- [ ] **Step 5: Commit**

```
git add static/index.html static/drawings.css static/app.js
git commit -m "drawings: floating-palette toolbar mode"
```

---

## Task 17: Undo / Redo + Erase all

**Files:**
- Modify: `static/drawings.js`
- Modify: `static/app.js`

- [ ] **Step 1: Add undo history to `DrawingLayer`**

Add to the constructor:

```js
this.history = [];        // {kind:"create"|"update"|"delete", before, after} entries
this.histPos = 0;         // index of next push (also = undo cursor)
this.maxHist = PrefsStore.get().undoDepth || 50;
```

Helper methods:

```js
_snap(d) { return JSON.parse(JSON.stringify(d)); }

_pushHistory(entry) {
  // Trim any forward-history when a new action is taken after an undo
  if (this.histPos < this.history.length) {
    this.history.length = this.histPos;
  }
  this.history.push(entry);
  if (this.history.length > this.maxHist) this.history.shift();
  this.histPos = this.history.length;
}

undo() {
  if (this.histPos === 0) return;
  const entry = this.history[--this.histPos];
  if (entry.kind === "create") {
    this.drawings = this.drawings.filter((d) => d.id !== entry.after.id);
  } else if (entry.kind === "delete") {
    this.drawings.push(this._snap(entry.before));
  } else if (entry.kind === "update") {
    const i = this.drawings.findIndex((d) => d.id === entry.after.id);
    if (i >= 0) this.drawings[i] = this._snap(entry.before);
  }
  this.save();
  this.selectedId = null;
  this._redraw();
}

redo() {
  if (this.histPos >= this.history.length) return;
  const entry = this.history[this.histPos++];
  if (entry.kind === "create") {
    this.drawings.push(this._snap(entry.after));
  } else if (entry.kind === "delete") {
    this.drawings = this.drawings.filter((d) => d.id !== entry.before.id);
  } else if (entry.kind === "update") {
    const i = this.drawings.findIndex((d) => d.id === entry.after.id);
    if (i >= 0) this.drawings[i] = this._snap(entry.after);
  }
  this.save();
  this._redraw();
}

eraseAll() {
  if (this.drawings.length === 0) return;
  if (!confirm(`Delete all ${this.drawings.length} drawings on this pane?`)) return;
  // Push individual delete entries so undo restores them
  for (const d of this.drawings.slice()) {
    this._pushHistory({ kind: "delete", before: this._snap(d), after: null });
  }
  this.drawings = [];
  this.selectedId = null;
  this.save();
  this._redraw();
}
```

- [ ] **Step 2: Push history entries at every mutation point**

In `_onClick`, after a successful create, just before `this._redraw()`:
```js
this._pushHistory({ kind: "create", before: null, after: this._snap(drawing) });
```

In `_handleMiniAction` for `del`:
```js
if (act === "del") {
  this._pushHistory({ kind: "delete", before: this._snap(d), after: null });
  this.drawings = this.drawings.filter((x) => x.id !== d.id);
  // ... rest unchanged
}
```

In `_handleMiniAction` for `dup`:
```js
} else if (act === "dup") {
  const copy = { ... };  // existing
  this._pushHistory({ kind: "create", before: null, after: this._snap(copy) });
  // ... rest unchanged
}
```

In `_attachHandleDrag`'s `pointerdown`, capture a snapshot:
```js
el.addEventListener("pointerdown", (ev) => {
  const before = this._snap(drawing);
  // ... existing setup ...
  const onUp = () => {
    el.releasePointerCapture(ev.pointerId);
    // ... remove listeners ...
    this._pushHistory({ kind: "update", before, after: this._snap(drawing) });
    this.save();
  };
  // ... rest ...
});
```

In `StyleModal._apply`, capture snapshots:
```js
_apply() {
  const { drawing, layer } = this.current;
  // For simplicity, we treat each apply as one update entry; replace any
  // half-finished one. The "before" was captured at open().
  if (!this._before) this._before = layer._snap(drawing);
  layer.save();
  layer._redraw();
}
```

In `StyleModal.open`, reset:
```js
open(drawing, layer) {
  this.ensure();
  this.current = { drawing, layer };
  this._before = layer._snap(drawing);
  // ... rest ...
}
```

In `StyleModal.close`:
```js
close() {
  if (this.current && this._before) {
    const { drawing, layer } = this.current;
    if (JSON.stringify(this._before) !== JSON.stringify(drawing)) {
      layer._pushHistory({ kind: "update", before: this._before, after: layer._snap(drawing) });
    }
    this._before = null;
  }
  // ... rest unchanged ...
}
```

- [ ] **Step 3: Wire Ctrl+Z / Ctrl+Y handlers in `_onKeyDown`**

```js
this._onKeyDown = (ev) => {
  if (this._destroyed) return;
  if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
  // Only the focused pane should act; rough heuristic: any pane handles
  // global undo if the cursor is inside its overlay.
  const inside = ev.target.closest && ev.target.closest(".pane") === this.wrapper?.closest(".pane");
  if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === "z") {
    if (!inside && !this.selectedId) return;
    ev.preventDefault();
    this.undo();
  } else if ((ev.ctrlKey || ev.metaKey) && (ev.key.toLowerCase() === "y" || (ev.key.toLowerCase() === "z" && ev.shiftKey))) {
    if (!inside && !this.selectedId) return;
    ev.preventDefault();
    this.redo();
  } else if (this.selectedId && ev.key === "Escape") {
    this.deselect();
  } else if (this.selectedId && (ev.key === "Delete" || ev.key === "Backspace")) {
    this._handleMiniAction("del");
    ev.preventDefault();
  }
};
```

- [ ] **Step 4: Wire toolbar undo + erase buttons in `app.js`**

```js
const undoBtn  = this.root.querySelector('.draw-tool[data-action="undo"]');
const eraseBtn = this.root.querySelector('.draw-tool[data-action="erase"]');
undoBtn?.addEventListener("click", () => this.drawingLayer.undo());
eraseBtn?.addEventListener("click", () => this.drawingLayer.eraseAll());
```

- [ ] **Step 5: Verify in browser**

1. Draw 3 trendlines. Press `Ctrl+Z` three times — each disappears in reverse order.
2. Press `Ctrl+Y` three times — they come back in order.
3. Edit a trendline's color via the style modal, close. Press `Ctrl+Z` — colour reverts.
4. Click **↺** (Undo) on the toolbar — also works.
5. Click **×** (Erase all) — confirm prompt; on OK, all drawings on the pane vanish.
6. `Ctrl+Z` — drawings come back one at a time.

- [ ] **Step 6: Commit**

```
git add static/drawings.js static/app.js
git commit -m "drawings: undo/redo history + erase-all with confirm"
```

---

## Task 18: README + CLAUDE.md updates

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a Drawing Tools section to README.md**

After the "Technical Indicators" section, insert:

```markdown
---

## Drawing Tools

Each pane has a left-edge toolbar (toggle to floating palette in settings) with 9 drawing tools plus undo/erase:

| Category | Tools |
|---|---|
| Lines | Trendline, Horizontal line, Vertical line |
| Bands & Channels | Rectangle / zone, Parallel channel |
| Levels | Fibonacci retracement |
| Arcs | Arc |
| Measurement | Measurement ruler (Δprice / Δ% / bars / Δtime) |
| Annotation | Text |

- **Shift-to-snap** — hold Shift while clicking to snap endpoints to the nearest OHLC value of the targeted candle. The default behaviour is configurable in the ⚙ settings popover.
- **Selection** — click any drawing to select it; circular handles appear (drag endpoints to reshape, drag the mid handle to move the whole shape), plus a floating mini-toolbar (✏ edit / ⎘ duplicate / ↑ bring-to-front / × delete).
- **Style modal** — colour, line width, dash pattern, opacity, label text, and extend direction per drawing.
- **Per-(symbol, source) persistence** — drawings follow the symbol across pane changes and timeframe switches (drawings store absolute time/price coordinates).
- **Undo / redo** — `Ctrl+Z` / `Ctrl+Y`, history depth configurable (default 50).
```

- [ ] **Step 2: Add a Drawing Layer subsection to CLAUDE.md Architecture**

After the "Self-contained indicator defs" section, insert:

```markdown
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
}
```

The `DrawingLayer` class owns one SVG overlay + one DOM handle layer per pane. It iterates `TOOL_DEFS` for rendering and hit-testing — no per-tool switches anywhere else.

Drawings store **absolute `(time, price)` points**, projected to pixels every redraw via `chart.timeScale().timeToCoordinate(...)` / `series.priceToCoordinate(...)`. This makes them re-render correctly across timeframe switches and zooms automatically.

Persistence: `localStorage["stv.drawings"]` keyed by `${source}|${symbol}` (case-insensitive symbol). UI prefs (toolbar mode, snap default, undo depth) live in `localStorage["stv.drawingPrefs"]`.

**Gotcha:** the SVG overlay attaches to `chart.panes()[0].getHTMLElement()`, which is `null` synchronously after `addSeries` in LWC v5. `DrawingLayer._attach()` defers via `requestAnimationFrame` and retries until the element is ready — same pattern as the indicator legends.
```

- [ ] **Step 3: Verify**

```
grep -l "Drawing" README.md CLAUDE.md
```

Expected: both files listed.

- [ ] **Step 4: Commit and push**

```
git add README.md CLAUDE.md
git commit -m "docs: document the drawing tools + drawing-layer architecture"
git push
```

---

## Final smoke checklist

After all 18 tasks are merged, do one comprehensive manual walkthrough:

- [ ] Open a 4-grid layout, BTC / ETH / SOL / RELIANCE.NS
- [ ] On BTC pane: draw one of each tool — trendline, horizontal, vertical, rectangle, fib, channel, arc, ruler, text
- [ ] Style at least one: change colour, dash, width, opacity, add a label, extend
- [ ] Drag a handle, drag a mid handle, delete via Del key, delete via mini-toolbar ×
- [ ] Undo (Ctrl+Z) then redo (Ctrl+Y) a chain of 5 operations
- [ ] Switch BTC → ETH → BTC; confirm drawings vanish and return
- [ ] Switch BTC timeframe 1m → 1d → 1m; drawings re-render at correct times
- [ ] Open settings, switch to Floating palette; verify both toolbars work
- [ ] Open settings, set snap to Always; draw a trendline — endpoints land on OHLC
- [ ] Click Erase all → confirm; Ctrl+Z restores everything
- [ ] Reload the page; everything persists exactly
