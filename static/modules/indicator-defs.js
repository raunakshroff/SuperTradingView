// DEFS array: one entry per indicator, wires math to chart series.

import { withAlpha, ohlcLine, markerLine, histSeries,
         sma, ema, wma, hma, dema, tema,
         bbands, donchian, keltner, vwap,
         psar, supertrend, ichimoku,
         rsi, stochastic, stochRsi, williamsR, roc, cci,
         ao, ultimate, trix, dpo, cmo,
         macd, adx, aroon, atr, obv, mfi, cmf, volumeBars,
         chartPatterns }
  from "./indicator-math.js";

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

export const DEFS = [
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
      { key: "type", default: 0, min: 0, max: 1, step: 1, label: "Type 0=SMA 1=EMA" },
    ],
    colors: [
      { key: "fast",   label: "Fast MA",      default: "#26a69a" },
      { key: "slow",   label: "Slow MA",      default: "#ef5350" },
      { key: "golden", label: "Golden Cross", default: "#ffd700" },
      { key: "death",  label: "Death Cross",  default: "#ff4422" },
    ],
    build: (chart, _s, col) => [
      markerLine(chart, col.fast, 0, { lineWidth: 2 }),
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
      s[0]._markers.setMarkers(d.markers);
    },
  },

  // ----- Pattern Recognition -----
  {
    id: "chartpatterns",
    name: "Chart Patterns",
    category: "Pattern Recognition",
    overlay: true,
    params: [
      { key: "lookback", default: 200, min: 50,  max: 500, label: "Lookback Bars" },
      { key: "strength", default: 5,   min: 2,   max: 20,  label: "Pivot Strength" },
      { key: "tol",      default: 4,   min: 1,   max: 15,  step: 1, label: "Tolerance %" },
    ],
    colors: [
      { key: "bullish", label: "Bullish",  default: "#26a69a" },
      { key: "bearish", label: "Bearish",  default: "#ef5350" },
      { key: "line",    label: "Ref Line", default: "#888888" },
    ],
    build: (chart, _s, col) => [
      markerLine(chart, withAlpha(col.line, 0.15), 0, { lineWidth: 1 }),
    ],
    compute: (c, p, col) => chartPatterns(
      c,
      +p.lookback || 200,
      +p.strength  || 5,
      (+p.tol      || 4) / 100,
      col.bullish,
      col.bearish,
    ),
    apply: (s, d) => {
      s[0].setData(d.data);
      s[0]._markers.setMarkers(d.markers);
    },
  },
];
