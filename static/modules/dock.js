// Bottom dock: market breadth (ADV/DEC/VIX/US10Y) and factor tilt.

import { fetchJSON } from "./rail.js";

export async function loadBreadth() {
  try {
    const data = await fetchJSON("/quote/breadth");
    const adv  = document.getElementById("dock-adv");
    const dec  = document.getElementById("dock-dec");
    const vix  = document.getElementById("dock-vix");
    const tnx  = document.getElementById("dock-tnx");
    if (adv) adv.textContent = data.adv ?? "—";
    if (dec) dec.textContent = data.dec ?? "—";
    if (vix) vix.textContent = data.vix  != null ? data.vix.toFixed(2)  : "—";
    if (tnx) tnx.textContent = data.us10y != null ? data.us10y.toFixed(3) + "%" : "—%";
  } catch {}
}

export async function refreshDockTilt() {
  try {
    const data    = await fetchJSON("/factors");
    const factors = data.factors || [];
    if (factors.length === 0) return;
    const top = factors.slice().sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
    const el  = document.getElementById("dock-tilt");
    if (el && top) {
      const sign = top.z >= 0 ? "+" : "";
      el.textContent = `${top.name.toLowerCase()} ${sign}${top.z.toFixed(2)}σ`;
    }
  } catch {}
}
