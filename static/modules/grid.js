// Multi-pane grid: layout, state persistence, pane lifecycle.

import { Pane }                                       from "./pane.js";
import { openIndicatorsModal }                        from "./indicators-modal.js";
import { LAYOUTS, AREA_KEYS, DEFAULT_PANES, LS_COUNT, LS_PANES, LS_LAYOUT_ID } from "./constants.js";

const gridEl = document.getElementById("grid");
let currentLayoutId = 5;
export const panes      = [];
export const paneStates = [];

export function getCurrentLayoutId() { return currentLayoutId; }

// --- State persistence ------------------------------------------------------

export function loadState() {
  let states;
  try { states = JSON.parse(localStorage.getItem(LS_PANES) || "null"); }
  catch { states = null; }
  if (!Array.isArray(states)) states = [];
  while (states.length < 8) states.push({ ...DEFAULT_PANES[states.length] });
  for (let i = 0; i < states.length; i++) {
    if (!states[i].indicators || typeof states[i].indicators !== "object") {
      states[i].indicators = {};
    }
  }
  return { states };
}

export function saveState() {
  for (let i = 0; i < panes.length; i++) paneStates[i] = panes[i].state;
  localStorage.setItem(LS_PANES, JSON.stringify(paneStates));
  localStorage.setItem(LS_LAYOUT_ID, String(currentLayoutId));
}

// --- Layout helpers ---------------------------------------------------------

export function getLayout(id) {
  return LAYOUTS.find((l) => l.id === id) || LAYOUTS[4];
}

export function applyLayout(layoutId) {
  const layout = getLayout(layoutId);
  gridEl.style.display             = "grid";
  gridEl.style.gridTemplateColumns = layout.cols;
  gridEl.style.gridTemplateRows    = layout.rows;
  gridEl.style.gridTemplateAreas  = layout.areas;
  gridEl.style.gap                 = "10px";
}

export function buildPanes(layoutId) {
  const layout = getLayout(layoutId);
  for (const p of panes) p.destroy();
  panes.splice(0, panes.length);  // clear in-place (panes is a shared const)
  gridEl.innerHTML = "";
  for (let i = 0; i < layout.n; i++) {
    const state = paneStates[i] || { ...DEFAULT_PANES[i % DEFAULT_PANES.length] };
    const pane  = new Pane(i, gridEl, state, {
      onStateChange: saveState,
      onOpenModal:   openIndicatorsModal,
    });
    if (pane.root) pane.root.style.gridArea = AREA_KEYS[i];
    panes.push(pane);
  }
  requestAnimationFrame(() => { for (const p of panes) p.resize(); });
}

export function layoutIconSVG(layout, size = 14) {
  const colSizes = layout.cols.split(" ").map((c) => parseFloat(c) || 1);
  const rowSizes = layout.rows.split(" ").map((r) => parseFloat(r) || 1);
  const cSum = colSizes.reduce((a, b) => a + b, 0);
  const rSum = rowSizes.reduce((a, b) => a + b, 0);
  const totW = 12, totH = 12;
  const cellW = colSizes.map((c) => (c / cSum) * totW);
  const cellH = rowSizes.map((r) => (r / rSum) * totH);
  const gridStr = layout.areas.replace(/"/g, " ").replace(/\s+/g, " ").trim().split(" ");
  const nCols = colSizes.length;
  const seen  = {};
  const rects = [];
  gridStr.forEach((name) => {
    if (seen[name]) return; seen[name] = true;
    let rMin = 99, rMax = -1, cMin = 99, cMax = -1;
    gridStr.forEach((n2, j) => {
      if (n2 !== name) return;
      const rr = Math.floor(j / nCols), cc = j % nCols;
      if (rr < rMin) rMin = rr; if (rr > rMax) rMax = rr;
      if (cc < cMin) cMin = cc; if (cc > cMax) cMax = cc;
    });
    let x = 1, y = 1;
    for (let i = 0; i < cMin; i++) x += cellW[i];
    for (let i = 0; i < rMin; i++) y += cellH[i];
    let w = 0; for (let i = cMin; i <= cMax; i++) w += cellW[i];
    let h = 0; for (let i = rMin; i <= rMax; i++) h += cellH[i];
    rects.push(`<rect x="${(x + 0.5).toFixed(2)}" y="${(y + 0.5).toFixed(2)}" width="${(w - 1).toFixed(2)}" height="${(h - 1).toFixed(2)}" rx="1" fill="currentColor" fill-opacity="0.7"/>`);
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 14 14"><rect x="0.5" y="0.5" width="13" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-opacity="0.4"/>${rects.join("")}</svg>`;
}

export function migrateLayoutState() {
  const newKey = localStorage.getItem(LS_LAYOUT_ID);
  if (newKey != null) {
    const id = parseInt(newKey, 10);
    return getLayout(id).id;
  }
  const legacy = parseInt(localStorage.getItem(LS_COUNT) || "4", 10);
  const map = { 1: 1, 2: 2, 4: 5, 6: 6, 8: 7 };
  const id  = map[legacy] || 5;
  localStorage.setItem(LS_LAYOUT_ID, String(id));
  return id;
}

export function setLayoutId(id, persist = true) {
  const layout = getLayout(id);
  currentLayoutId = layout.id;
  applyLayout(currentLayoutId);
  buildPanes(currentLayoutId);
  if (persist) {
    localStorage.setItem(LS_LAYOUT_ID, String(currentLayoutId));
    saveState();
  }
  refreshLayoutTrigger();
  refreshLayoutPopover();
}

// Initialises grid from persisted state. Called once at app boot.
export function bootGrid() {
  const { states } = loadState();
  // Mutate the exported const arrays in-place so all importers share the same refs.
  paneStates.splice(0, paneStates.length, ...states);
  currentLayoutId = migrateLayoutState();
  applyLayout(currentLayoutId);
  buildPanes(currentLayoutId);
  refreshLayoutTrigger();
  refreshLayoutPopover();
  bindLayoutPopover();
}

// --- Layout popover UI ------------------------------------------------------

export function refreshLayoutTrigger() {
  const layout  = getLayout(currentLayoutId);
  const iconEl  = document.getElementById("layout-trigger-icon");
  const countEl = document.getElementById("layout-trigger-count");
  if (iconEl)  iconEl.innerHTML   = layoutIconSVG(layout, 14);
  if (countEl) countEl.textContent = String(layout.n);
}

export function refreshLayoutPopover() {
  const grid = document.getElementById("layout-popover-grid");
  if (!grid) return;
  grid.innerHTML = "";
  for (const l of LAYOUTS) {
    const btn = document.createElement("button");
    btn.type      = "button";
    btn.className = "layout-preset" + (l.id === currentLayoutId ? " on" : "");
    btn.title     = l.label;
    btn.dataset.id = String(l.id);
    btn.innerHTML  = `${layoutIconSVG(l, 22)}<span class="layout-preset-count mono tnum">${l.n}</span>`;
    btn.addEventListener("click", () => { setLayoutId(l.id); closeLayoutPopover(); });
    grid.appendChild(btn);
  }
}

function openLayoutPopover() {
  const pop  = document.getElementById("layout-popover");
  const trig = document.getElementById("layout-trigger");
  if (pop)  pop.hidden = false;
  if (trig) trig.setAttribute("aria-expanded", "true");
}
function closeLayoutPopover() {
  const pop  = document.getElementById("layout-popover");
  if (pop) pop.hidden = true;
  const trig = document.getElementById("layout-trigger");
  if (trig) trig.setAttribute("aria-expanded", "false");
}

export function bindLayoutPopover() {
  const trig = document.getElementById("layout-trigger");
  if (trig) {
    trig.addEventListener("click", (e) => {
      e.stopPropagation();
      const pop  = document.getElementById("layout-popover");
      const open = pop && pop.hidden === false;
      if (open) closeLayoutPopover(); else openLayoutPopover();
    });
  }
  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("layout-popover-wrap");
    if (wrap && !wrap.contains(e.target)) closeLayoutPopover();
  });
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 7) { e.preventDefault(); setLayoutId(n); }
  });
}

window.addEventListener("resize", () => { for (const p of panes) p.resize(); });
