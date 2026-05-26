/* Technical indicator library.
 *
 * Each indicator is a self-contained "def":
 *   {
 *     id, name, category, overlay, params, colors,
 *     build(chart, scaleId, colors),    // returns Lightweight Charts series
 *     compute(candles, params, colors), // returns data
 *     apply(series, data)               // pushes data into series
 *   }
 *
 * - `params` is the list of numeric parameters (period, mult, etc.).
 * - `colors` is the list of color slots the indicator exposes for user override.
 *   Each slot is { key, label, default } where default is a #RRGGBB hex.
 *
 * To add a new indicator: write its math, then append one def to DEFS below.
 * The modal, chart wiring, persistence, sub-pane layout, and color pickers
 * pick it up automatically.
 */

// --- Helpers --------------------------------------------------------------

function withAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function trueRange(c, prevClose) {
  return Math.max(
    c.high - c.low,
    Math.abs(c.high - prevClose),
    Math.abs(c.low - prevClose)
  );
}

function atrSeriesRaw(candles, period) {
  const out = [];
  if (candles.length < period + 1) return out;
  let sumTR = 0;
  for (let i = 1; i <= period; i++) sumTR += trueRange(candles[i], candles[i - 1].close);
  let atrV = sumTR / period;
  out.push({ time: candles[period].time, value: atrV });
  for (let i = period + 1; i < candles.length; i++) {
    const tr = trueRange(candles[i], candles[i - 1].close);
    atrV = (atrV * (period - 1) + tr) / period;
    out.push({ time: candles[i].time, value: atrV });
  }
  return out;
}

function smaSeries(points, period) {
  const out = [];
  if (points.length < period) return out;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += points[i].value;
    if (i >= period) sum -= points[i - period].value;
    if (i >= period - 1) out.push({ time: points[i].time, value: sum / period });
  }
  return out;
}

function emaSeries(points, period) {
  const out = [];
  if (points.length < period) return out;
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < points.length; i++) {
    if (i < period - 1) continue;
    if (prev === null) {
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += points[j].value;
      prev = s / period;
    } else {
      prev = points[i].value * k + prev * (1 - k);
    }
    out.push({ time: points[i].time, value: prev });
  }
  return out;
}

function lineOpts(color, extra) {
  return Object.assign({
    color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
  }, extra || {});
}

// v5: chart.addSeries(SeriesType, options, paneIndex). Series in pane N
// automatically use that pane's own right price scale (with visible axis).
function ohlcLine(chart, color, paneIndex, extra) {
  return chart.addSeries(LightweightCharts.LineSeries, lineOpts(color, extra), paneIndex || 0);
}

function histSeries(chart, paneIndex, extra) {
  return chart.addSeries(LightweightCharts.HistogramSeries,
    Object.assign({ priceLineVisible: false }, extra || {}),
    paneIndex || 0);
}

// --- Calculations ---------------------------------------------------------

function sma(candles, period) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

function ema(candles, period) {
  return emaSeries(candles.map((c) => ({ time: c.time, value: c.close })), period);
}

function wma(candles, period) {
  const out = [];
  if (candles.length < period) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < candles.length; i++) {
    let s = 0;
    for (let j = 0; j < period; j++) s += candles[i - j].close * (period - j);
    out.push({ time: candles[i].time, value: s / denom });
  }
  return out;
}

function wmaOfPoints(points, period) {
  const out = [];
  if (points.length < period) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < points.length; i++) {
    let s = 0;
    for (let j = 0; j < period; j++) s += points[i - j].value * (period - j);
    out.push({ time: points[i].time, value: s / denom });
  }
  return out;
}

function hma(candles, period) {
  if (period < 2) return [];
  const half = Math.max(2, Math.floor(period / 2));
  const sqrtP = Math.max(1, Math.floor(Math.sqrt(period)));
  const wh = wma(candles, half);
  const wf = wma(candles, period);
  const whMap = new Map(wh.map((p) => [p.time, p.value]));
  const raw = [];
  for (const p of wf) {
    if (whMap.has(p.time)) raw.push({ time: p.time, value: 2 * whMap.get(p.time) - p.value });
  }
  return wmaOfPoints(raw, sqrtP);
}

function dema(candles, period) {
  const e1 = ema(candles, period);
  const e2 = emaSeries(e1, period);
  const e1Map = new Map(e1.map((p) => [p.time, p.value]));
  return e2.map((p) => ({ time: p.time, value: 2 * e1Map.get(p.time) - p.value }));
}

function tema(candles, period) {
  const e1 = ema(candles, period);
  const e2 = emaSeries(e1, period);
  const e3 = emaSeries(e2, period);
  const e1m = new Map(e1.map((p) => [p.time, p.value]));
  const e2m = new Map(e2.map((p) => [p.time, p.value]));
  return e3.map((p) => ({ time: p.time, value: 3 * e1m.get(p.time) - 3 * e2m.get(p.time) + p.value }));
}

function bbands(candles, period, mult) {
  const upper = [], mid = [], lower = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = candles[j].close - mean;
      sq += d * d;
    }
    const sd = Math.sqrt(sq / period);
    const t = candles[i].time;
    mid.push({ time: t, value: mean });
    upper.push({ time: t, value: mean + mult * sd });
    lower.push({ time: t, value: mean - mult * sd });
  }
  return { upper, mid, lower };
}

function donchian(candles, period) {
  const upper = [], lower = [], mid = [];
  for (let i = period - 1; i < candles.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j].high);
      lo = Math.min(lo, candles[j].low);
    }
    upper.push({ time: candles[i].time, value: hi });
    lower.push({ time: candles[i].time, value: lo });
    mid.push({ time: candles[i].time, value: (hi + lo) / 2 });
  }
  return { upper, mid, lower };
}

function keltner(candles, period, mult) {
  const mid = ema(candles, period);
  const atrArr = atrSeriesRaw(candles, period);
  const atrMap = new Map(atrArr.map((p) => [p.time, p.value]));
  const upper = [], lower = [], midOut = [];
  for (const m of mid) {
    if (atrMap.has(m.time)) {
      const a = atrMap.get(m.time);
      midOut.push({ time: m.time, value: m.value });
      upper.push({ time: m.time, value: m.value + mult * a });
      lower.push({ time: m.time, value: m.value - mult * a });
    }
  }
  return { upper, mid: midOut, lower };
}

function vwap(candles) {
  const out = [];
  let cumPV = 0, cumV = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    const v = c.volume || 0;
    cumPV += tp * v;
    cumV += v;
    out.push({ time: c.time, value: cumV > 0 ? cumPV / cumV : c.close });
  }
  return out;
}

function psar(candles, accInit, accMax, accStep) {
  if (candles.length < 2) return [];
  const out = [];
  let isUp = candles[1].close >= candles[0].close;
  let af = accInit;
  let ep = isUp ? candles[1].high : candles[1].low;
  let sar = isUp ? Math.min(candles[0].low, candles[1].low) : Math.max(candles[0].high, candles[1].high);
  out.push({ time: candles[0].time, value: sar });
  out.push({ time: candles[1].time, value: sar });
  for (let i = 2; i < candles.length; i++) {
    const c = candles[i];
    let nextSar = sar + af * (ep - sar);
    if (isUp) {
      nextSar = Math.min(nextSar, candles[i - 1].low, candles[i - 2].low);
      if (c.low < nextSar) {
        isUp = false;
        nextSar = ep;
        ep = c.low;
        af = accInit;
      } else if (c.high > ep) {
        ep = c.high;
        af = Math.min(af + accStep, accMax);
      }
    } else {
      nextSar = Math.max(nextSar, candles[i - 1].high, candles[i - 2].high);
      if (c.high > nextSar) {
        isUp = true;
        nextSar = ep;
        ep = c.high;
        af = accInit;
      } else if (c.low < ep) {
        ep = c.low;
        af = Math.min(af + accStep, accMax);
      }
    }
    sar = nextSar;
    out.push({ time: c.time, value: sar });
  }
  return out;
}

function supertrend(candles, period, mult) {
  const atrArr = atrSeriesRaw(candles, period);
  const atrMap = new Map(atrArr.map((p) => [p.time, p.value]));
  const out = [];
  let prevUpper = null, prevLower = null, prevST = null, isUp = true;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const a = atrMap.get(c.time);
    if (a == null) continue;
    const hl2 = (c.high + c.low) / 2;
    const ub = hl2 + mult * a;
    const lb = hl2 - mult * a;
    const prevClose = i > 0 ? candles[i - 1].close : c.close;
    const upper = prevUpper == null || ub < prevUpper || prevClose > prevUpper ? ub : prevUpper;
    const lower = prevLower == null || lb > prevLower || prevClose < prevLower ? lb : prevLower;
    let st;
    if (prevST == null) {
      isUp = c.close > upper;
      st = isUp ? lower : upper;
    } else if (prevST === prevUpper && c.close > upper) { st = lower; isUp = true; }
    else if (prevST === prevUpper && c.close <= upper) { st = upper; isUp = false; }
    else if (prevST === prevLower && c.close < lower)  { st = upper; isUp = false; }
    else if (prevST === prevLower && c.close >= lower) { st = lower; isUp = true; }
    else { st = isUp ? lower : upper; }
    out.push({ time: c.time, value: st });
    prevST = st; prevUpper = upper; prevLower = lower;
  }
  return out;
}

function ichimoku(candles, tP, kP, bP) {
  const tenkan = [], kijun = [], senkouA = [], senkouB = [];
  function hh_ll(end, n) {
    let hi = -Infinity, lo = Infinity;
    for (let j = end - n + 1; j <= end; j++) {
      hi = Math.max(hi, candles[j].high);
      lo = Math.min(lo, candles[j].low);
    }
    return (hi + lo) / 2;
  }
  for (let i = 0; i < candles.length; i++) {
    if (i >= tP - 1) tenkan.push({ time: candles[i].time, value: hh_ll(i, tP) });
    if (i >= kP - 1) kijun.push({ time: candles[i].time, value: hh_ll(i, kP) });
    if (i >= bP - 1) senkouB.push({ time: candles[i].time, value: hh_ll(i, bP) });
  }
  const tMap = new Map(tenkan.map((p) => [p.time, p.value]));
  for (const k of kijun) {
    if (tMap.has(k.time)) senkouA.push({ time: k.time, value: (tMap.get(k.time) + k.value) / 2 });
  }
  return { tenkan, kijun, senkouA, senkouB };
}

function rsi(candles, period) {
  if (candles.length < period + 1) return [];
  const out = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d >= 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  const push = (i, g, l) => {
    const val = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    out.push({ time: candles[i].time, value: val });
  };
  push(period, avgGain, avgLoss);
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    push(i, avgGain, avgLoss);
  }
  return out;
}

function stochastic(candles, kP, dP, smooth) {
  const rawK = [];
  for (let i = kP - 1; i < candles.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - kP + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j].high);
      lo = Math.min(lo, candles[j].low);
    }
    const v = hi === lo ? 50 : (100 * (candles[i].close - lo)) / (hi - lo);
    rawK.push({ time: candles[i].time, value: v });
  }
  const k = smaSeries(rawK, smooth);
  const d = smaSeries(k, dP);
  return { k, d };
}

function stochRsi(candles, rsiP, kP, dP, smooth) {
  const r = rsi(candles, rsiP);
  const rawK = [];
  for (let i = kP - 1; i < r.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - kP + 1; j <= i; j++) {
      hi = Math.max(hi, r[j].value);
      lo = Math.min(lo, r[j].value);
    }
    const v = hi === lo ? 50 : (100 * (r[i].value - lo)) / (hi - lo);
    rawK.push({ time: r[i].time, value: v });
  }
  const k = smaSeries(rawK, smooth);
  const d = smaSeries(k, dP);
  return { k, d };
}

function williamsR(candles, period) {
  const out = [];
  for (let i = period - 1; i < candles.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j].high);
      lo = Math.min(lo, candles[j].low);
    }
    const wr = hi === lo ? -50 : (-100 * (hi - candles[i].close)) / (hi - lo);
    out.push({ time: candles[i].time, value: wr });
  }
  return out;
}

function roc(candles, period) {
  const out = [];
  for (let i = period; i < candles.length; i++) {
    const prev = candles[i - period].close;
    out.push({
      time: candles[i].time,
      value: prev === 0 ? 0 : (100 * (candles[i].close - prev)) / prev,
    });
  }
  return out;
}

function cci(candles, period) {
  const out = [];
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  for (let i = period - 1; i < candles.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += tp[j];
    const mean = s / period;
    let dev = 0;
    for (let j = i - period + 1; j <= i; j++) dev += Math.abs(tp[j] - mean);
    const mad = dev / period;
    out.push({ time: candles[i].time, value: mad === 0 ? 0 : (tp[i] - mean) / (0.015 * mad) });
  }
  return out;
}

function ao(candles, upColor, dnColor) {
  const med = candles.map((c) => ({ time: c.time, value: (c.high + c.low) / 2 }));
  const s5 = smaSeries(med, 5);
  const s34 = smaSeries(med, 34);
  const s5Map = new Map(s5.map((p) => [p.time, p.value]));
  const out = [];
  let prev = null;
  for (const p of s34) {
    if (s5Map.has(p.time)) {
      const v = s5Map.get(p.time) - p.value;
      const color = prev != null && v >= prev ? upColor : dnColor;
      out.push({ time: p.time, value: v, color });
      prev = v;
    }
  }
  return out;
}

function ultimate(candles, p1, p2, p3) {
  if (candles.length < p3 + 1) return [];
  const bp = [], tr = [];
  for (let i = 1; i < candles.length; i++) {
    const lowMin  = Math.min(candles[i].low,  candles[i - 1].close);
    const highMax = Math.max(candles[i].high, candles[i - 1].close);
    bp.push(candles[i].close - lowMin);
    tr.push(highMax - lowMin);
  }
  const out = [];
  for (let i = p3 - 1; i < bp.length; i++) {
    let bp1 = 0, tr1 = 0, bp2 = 0, tr2 = 0, bp3 = 0, tr3 = 0;
    for (let j = i - p1 + 1; j <= i; j++) { bp1 += bp[j]; tr1 += tr[j]; }
    for (let j = i - p2 + 1; j <= i; j++) { bp2 += bp[j]; tr2 += tr[j]; }
    for (let j = i - p3 + 1; j <= i; j++) { bp3 += bp[j]; tr3 += tr[j]; }
    const a1 = tr1 === 0 ? 0 : bp1 / tr1;
    const a2 = tr2 === 0 ? 0 : bp2 / tr2;
    const a3 = tr3 === 0 ? 0 : bp3 / tr3;
    out.push({ time: candles[i + 1].time, value: (100 * (4 * a1 + 2 * a2 + a3)) / 7 });
  }
  return out;
}

function trix(candles, period) {
  const e1 = ema(candles, period);
  const e2 = emaSeries(e1, period);
  const e3 = emaSeries(e2, period);
  const out = [];
  for (let i = 1; i < e3.length; i++) {
    const prev = e3[i - 1].value;
    out.push({ time: e3[i].time, value: prev === 0 ? 0 : (100 * (e3[i].value - prev)) / prev });
  }
  return out;
}

function dpo(candles, period) {
  const shift = Math.floor(period / 2) + 1;
  if (candles.length < period) return [];
  const out = [];
  for (let i = period - 1; i < candles.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += candles[j].close;
    const m = s / period;
    const idx = i - shift;
    if (idx >= 0) out.push({ time: candles[i].time, value: candles[idx].close - m });
  }
  return out;
}

function cmo(candles, period) {
  const out = [];
  for (let i = period; i < candles.length; i++) {
    let up = 0, dn = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = candles[j].close - candles[j - 1].close;
      if (d > 0) up += d; else dn -= d;
    }
    out.push({ time: candles[i].time, value: up + dn === 0 ? 0 : (100 * (up - dn)) / (up + dn) });
  }
  return out;
}

function macd(candles, fast, slow, signal, histUpColor, histDnColor) {
  const fastE = ema(candles, fast);
  const slowE = ema(candles, slow);
  const slowMap = new Map(slowE.map((p) => [p.time, p.value]));
  const macdLine = [];
  for (const p of fastE) {
    if (slowMap.has(p.time)) macdLine.push({ time: p.time, value: p.value - slowMap.get(p.time) });
  }
  const sig = emaSeries(macdLine, signal);
  const sigMap = new Map(sig.map((p) => [p.time, p.value]));
  const hist = macdLine
    .filter((p) => sigMap.has(p.time))
    .map((p) => {
      const diff = p.value - sigMap.get(p.time);
      return { time: p.time, value: diff, color: diff >= 0 ? histUpColor : histDnColor };
    });
  return { macd: macdLine, signal: sig, hist };
}

function adx(candles, period) {
  if (candles.length < period + 1) return { adx: [], plusDI: [], minusDI: [] };
  const tr = [], pDM = [], mDM = [];
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const dn = candles[i - 1].low - candles[i].low;
    pDM.push(up > dn && up > 0 ? up : 0);
    mDM.push(dn > up && dn > 0 ? dn : 0);
    tr.push(trueRange(candles[i], candles[i - 1].close));
  }
  function smooth(arr) {
    const sm = [];
    if (arr.length < period) return sm;
    let s = 0;
    for (let i = 0; i < period; i++) s += arr[i];
    sm.push(s);
    for (let i = period; i < arr.length; i++) { s = s - s / period + arr[i]; sm.push(s); }
    return sm;
  }
  const trS = smooth(tr), pS = smooth(pDM), mS = smooth(mDM);
  const plusDI = [], minusDI = [], dx = [];
  for (let i = 0; i < trS.length; i++) {
    const pdi = trS[i] === 0 ? 0 : (100 * pS[i]) / trS[i];
    const mdi = trS[i] === 0 ? 0 : (100 * mS[i]) / trS[i];
    plusDI.push({ time: candles[i + period].time, value: pdi });
    minusDI.push({ time: candles[i + period].time, value: mdi });
    dx.push(pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi));
  }
  const adxArr = [];
  if (dx.length < period) return { adx: adxArr, plusDI, minusDI };
  let sum = 0;
  for (let i = 0; i < period; i++) sum += dx[i];
  let a = sum / period;
  adxArr.push({ time: candles[period * 2 - 1].time, value: a });
  for (let i = period; i < dx.length; i++) {
    a = (a * (period - 1) + dx[i]) / period;
    adxArr.push({ time: candles[i + period].time, value: a });
  }
  return { adx: adxArr, plusDI, minusDI };
}

function aroon(candles, period) {
  const up = [], dn = [];
  for (let i = period; i < candles.length; i++) {
    let hiIdx = i, hi = -Infinity;
    let loIdx = i, lo = Infinity;
    for (let j = i - period; j <= i; j++) {
      if (candles[j].high > hi) { hi = candles[j].high; hiIdx = j; }
      if (candles[j].low  < lo) { lo = candles[j].low;  loIdx = j; }
    }
    up.push({ time: candles[i].time, value: (100 * (period - (i - hiIdx))) / period });
    dn.push({ time: candles[i].time, value: (100 * (period - (i - loIdx))) / period });
  }
  return { up, dn };
}

function atr(candles, period) { return atrSeriesRaw(candles, period); }

function obv(candles) {
  if (candles.length === 0) return [];
  const out = [{ time: candles[0].time, value: 0 }];
  let val = 0;
  for (let i = 1; i < candles.length; i++) {
    const v = candles[i].volume || 0;
    if (candles[i].close > candles[i - 1].close) val += v;
    else if (candles[i].close < candles[i - 1].close) val -= v;
    out.push({ time: candles[i].time, value: val });
  }
  return out;
}

function mfi(candles, period) {
  if (candles.length < period + 1) return [];
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const out = [];
  for (let i = period; i < candles.length; i++) {
    let pos = 0, neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const flow = tp[j] * (candles[j].volume || 0);
      if (tp[j] > tp[j - 1]) pos += flow;
      else if (tp[j] < tp[j - 1]) neg += flow;
    }
    const ratio = neg === 0 ? Infinity : pos / neg;
    out.push({ time: candles[i].time, value: ratio === Infinity ? 100 : 100 - 100 / (1 + ratio) });
  }
  return out;
}

function cmf(candles, period) {
  if (candles.length < period) return [];
  const mfv = [];
  for (const c of candles) {
    const range = c.high - c.low;
    const m = range === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / range;
    mfv.push(m * (c.volume || 0));
  }
  const out = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sumV = 0, sumMFV = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumV += candles[j].volume || 0;
      sumMFV += mfv[j];
    }
    out.push({ time: candles[i].time, value: sumV === 0 ? 0 : sumMFV / sumV });
  }
  return out;
}

function volumeBars(candles, upColor, dnColor) {
  return candles.map((c) => ({
    time: c.time,
    value: c.volume || 0,
    color: c.close >= c.open ? upColor : dnColor,
  }));
}

// --- Indicator definitions ------------------------------------------------

const PERIOD = (def, key, min = 2, max = 500, step) => {
  const p = { key, default: def, min, max };
  if (step != null) p.step = step;
  return p;
};

const oneLine = (defaultHex) => [{ key: "line", label: "Line", default: defaultHex }];
const upDn = (up, dn) => [
  { key: "up",   label: "Up",   default: up },
  { key: "down", label: "Down", default: dn },
];

const DEFS = [
  // ----- Moving Averages -----
  {
    id: "sma", name: "SMA — Simple MA", category: "Moving Averages", overlay: true,
    params: [PERIOD(20, "period")],
    colors: oneLine("#ffa726"),
    build: (chart, _s, col) => [ohlcLine(chart, col.line)],
    compute: (c, p) => sma(c, +p.period || 20),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "ema", name: "EMA — Exponential MA", category: "Moving Averages", overlay: true,
    params: [PERIOD(50, "period")],
    colors: oneLine("#42a5f5"),
    build: (chart, _s, col) => [ohlcLine(chart, col.line)],
    compute: (c, p) => ema(c, +p.period || 50),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "wma", name: "WMA — Weighted MA", category: "Moving Averages", overlay: true,
    params: [PERIOD(20, "period")],
    colors: oneLine("#ec407a"),
    build: (chart, _s, col) => [ohlcLine(chart, col.line)],
    compute: (c, p) => wma(c, +p.period || 20),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "hma", name: "HMA — Hull MA", category: "Moving Averages", overlay: true,
    params: [PERIOD(20, "period")],
    colors: oneLine("#7e57c2"),
    build: (chart, _s, col) => [ohlcLine(chart, col.line, null, { lineWidth: 2 })],
    compute: (c, p) => hma(c, +p.period || 20),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "dema", name: "DEMA — Double EMA", category: "Moving Averages", overlay: true,
    params: [PERIOD(20, "period")],
    colors: oneLine("#26c6da"),
    build: (chart, _s, col) => [ohlcLine(chart, col.line)],
    compute: (c, p) => dema(c, +p.period || 20),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "tema", name: "TEMA — Triple EMA", category: "Moving Averages", overlay: true,
    params: [PERIOD(20, "period")],
    colors: oneLine("#ab47bc"),
    build: (chart, _s, col) => [ohlcLine(chart, col.line)],
    compute: (c, p) => tema(c, +p.period || 20),
    apply: (s, d) => s[0].setData(d),
  },

  // ----- Bands & Channels -----
  {
    id: "bb", name: "Bollinger Bands", category: "Bands & Channels", overlay: true,
    params: [PERIOD(20, "period"), { key: "mult", default: 2, min: 0.5, max: 5, step: 0.5 }],
    colors: [
      { key: "upper",  label: "Upper",  default: "#ab47bc" },
      { key: "middle", label: "Middle", default: "#7e57c2" },
      { key: "lower",  label: "Lower",  default: "#ab47bc" },
    ],
    build: (chart, _s, col) => [
      ohlcLine(chart, col.upper),
      ohlcLine(chart, col.middle, null, { lineStyle: 2 }),
      ohlcLine(chart, col.lower),
    ],
    compute: (c, p) => bbands(c, +p.period || 20, +p.mult || 2),
    apply: (s, d) => { s[0].setData(d.upper); s[1].setData(d.mid); s[2].setData(d.lower); },
  },
  {
    id: "donchian", name: "Donchian Channels", category: "Bands & Channels", overlay: true,
    params: [PERIOD(20, "period")],
    colors: [
      { key: "upper",  label: "Upper",  default: "#ffb74d" },
      { key: "middle", label: "Middle", default: "#bdbdbd" },
      { key: "lower",  label: "Lower",  default: "#ffb74d" },
    ],
    build: (chart, _s, col) => [
      ohlcLine(chart, col.upper),
      ohlcLine(chart, col.middle, null, { lineStyle: 2 }),
      ohlcLine(chart, col.lower),
    ],
    compute: (c, p) => donchian(c, +p.period || 20),
    apply: (s, d) => { s[0].setData(d.upper); s[1].setData(d.mid); s[2].setData(d.lower); },
  },
  {
    id: "keltner", name: "Keltner Channels", category: "Bands & Channels", overlay: true,
    params: [PERIOD(20, "period"), { key: "mult", default: 2, min: 0.5, max: 5, step: 0.5 }],
    colors: [
      { key: "upper",  label: "Upper",  default: "#9ccc65" },
      { key: "middle", label: "Middle", default: "#7cb342" },
      { key: "lower",  label: "Lower",  default: "#9ccc65" },
    ],
    build: (chart, _s, col) => [
      ohlcLine(chart, col.upper),
      ohlcLine(chart, col.middle, null, { lineStyle: 2 }),
      ohlcLine(chart, col.lower),
    ],
    compute: (c, p) => keltner(c, +p.period || 20, +p.mult || 2),
    apply: (s, d) => { s[0].setData(d.upper); s[1].setData(d.mid); s[2].setData(d.lower); },
  },

  // ----- Volume-weighted -----
  {
    id: "vwap", name: "VWAP (cumulative)", category: "Volume-weighted", overlay: true,
    params: [],
    colors: oneLine("#26c6da"),
    build: (chart, _s, col) => [ohlcLine(chart, col.line, null, { lineWidth: 2 })],
    compute: (c) => vwap(c),
    apply: (s, d) => s[0].setData(d),
  },

  // ----- Trend / Levels -----
  {
    id: "psar", name: "Parabolic SAR", category: "Trend / Levels", overlay: true,
    params: [
      { key: "init", default: 0.02, min: 0.001, max: 1, step: 0.01 },
      { key: "max",  default: 0.2,  min: 0.01,  max: 1, step: 0.01 },
    ],
    colors: oneLine("#ffca28"),
    build: (chart, _s, col) => [ohlcLine(chart, col.line, null, { lineWidth: 1, lineStyle: 3 })],
    compute: (c, p) => psar(c, +p.init || 0.02, +p.max || 0.2, +p.init || 0.02),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "supertrend", name: "SuperTrend", category: "Trend / Levels", overlay: true,
    params: [PERIOD(10, "period"), { key: "mult", default: 3, min: 0.5, max: 10, step: 0.5 }],
    colors: oneLine("#26a69a"),
    build: (chart, _s, col) => [ohlcLine(chart, col.line, null, { lineWidth: 2 })],
    compute: (c, p) => supertrend(c, +p.period || 10, +p.mult || 3),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "ichimoku", name: "Ichimoku Cloud", category: "Trend / Levels", overlay: true,
    params: [
      { key: "tenkan", default: 9,  min: 2, max: 100 },
      { key: "kijun",  default: 26, min: 2, max: 200 },
      { key: "senkou", default: 52, min: 2, max: 400 },
    ],
    colors: [
      { key: "tenkan",  label: "Tenkan",   default: "#42a5f5" },
      { key: "kijun",   label: "Kijun",    default: "#ef5350" },
      { key: "senkouA", label: "Senkou A", default: "#26a69a" },
      { key: "senkouB", label: "Senkou B", default: "#ef5350" },
    ],
    build: (chart, _s, col) => [
      ohlcLine(chart, col.tenkan),
      ohlcLine(chart, col.kijun),
      ohlcLine(chart, withAlpha(col.senkouA, 0.55), null, { lineWidth: 1, lineStyle: 2 }),
      ohlcLine(chart, withAlpha(col.senkouB, 0.55), null, { lineWidth: 1, lineStyle: 2 }),
    ],
    compute: (c, p) => ichimoku(c, +p.tenkan || 9, +p.kijun || 26, +p.senkou || 52),
    apply: (s, d) => {
      s[0].setData(d.tenkan); s[1].setData(d.kijun);
      s[2].setData(d.senkouA); s[3].setData(d.senkouB);
    },
  },

  // ----- Oscillators -----
  {
    id: "rsi", name: "RSI — Relative Strength", category: "Oscillators", overlay: false,
    params: [PERIOD(14, "period")],
    colors: oneLine("#ffca28"),
    build: (chart, scaleId, col) => [ohlcLine(chart, col.line, scaleId)],
    compute: (c, p) => rsi(c, +p.period || 14),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "stoch", name: "Stochastic %K/%D", category: "Oscillators", overlay: false,
    params: [
      { key: "k", default: 14, min: 2, max: 200 },
      { key: "d", default: 3,  min: 1, max: 50 },
      { key: "smooth", default: 3, min: 1, max: 50 },
    ],
    colors: [
      { key: "k", label: "%K", default: "#42a5f5" },
      { key: "d", label: "%D", default: "#ef5350" },
    ],
    build: (chart, scaleId, col) => [ohlcLine(chart, col.k, scaleId), ohlcLine(chart, col.d, scaleId)],
    compute: (c, p) => stochastic(c, +p.k || 14, +p.d || 3, +p.smooth || 3),
    apply: (s, d) => { s[0].setData(d.k); s[1].setData(d.d); },
  },
  {
    id: "stochrsi", name: "Stochastic RSI", category: "Oscillators", overlay: false,
    params: [
      { key: "rsi", default: 14, min: 2, max: 100 },
      { key: "k",   default: 14, min: 2, max: 100 },
      { key: "d",   default: 3,  min: 1, max: 50 },
      { key: "smooth", default: 3, min: 1, max: 50 },
    ],
    colors: [
      { key: "k", label: "%K", default: "#42a5f5" },
      { key: "d", label: "%D", default: "#ef5350" },
    ],
    build: (chart, scaleId, col) => [ohlcLine(chart, col.k, scaleId), ohlcLine(chart, col.d, scaleId)],
    compute: (c, p) => stochRsi(c, +p.rsi || 14, +p.k || 14, +p.d || 3, +p.smooth || 3),
    apply: (s, d) => { s[0].setData(d.k); s[1].setData(d.d); },
  },
  {
    id: "williams", name: "Williams %R", category: "Oscillators", overlay: false,
    params: [PERIOD(14, "period")],
    colors: oneLine("#ab47bc"),
    build: (chart, scaleId, col) => [ohlcLine(chart, col.line, scaleId)],
    compute: (c, p) => williamsR(c, +p.period || 14),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "roc", name: "Rate of Change", category: "Oscillators", overlay: false,
    params: [PERIOD(12, "period")],
    colors: oneLine("#26c6da"),
    build: (chart, scaleId, col) => [ohlcLine(chart, col.line, scaleId)],
    compute: (c, p) => roc(c, +p.period || 12),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "cci", name: "CCI", category: "Oscillators", overlay: false,
    params: [PERIOD(20, "period")],
    colors: oneLine("#ffa726"),
    build: (chart, scaleId, col) => [ohlcLine(chart, col.line, scaleId)],
    compute: (c, p) => cci(c, +p.period || 20),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "ao", name: "Awesome Oscillator", category: "Oscillators", overlay: false,
    params: [],
    colors: upDn("#26a69a", "#ef5350"),
    build: (chart, scaleId) => [histSeries(chart, scaleId)],
    compute: (c, _p, col) => ao(c, withAlpha(col.up, 0.8), withAlpha(col.down, 0.8)),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "ultimate", name: "Ultimate Oscillator", category: "Oscillators", overlay: false,
    params: [
      { key: "p1", default: 7,  min: 2, max: 100 },
      { key: "p2", default: 14, min: 2, max: 200 },
      { key: "p3", default: 28, min: 2, max: 400 },
    ],
    colors: oneLine("#ec407a"),
    build: (chart, scaleId, col) => [ohlcLine(chart, col.line, scaleId)],
    compute: (c, p) => ultimate(c, +p.p1 || 7, +p.p2 || 14, +p.p3 || 28),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "trix", name: "TRIX", category: "Oscillators", overlay: false,
    params: [PERIOD(14, "period")],
    colors: oneLine("#42a5f5"),
    build: (chart, scaleId, col) => [ohlcLine(chart, col.line, scaleId)],
    compute: (c, p) => trix(c, +p.period || 14),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "dpo", name: "DPO — Detrended Price", category: "Oscillators", overlay: false,
    params: [PERIOD(20, "period")],
    colors: oneLine("#ffa726"),
    build: (chart, scaleId, col) => [ohlcLine(chart, col.line, scaleId)],
    compute: (c, p) => dpo(c, +p.period || 20),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "cmo", name: "Chande Momentum (CMO)", category: "Oscillators", overlay: false,
    params: [PERIOD(14, "period")],
    colors: oneLine("#7e57c2"),
    build: (chart, scaleId, col) => [ohlcLine(chart, col.line, scaleId)],
    compute: (c, p) => cmo(c, +p.period || 14),
    apply: (s, d) => s[0].setData(d),
  },

  // ----- Momentum / Trend Strength -----
  {
    id: "macd", name: "MACD (12, 26, 9)", category: "Momentum", overlay: false,
    params: [
      { key: "fast",   default: 12, min: 2, max: 200 },
      { key: "slow",   default: 26, min: 2, max: 400 },
      { key: "signal", default: 9,  min: 2, max: 100 },
    ],
    colors: [
      { key: "macd",     label: "MACD",     default: "#42a5f5" },
      { key: "signal",   label: "Signal",   default: "#ef5350" },
      { key: "histUp",   label: "Hist Up",   default: "#26a69a" },
      { key: "histDown", label: "Hist Dn",   default: "#ef5350" },
    ],
    build: (chart, scaleId, col) => [
      histSeries(chart, scaleId),
      ohlcLine(chart, col.macd, scaleId),
      ohlcLine(chart, col.signal, scaleId),
    ],
    compute: (c, p, col) => macd(
      c, +p.fast || 12, +p.slow || 26, +p.signal || 9,
      withAlpha(col.histUp, 0.8), withAlpha(col.histDown, 0.8),
    ),
    apply: (s, d) => { s[0].setData(d.hist); s[1].setData(d.macd); s[2].setData(d.signal); },
  },
  {
    id: "adx", name: "ADX (+DI / -DI)", category: "Momentum", overlay: false,
    params: [PERIOD(14, "period")],
    colors: [
      { key: "adx",     label: "ADX",  default: "#ffca28" },
      { key: "plusDI",  label: "+DI",  default: "#26a69a" },
      { key: "minusDI", label: "-DI",  default: "#ef5350" },
    ],
    build: (chart, scaleId, col) => [
      ohlcLine(chart, col.adx, scaleId, { lineWidth: 2 }),
      ohlcLine(chart, col.plusDI, scaleId),
      ohlcLine(chart, col.minusDI, scaleId),
    ],
    compute: (c, p) => adx(c, +p.period || 14),
    apply: (s, d) => { s[0].setData(d.adx); s[1].setData(d.plusDI); s[2].setData(d.minusDI); },
  },
  {
    id: "aroon", name: "Aroon", category: "Momentum", overlay: false,
    params: [PERIOD(14, "period")],
    colors: [
      { key: "up",   label: "Up",   default: "#26a69a" },
      { key: "down", label: "Down", default: "#ef5350" },
    ],
    build: (chart, scaleId, col) => [ohlcLine(chart, col.up, scaleId), ohlcLine(chart, col.down, scaleId)],
    compute: (c, p) => aroon(c, +p.period || 14),
    apply: (s, d) => { s[0].setData(d.up); s[1].setData(d.dn); },
  },

  // ----- Volatility -----
  {
    id: "atr", name: "ATR — Average True Range", category: "Volatility", overlay: false,
    params: [PERIOD(14, "period")],
    colors: oneLine("#ffa726"),
    build: (chart, scaleId, col) => [ohlcLine(chart, col.line, scaleId)],
    compute: (c, p) => atr(c, +p.period || 14),
    apply: (s, d) => s[0].setData(d),
  },

  // ----- Volume -----
  {
    id: "obv", name: "OBV — On-Balance Volume", category: "Volume", overlay: false,
    params: [],
    colors: oneLine("#42a5f5"),
    build: (chart, scaleId, col) => [ohlcLine(chart, col.line, scaleId)],
    compute: (c) => obv(c),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "mfi", name: "MFI — Money Flow Index", category: "Volume", overlay: false,
    params: [PERIOD(14, "period")],
    colors: oneLine("#ec407a"),
    build: (chart, scaleId, col) => [ohlcLine(chart, col.line, scaleId)],
    compute: (c, p) => mfi(c, +p.period || 14),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "cmf", name: "CMF — Chaikin Money Flow", category: "Volume", overlay: false,
    params: [PERIOD(20, "period")],
    colors: oneLine("#26c6da"),
    build: (chart, scaleId, col) => [ohlcLine(chart, col.line, scaleId)],
    compute: (c, p) => cmf(c, +p.period || 20),
    apply: (s, d) => s[0].setData(d),
  },
  {
    id: "volume", name: "Volume", category: "Volume", overlay: false,
    params: [],
    colors: upDn("#26a69a", "#ef5350"),
    build: (chart, scaleId) => [histSeries(chart, scaleId)],
    compute: (c, _p, col) => volumeBars(c, withAlpha(col.up, 0.6), withAlpha(col.down, 0.6)),
    apply: (s, d) => s[0].setData(d),
  },

  // ----- Crossover Analysis -----
  {
    id: "ma_cross",
    name: "MA Crossover — Golden / Death Cross",
    category: "Crossover",
    overlay: true,
    params: [
      { key: "fast", default: 50,  min: 2, max: 500, label: "Fast Period" },
      { key: "slow", default: 200, min: 2, max: 500, label: "Slow Period" },
      // 0 = SMA, 1 = EMA
      { key: "type", default: 0, min: 0, max: 1, step: 1, label: "Type 0=SMA 1=EMA" },
    ],
    colors: [
      { key: "fast",   label: "Fast MA",      default: "#26a69a" },
      { key: "slow",   label: "Slow MA",      default: "#ef5350" },
      { key: "golden", label: "Golden Cross", default: "#ffd700" },
      { key: "death",  label: "Death Cross",  default: "#ff4422" },
    ],
    build: (chart, _s, col) => [
      ohlcLine(chart, col.fast, 0, { lineWidth: 2 }),
      ohlcLine(chart, col.slow, 0, { lineWidth: 2, lineStyle: 2 }),
    ],
    compute: (c, p, col) => {
      const fp = Math.max(2, +p.fast || 50);
      const sp = Math.max(2, +p.slow || 200);
      const fn = +p.type === 1 ? ema : sma;
      const fastData = fn(c, fp);
      const slowData = fn(c, sp);
      const fastMap = new Map(fastData.map((pt) => [pt.time, pt.value]));
      const markers = [];
      let prevF = null, prevS = null;
      for (const sd of slowData) {
        const f = fastMap.get(sd.time);
        if (f !== undefined) {
          if (prevF !== null) {
            if (prevF <= prevS && f > sd.value) {
              markers.push({
                time: sd.time, position: "belowBar",
                color: col.golden, shape: "arrowUp", text: "Golden",
              });
            } else if (prevF >= prevS && f < sd.value) {
              markers.push({
                time: sd.time, position: "aboveBar",
                color: col.death, shape: "arrowDown", text: "Death",
              });
            }
          }
          prevF = f;
          prevS = sd.value;
        }
      }
      return { fast: fastData, slow: slowData, markers };
    },
    apply: (s, d) => {
      s[0].setData(d.fast);
      s[1].setData(d.slow);
      s[0].setMarkers(d.markers);
    },
  },
];

export { DEFS };
