/* SuperTradingView drawing layer.
 *
 * Public exports (on `window.Drawings`):
 *   - DrawingStore: per-(source, symbol) drawing list in localStorage
 *   - PrefsStore:   user UI prefs (toolbar mode, default snap, undo depth)
 *   - DrawingLayer: per-pane drawing layer (added in a later task)
 *   - TOOL_DEFS:    list of available drawing tools (added in a later task)
 *   - util:         geometry + ID helpers
 */
(function () {
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

  const DrawingStore = {
    _key(source, symbol) { return `${source}|${symbol.toUpperCase()}`; },

    get(source, symbol) {
      const all = _readJSON(LS_DRAWINGS, {});
      const arr = all[this._key(source, symbol)] || [];
      // Drop any persisted entries that fail a basic shape check
      return arr.filter((d) =>
        d && typeof d.id === "string"
          && typeof d.tool === "string"
          && Array.isArray(d.points)
          && d.points.every((p) => typeof p.time === "number" && typeof p.price === "number"));
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

  const PrefsStore = {
    get() { return { ...DEFAULT_PREFS, ..._readJSON(LS_PREFS, {}) }; },
    set(partial) { _writeJSON(LS_PREFS, { ...this.get(), ...partial }); },
  };

  const util = {
    newId() { return "drw_" + Math.random().toString(36).slice(2, 10); },
  };

  window.Drawings = { DrawingStore, PrefsStore, util };
})();
