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
      const sign  = f.z >= 0 ? "+" : "";
      const color = f.z >= 0 ? "var(--up)" : "var(--down)";

      const nameEl = document.createElement("span");
      nameEl.className = "factor-name";
      nameEl.textContent = f.name;

      const barEl = document.createElement("div");
      barEl.className = "factor-bar";
      const zeroEl = document.createElement("div");
      zeroEl.className = "factor-bar-zero";
      const fillEl = document.createElement("div");
      fillEl.className = "factor-bar-fill";
      fillEl.style.left       = f.z >= 0 ? "50%" : `${50 + f.z * 25}%`;
      fillEl.style.width      = `${Math.abs(f.z) * 25}%`;
      fillEl.style.background = color;
      barEl.append(zeroEl, fillEl);

      const zEl = document.createElement("span");
      zEl.className = "factor-z";
      zEl.style.color = color;
      zEl.textContent = `${sign}${f.z.toFixed(2)}σ`;

      row.append(nameEl, barEl, zEl);
      wrap.appendChild(row);
    }
  } catch {
    wrap.innerHTML = '<div class="card-empty">Factors unavailable.</div>';
  }
}
