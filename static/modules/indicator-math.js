// Pure indicator math functions + Lightweight Charts series builder helpers.

import { withAlpha } from "../utils.js";

export { withAlpha };

export function trueRange(c, prevClose) {
  return Math.max(
    c.high - c.low,
    Math.abs(c.high - prevClose),
    Math.abs(c.low - prevClose)
  );
}

export function atrSeriesRaw(candles, period) {
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

export function smaSeries(points, period) {
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

export function emaSeries(points, period) {
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

export function ohlcLine(chart, color, paneIndex, extra) {
  return chart.addSeries(LightweightCharts.LineSeries, lineOpts(color, extra), paneIndex || 0);
}

export function histSeries(chart, paneIndex, extra) {
  return chart.addSeries(LightweightCharts.HistogramSeries,
    Object.assign({ priceLineVisible: false }, extra || {}),
    paneIndex || 0);
}

export function sma(candles, period) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

export function ema(candles, period) {
  return emaSeries(candles.map((c) => ({ time: c.time, value: c.close })), period);
}

export function wma(candles, period) {
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

export function wmaOfPoints(points, period) {
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

export function hma(candles, period) {
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

export function dema(candles, period) {
  const e1 = ema(candles, period);
  const e2 = emaSeries(e1, period);
  const e1Map = new Map(e1.map((p) => [p.time, p.value]));
  return e2.map((p) => ({ time: p.time, value: 2 * e1Map.get(p.time) - p.value }));
}

export function tema(candles, period) {
  const e1 = ema(candles, period);
  const e2 = emaSeries(e1, period);
  const e3 = emaSeries(e2, period);
  const e1m = new Map(e1.map((p) => [p.time, p.value]));
  const e2m = new Map(e2.map((p) => [p.time, p.value]));
  return e3.map((p) => ({ time: p.time, value: 3 * e1m.get(p.time) - 3 * e2m.get(p.time) + p.value }));
}

export function bbands(candles, period, mult) {
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

export function donchian(candles, period) {
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

export function keltner(candles, period, mult) {
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

export function vwap(candles) {
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

export function psar(candles, accInit, accMax, accStep) {
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
        isUp = false; nextSar = ep; ep = c.low; af = accInit;
      } else if (c.high > ep) {
        ep = c.high; af = Math.min(af + accStep, accMax);
      }
    } else {
      nextSar = Math.max(nextSar, candles[i - 1].high, candles[i - 2].high);
      if (c.high > nextSar) {
        isUp = true; nextSar = ep; ep = c.high; af = accInit;
      } else if (c.low < ep) {
        ep = c.low; af = Math.min(af + accStep, accMax);
      }
    }
    sar = nextSar;
    out.push({ time: c.time, value: sar });
  }
  return out;
}

export function supertrend(candles, period, mult) {
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

export function ichimoku(candles, tP, kP, bP) {
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

export function rsi(candles, period) {
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

export function stochastic(candles, kP, dP, smooth) {
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

export function stochRsi(candles, rsiP, kP, dP, smooth) {
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

export function williamsR(candles, period) {
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

export function roc(candles, period) {
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

export function cci(candles, period) {
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

export function ao(candles, upColor, dnColor) {
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

export function ultimate(candles, p1, p2, p3) {
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

export function trix(candles, period) {
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

export function dpo(candles, period) {
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

export function cmo(candles, period) {
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

export function macd(candles, fast, slow, signal, histUpColor, histDnColor) {
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

export function adx(candles, period) {
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

export function aroon(candles, period) {
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

export function atr(candles, period) { return atrSeriesRaw(candles, period); }

export function obv(candles) {
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

export function mfi(candles, period) {
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

export function cmf(candles, period) {
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

export function volumeBars(candles, upColor, dnColor) {
  return candles.map((c) => ({
    time: c.time,
    value: c.volume || 0,
    color: c.close >= c.open ? upColor : dnColor,
  }));
}
