// tests/frontend/test_drawings.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBrowserScript } = require("./_sandbox.js");

const w = loadBrowserScript("../../static/drawings.js");
const { Drawings } = w;
const storage = w.localStorage;            // same object DrawingStore writes to
const { DrawingStore, PrefsStore, TOOL_DEFS } = Drawings;
const TOOLS_BY_ID = Object.fromEntries(TOOL_DEFS.map((t) => [t.id, t]));

// Identity-like layer: pixel == time on x, pixel == price on y.
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
  storage.clear();
  const d = makeDrawing("trendline", [{ time: 100, price: 50 }, { time: 200, price: 60 }]);
  DrawingStore.set("yfinance", "AAPL", [d]);
  const got = DrawingStore.get("yfinance", "AAPL");
  assert.equal(got.length, 1);
  assert.equal(got[0].id, "drw_test");
});

test("DrawingStore: key is case-insensitive on symbol", () => {
  storage.clear();
  const d = makeDrawing("trendline", [{ time: 1, price: 1 }, { time: 2, price: 2 }]);
  DrawingStore.set("yfinance", "aapl", [d]);
  assert.equal(DrawingStore.get("yfinance", "AAPL").length, 1);
  assert.equal(DrawingStore.get("yfinance", "AaPl").length, 1);
});

test("DrawingStore: clear() removes the symbol's drawings", () => {
  storage.clear();
  const d = makeDrawing("trendline", [{ time: 1, price: 1 }, { time: 2, price: 2 }]);
  DrawingStore.set("yfinance", "AAPL", [d]);
  DrawingStore.clear("yfinance", "AAPL");
  // assert.deepEqual [] vs [] fails in node:assert/strict (strictEqual requires reference equality);
  // use length check instead.
  assert.equal(DrawingStore.get("yfinance", "AAPL").length, 0);
});

test("DrawingStore: invalid persisted entries are dropped on read", () => {
  storage.clear();
  const good = makeDrawing("trendline", [{ time: 1, price: 1 }, { time: 2, price: 2 }]);
  const corrupt = [
    null,
    { id: 1, tool: "trendline", points: [] },
    { id: "x", tool: 9, points: [] },
    { id: "x", tool: "trendline", points: "nope" },
    { id: "x", tool: "trendline", points: [{ time: "1", price: 2 }] },
    { id: "x", tool: "trendline", points: [{ time: 1, price: 2 }], style: { color: "#zzzz00" } },
    { id: "x", tool: "trendline", points: [{ time: 1, price: 2 }], style: { width: -3 } },
    { id: "x", tool: "trendline", points: [{ time: 1, price: 2 }], style: { opacity: 9 } },
    { id: "x", tool: "trendline", points: [{ time: 1, price: 2 }], style: { dash: "rainbow" } },
  ];
  const payload = { "yfinance|AAPL": [good, ...corrupt] };
  storage.setItem("stv.drawings", JSON.stringify(payload));
  const got = DrawingStore.get("yfinance", "AAPL");
  assert.equal(got.length, 1, "only the good entry survives");
  assert.equal(got[0].id, "drw_test");
});

// --- PrefsStore ----------------------------------------------------------

test("PrefsStore: returns defaults when empty", () => {
  storage.clear();
  const p = PrefsStore.get();
  assert.equal(p.toolbarMode, "left");
  assert.equal(p.snapDefault, "shift");
  assert.equal(p.undoDepth, 50);
});

test("PrefsStore: set() merges over defaults and persists", () => {
  storage.clear();
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

  test(`${def.id}: moveAll shifts every stored point by exactly (dx, dy) on owned axes`, () => {
    const layer = makeLayer();
    const points = samplePoints(def.pointsNeeded);
    const d = makeDrawing(def.id, points);
    const before = d.points.map((p) => ({ ...p }));
    def.moveAll(d, 7, 5, layer);

    // Which axes does this tool actually move? horizontal owns price only,
    // vertical owns time only, everything else owns both.
    const movesTime  = def.id !== "horizontal";
    const movesPrice = def.id !== "vertical";

    for (let i = 0; i < def.pointsNeeded; i++) {
      if (movesTime) {
        assert.ok(Math.abs((d.points[i].time - before[i].time) - 7) < 1e-9,
          `${def.id}: point ${i} time should move by +7 (was ${before[i].time}, now ${d.points[i].time})`);
      } else {
        assert.equal(d.points[i].time, before[i].time,
          `${def.id}: point ${i} time should NOT move`);
      }
      if (movesPrice) {
        assert.ok(Math.abs((d.points[i].price - before[i].price) - 5) < 1e-9,
          `${def.id}: point ${i} price should move by +5 (was ${before[i].price}, now ${d.points[i].price})`);
      } else {
        assert.equal(d.points[i].price, before[i].price,
          `${def.id}: point ${i} price should NOT move`);
      }
    }
  });
}

// --- Targeted hit-test checks --------------------------------------------

test("trendline: hit on segment, miss far away", () => {
  const def = TOOLS_BY_ID["trendline"];
  const layer = makeLayer();
  const d = makeDrawing("trendline", [{ time: 100, price: 100 }, { time: 200, price: 200 }]);
  assert.ok(def.hitTest(d, 150, 150, layer));
  assert.ok(!def.hitTest(d, 500, 500, layer));
});

test("trendline: hit on endpoints", () => {
  const def = TOOLS_BY_ID["trendline"];
  const layer = makeLayer();
  const d = makeDrawing("trendline", [{ time: 100, price: 100 }, { time: 200, price: 200 }]);
  assert.ok(def.hitTest(d, 100, 100, layer));
  assert.ok(def.hitTest(d, 200, 200, layer));
});

test("horizontal: hits anywhere at the line's y, misses off the y", () => {
  const def = TOOLS_BY_ID["horizontal"];
  const layer = makeLayer();
  const d = makeDrawing("horizontal", [{ time: 0, price: 250 }]);
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
  const d = makeDrawing("rectangle", [{ time: 100, price: 100 }, { time: 300, price: 200 }]);
  assert.ok(def.hitTest(d, 200, 150, layer), "inside");
  assert.ok(def.hitTest(d, 100, 100, layer), "corner");
  assert.ok(def.hitTest(d, 300, 200, layer), "opposite corner");
  assert.ok(!def.hitTest(d, 500, 500, layer), "far outside");
});

test("trendline: moveHandle(0) updates only point 0", () => {
  const def = TOOLS_BY_ID["trendline"];
  const layer = makeLayer();
  const d = makeDrawing("trendline", [{ time: 100, price: 100 }, { time: 200, price: 200 }]);
  def.moveHandle(d, 0, 50, 75, layer);
  assert.equal(d.points[0].time, 50);
  assert.equal(d.points[0].price, 75);
  assert.equal(d.points[1].time, 200, "point 1 untouched");
  assert.equal(d.points[1].price, 200);
});

test("trendline: moveHandle(1) updates only point 1", () => {
  const def = TOOLS_BY_ID["trendline"];
  const layer = makeLayer();
  const d = makeDrawing("trendline", [{ time: 100, price: 100 }, { time: 200, price: 200 }]);
  def.moveHandle(d, 1, 999, 888, layer);
  assert.equal(d.points[0].time, 100, "point 0 untouched");
  assert.equal(d.points[1].time, 999);
  assert.equal(d.points[1].price, 888);
});

test("rectangle: moveHandle accepts string handleId (UI dataset path)", () => {
  const def = TOOLS_BY_ID["rectangle"];
  const layer = makeLayer();
  const d = makeDrawing("rectangle", [{ time: 100, price: 100 }, { time: 300, price: 200 }]);
  def.moveHandle(d, "0", 50, 50, layer);
  assert.equal(d.points[0].time, 50);
  assert.equal(d.points[0].price, 50);
});
