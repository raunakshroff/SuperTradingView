// Factor pulse panel: fetch /factors and render z-score bars.

import { fetchJSON } from "./rail.js";

export async function loadFactors() {
  const wrap = document.getElementById("factor-list");
  if (!wrap) return;
  try {
    const data  = await fetchJSON("/factors");
    const items = data.factors || [];
    if (items.length === 0) {
      wrap.innerHTML = '<div class="card-empty">No factor data.</div>';
      return;
    }
    wrap.innerHTML = "";
    for (const f of items) {
      const row  = document.createElement("div");
      row.className = "factor-row";
      const sign      = f.z >= 0 ? "+" : "";
      const color     = f.z >= 0 ? "var(--up)" : "var(--down)";
      const fillLeft  = f.z >= 0 ? "50%" : `${50 + f.z * 25}%`;
      const fillWidth = `${Math.abs(f.z) * 25}%`;
      row.innerHTML = `
        <span class="factor-name">${f.name}</span>
        <div class="factor-bar">
          <div class="factor-bar-zero"></div>
          <div class="factor-bar-fill" style="left:${fillLeft};width:${fillWidth};background:${color};"></div>
        </div>
        <span class="factor-z" style="color:${color}">${sign}${f.z.toFixed(2)}σ</span>
      `;
      wrap.appendChild(row);
    }
  } catch {
    wrap.innerHTML = '<div class="card-empty">Factors unavailable.</div>';
  }
}
