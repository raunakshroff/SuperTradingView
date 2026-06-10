// Drawing persistence: DrawingStore, PrefsStore, util, validation helpers.

const LS_DRAWINGS = "stv.drawings";
const LS_PREFS    = "stv.drawingPrefs";

const DEFAULT_PREFS = {
  toolbarMode: "left",      // "left" | "floating"
  snapDefault: "shift",     // "shift" | "always" | "never"
  undoDepth: 50,
};

function _readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch { return fallback; }
}

function _writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}

const _HEX_RE = /^#[0-9a-fA-F]{6}$/;
const _DASH_KEYS = new Set(["solid", "dashed", "dotted", "dashdot"]);

function _isValidDrawing(d) {
  if (!d || typeof d.id !== "string" || typeof d.tool !== "string") return false;
  if (!Array.isArray(d.points)) return false;
  if (!d.points.every((p) => p && typeof p.time === "number" && typeof p.price === "number")) return false;
  const s = d.style;
  if (s != null) {
    if (typeof s !== "object") return false;
    if (s.color != null && !(typeof s.color === "string" && _HEX_RE.test(s.color))) return false;
    if (s.width != null && !(typeof s.width === "number" && Number.isFinite(s.width) && s.width > 0 && s.width < 50)) return false;
    if (s.opacity != null && !(typeof s.opacity === "number" && Number.isFinite(s.opacity) && s.opacity >= 0 && s.opacity <= 1)) return false;
    if (s.dash != null && !_DASH_KEYS.has(s.dash)) return false;
    if (s.label != null && typeof s.label !== "string") return false;
  }
  return true;
}

export const DrawingStore = {
  _key(source, symbol) { return `${source}|${symbol.toUpperCase()}`; },

  get(source, symbol) {
    const all = _readJSON(LS_DRAWINGS, {});
    const arr = all[this._key(source, symbol)] || [];
    return arr.filter((d) => _isValidDrawing(d));
  },

  set(source, symbol, drawings) {
    const all = _readJSON(LS_DRAWINGS, {});
    all[this._key(source, symbol)] = drawings;
    _writeJSON(LS_DRAWINGS, all);
  },

  clear(source, symbol) {
    const all = _readJSON(LS_DRAWINGS, {});
    delete all[this._key(source, symbol)];
    _writeJSON(LS_DRAWINGS, all);
  },
};

export const PrefsStore = {
  get() { return { ...DEFAULT_PREFS, ..._readJSON(LS_PREFS, {}) }; },
  set(partial) { _writeJSON(LS_PREFS, { ...this.get(), ...partial }); },
};

export const util = {
  newId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return "drw_" + crypto.randomUUID();
    }
    return "drw_" + Math.random().toString(36).slice(2, 10);
  },
};
