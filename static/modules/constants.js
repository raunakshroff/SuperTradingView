// Layout presets, localStorage keys, and shared utilities.

export const LAYOUTS = [
  { id: 1, n: 1, label: "1 up",  cols: "1fr",             rows: "1fr",     areas: '"a"' },
  { id: 2, n: 2, label: "2 H",   cols: "1fr 1fr",         rows: "1fr",     areas: '"a b"' },
  { id: 3, n: 2, label: "2 V",   cols: "1fr",             rows: "1fr 1fr", areas: '"a" "b"' },
  { id: 4, n: 3, label: "1+2",   cols: "2fr 1fr",         rows: "1fr 1fr", areas: '"a b" "a c"' },
  { id: 5, n: 4, label: "2×2",   cols: "1fr 1fr",         rows: "1fr 1fr", areas: '"a b" "c d"' },
  { id: 6, n: 6, label: "3×2",   cols: "1fr 1fr 1fr",     rows: "1fr 1fr", areas: '"a b c" "d e f"' },
  { id: 7, n: 8, label: "4×2",   cols: "1fr 1fr 1fr 1fr", rows: "1fr 1fr", areas: '"a b c d" "e f g h"' },
];

export const AREA_KEYS = ["a", "b", "c", "d", "e", "f", "g", "h"];

export const DEFAULT_PANES = [
  { source: "hyperliquid", symbol: "BTC",         tf: "1m", indicators: {} },
  { source: "hyperliquid", symbol: "ETH",         tf: "1m", indicators: {} },
  { source: "hyperliquid", symbol: "SOL",         tf: "1m", indicators: {} },
  { source: "yfinance",    symbol: "RELIANCE.NS", tf: "1m", indicators: {} },
  { source: "hyperliquid", symbol: "HYPE",        tf: "1m", indicators: {} },
  { source: "yfinance",    symbol: "TCS.NS",      tf: "1m", indicators: {} },
  { source: "hyperliquid", symbol: "DOGE",        tf: "1m", indicators: {} },
  { source: "yfinance",    symbol: "INFY.NS",     tf: "1m", indicators: {} },
];

export const LS_COUNT     = "stv.chartCount";
export const LS_PANES     = "stv.panes";
export const LS_LAYOUT_ID = "stv.layoutId";

// Returns the base indicator def-id from an instance key.
// "sma"        → "sma"   (single instance uses bare id for backward compat)
// "sma~123456" → "sma"   (additional instances append ~<timestamp>)
export function defIdOf(key) {
  const i = key.indexOf("~");
  return i < 0 ? key : key.slice(0, i);
}
