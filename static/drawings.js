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

  class DrawingLayer {
    /**
     * @param {Object} opts
     * @param {IChartApi} opts.chart      Lightweight Charts chart instance
     * @param {ISeriesApi} opts.series    The candle series (used as the price-scale source)
     * @param {string} opts.source        e.g. "hyperliquid"
     * @param {string} opts.symbol        e.g. "BTC"
     * @param {string} opts.timeframe     e.g. "1m"
     */
    constructor(opts) {
      this.chart = opts.chart;
      this.series = opts.series;
      this.source = opts.source;
      this.symbol = opts.symbol;
      this.timeframe = opts.timeframe;

      this.wrapper = null;     // <div> overlay attached to chart.panes()[0]
      this.svg = null;         // <svg> for shapes
      this.handleHost = null;  // <div> for handles + mini-toolbar (siblings)
      this.drawings = [];      // current list, hydrated from store

      // Interaction state used by tools added in later tasks. Declared here so
      // the class shape is complete and setSymbol's reset doesn't write to
      // undefined fields.
      this.mode = "idle";        // "idle" | "placing"
      this.activeTool = null;    // TOOL_DEFS entry while placing
      this.placePoints = [];     // points captured so far during placement
      this.selectedId = null;    // id of currently selected drawing

      this._destroyed = false;
      this._onResize = null;
      this._onVisRange = null;

      // Defer DOM attach until the pane HTML element exists (v5 layout pass).
      requestAnimationFrame(() => this._attach());
    }

    _attach() {
      if (this._destroyed) return;
      const panes = this.chart.panes();
      if (panes.length === 0) { requestAnimationFrame(() => this._attach()); return; }
      const paneEl = panes[0].getHTMLElement();
      if (!paneEl) { requestAnimationFrame(() => this._attach()); return; }

      if (window.getComputedStyle(paneEl).position === "static") {
        paneEl.style.position = "relative";
      }

      this.wrapper = document.createElement("div");
      this.wrapper.className = "draw-overlay";
      Object.assign(this.wrapper.style, {
        position: "absolute", inset: "0", pointerEvents: "none", zIndex: "3",
      });

      this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      Object.assign(this.svg.style, {
        position: "absolute", inset: "0", width: "100%", height: "100%",
        pointerEvents: "none",
      });

      this.handleHost = document.createElement("div");
      Object.assign(this.handleHost.style, {
        position: "absolute", inset: "0", pointerEvents: "none",
      });

      this.wrapper.appendChild(this.svg);
      this.wrapper.appendChild(this.handleHost);
      paneEl.appendChild(this.wrapper);

      this._onResize = () => this._redraw();
      this._onVisRange = () => this._redraw();
      this.chart.timeScale().subscribeVisibleTimeRangeChange(this._onVisRange);
      window.addEventListener("resize", this._onResize);

      this.load();
      this._redraw();
    }

    /**
     * Project (time, price) -> {x, y} pixels in the overlay. Returns null if
     * the point is outside the visible time range.
     */
    toPx(point) {
      const x = this.chart.timeScale().timeToCoordinate(point.time);
      const y = this.series.priceToCoordinate(point.price);
      if (x == null || y == null) return null;
      return { x, y };
    }

    /**
     * Inverse projection. Returns null if the cursor is outside the chart
     * plotting area.
     */
    fromPx(x, y) {
      const time  = this.chart.timeScale().coordinateToTime(x);
      const price = this.series.coordinateToPrice(y);
      if (time == null || price == null) return null;
      return { time: typeof time === "number" ? time : Number(time), price };
    }

    load() {
      this.drawings = DrawingStore.get(this.source, this.symbol);
    }

    save() {
      DrawingStore.set(this.source, this.symbol, this.drawings);
    }

    /** Re-render every drawing. Placeholder until tools are added. */
    _redraw() {
      if (!this.svg) return;
      while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
      // Tools render in later tasks.
    }

    setSymbol(source, symbol, timeframe) {
      this.source = source;
      this.symbol = symbol;
      this.timeframe = timeframe;
      // Abort any in-progress placement / selection (spec: symbol change mid-edit)
      this.mode = "idle";
      this.activeTool = null;
      this.placePoints = [];
      this.selectedId = null;
      this.load();
      this._redraw();
    }

    destroy() {
      this._destroyed = true;
      if (this._onVisRange) {
        this.chart.timeScale().unsubscribeVisibleTimeRangeChange(this._onVisRange);
        this._onVisRange = null;
      }
      if (this._onResize) {
        window.removeEventListener("resize", this._onResize);
        this._onResize = null;
      }
      if (this.wrapper && this.wrapper.parentNode) {
        this.wrapper.parentNode.removeChild(this.wrapper);
      }
      this.wrapper = this.svg = this.handleHost = null;
    }
  }

  window.Drawings = { DrawingStore, PrefsStore, DrawingLayer, util };
})();
