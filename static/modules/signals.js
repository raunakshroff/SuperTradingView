// Live signals panel: fetch /signals and render with side badge + sigma.

import { fetchJSON } from "./rail.js";

export async function loadSignals() {
  const wrap    = document.getElementById("signals-list");
  const countEl = document.getElementById("signals-count");
  if (!wrap) return;
  try {
    const data  = await fetchJSON("/signals");
    const items = data.signals || [];
    if (countEl) countEl.textContent = `${items.length} active`;
    if (items.length === 0) {
      wrap.innerHTML = '<div class="card-empty">No active signals.</div>';
      return;
    }
    wrap.innerHTML = "";
    for (const s of items) {
      const row  = document.createElement("div");
      row.className = "signal-row";

      const sig      = s.sigma >= 0 ? `+${s.sigma.toFixed(1)}σ` : `${s.sigma.toFixed(1)}σ`;
      const sigColor = s.sigma >= 0 ? "var(--up)" : "var(--down)";

      const sideEl = document.createElement("span");
      sideEl.className   = "signal-side " + (s.side === "long" ? "long" : "short");
      sideEl.textContent = s.side.toUpperCase();

      const bodyEl = document.createElement("div");
      bodyEl.className   = "signal-body";
      const symEl  = document.createElement("div");
      symEl.className    = "signal-sym";
      symEl.textContent  = s.symbol;
      const msgEl  = document.createElement("div");
      msgEl.className    = "signal-msg";
      msgEl.textContent  = s.message;
      bodyEl.appendChild(symEl);
      bodyEl.appendChild(msgEl);

      const sigmaEl = document.createElement("span");
      sigmaEl.className      = "signal-sigma";
      sigmaEl.style.color    = sigColor;
      sigmaEl.textContent    = sig;

      row.appendChild(sideEl);
      row.appendChild(bodyEl);
      row.appendChild(sigmaEl);
      wrap.appendChild(row);
    }
  } catch {
    wrap.innerHTML = '<div class="card-empty">Signals unavailable.</div>';
  }
}
