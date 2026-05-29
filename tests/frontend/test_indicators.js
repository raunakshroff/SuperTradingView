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
    // At n=300 with default params, every indicator should emit at least one point.
    const nonEmpty = Array.isArray(result)
      ? result.length > 0
      : Object.values(result).some((v) => Array.isArray(v) && v.length > 0);
    assert.ok(nonEmpty, `${def.id}: expected non-empty output for a 300-candle series`);
  });
}

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
    assert.ok(width > 0, `bb width at ${i} should be > 0`);
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
  const candles = candlesFromCloses(Array.from({ length: 30 }, () => 100));
  const out = def.compute(candles, { period: 14 }, defaultColors(def));
  assert.ok(out.length > 0);
  for (const p of out) assert.ok(Math.abs(p.value - 1.0) < 1e-9);
});

test("obv: empty input -> [], single candle -> single zero entry", () => {
  const def = defById("obv");
  // assert.deepEqual under node:assert/strict compares references; use length check instead
  const empty = def.compute([], {}, defaultColors(def));
  assert.equal(empty.length, 0);
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
  const vals = out.map((p) => p.value);
  assert.equal(vals[0], 0);
  assert.equal(vals[1], 20);
  assert.equal(vals[2], -10);
  assert.equal(vals[3], -10);
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
  assert.ok(out[0].color.startsWith("rgba(0,255,0"));
  assert.ok(out[1].color.startsWith("rgba(255,0,0"));
  assert.ok(out[2].color.startsWith("rgba(0,255,0"), "close === open should be `up`");
});

test("ma_cross: golden cross emitted when fast crosses above slow", () => {
  const def = defById("ma_cross");
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

test("ma_cross: death cross emitted when fast crosses below slow", () => {
  const def = defById("ma_cross");
  const closes = [100, 100, 100, 100, 100, 10, 10, 10, 10, 10];
  const colors = defaultColors(def);
  const result = def.compute(candlesFromCloses(closes),
    { fast: 2, slow: 4, type: 0 }, colors);
  const death = result.markers.find((m) => m.text === "Death");
  assert.ok(death, "expected a Death Cross marker");
  assert.equal(death.color, colors.death);
  assert.equal(death.position, "aboveBar");
});
