// AI Copilot insight panel: deterministic regime detection, no LLM.

import { getHistoryCached } from "./rail.js";
import { panes }            from "./grid.js";
import { showToast }        from "./topbar.js";

function _stdev(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

function _logReturns(closes, n) {
  const out = [];
  for (let i = closes.length - n; i < closes.length; i++) {
    if (i <= 0 || closes[i - 1] === 0) continue;
    out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}

// end is inclusive index into closes (default: last element)
function _rsiLast(closes, period = 14, end = closes.length - 1) {
  if (end < period) return null;
  let gains = 0, losses = 0;
  for (let i = end - period + 1; i <= end; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  const avgG = gains / period;
  const avgL = losses / period;
  if (avgL === 0 && avgG === 0) return null;
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

// O(n) rolling SMA — avoids repeated slice+sum inside loops
function _sma200Series(closes) {
  const result = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= 200) sum -= closes[i - 200];
    result[i] = sum / Math.min(i + 1, 200);
  }
  return result;
}

function _hiddenBullDiv(closes, rsis) {
  if (closes.length < 20 || rsis.length < 20) return false;
  const idxByPriceAsc = [...Array(20).keys()].sort(
    (a, b) => closes[closes.length - 20 + a] - closes[closes.length - 20 + b]
  );
  const lows = idxByPriceAsc.slice(0, 2).sort((a, b) => a - b);
  if (lows.length !== 2) return false;
  const pLows = lows.map((i) => closes[closes.length - 20 + i]);
  const rLows = lows.map((i) => rsis[rsis.length - 20 + i]);
  if (rLows.some((r) => r == null)) return false;
  return pLows[1] > pLows[0] && rLows[1] < rLows[0];
}

function _renderInsight(symbol, candles) {
  const symEl     = document.getElementById("ai-symbol");
  const askSymEl  = document.getElementById("ai-ask-symbol");
  const bodyEl    = document.getElementById("ai-body");
  const metricsEl = document.getElementById("ai-metrics");
  if (symEl)    symEl.textContent    = symbol;
  if (askSymEl) askSymEl.textContent = symbol;
  if (!candles || candles.length < 30) {
    if (bodyEl)    bodyEl.textContent    = "Not enough data yet.";
    if (metricsEl) metricsEl.innerHTML   = "";
    return;
  }

  const closes  = candles.map((c) => c.c);
  const last    = closes[closes.length - 1];
  const smaSer  = _sma200Series(closes);
  const sma200  = smaSer[closes.length - 1];
  const bullish = sma200 != null && last > sma200;

  const rets5   = _logReturns(closes, 5);
  const rets60  = _logReturns(closes, 60);
  const vol5    = _stdev(rets5);
  const vol60   = _stdev(rets60);
  const volCluster = vol5 > vol60 * 1.5;

  const rsi14 = [];
  for (let i = 14; i < closes.length; i++) rsi14.push(_rsiLast(closes, 14, i));
  const hiddenBull = _hiddenBullDiv(closes, rsi14);

  const demandReclaim = last * 0.985;
  const high20        = Math.max(...closes.slice(-20));
  const impliedSigma  = (vol60 || 0) * 100;

  let similar = 0, wins = 0;
  if (sma200 != null) {
    const curBucket = Math.floor((rsi14[rsi14.length - 1] || 50) / 10);
    const curMaSign = last > sma200 ? 1 : -1;
    for (let i = 14; i < closes.length - 5; i++) {
      const rs = rsi14[i - 14];
      const ma = smaSer[i];
      if (rs == null || ma == null) continue;
      const b = Math.floor(rs / 10);
      const s = closes[i] > ma ? 1 : -1;
      if (b === curBucket && s === curMaSign) {
        similar++;
        if (closes[i + 5] > closes[i]) wins++;
      }
    }
  }
  const winRate = similar > 0 ? Math.round((wins / similar) * 100) : 0;

  let obv = 0;
  const obvSeries = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += 1;
    else if (closes[i] < closes[i - 1]) obv -= 1;
    obvSeries.push(obv);
  }
  const obv20  = obvSeries.slice(-20);
  const obvUp  = obv20.length >= 2 && obv20[obv20.length - 1] > obv20[0];

  if (bodyEl) {
    bodyEl.innerHTML = `
      Regime: <span class="ai-strong">${bullish ? "bullish" : "bearish"}${volCluster ? " · vol-cluster active" : ""}</span>.
      ${hiddenBull ? 'Hidden divergence on 4H RSI vs. price · ' : ''}watch
      <span class="mono ai-strong">${demandReclaim.toFixed(2)}</span> as first demand reclaim.
    `;
  }
  if (metricsEl) {
    const rows = [
      { k: "Similar setups",    v: similar > 0 ? `${similar} historical · ${winRate}% win` : "n/a" },
      { k: "Liquidity above",   v: high20.toFixed(2) },
      { k: "Implied σ (1D)",    v: `±${impliedSigma.toFixed(2)}%` },
      { k: "Institutional flow", v: obvUp ? "Accumulating" : "Distributing", tone: obvUp ? "up" : "down" },
    ];
    metricsEl.innerHTML = rows.map((r) => `
      <div class="ai-metric">
        <span class="ai-metric-k">${r.k}</span>
        <span class="ai-metric-v" ${r.tone ? `style="color:var(--${r.tone})"` : ""}>${r.v}</span>
      </div>
    `).join("");
  }
}

export async function refreshAIInsight() {
  if (!panes[0] || !panes[0].state) return;
  const { source, symbol } = panes[0].state;
  const candles = await getHistoryCached(source, symbol, "1D");
  _renderInsight(symbol, candles);
}

export function bindAIInsight() {
  document.getElementById("ai-ask")?.addEventListener("click", () => showToast("Copilot coming soon"));
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
      e.preventDefault();
      showToast("Copilot coming soon");
    }
  });
}
