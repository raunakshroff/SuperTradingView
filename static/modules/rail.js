// Right-rail narratives card: chips, symbol list with sparklines, 5-min cache.

import { panes } from "./grid.js";

export async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

const RAIL_STATE = {
  narratives:      [],
  activeNarrative: null,
  histCache:       new Map(),
};

export async function loadNarratives() {
  try {
    const data = await fetchJSON("/narratives");
    RAIL_STATE.narratives = data.narratives || [];
    if (RAIL_STATE.narratives.length > 0 && !RAIL_STATE.activeNarrative) {
      RAIL_STATE.activeNarrative = RAIL_STATE.narratives[0].id;
    }
    renderNarrativesChips();
    renderNarrativesList();
  } catch (e) {
    console.warn("narratives load failed", e);
  }
}

function renderNarrativesChips() {
  const wrap = document.getElementById("narratives-chips");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (const n of RAIL_STATE.narratives) {
    const b = document.createElement("button");
    b.type      = "button";
    b.className = "chip" + (n.id === RAIL_STATE.activeNarrative ? " on" : "");
    b.textContent = n.title;
    b.addEventListener("click", () => {
      RAIL_STATE.activeNarrative = n.id;
      renderNarrativesChips();
      renderNarrativesList();
    });
    wrap.appendChild(b);
  }
}

export async function getHistoryCached(source, symbol, tf = "1D") {
  const key = `${source}|${symbol}|${tf}`;
  const hit  = RAIL_STATE.histCache.get(key);
  if (hit && Date.now() - hit.ts < 5 * 60 * 1000) return hit.candles;
  try {
    const candles = await fetchJSON(
      `/history?source=${encodeURIComponent(source)}&symbol=${encodeURIComponent(symbol)}&tf=${tf}&limit=60`
    );
    RAIL_STATE.histCache.set(key, { ts: Date.now(), candles });
    return candles;
  } catch {
    return [];
  }
}

function sparkSVG(series, up, w = 80, h = 22) {
  if (!series || series.length < 2) return "";
  const lo = Math.min(...series), hi = Math.max(...series);
  const rng = (hi - lo) || 1;
  const pts = series.map((v, i) => [
    (i / (series.length - 1)) * w,
    h - 2 - ((v - lo) / rng) * (h - 4),
  ]);
  const d   = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const col = up ? "var(--up)" : "var(--down)";
  return `<svg width="${w}" height="${h}"><path d="${d}" fill="none" stroke="${col}" stroke-width="1.2" stroke-linejoin="round"/><path d="${d} L${w} ${h} L0 ${h} Z" fill="${col}" opacity="0.12"/></svg>`;
}

async function renderNarrativesList() {
  const wrap = document.getElementById("narratives-list");
  if (!wrap) return;
  const narr = RAIL_STATE.narratives.find((n) => n.id === RAIL_STATE.activeNarrative);
  if (!narr) { wrap.innerHTML = '<div class="card-empty">No narratives.</div>'; return; }
  wrap.innerHTML = '<div class="card-empty">Loading…</div>';
  const rows = await Promise.all(narr.symbols.map(async (s) => {
    const candles = await getHistoryCached(s.source, s.symbol, "1D");
    if (candles.length < 2) return { sym: s.symbol, source: s.source, last: null, chg: 0, closes: [] };
    const closes = candles.map((c) => c.c);
    const last   = closes[closes.length - 1];
    const prev   = closes[closes.length - 2];
    const chg    = prev ? ((last - prev) / prev) * 100 : 0;
    return { sym: s.symbol, source: s.source, last, chg, closes };
  }));
  wrap.innerHTML = "";
  for (const row of rows) {
    const btn     = document.createElement("button");
    btn.type      = "button";
    btn.className = "narrative-row";
    const chgCls  = row.chg >= 0 ? "up" : "down";
    btn.innerHTML = `
      <span class="narrative-sym">${row.sym}</span>
      <span class="narrative-spark">${sparkSVG(row.closes.slice(-40), row.chg >= 0)}</span>
      <span class="narrative-price">${row.last != null ? row.last.toFixed(2) : "—"}</span>
      <span class="narrative-chg ${chgCls}">${row.chg >= 0 ? "+" : ""}${row.chg.toFixed(2)}%</span>
    `;
    btn.addEventListener("click", () => {
      if (panes[0] && panes[0].symbolInput) {
        panes[0].symbolInput.value = row.sym;
        panes[0].symbolInput.dispatchEvent(new Event("change"));
      }
    });
    wrap.appendChild(btn);
  }
}
