// Command palette (⌘K): market search with keyboard navigation.

import { fetchJSON }      from "./rail.js";
import { registerSymbols } from "./symbols.js";
import { panes }          from "./grid.js";

const CMD_PALETTE = {
  results:       [],
  active:        0,
  queryToken:    0,
  debounceTimer: null,
};

export function openCmdPalette() {
  const pal   = document.getElementById("cmd-palette");
  const input = document.getElementById("cmd-palette-input");
  if (!pal || !input) return;
  pal.hidden = false;
  input.value = "";
  cmdPaletteSearch("");
  requestAnimationFrame(() => input.focus());
}

function closeCmdPalette() {
  const pal = document.getElementById("cmd-palette");
  if (pal) pal.hidden = true;
}

async function cmdPaletteSearch(q) {
  const list = document.getElementById("cmd-palette-list");
  if (!list) return;
  const token = ++CMD_PALETTE.queryToken;
  try {
    const url  = q.trim() ? `/symbols?q=${encodeURIComponent(q.trim())}` : `/symbols`;
    const data = await fetchJSON(url);
    if (token !== CMD_PALETTE.queryToken) return;
    const syms = (data.symbols || []).slice(0, 50);
    CMD_PALETTE.results = syms;
    CMD_PALETTE.active  = 0;
    renderCmdPaletteResults();
  } catch {
    list.innerHTML = '<div class="cmd-palette-empty">Search failed.</div>';
  }
}

function renderCmdPaletteResults() {
  const list = document.getElementById("cmd-palette-list");
  if (!list) return;
  list.innerHTML = "";
  if (CMD_PALETTE.results.length === 0) {
    list.innerHTML = '<div class="cmd-palette-empty">No results.</div>';
    return;
  }
  CMD_PALETTE.results.forEach((s, i) => {
    const btn = document.createElement("button");
    btn.type      = "button";
    btn.className = "cmd-palette-row" + (i === CMD_PALETTE.active ? " active" : "");
    btn.dataset.idx = String(i);

    const sym = document.createElement("span");
    sym.className   = "cmd-palette-sym";
    sym.textContent = s.symbol;

    const lbl = document.createElement("span");
    lbl.className   = "cmd-palette-label";
    lbl.textContent = s.label || "";

    const src = document.createElement("span");
    src.className   = "cmd-palette-source";
    src.textContent = s.source || s.asset_class || "";

    btn.appendChild(sym);
    btn.appendChild(lbl);
    btn.appendChild(src);
    btn.addEventListener("click", () => pickCmdPaletteResult(i));
    list.appendChild(btn);
  });
}

function pickCmdPaletteResult(idx) {
  const s = CMD_PALETTE.results[idx];
  if (!s) return;
  registerSymbols([s]);
  if (panes[0] && panes[0].symbolInput) {
    panes[0].symbolInput.value = s.symbol;
    panes[0].symbolInput.dispatchEvent(new Event("change"));
  }
  closeCmdPalette();
}

function moveCmdPaletteActive(delta) {
  const n = CMD_PALETTE.results.length;
  if (n === 0) return;
  CMD_PALETTE.active = (CMD_PALETTE.active + delta + n) % n;
  const list = document.getElementById("cmd-palette-list");
  if (!list) return;
  Array.from(list.children).forEach((el, i) => {
    el.classList.toggle("active", i === CMD_PALETTE.active);
    if (i === CMD_PALETTE.active && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  });
}

export function bindCommandK() {
  const btn = document.getElementById("cmd-k");
  if (btn) btn.addEventListener("click", openCmdPalette);

  document.querySelectorAll("[data-cmd-close]").forEach((el) => {
    el.addEventListener("click", closeCmdPalette);
  });

  const input = document.getElementById("cmd-palette-input");
  if (input) {
    input.addEventListener("input", () => {
      clearTimeout(CMD_PALETTE.debounceTimer);
      const q = input.value;
      CMD_PALETTE.debounceTimer = setTimeout(() => cmdPaletteSearch(q), 200);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        pickCmdPaletteResult(CMD_PALETTE.active);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        moveCmdPaletteActive(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveCmdPaletteActive(-1);
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
      if (e.key === "Escape" && e.target.id === "cmd-palette-input") {
        e.preventDefault();
        closeCmdPalette();
      }
      return;
    }
    const metaK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
    if (metaK) {
      e.preventDefault();
      openCmdPalette();
    } else if (e.key === "Escape") {
      const pal = document.getElementById("cmd-palette");
      if (pal && !pal.hidden) closeCmdPalette();
    }
  });
}
