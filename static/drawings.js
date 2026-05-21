/* SuperTradingView drawing layer.
 *
 * Public exports (on `window.Drawings`):
 *   - DrawingStore: per-(source, symbol) drawing list in localStorage
 *   - PrefsStore:   user UI prefs (toolbar mode, default snap, undo depth)
 *   - DrawingLayer: per-pane drawing layer (added in a later task)
 *   - TOOL_DEFS:    list of available drawing tools
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

  const _HEX_RE = /^#[0-9a-fA-F]{6}$/;
  const _DASH_KEYS = new Set(["solid", "dashed", "dotted", "dashdot"]);

  function _isValidDrawing(d) {
    if (!d || typeof d.id !== "string" || typeof d.tool !== "string") return false;
    if (!Array.isArray(d.points)) return false;
    if (!d.points.every((p) => p && typeof p.time === "number" && typeof p.price === "number")) return false;
    // Style shape (when present): defaults applied at render time, but reject hostile values.
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

  const DrawingStore = {
    _key(source, symbol) { return `${source}|${symbol.toUpperCase()}`; },

    get(source, symbol) {
      const all = _readJSON(LS_DRAWINGS, {});
      const arr = all[this._key(source, symbol)] || [];
      // Drop any persisted entries that fail a basic shape check
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

  const PrefsStore = {
    get() { return { ...DEFAULT_PREFS, ..._readJSON(LS_PREFS, {}) }; },
    set(partial) { _writeJSON(LS_PREFS, { ...this.get(), ...partial }); },
  };

  const util = {
    newId() { return "drw_" + Math.random().toString(36).slice(2, 10); },
  };

  function distPointToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  const DASH_MAP = {
    solid: null,
    dashed: "8,4",
    dotted: "2,3",
    dashdot: "8,4,2,4",
  };

  const TOOL_DEFS = [
    {
      id: "trendline",
      name: "Trendline",
      pointsNeeded: 2,
      defaultStyle: { color: "#ffca28", width: 2, dash: "solid", opacity: 1 },
      defaultScope: { showAllTimeframes: true, extend: "none" },

      render(svg, drawing, layer) {
        const [a, b] = drawing.points;
        const pa = layer.toPx(a);
        const pb = layer.toPx(b);
        if (!pa || !pb) return;
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("data-drawing-id", drawing.id);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", pa.x);
        line.setAttribute("y1", pa.y);
        line.setAttribute("x2", pb.x);
        line.setAttribute("y2", pb.y);
        line.setAttribute("stroke", drawing.style.color);
        line.setAttribute("stroke-width", drawing.style.width);
        line.setAttribute("stroke-opacity", drawing.style.opacity);
        line.setAttribute("stroke-linecap", "round");
        const dash = DASH_MAP[drawing.style.dash];
        if (dash) line.setAttribute("stroke-dasharray", dash);
        g.appendChild(line);
        svg.appendChild(g);
      },

      handles(drawing, layer) {
        const [a, b] = drawing.points;
        const pa = layer.toPx(a);
        const pb = layer.toPx(b);
        if (!pa || !pb) return [];
        return [
          { id: 0,   kind: "endpoint", x: pa.x, y: pa.y },
          { id: 1,   kind: "endpoint", x: pb.x, y: pb.y },
          { id: "mid", kind: "mid",    x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
        ];
      },

      hitTest(drawing, x, y, layer, tol = 6) {
        const [a, b] = drawing.points;
        const pa = layer.toPx(a);
        const pb = layer.toPx(b);
        if (!pa || !pb) return false;
        return distPointToSegment(x, y, pa.x, pa.y, pb.x, pb.y) <= tol;
      },
    },
  ];

  const TOOL_DEFS_BY_ID = Object.fromEntries(TOOL_DEFS.map((t) => [t.id, t]));

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
      this.miniToolbar = null;   // floating mini-toolbar element for the selection

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

      this.wrapper.addEventListener("click", (ev) => this._onClick(ev));

      // Cursor mode must remain interactive so clicks can hit-test for selection.
      this._setOverlayInteractive(true);

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

    /** Re-render every drawing. */
    _redraw() {
      if (!this.svg) return;
      while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
      // Sort by z so higher-z draws on top
      const sorted = this.drawings.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
      for (const d of sorted) {
        const def = TOOL_DEFS_BY_ID[d.tool];
        if (def && def.render) def.render(this.svg, d, this);
      }
      this._renderHandles();
    }

    setActiveTool(toolId) {
      const isCursor = toolId === "cursor" || toolId == null;
      const def = isCursor ? null : TOOL_DEFS_BY_ID[toolId];
      if (isCursor || !def) {
        this.mode = "idle";
        this.activeTool = null;
        this.placePoints = [];
        this._setCursor("default");
        // Cursor mode stays interactive so clicks can hit-test for selection.
        this._setOverlayInteractive(true);
        if (this._notifyToolChange) this._notifyToolChange("cursor");
        return;
      }
      this.mode = "placing";
      this.activeTool = def;
      this.placePoints = [];
      this._setCursor("crosshair");
      this._setOverlayInteractive(true);
      if (this._notifyToolChange) this._notifyToolChange(def.id);
    }

    select(id) {
      this.selectedId = id;
      this._renderHandles();
    }

    deselect() {
      this.selectedId = null;
      this._renderHandles();
    }

    _clearHandleHost() {
      if (!this.handleHost) return;
      while (this.handleHost.firstChild) this.handleHost.removeChild(this.handleHost.firstChild);
    }

    _renderHandles() {
      this._clearHandleHost();
      if (!this.selectedId) return;
      const d = this.drawings.find((x) => x.id === this.selectedId);
      if (!d) return;
      const def = TOOL_DEFS_BY_ID[d.tool];
      if (!def || !def.handles) return;
      const handles = def.handles(d, this);
      if (handles.length === 0) return;

      for (const h of handles) {
        const el = document.createElement("div");
        el.className = "draw-handle " + h.kind;
        el.style.left = h.x + "px";
        el.style.top  = h.y + "px";
        el.dataset.handleId = String(h.id);
        this.handleHost.appendChild(el);
      }

      // Mini-toolbar above the topmost handle
      const top = handles.reduce((p, c) => (c.y < p.y ? c : p), handles[0]);
      this.miniToolbar = this._buildMiniToolbar();
      this.miniToolbar.style.left = top.x + "px";
      this.miniToolbar.style.top  = Math.max(8, top.y - 36) + "px";
      this.handleHost.appendChild(this.miniToolbar);
    }

    _buildMiniToolbar() {
      const bar = document.createElement("div");
      bar.className = "draw-mini-toolbar";
      bar.innerHTML = `
        <button class="dmt-btn" type="button" data-act="edit" title="Edit style">✏</button>
        <button class="dmt-btn" type="button" data-act="dup"  title="Duplicate">⎘</button>
        <button class="dmt-btn" type="button" data-act="top"  title="Bring to front">↑</button>
        <button class="dmt-btn danger" type="button" data-act="del" title="Delete">×</button>
      `;
      bar.addEventListener("click", (ev) => {
        const act = ev.target.closest("[data-act]")?.dataset.act;
        if (!act) return;
        ev.stopPropagation();
        this._handleMiniAction(act);
      });
      return bar;
    }

    _handleMiniAction(act) {
      const d = this.drawings.find((x) => x.id === this.selectedId);
      if (!d) return;
      if (act === "del") {
        this.drawings = this.drawings.filter((x) => x.id !== d.id);
        this.selectedId = null;
        this.save();
        this._redraw();
      } else if (act === "dup") {
        const copy = {
          ...d,
          id: util.newId(),
          points: d.points.map((p) => ({ ...p })),
          style: { ...d.style },
          scope: { ...d.scope },
          z: this.drawings.length,
        };
        this.drawings.push(copy);
        this.save();
        this.select(copy.id);
        this._redraw();
      } else if (act === "top") {
        d.z = Math.max(...this.drawings.map((x) => x.z || 0)) + 1;
        this.save();
        this._redraw();
      }
      // "edit" wired in the Style Modal task (Task 6)
    }

    _setCursor(c) { if (this.wrapper) this.wrapper.style.cursor = c; }

    _setOverlayInteractive(on) {
      if (!this.wrapper) return;
      this.wrapper.style.pointerEvents = on ? "auto" : "none";
    }

    _onClick(ev) {
      const rect = this.wrapper.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;

      if (this.mode === "placing" && this.activeTool) {
        const pt = this.fromPx(x, y);
        if (!pt) return;
        this.placePoints.push(pt);
        if (this.placePoints.length >= this.activeTool.pointsNeeded) {
          // Spec: discard zero-length drawings (two clicks at the same point).
          if (this.placePoints.length >= 2) {
            const p0 = this.placePoints[0];
            const pN = this.placePoints[this.placePoints.length - 1];
            if (p0.time === pN.time && p0.price === pN.price) {
              this.placePoints = [];
              this.setActiveTool("cursor");
              return;
            }
          }
          const drawing = {
            id: util.newId(),
            tool: this.activeTool.id,
            points: this.placePoints.slice(),
            style: { ...this.activeTool.defaultStyle },
            scope: { ...this.activeTool.defaultScope },
            z: this.drawings.length,
            createdAt: Math.floor(Date.now() / 1000),
          };
          this.drawings.push(drawing);
          this.save();
          this.placePoints = [];
          // setActiveTool fires _notifyToolChange itself.
          this.setActiveTool("cursor");
          this._redraw();
        }
        return;
      }

      // Cursor mode: hit-test against drawings (top-z first)
      const sorted = this.drawings.slice().sort((a, b) => (b.z || 0) - (a.z || 0));
      for (const d of sorted) {
        const def = TOOL_DEFS_BY_ID[d.tool];
        if (def && def.hitTest && def.hitTest(d, x, y, this)) {
          this.select(d.id);
          return;
        }
      }
      this.deselect();
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

  window.Drawings = { DrawingStore, PrefsStore, DrawingLayer, TOOL_DEFS, util };
})();
