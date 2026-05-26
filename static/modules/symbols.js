// Symbol registry: curated list + live search against /symbols?q=...

export const SYMBOLS = { byKey: new Map(), all: [], timeframes: [] };

function _renderSymbolsDatalist(symbols) {
  const dl = document.getElementById("symbols-datalist");
  while (dl.firstChild) dl.removeChild(dl.firstChild);
  for (const s of symbols) {
    const opt = document.createElement("option");
    opt.value = s.symbol;
    opt.textContent = `${s.label} (${s.asset_class})`;
    dl.appendChild(opt);
  }
}

export function registerSymbols(symbols) {
  for (const s of symbols) {
    SYMBOLS.byKey.set(s.symbol.toUpperCase(), s);
  }
}

export async function loadSymbols() {
  const res = await fetch("/symbols");
  const data = await res.json();
  SYMBOLS.all = data.symbols;
  SYMBOLS.timeframes = data.timeframes;
  registerSymbols(data.symbols);
  _renderSymbolsDatalist(data.symbols);
}

let _searchTimer = null;
let _searchToken = 0;

export function querySymbolsDebounced(query, delay = 250) {
  clearTimeout(_searchTimer);
  if (!query || query.length < 1) {
    _renderSymbolsDatalist(SYMBOLS.all);
    return;
  }
  _searchTimer = setTimeout(() => querySymbolsNow(query), delay);
}

export async function querySymbolsNow(query) {
  const token = ++_searchToken;
  try {
    const res = await fetch(`/symbols?q=${encodeURIComponent(query)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (token !== _searchToken) return;
    registerSymbols(data.symbols);
    _renderSymbolsDatalist(data.symbols);
  } catch {
    /* silent — keep last datalist contents */
  }
}

export function resolveSource(symbolText) {
  const key = symbolText.trim().toUpperCase();
  const hit = SYMBOLS.byKey.get(key);
  if (hit) return { symbol: key, source: hit.source };
  if (key.includes(".")) return { symbol: key, source: "yfinance" };
  return { symbol: key, source: "hyperliquid" };
}
