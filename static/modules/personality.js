// Workspace personality presets (Minimalist, Quant, Scalper, Investor).

import { panes, paneStates, setLayoutId } from "./grid.js";

export const PERSONALITY_DEFAULTS = {
  Minimalist: { layoutId: 1, syms: [{ source: "yfinance", symbol: "NVDA" }], tf: "1d" },
  Quant:      { layoutId: 5, syms: [
    { source: "yfinance", symbol: "SPY"  },
    { source: "yfinance", symbol: "NVDA" },
    { source: "yfinance", symbol: "TLT"  },
    { source: "yfinance", symbol: "^VIX" },
  ], tf: "1h" },
  Scalper:    { layoutId: 5, syms: [
    { source: "yfinance", symbol: "ES=F"  },
    { source: "yfinance", symbol: "NQ=F"  },
    { source: "yfinance", symbol: "NVDA"  },
    { source: "yfinance", symbol: "TSLA"  },
  ], tf: "5m" },
  Investor:   { layoutId: 4, syms: [
    { source: "yfinance", symbol: "SPY" },
    { source: "yfinance", symbol: "TLT" },
    { source: "yfinance", symbol: "GLD" },
  ], tf: "1d" },
};

const LS_PERSONALITY = "stv.personality";

export function currentPersonality() {
  return localStorage.getItem(LS_PERSONALITY) || "Quant";
}

export function applyPersonality(name) {
  const preset = PERSONALITY_DEFAULTS[name];
  if (!preset) return;
  for (let i = 0; i < preset.syms.length; i++) {
    const prev  = paneStates[i] || { indicators: {} };
    paneStates[i] = {
      source:     preset.syms[i].source,
      symbol:     preset.syms[i].symbol,
      tf:         preset.tf,
      indicators: prev.indicators || {},
    };
  }
  localStorage.setItem(LS_PERSONALITY, name);
  setLayoutId(preset.layoutId);
  refreshPersonalityButtons();
}

export function refreshPersonalityButtons() {
  const cur = currentPersonality();
  document.querySelectorAll(".pers-btn").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.pers === cur);
  });
}

export function bindPersonality() {
  document.querySelectorAll(".pers-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyPersonality(btn.dataset.pers));
  });
  refreshPersonalityButtons();
}
