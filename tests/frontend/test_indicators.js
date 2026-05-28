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
