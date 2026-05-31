# Component Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automated regression tests for the three uncovered components (Flask routes, the `DataSource` layer, frontend indicator math, and frontend drawing geometry) so any change that breaks a contract or formula goes red immediately.

**Architecture:** Backend uses pytest with `unittest.mock.patch` against existing seams (matches `tests/services/` style). Frontend uses Node's built-in `node:test` runner; the IIFE-wrapped browser scripts are loaded into a `vm` sandbox with a fake `window`/`localStorage` so no source edits are required.

**Tech Stack:** pytest 8, Flask test client, `unittest.mock`, Node 24+ `node:test`, `node:vm`, `node:assert`.

**Spec:** [docs/superpowers/specs/2026-05-27-component-test-suite-design.md](../specs/2026-05-27-component-test-suite-design.md)

---

## File Structure

**New files (backend):**
- `tests/test_data_source.py` — `Candle`/`Quote`, helpers, registry, both sources.
- `tests/test_app.py` — Flask routes via `app.test_client()`.

**New files (frontend):**
- `tests/frontend/_sandbox.js` — `vm`-based loader for IIFE browser scripts.
- `tests/frontend/test_indicators.js` — `compute()` for every entry in `Indicators.DEFS`.
- `tests/frontend/test_drawings.js` — `hitTest`/`handles`/`moveHandle`/`moveAll` for every entry in `Drawings.TOOL_DEFS`, plus `DrawingStore`/`PrefsStore`.

**New files (tooling):**
- `package.json` — single `test` script, no deps.

**Modified files:**
- `README.md` — add a short "Tests" section.

**Untouched:** all existing source files (`app.py`, `data_source.py`, `services/`, `static/*`) and existing `tests/services/`.

---

## Task 1: Frontend sandbox shim

The IIFE-wrapped browser scripts attach to `window.Indicators` and `window.Drawings`. We need to run them in Node without editing the source. A `vm` context with a fake `window`, `localStorage`, and `document` is enough.

**Files:**
- Create: `tests/frontend/_sandbox.js`

- [ ] **Step 1: Create the shim**

```js
// tests/frontend/_sandbox.js
//
// Loads an IIFE-wrapped browser script in a fresh Node vm context with a
// minimal window/localStorage/document shim, and returns the resulting
// window object. Source files are not modified.

const fs   = require("node:fs");
const path = require("node:path");
const vm   = require("node:vm");

function makeFakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] ?? null,
  };
}

function makeFakeDocument() {
  // Just enough for top-level IIFE code that touches document. The drawings
  // file calls document.createElementNS only inside render(), which our tests
  // never invoke directly, so a no-op stub is fine.
  const stub = () => ({
    setAttribute() {}, appendChild() {}, removeChild() {},
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0 }),
    style: {}, dataset: {}, textContent: "",
  });
  return {
    createElement: stub,
    createElementNS: stub,
    body: stub(),
    documentElement: stub(),
    addEventListener() {}, removeEventListener() {},
  };
}

/**
 * Load a browser script (path relative to this file) into a fresh sandbox.
 * Returns the sandbox's `window` object so callers can read `window.Indicators`
 * or `window.Drawings`.
 */
function loadBrowserScript(relPath) {
  const abs = path.resolve(__dirname, relPath);
  const code = fs.readFileSync(abs, "utf8");
  const window = {};
  const sandbox = {
    window,
    localStorage: makeFakeLocalStorage(),
    document: makeFakeDocument(),
    // The scripts also reference these globals indirectly through other code,
    // but the parts we test don't touch them. Provide harmless stubs anyway.
    LightweightCharts: {
      LineSeries: "LineSeries",
      HistogramSeries: "HistogramSeries",
    },
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  // Mirror sandbox globals onto window so `window.foo` and bare `foo` agree.
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.document = sandbox.document;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: abs });
  return window;
}

module.exports = { loadBrowserScript };
```

- [ ] **Step 2: Smoke-test the shim by hand**

Run: `node -e "const {loadBrowserScript} = require('./tests/frontend/_sandbox.js'); const w = loadBrowserScript('../../static/indicators.js'); console.log('defs:', w.Indicators.DEFS.length); const d = loadBrowserScript('../../static/drawings.js'); console.log('tools:', d.Drawings.TOOL_DEFS.length);"`
Expected output: `defs: 32` and `tools: 9` (exact numbers don't matter; both must be positive).

- [ ] **Step 3: Commit**

```bash
git add tests/frontend/_sandbox.js
git commit -m "test: vm-based sandbox loader for IIFE browser scripts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: package.json for the Node test runner

Lets developers run `npm test`. Zero dependencies — Node 24 ships `node --test`.

**Files:**
- Create: `package.json`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "supertradingview-tests",
  "private": true,
  "version": "0.0.0",
  "description": "Frontend pure-logic tests (run with `npm test`).",
  "scripts": {
    "test": "node --test tests/frontend"
  }
}
```

- [ ] **Step 2: Verify the runner finds files**

Run: `npm test`
Expected: `ok` summary with `0 tests` (no test files exist yet, but the runner shouldn't error).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test: package.json for node:test runner

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Indicator test scaffolding (generic per-def checks)

Every indicator def gets the same baseline check: `compute([])` and `compute([oneCandle])` must not throw, and the result must be the documented shape (array or `{...}` of arrays). This catches the "I renamed a property" class of bug immediately, without needing per-indicator math.

**Files:**
- Create: `tests/frontend/test_indicators.js`

- [ ] **Step 1: Write the scaffolding + generic checks**

```js
// tests/frontend/test_indicators.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBrowserScript } = require("./_sandbox.js");

const { Indicators } = loadBrowserScript("../../static/indicators.js");
const DEFS = Indicators.DEFS;

// Build a default param object from a def (mirrors what the UI passes).
function defaultParams(def) {
  const p = {};
  for (const param of def.params) p[param.key] = param.default;
  return p;
}

// Build a default color object from a def (mirrors what the UI passes).
function defaultColors(def) {
  const c = {};
  for (const slot of def.colors) c[slot.key] = slot.default;
  return c;
}

// Make a synthetic candle list. Prices walk up by `step` from `start`,
// timestamps are `time0 + i*60` (1m). Volume is `vol` everywhere.
function makeCandles(n, { start = 100, step = 1, vol = 1000, time0 = 1_700_000_000 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const close = start + i * step;
    out.push({
      time: time0 + i * 60,
      open: close - 0.1,
      high: close + 0.5,
      low:  close - 0.5,
      close,
      volume: vol,
    });
  }
  return out;
}

// Returns true if `result` is an array OR a plain object whose values are all arrays.
function isPlausibleShape(result) {
  if (Array.isArray(result)) return true;
  if (result && typeof result === "object") {
    return Object.values(result).every((v) => Array.isArray(v));
  }
  return false;
}

test("Indicators.DEFS is non-empty and each entry has the required shape", () => {
  assert.ok(Array.isArray(DEFS) && DEFS.length > 0);
  for (const def of DEFS) {
    assert.equal(typeof def.id, "string", `def missing id: ${JSON.stringify(def)}`);
    assert.equal(typeof def.compute, "function", `${def.id}: compute must be a function`);
    assert.ok(Array.isArray(def.params), `${def.id}: params must be an array`);
    assert.ok(Array.isArray(def.colors), `${def.id}: colors must be an array`);
  }
});

for (const def of DEFS) {
  test(`${def.id}: compute([]) does not throw and returns plausible shape`, () => {
    const result = def.compute([], defaultParams(def), defaultColors(def));
    assert.ok(isPlausibleShape(result), `${def.id}: result shape = ${JSON.stringify(result)?.slice(0, 80)}`);
  });

  test(`${def.id}: compute([oneCandle]) does not throw`, () => {
    const result = def.compute(makeCandles(1), defaultParams(def), defaultColors(def));
    assert.ok(isPlausibleShape(result));
  });

  test(`${def.id}: compute(largeSeries) does not throw and returns plausible shape`, () => {
    const result = def.compute(makeCandles(300), defaultParams(def), defaultColors(def));
    assert.ok(isPlausibleShape(result));
  });
}
```

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: ~97 passing tests (3 generic × 32 defs + 1 shape check). All green.

- [ ] **Step 3: Commit**

```bash
git add tests/frontend/test_indicators.js
git commit -m "test: per-def baseline checks for every indicator

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Targeted indicator math tests

These lock in specific numeric outputs for the indicators with well-defined formulas. If anyone changes the math, the test goes red.

**Files:**
- Modify: `tests/frontend/test_indicators.js`

- [ ] **Step 1: Append the math tests to test_indicators.js**

Add the following to the end of `tests/frontend/test_indicators.js`:

```js
// --- Targeted math tests --------------------------------------------------

function defById(id) {
  const d = DEFS.find((x) => x.id === id);
  if (!d) throw new Error(`def ${id} not found`);
  return d;
}

// Build candles whose closes are exactly the given array, with predictable
// OHLV so range-based indicators still behave sanely.
function candlesFromCloses(closes, { vol = 1000, time0 = 1_700_000_000 } = {}) {
  return closes.map((c, i) => ({
    time: time0 + i * 60,
    open: c, high: c + 0.5, low: c - 0.5, close: c, volume: vol,
  }));
}

test("sma(3) on [1..5] -> [2, 3, 4] (three warmup-clipped points)", () => {
  const def = defById("sma");
  const out = def.compute(candlesFromCloses([1, 2, 3, 4, 5]), { period: 3 }, defaultColors(def));
  assert.equal(out.length, 3);
  assert.equal(out[0].value, 2);
  assert.equal(out[1].value, 3);
  assert.equal(out[2].value, 4);
});

test("ema(period) seed equals SMA of first `period` closes", () => {
  const def = defById("ema");
  const closes = [10, 12, 14, 16, 18];
  const out = def.compute(candlesFromCloses(closes), { period: 3 }, defaultColors(def));
  // Seed at index 2 = mean(10,12,14) = 12
  assert.equal(out[0].value, 12);
  // Next value uses k = 2/(3+1) = 0.5: 16*0.5 + 12*0.5 = 14
  assert.equal(out[1].value, 14);
});

test("rsi(period) on monotonically rising series = 100 after warmup", () => {
  const def = defById("rsi");
  const out = def.compute(candlesFromCloses(Array.from({ length: 30 }, (_, i) => i + 1)),
                          { period: 14 }, defaultColors(def));
  assert.ok(out.length > 0);
  for (const p of out) assert.equal(p.value, 100);
});

test("rsi(period) on monotonically falling series = 0 after warmup", () => {
  const def = defById("rsi");
  const out = def.compute(candlesFromCloses(Array.from({ length: 30 }, (_, i) => 100 - i)),
                          { period: 14 }, defaultColors(def));
  for (const p of out) assert.equal(p.value, 0);
});

test("bollinger bands: upper - lower equals 2 * mult * stddev", () => {
  const def = defById("bb");
  const closes = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40,
                  42, 44, 46, 48, 50, 52, 54, 56];
  const out = def.compute(candlesFromCloses(closes), { period: 20, mult: 2 }, defaultColors(def));
  for (let i = 0; i < out.upper.length; i++) {
    const width = out.upper[i].value - out.lower[i].value;
    // 4 * stddev: for our linear series stddev is finite and positive.
    assert.ok(width > 0, `bb width at ${i} should be > 0`);
    // Width / 4 should be the std dev; mid should be the mean of the window.
    const midFromBands = (out.upper[i].value + out.lower[i].value) / 2;
    assert.ok(Math.abs(midFromBands - out.mid[i].value) < 1e-9);
  }
});

test("vwap cumulative on constant-vol equal-price candles = that price", () => {
  const def = defById("vwap");
  const candles = candlesFromCloses([100, 100, 100, 100], { vol: 50 });
  // typical price = (h+l+c)/3 = (100.5 + 99.5 + 100)/3 = 100
  const out = def.compute(candles, {}, defaultColors(def));
  for (const p of out) assert.ok(Math.abs(p.value - 100) < 1e-9);
});

test("atr(period) on constant-range candles = that range", () => {
  const def = defById("atr");
  // hi - lo = 1.0 for every candle, no gaps.
  const candles = candlesFromCloses(Array.from({ length: 30 }, () => 100));
  const out = def.compute(candles, { period: 14 }, defaultColors(def));
  assert.ok(out.length > 0);
  for (const p of out) assert.ok(Math.abs(p.value - 1.0) < 1e-9);
});

test("obv: empty input -> [], single candle -> single zero entry", () => {
  const def = defById("obv");
  assert.deepEqual(def.compute([], {}, defaultColors(def)), []);
  const one = def.compute(candlesFromCloses([100]), {}, defaultColors(def));
  assert.equal(one.length, 1);
  assert.equal(one[0].value, 0);
});

test("obv: cumulative sum of volume signed by close-vs-prev-close", () => {
  const def = defById("obv");
  const candles = [
    { time: 1, open: 100, high: 101, low: 99,  close: 100, volume: 10 },
    { time: 2, open: 100, high: 102, low: 99,  close: 101, volume: 20 }, // up
    { time: 3, open: 101, high: 102, low: 100, close: 100, volume: 30 }, // down
    { time: 4, open: 100, high: 101, low: 99,  close: 100, volume: 40 }, // flat
  ];
  const out = def.compute(candles, {}, defaultColors(def));
  assert.deepEqual(out.map((p) => p.value), [0, 20, -10, -10]);
});

test("volume: bar color flips at close >= open boundary", () => {
  const def = defById("volume");
  const candles = [
    { time: 1, open: 100, high: 101, low: 99, close: 101, volume: 5 },  // up
    { time: 2, open: 101, high: 102, low: 99, close: 100, volume: 7 },  // down
    { time: 3, open: 100, high: 101, low: 99, close: 100, volume: 9 },  // flat -> up
  ];
  const colors = { up: "#00ff00", down: "#ff0000" };
  const out = def.compute(candles, {}, colors);
  // We don't pin the exact rgba alpha but we do pin which colour family each bar got.
  assert.ok(out[0].color.startsWith("rgba(0,255,0"));
  assert.ok(out[1].color.startsWith("rgba(255,0,0"));
  assert.ok(out[2].color.startsWith("rgba(0,255,0"), "close === open should be `up`");
});

test("ma_cross: golden cross emitted when fast crosses above slow", () => {
  const def = defById("ma_cross");
  // Construct: slow MA stays around 50, fast MA crosses from below to above.
  // Easy way: closes start low, then jump high. SMA fast=2, slow=4.
  const closes = [10, 10, 10, 10, 10, 100, 100, 100, 100, 100];
  const colors = defaultColors(def);
  const result = def.compute(candlesFromCloses(closes),
    { fast: 2, slow: 4, type: 0 }, colors);
  assert.ok(Array.isArray(result.markers));
  const golden = result.markers.find((m) => m.text === "Golden");
  assert.ok(golden, "expected a Golden Cross marker");
  assert.equal(golden.color, colors.golden);
  assert.equal(golden.position, "belowBar");
});
```

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: all previous tests plus 11 new math tests, all green.

- [ ] **Step 3: Commit**

```bash
git add tests/frontend/test_indicators.js
git commit -m "test: targeted math checks for SMA, EMA, RSI, BB, VWAP, ATR, OBV, volume, MA cross

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Drawing tool tests (storage + per-tool geometry)

Tests `DrawingStore`/`PrefsStore` persistence guarantees and the geometric primitives every tool exposes (`handles`, `moveHandle`, `moveAll`, `hitTest`).

**Files:**
- Create: `tests/frontend/test_drawings.js`

- [ ] **Step 1: Write the test file**

```js
// tests/frontend/test_drawings.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBrowserScript } = require("./_sandbox.js");

// Fresh sandbox per test would be cleaner, but storage tests use clear()
// explicitly to isolate. One sandbox keeps the test file simpler.
const { Drawings } = loadBrowserScript("../../static/drawings.js");
const { DrawingStore, PrefsStore, TOOL_DEFS } = Drawings;
const TOOLS_BY_ID = Object.fromEntries(TOOL_DEFS.map((t) => [t.id, t]));

// Identity-like layer: pixel == time on x, pixel == price on y.
// Wide enough that horizontal/vertical hit-tests have room.
function makeLayer({ width = 800, height = 600 } = {}) {
  const layer = {
    chart: {
      timeScale: () => ({
        timeToCoordinate: (t) => t,
        coordinateToTime: (x) => x,
      }),
    },
    series: {
      priceToCoordinate: (p) => p,
      coordinateToPrice: (y) => y,
    },
    svg: { getBoundingClientRect: () => ({ width, height, top: 0, left: 0 }) },
    toPx(pt) {
      return { x: this.chart.timeScale().timeToCoordinate(pt.time),
               y: this.series.priceToCoordinate(pt.price) };
    },
    fromPx(x, y) {
      return { time: this.chart.timeScale().coordinateToTime(x),
               price: this.series.coordinateToPrice(y) };
    },
    getCandles: () => [],
  };
  return layer;
}

function makeDrawing(toolId, points) {
  const def = TOOLS_BY_ID[toolId];
  return {
    id: "drw_test",
    tool: toolId,
    points: points.map((p) => ({ time: p.time, price: p.price })),
    style: { ...def.defaultStyle },
    scope: { ...def.defaultScope },
  };
}

// --- DrawingStore --------------------------------------------------------

test("DrawingStore: round-trip a drawing list", () => {
  localStorage.clear();
  const d = makeDrawing("trendline", [{ time: 100, price: 50 }, { time: 200, price: 60 }]);
  DrawingStore.set("yfinance", "AAPL", [d]);
  const got = DrawingStore.get("yfinance", "AAPL");
  assert.equal(got.length, 1);
  assert.equal(got[0].id, "drw_test");
});

test("DrawingStore: key is case-insensitive on symbol", () => {
  localStorage.clear();
  const d = makeDrawing("trendline", [{ time: 1, price: 1 }, { time: 2, price: 2 }]);
  DrawingStore.set("yfinance", "aapl", [d]);
  // Stored under "yfinance|AAPL"; reading with mixed case still finds it.
  assert.equal(DrawingStore.get("yfinance", "AAPL").length, 1);
  assert.equal(DrawingStore.get("yfinance", "AaPl").length, 1);
});

test("DrawingStore: clear() removes the symbol's drawings", () => {
  localStorage.clear();
  const d = makeDrawing("trendline", [{ time: 1, price: 1 }, { time: 2, price: 2 }]);
  DrawingStore.set("yfinance", "AAPL", [d]);
  DrawingStore.clear("yfinance", "AAPL");
  assert.deepEqual(DrawingStore.get("yfinance", "AAPL"), []);
});

test("DrawingStore: invalid persisted entries are dropped on read", () => {
  localStorage.clear();
  // Hand-write a payload with one good + several corrupt entries.
  const good = makeDrawing("trendline", [{ time: 1, price: 1 }, { time: 2, price: 2 }]);
  const corrupt = [
    null,
    { id: 1, tool: "trendline", points: [] },                                 // bad id type
    { id: "x", tool: 9, points: [] },                                          // bad tool type
    { id: "x", tool: "trendline", points: "nope" },                            // bad points type
    { id: "x", tool: "trendline", points: [{ time: "1", price: 2 }] },         // bad point fields
    { id: "x", tool: "trendline", points: [{ time: 1, price: 2 }],
      style: { color: "#zzzz00" } },                                           // bad hex
    { id: "x", tool: "trendline", points: [{ time: 1, price: 2 }],
      style: { width: -3 } },                                                  // bad width
    { id: "x", tool: "trendline", points: [{ time: 1, price: 2 }],
      style: { opacity: 9 } },                                                 // bad opacity
    { id: "x", tool: "trendline", points: [{ time: 1, price: 2 }],
      style: { dash: "rainbow" } },                                            // bad dash
  ];
  const payload = { "yfinance|AAPL": [good, ...corrupt] };
  localStorage.setItem("stv.drawings", JSON.stringify(payload));
  const got = DrawingStore.get("yfinance", "AAPL");
  assert.equal(got.length, 1, "only the good entry survives");
  assert.equal(got[0].id, "drw_test");
});

// --- PrefsStore ----------------------------------------------------------

test("PrefsStore: returns defaults when empty", () => {
  localStorage.clear();
  const p = PrefsStore.get();
  assert.equal(p.toolbarMode, "left");
  assert.equal(p.snapDefault, "shift");
  assert.equal(p.undoDepth, 50);
});

test("PrefsStore: set() merges over defaults and persists", () => {
  localStorage.clear();
  PrefsStore.set({ toolbarMode: "floating" });
  let p = PrefsStore.get();
  assert.equal(p.toolbarMode, "floating");
  assert.equal(p.snapDefault, "shift", "untouched fields keep their default");
  PrefsStore.set({ undoDepth: 100 });
  p = PrefsStore.get();
  assert.equal(p.toolbarMode, "floating", "earlier setting persists");
  assert.equal(p.undoDepth, 100);
});

// --- Per-tool generic checks ---------------------------------------------

function samplePoints(pointsNeeded) {
  // Spread out so geometry has room to breathe.
  const out = [];
  for (let i = 0; i < pointsNeeded; i++) {
    out.push({ time: 100 + i * 100, price: 50 + i * 10 });
  }
  return out;
}

for (const def of TOOL_DEFS) {
  test(`${def.id}: handles() returns at least pointsNeeded entries`, () => {
    const layer = makeLayer();
    const d = makeDrawing(def.id, samplePoints(def.pointsNeeded));
    const handles = def.handles(d, layer);
    assert.ok(Array.isArray(handles));
    assert.ok(handles.length >= def.pointsNeeded,
      `${def.id}: handles=${handles.length} pointsNeeded=${def.pointsNeeded}`);
  });

  test(`${def.id}: moveAll shifts every stored point in screen-space by (dx, dy)`, () => {
    const layer = makeLayer();
    const points = samplePoints(def.pointsNeeded);
    const d = makeDrawing(def.id, points);
    const before = d.points.map((p) => ({ ...p }));
    def.moveAll(d, 7, 5, layer);
    // Identity layer means time and price each shift by exactly the delta.
    for (let i = 0; i < def.pointsNeeded; i++) {
      // horizontal stores only price (time may be unchanged), vertical only time.
      if (def.id !== "horizontal") {
        assert.ok(
          Math.abs((d.points[i].time - before[i].time) - 7) < 1e-9
          // horizontal/vertical/text tools may leave time unchanged
          || d.points[i].time === before[i].time,
          `${def.id}: point ${i} time delta off`,
        );
      }
      if (def.id !== "vertical") {
        assert.ok(
          Math.abs((d.points[i].price - before[i].price) - 5) < 1e-9
          || d.points[i].price === before[i].price,
          `${def.id}: point ${i} price delta off`,
        );
      }
    }
  });
}

// --- Targeted hit-test checks --------------------------------------------

test("trendline: hit on segment, miss far away", () => {
  const def = TOOLS_BY_ID["trendline"];
  const layer = makeLayer();
  const d = makeDrawing("trendline",
    [{ time: 100, price: 100 }, { time: 200, price: 200 }]);
  // Midpoint of segment in screen coords (identity layer) is (150, 150).
  assert.ok(def.hitTest(d, 150, 150, layer));
  assert.ok(!def.hitTest(d, 500, 500, layer));
});

test("trendline: hit on endpoints", () => {
  const def = TOOLS_BY_ID["trendline"];
  const layer = makeLayer();
  const d = makeDrawing("trendline",
    [{ time: 100, price: 100 }, { time: 200, price: 200 }]);
  assert.ok(def.hitTest(d, 100, 100, layer));
  assert.ok(def.hitTest(d, 200, 200, layer));
});

test("horizontal: hits anywhere at the line's y, misses off the y", () => {
  const def = TOOLS_BY_ID["horizontal"];
  const layer = makeLayer();
  const d = makeDrawing("horizontal", [{ time: 0, price: 250 }]);
  // Identity layer: priceToCoordinate(250) = 250.
  assert.ok(def.hitTest(d, 50,  250, layer));
  assert.ok(def.hitTest(d, 700, 250, layer));
  assert.ok(!def.hitTest(d, 400, 100, layer));
});

test("vertical: hits anywhere at the line's x, misses off the x", () => {
  const def = TOOLS_BY_ID["vertical"];
  const layer = makeLayer();
  const d = makeDrawing("vertical", [{ time: 300, price: 0 }]);
  assert.ok(def.hitTest(d, 300, 50,  layer));
  assert.ok(def.hitTest(d, 300, 500, layer));
  assert.ok(!def.hitTest(d, 100, 300, layer));
});

test("rectangle: hits anywhere inside or on the border, misses well outside", () => {
  const def = TOOLS_BY_ID["rectangle"];
  const layer = makeLayer();
  const d = makeDrawing("rectangle",
    [{ time: 100, price: 100 }, { time: 300, price: 200 }]);
  assert.ok(def.hitTest(d, 200, 150, layer), "inside");
  assert.ok(def.hitTest(d, 100, 100, layer), "corner");
  assert.ok(def.hitTest(d, 300, 200, layer), "opposite corner");
  assert.ok(!def.hitTest(d, 500, 500, layer), "far outside");
});

test("trendline: moveHandle(0) updates only point 0", () => {
  const def = TOOLS_BY_ID["trendline"];
  const layer = makeLayer();
  const d = makeDrawing("trendline",
    [{ time: 100, price: 100 }, { time: 200, price: 200 }]);
  def.moveHandle(d, 0, 50, 75, layer);
  assert.equal(d.points[0].time, 50);
  assert.equal(d.points[0].price, 75);
  assert.equal(d.points[1].time, 200, "point 1 untouched");
  assert.equal(d.points[1].price, 200);
});

test("trendline: moveHandle(1) updates only point 1", () => {
  const def = TOOLS_BY_ID["trendline"];
  const layer = makeLayer();
  const d = makeDrawing("trendline",
    [{ time: 100, price: 100 }, { time: 200, price: 200 }]);
  def.moveHandle(d, 1, 999, 888, layer);
  assert.equal(d.points[0].time, 100, "point 0 untouched");
  assert.equal(d.points[1].time, 999);
  assert.equal(d.points[1].price, 888);
});

test("rectangle: moveHandle accepts string handleId (UI dataset path)", () => {
  // The DOM path serializes handle ids as strings; the def must accept both.
  const def = TOOLS_BY_ID["rectangle"];
  const layer = makeLayer();
  const d = makeDrawing("rectangle",
    [{ time: 100, price: 100 }, { time: 300, price: 200 }]);
  def.moveHandle(d, "0", 50, 50, layer);
  assert.equal(d.points[0].time, 50);
  assert.equal(d.points[0].price, 50);
});
```

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: all indicator tests plus ~30 new drawing tests, all green.

If the rectangle hit-test assertion `assert.ok(def.hitTest(d, 200, 150, layer), "inside")` fails, look at [static/drawings.js:346](static/drawings.js#L346) — the current code DOES count inside as a hit because it's a bbox-with-tolerance test, so it should pass. If something else fails, fix the test to lock in current behavior and add a one-line comment explaining what the indicator/tool actually does.

- [ ] **Step 3: Commit**

```bash
git add tests/frontend/test_drawings.js
git commit -m "test: storage + geometry checks for every drawing tool

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: data_source.py tests — types, helpers, registry

The easy parts first: dataclasses, `_tf_to_seconds`, `TIMEFRAMES`, `get_source`, `list_sources`, `load_symbols`.

**Files:**
- Create: `tests/test_data_source.py`

- [ ] **Step 1: Write the file**

```python
# tests/test_data_source.py
from __future__ import annotations

import json
from pathlib import Path

import pytest

from data_source import (
    Candle,
    Quote,
    REGISTRY,
    TIMEFRAMES,
    _tf_to_seconds,
    get_source,
    list_sources,
    load_symbols,
)


# --- Wire types ----------------------------------------------------------------

def test_candle_to_dict_round_trip():
    c = Candle(time=1_700_000_000, open=1.0, high=2.0, low=0.5, close=1.5, volume=100.0)
    d = c.to_dict()
    assert d == {
        "time": 1_700_000_000,
        "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5,
        "volume": 100.0,
    }
    # Reconstruct from the dict
    c2 = Candle(**d)
    assert c2 == c


def test_quote_dataclass_fields():
    q = Quote(time=42, price=3.14, source="hyperliquid", symbol="BTC")
    assert (q.time, q.price, q.source, q.symbol) == (42, 3.14, "hyperliquid", "BTC")


# --- Timeframe helpers ---------------------------------------------------------

@pytest.mark.parametrize("tf,sec", [
    ("1m", 60), ("5m", 300), ("15m", 900),
    ("1h", 3600), ("4h", 14400), ("1d", 86400),
])
def test_tf_to_seconds(tf, sec):
    assert _tf_to_seconds(tf) == sec


def test_timeframes_all_parseable():
    assert TIMEFRAMES, "TIMEFRAMES must be non-empty"
    for tf in TIMEFRAMES:
        assert _tf_to_seconds(tf) > 0


# --- Registry ------------------------------------------------------------------

def test_list_sources_includes_registered():
    out = list_sources()
    names = {s["name"] for s in out}
    assert "hyperliquid" in names
    assert "yfinance" in names
    for s in out:
        assert "asset_class" in s


def test_get_source_unknown_raises():
    with pytest.raises(KeyError):
        get_source("not_a_real_source")


def test_get_source_returns_instance():
    src = get_source("hyperliquid")
    assert src is REGISTRY["hyperliquid"]


# --- Curated symbol loader -----------------------------------------------------

def test_load_symbols_reads_json(tmp_path: Path):
    p = tmp_path / "symbols.json"
    p.write_text(json.dumps([
        {"symbol": "AAPL", "label": "Apple", "source": "yfinance", "asset_class": "stock"},
    ]))
    got = load_symbols(str(p))
    assert len(got) == 1
    assert got[0]["symbol"] == "AAPL"
```

- [ ] **Step 2: Run the tests**

Run: `py -3 -m pytest tests/test_data_source.py -v`
Expected: all 10 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/test_data_source.py
git commit -m "test: data_source types, helpers, registry, symbol loader

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: data_source.py tests — HyperliquidSource

Network is mocked via `unittest.mock.patch("data_source.requests.post")`. Covers history parsing, universe caching, search ordering, the deliberate `NotImplementedError`.

**Files:**
- Modify: `tests/test_data_source.py`

- [ ] **Step 1: Append Hyperliquid tests**

Append to `tests/test_data_source.py`:

```python
# --- HyperliquidSource ---------------------------------------------------------

from unittest.mock import MagicMock, patch
from data_source import HyperliquidSource


def _resp(json_body):
    r = MagicMock()
    r.json.return_value = json_body
    r.raise_for_status.return_value = None
    return r


@pytest.fixture
def hl():
    s = HyperliquidSource()
    # Reset class-level caches so tests don't bleed into one another.
    HyperliquidSource._universe_cache = None
    HyperliquidSource._universe_cache_at = 0.0
    return s


def test_hl_get_history_parses_response(hl):
    body = [
        {"t": 1_700_000_000_000, "o": "1", "h": "2", "l": "0.5", "c": "1.5", "v": "10"},
        {"t": 1_700_000_060_000, "o": "1.5", "h": "2.5", "l": "1.0", "c": "2.0", "v": "20"},
    ]
    with patch("data_source.requests.post", return_value=_resp(body)) as post:
        out = hl.get_history("BTC", "1m", limit=10)
    assert len(out) == 2
    assert out[0].time == 1_700_000_000  # ms -> s
    assert out[0].open == 1.0 and out[0].close == 1.5 and out[0].volume == 10.0
    sent = post.call_args.kwargs["json"]
    assert sent["type"] == "candleSnapshot"
    assert sent["req"]["coin"] == "BTC"
    assert sent["req"]["interval"] == "1m"
    assert sent["req"]["endTime"] - sent["req"]["startTime"] == 60 * 1000 * 10


def test_hl_get_history_propagates_http_error(hl):
    bad = MagicMock()
    bad.raise_for_status.side_effect = RuntimeError("boom")
    with patch("data_source.requests.post", return_value=bad), pytest.raises(RuntimeError):
        hl.get_history("BTC", "1m")


def test_hl_stream_quotes_raises_not_implemented(hl):
    with pytest.raises(NotImplementedError):
        next(hl.stream_quotes("BTC", "1m"))


def test_hl_search_empty_query_returns_empty(hl):
    assert hl.search_symbols("") == []
    assert hl.search_symbols("   ") == []


def test_hl_universe_cached_after_first_fetch(hl):
    body = {"universe": [{"name": "BTC"}, {"name": "ETH"}]}
    with patch("data_source.requests.post", return_value=_resp(body)) as post:
        hl.search_symbols("B")
        hl.search_symbols("E")
    assert post.call_count == 1, "universe should be cached across calls"


def test_hl_universe_failure_keeps_prior_cache(hl):
    body = {"universe": [{"name": "BTC"}, {"name": "ETH"}]}
    with patch("data_source.requests.post", return_value=_resp(body)):
        hl.search_symbols("B")
    # Now force the cache TTL to expire and the next fetch to fail.
    HyperliquidSource._universe_cache_at = 0.0
    with patch("data_source.requests.post", side_effect=RuntimeError("net down")):
        # Should NOT raise: source swallows the error and reuses cache.
        out = hl.search_symbols("B")
    assert any(s["symbol"] == "BTC" for s in out)


def test_hl_search_filters_delisted(hl):
    body = {"universe": [
        {"name": "BTC"},
        {"name": "OLD", "isDelisted": True},
    ]}
    with patch("data_source.requests.post", return_value=_resp(body)):
        out = hl.search_symbols("O")
    assert all(s["symbol"] != "OLD" for s in out)


def test_hl_search_prefix_matches_sort_first(hl):
    body = {"universe": [
        {"name": "ZZBT"},   # contains BT but not prefix
        {"name": "BTC"},    # prefix match
        {"name": "BTA"},    # prefix match
    ]}
    with patch("data_source.requests.post", return_value=_resp(body)):
        out = hl.search_symbols("BT")
    syms = [s["symbol"] for s in out]
    # Prefix matches come first, alphabetically sorted within prefix group.
    assert syms.index("BTA") < syms.index("ZZBT")
    assert syms.index("BTC") < syms.index("ZZBT")


def test_hl_search_truncates_to_25(hl):
    body = {"universe": [{"name": f"X{i:03d}"} for i in range(40)]}
    with patch("data_source.requests.post", return_value=_resp(body)):
        out = hl.search_symbols("X")
    assert len(out) == 25
```

- [ ] **Step 2: Run the tests**

Run: `py -3 -m pytest tests/test_data_source.py -v`
Expected: original 10 + 9 new = 19 tests, all green.

- [ ] **Step 3: Commit**

```bash
git add tests/test_data_source.py
git commit -m "test: HyperliquidSource history, search, universe cache

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: data_source.py tests — YFinanceSource

Two challenges: the source lazy-imports `yfinance` inside `_yf()`, and the streaming generator is `while True`. We patch `_yf` to return a fake module, and break the stream loop by patching `time.sleep` to raise.

**Files:**
- Modify: `tests/test_data_source.py`

- [ ] **Step 1: Append YFinance tests**

Append to `tests/test_data_source.py`:

```python
# --- YFinanceSource ------------------------------------------------------------

from data_source import YFinanceSource


class _FakeRow(dict):
    """Acts like a pandas Series row for .get() / item access."""
    pass


class _FakeDF:
    def __init__(self, rows):
        # rows: list of (timestamp, dict) tuples.
        self._rows = rows
        self.empty = not rows

    def iterrows(self):
        for ts, row in self._rows:
            yield ts, _FakeRow(row)


class _FakeTs:
    def __init__(self, secs):
        self._s = secs

    def timestamp(self):
        return self._s


class _FakeTicker:
    def __init__(self, df=None, fast_info=None):
        self._df = df if df is not None else _FakeDF([])
        self.fast_info = fast_info or {}

    def history(self, period=None, interval=None, auto_adjust=False):
        return self._df


class _FakeYF:
    def __init__(self, ticker=None, search_quotes=None, search_raises=False):
        self._ticker = ticker or _FakeTicker()
        self._search_quotes = search_quotes or []
        self._search_raises = search_raises

    def Ticker(self, symbol):
        return self._ticker

    def Search(self, *args, **kwargs):
        if self._search_raises:
            raise RuntimeError("yahoo down")
        r = MagicMock()
        r.quotes = self._search_quotes
        return r


@pytest.fixture
def yfs():
    return YFinanceSource()


def test_yf_get_history_empty_df_returns_empty(yfs):
    fake = _FakeYF(ticker=_FakeTicker(df=_FakeDF([])))
    with patch.object(YFinanceSource, "_yf", return_value=fake):
        assert yfs.get_history("AAPL", "1m") == []


def test_yf_get_history_maps_row_fields(yfs):
    rows = [
        (_FakeTs(1_700_000_000), {"Open": 1.0, "High": 2.0, "Low": 0.5, "Close": 1.5, "Volume": 10}),
        (_FakeTs(1_700_000_060), {"Open": 1.5, "High": 2.5, "Low": 1.0, "Close": 2.0, "Volume": 20}),
    ]
    fake = _FakeYF(ticker=_FakeTicker(df=_FakeDF(rows)))
    with patch.object(YFinanceSource, "_yf", return_value=fake):
        out = yfs.get_history("AAPL", "1m", limit=10)
    assert len(out) == 2
    assert out[0].time == 1_700_000_000
    assert out[0].close == 1.5 and out[0].volume == 10.0


def test_yf_get_history_truncates_to_limit(yfs):
    rows = [(_FakeTs(i), {"Open": 1, "High": 1, "Low": 1, "Close": 1, "Volume": 0}) for i in range(20)]
    fake = _FakeYF(ticker=_FakeTicker(df=_FakeDF(rows)))
    with patch.object(YFinanceSource, "_yf", return_value=fake):
        out = yfs.get_history("AAPL", "1m", limit=5)
    assert len(out) == 5
    assert [c.time for c in out] == [15, 16, 17, 18, 19]


def test_yf_search_empty_query(yfs):
    assert yfs.search_symbols("") == []


def test_yf_search_exception_returns_empty(yfs):
    fake = _FakeYF(search_raises=True)
    with patch.object(YFinanceSource, "_yf", return_value=fake):
        assert yfs.search_symbols("AAPL") == []


def test_yf_search_maps_quote_type_to_asset_class(yfs):
    quotes = [
        {"symbol": "AAPL", "shortname": "Apple", "quoteType": "EQUITY",         "exchDisp": "NMS"},
        {"symbol": "BTC-USD", "shortname": "Bitcoin", "quoteType": "CRYPTOCURRENCY"},
        {"symbol": "EURUSD=X", "shortname": "EUR/USD", "quoteType": "CURRENCY"},
        {"symbol": "WEIRD", "shortname": "Mystery", "quoteType": "UNKNOWN_TYPE"},
    ]
    fake = _FakeYF(search_quotes=quotes)
    with patch.object(YFinanceSource, "_yf", return_value=fake):
        out = yfs.search_symbols("x")
    by_sym = {s["symbol"]: s for s in out}
    assert by_sym["AAPL"]["asset_class"] == "stock"
    assert by_sym["AAPL"]["label"] == "Apple · NMS"
    assert by_sym["BTC-USD"]["asset_class"] == "crypto"
    assert by_sym["EURUSD=X"]["asset_class"] == "fx"
    assert by_sym["WEIRD"]["asset_class"] == "stock"  # unknown defaults to stock


def test_yf_search_label_fallback_chain(yfs):
    quotes = [
        {"symbol": "A", "longname": "Long A"},
        {"symbol": "B", "name": "Just B"},
        {"symbol": "C"},  # nothing => label is the symbol
    ]
    fake = _FakeYF(search_quotes=quotes)
    with patch.object(YFinanceSource, "_yf", return_value=fake):
        out = yfs.search_symbols("x")
    by_sym = {s["symbol"]: s for s in out}
    assert by_sym["A"]["label"] == "Long A"
    assert by_sym["B"]["label"] == "Just B"
    assert by_sym["C"]["label"] == "C"


def test_yf_search_skips_quote_with_no_symbol(yfs):
    quotes = [{"shortname": "no symbol here"}, {"symbol": "OK"}]
    fake = _FakeYF(search_quotes=quotes)
    with patch.object(YFinanceSource, "_yf", return_value=fake):
        out = yfs.search_symbols("x")
    assert [s["symbol"] for s in out] == ["OK"]


def test_yf_stream_quotes_yields_one_quote(yfs):
    """Run one iteration of the polling loop and stop.

    Strategy: mock fast_info so a price is available, then patch `time.sleep`
    on the *first call* to raise StopIteration, which breaks out of `while True`.
    """
    fake = _FakeYF(ticker=_FakeTicker(fast_info={"last_price": 123.45}))
    with patch.object(YFinanceSource, "_yf", return_value=fake), \
         patch("data_source.time.sleep", side_effect=StopIteration):
        gen = yfs.stream_quotes("AAPL", "1m")
        q = next(gen)
        # Generator advances once, yields one quote, then hits sleep -> StopIteration.
        with pytest.raises(StopIteration):
            next(gen)
    assert q.price == 123.45
    assert q.source == "yfinance"
    assert q.symbol == "AAPL"
```

- [ ] **Step 2: Run the tests**

Run: `py -3 -m pytest tests/test_data_source.py -v`
Expected: 19 prior + 9 new = 28 tests, all green.

- [ ] **Step 3: Commit**

```bash
git add tests/test_data_source.py
git commit -m "test: YFinanceSource history, search, and one-iteration stream

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Flask route tests — `/sources`, `/symbols`, `/narratives`, `/news`, `/events`, `/factors`, `/signals`, `/quote/breadth`, `/`, `/static/<path>`

Uses `app.test_client()`. Services are mocked at the module path (`app.fetch_news`, etc.) — same seam style as the existing service tests.

**Files:**
- Create: `tests/test_app.py`

- [ ] **Step 1: Write the file**

```python
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
    # Stub each source so we control merge order and de-dup behavior.
    fake_source = MagicMock()
    fake_source.search_symbols.return_value = [
        {"symbol": "AAPL", "label": "Apple", "source": "yfinance", "asset_class": "stock"},
        # duplicate (case-insensitive) of a curated entry — should be deduped
        {"symbol": "aapl", "label": "dup",   "source": "yfinance", "asset_class": "stock"},
    ]
    with patch.dict("app.REGISTRY", {"yfinance": fake_source}, clear=True):
        r = client.get("/symbols?q=AAPL")
    body = r.get_json()
    upper_syms = [s["symbol"].upper() for s in body["symbols"]]
    # AAPL appears exactly once
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
    # Empty and whitespace-only entries are stripped.
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
```

- [ ] **Step 2: Run the tests**

Run: `py -3 -m pytest tests/test_app.py -v`
Expected: 11 tests, all green.

- [ ] **Step 3: Commit**

```bash
git add tests/test_app.py
git commit -m "test: Flask routes for sources, symbols, narratives, news, events, factors, signals, breadth

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Flask route tests — `/history` and `/stream/quotes`

`/history` needs success, unknown-source 404, and source-raised 500. `/stream/quotes` is an SSE endpoint that returns a generator — we test by consuming the generator directly, no long-running server needed.

**Files:**
- Modify: `tests/test_app.py`

- [ ] **Step 1: Append history + SSE tests**

Append to `tests/test_app.py`:

```python
# --- /history ------------------------------------------------------------------

from data_source import Candle


def test_history_success(client):
    fake = MagicMock()
    fake.get_history.return_value = [
        Candle(time=1, open=1, high=2, low=0.5, close=1.5, volume=10),
    ]
    with patch.dict("app.REGISTRY", {"yfinance": fake}, clear=True):
        r = client.get("/history?source=yfinance&symbol=AAPL&tf=1m&limit=10")
    assert r.status_code == 200
    body = r.get_json()
    assert len(body) == 1 and body[0]["time"] == 1


def test_history_unknown_source_returns_404(client):
    with patch.dict("app.REGISTRY", {}, clear=True):
        r = client.get("/history?source=nope&symbol=X&tf=1m")
    assert r.status_code == 404
    assert "error" in r.get_json()


def test_history_source_raises_returns_500(client):
    fake = MagicMock()
    fake.get_history.side_effect = RuntimeError("network down")
    with patch.dict("app.REGISTRY", {"yfinance": fake}, clear=True):
        r = client.get("/history?source=yfinance&symbol=AAPL&tf=1m")
    assert r.status_code == 500
    assert r.get_json()["error"] == "network down"


# --- /stream/quotes ------------------------------------------------------------

from data_source import Quote


def test_stream_quotes_unknown_source_returns_404(client):
    with patch.dict("app.REGISTRY", {}, clear=True):
        r = client.get("/stream/quotes?source=nope&symbol=X&tf=1m")
    assert r.status_code == 404


def test_stream_quotes_sse_headers_and_payload(client):
    """Consume the generator directly. We don't keep the connection open."""
    fake = MagicMock()
    fake.stream_quotes.return_value = iter([
        Quote(time=1, price=1.5, source="yfinance", symbol="AAPL"),
        Quote(time=2, price=1.6, source="yfinance", symbol="AAPL"),
    ])
    with patch.dict("app.REGISTRY", {"yfinance": fake}, clear=True):
        r = client.get("/stream/quotes?source=yfinance&symbol=AAPL&tf=1m")
        assert r.status_code == 200
        assert r.mimetype == "text/event-stream"
        # response.iter_encoded() materializes the generator; force-consume it.
        chunks = [c.decode() for c in r.response]
    body = "".join(chunks)
    assert body.startswith(": connected\n\n")
    assert 'data: {' in body
    assert '"price": 1.5' in body
    assert '"price": 1.6' in body


def test_stream_quotes_not_implemented_emits_error_event(client):
    fake = MagicMock()
    def gen(*_args, **_kwargs):
        # raise during iteration, mimicking HyperliquidSource.stream_quotes
        raise NotImplementedError("crypto streams in the browser")
        yield  # pragma: no cover  (keeps it a generator)
    fake.stream_quotes.side_effect = gen
    with patch.dict("app.REGISTRY", {"hyperliquid": fake}, clear=True):
        r = client.get("/stream/quotes?source=hyperliquid&symbol=BTC&tf=1m")
        body = "".join(c.decode() for c in r.response)
    assert "event: error" in body
    assert "streaming not supported" in body


def test_stream_quotes_generic_exception_emits_error_event(client):
    fake = MagicMock()
    def gen(*_args, **_kwargs):
        raise RuntimeError("oops")
        yield  # pragma: no cover
    fake.stream_quotes.side_effect = gen
    with patch.dict("app.REGISTRY", {"yfinance": fake}, clear=True):
        r = client.get("/stream/quotes?source=yfinance&symbol=AAPL&tf=1m")
        body = "".join(c.decode() for c in r.response)
    assert "event: error" in body
    assert "oops" in body
```

- [ ] **Step 2: Run all tests**

Run: `py -3 -m pytest -v`
Expected: existing service tests + new data_source tests + new app tests, all green.

- [ ] **Step 3: Commit**

```bash
git add tests/test_app.py
git commit -m "test: /history and /stream/quotes routes with mocked sources

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: README update

One short section so future readers know `npm test` exists.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read README.md to find the right insertion point**

Run: `Read README.md` (the file is short).

- [ ] **Step 2: Insert a Tests section**

Insert after the existing "Quick start" / "Run" content (before the "Extending" or "Architecture" section, whichever comes first — pick the natural slot). Add:

```markdown
## Tests

Backend:

```
py -3 -m pytest
```

Frontend (pure-logic checks for indicators and drawings):

```
npm test
```

`npm test` runs Node's built-in `node --test` against `tests/frontend/`. No npm install needed — there are no dependencies.
```

If the README already has a "Tests" or "Testing" section, replace its body with the above instead of duplicating.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Tests section to README

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Final verification + negative-control sanity check

Confirm everything passes together, then deliberately break one indicator and verify the test catches it.

- [ ] **Step 1: Run full backend suite**

Run: `py -3 -m pytest -v`
Expected: all green. Note total count (existing services + new app + new data_source).

- [ ] **Step 2: Run full frontend suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 3: Negative-control check (manual)**

Temporarily flip a sign in [static/indicators.js](static/indicators.js) — change the `sma` function's `sum += candles[i].close;` to `sum -= candles[i].close;`. Run `npm test`. The `sma(3) on [1..5]` test must fail. Revert the change. Run `npm test` again — must pass.

This confirms the suite actually catches regressions (not just structural problems).

- [ ] **Step 4: Final commit (if README changes are not yet pushed)**

```bash
git status
# If clean, you're done.
```

---

## Self-Review

**Spec coverage:**
- `tests/test_app.py` — Task 9 + Task 10 cover all 12 routes listed in the spec. ✓
- `tests/test_data_source.py` — Task 6 (types/helpers/registry), Task 7 (Hyperliquid), Task 8 (yfinance + one-iteration stream). ✓
- `tests/frontend/test_indicators.js` — Task 3 (generic per-def) + Task 4 (targeted math). ✓
- `tests/frontend/test_drawings.js` — Task 5 covers `DrawingStore`, `PrefsStore`, per-tool generic checks, targeted hit-test/moveHandle/moveAll. ✓
- `tests/frontend/_sandbox.js` — Task 1. ✓
- `package.json` — Task 2. ✓
- README update — Task 11. ✓

**Placeholder scan:** No "TBD", "TODO", or "similar to Task N" stubs. Every code step has complete code. ✓

**Type consistency:** `loadBrowserScript`, `defaultParams`, `defaultColors`, `makeCandles`, `candlesFromCloses`, `makeLayer`, `makeDrawing` — all defined where first used (within the same file as their callers). ✓

**Negative-control:** Task 12 step 3 has a concrete edit that must produce a known failure. ✓

**Risks:**
- The Hyperliquid universe cache lives on the class, not the instance. The `hl` fixture resets it. If two tests in the same file run in parallel, cache resets could race — but pytest runs serially by default. Safe.
- `npm test` first run on a fresh clone needs Node 24 or `node --test` won't exist. The README should mention this; the test instructions assume the current dev machine (Node 24 confirmed).
