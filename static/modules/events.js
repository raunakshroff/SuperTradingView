// Upcoming events panel: fetch /events?symbols=... and render.

import { fetchJSON } from "./rail.js";
import { panes }     from "./grid.js";

function paneSymbolsList() {
  return panes.map((p) => p && p.state && p.state.symbol).filter(Boolean);
}

export async function loadEvents() {
  const wrap = document.getElementById("events-list");
  if (!wrap) return;
  try {
    const syms  = paneSymbolsList().join(",");
    const data  = await fetchJSON(`/events?symbols=${encodeURIComponent(syms)}`);
    const items = data.events || [];
    if (items.length === 0) {
      wrap.innerHTML = '<div class="card-empty">No upcoming events.</div>';
      return;
    }
    wrap.innerHTML = "";
    for (const e of items) {
      const row   = document.createElement("div");
      row.className = "event-row";

      const whenEl = document.createElement("span");
      whenEl.className   = "event-when";
      whenEl.textContent = e.when;

      const dotEl  = document.createElement("span");
      const toneClass = e.tone === "acid" ? "acid" : e.tone === "warn" ? "warn" : "";
      dotEl.className = "event-dot" + (toneClass ? " " + toneClass : "");

      const labelEl = document.createElement("span");
      labelEl.className   = "event-label";
      labelEl.textContent = e.label;

      row.appendChild(whenEl);
      row.appendChild(dotEl);
      row.appendChild(labelEl);
      wrap.appendChild(row);
    }
  } catch {
    wrap.innerHTML = '<div class="card-empty">Events unavailable.</div>';
  }
}
