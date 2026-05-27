// DrawingLayer, StyleModal, SettingsPopover — the interactive drawing overlay.

import { DrawingStore, PrefsStore, util } from "./drawing-store.js";
import { TOOL_DEFS_BY_ID }               from "./drawing-tools.js";

const DASH_OPTIONS   = ["solid", "dashed", "dotted", "dashdot"];
const EXTEND_OPTIONS = ["none", "left", "right", "both"];

export const StyleModal = {
  el: null,
  body: null,
  sub: null,
  deleteBtn: null,
  current: null,
  _before: null,

  ensure() {
    if (this.el) return;
    this.el = document.getElementById("draw-style-modal");
    this.body = document.getElementById("dsm-body");
    this.sub = document.getElementById("dsm-sub");
    this.deleteBtn = document.getElementById("dsm-delete");
    if (!this.el) return;
    this.el.addEventListener("click", (ev) => {
      if (ev.target.matches("[data-close]")) this.close();
    });
    this.deleteBtn.addEventListener("click", () => {
      if (!this.current) return;
      const { drawing, layer } = this.current;
      layer._pushHistory({ kind: "delete", before: layer._snap(drawing), after: null });
      this._before = null;
      layer.drawings = layer.drawings.filter((x) => x.id !== drawing.id);
      layer.save();
      layer.deselect();
      layer._redraw();
      this.close();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !this.el.hidden) this.close();
    });
  },

  open(drawing, layer) {
    this.ensure();
    if (!this.el) return;
    this.current = { drawing, layer };
    this._before = layer._snap(drawing);
    const def = TOOL_DEFS_BY_ID[drawing.tool];
    this.sub.textContent = def ? def.name : drawing.tool;
    this._render();
    this.el.hidden = false;
  },

  close() {
    if (!this.el) return;
    if (this.current && this._before) {
      const { drawing, layer } = this.current;
      if (JSON.stringify(this._before) !== JSON.stringify(drawing)) {
        layer._pushHistory({ kind: "update", before: this._before, after: layer._snap(drawing) });
      }
      this._before = null;
    }
    this.el.hidden = true;
    this.current = null;
  },

  _render() {
    const { drawing } = this.current;
    this.body.innerHTML = "";
    const rows = [
      this._row("Color",   this._colorInput(drawing)),
      this._row("Width",   this._numberInput(drawing, "width", 1, 8, 1)),
      this._row("Dash",    this._pillRow(drawing, "dash", DASH_OPTIONS,
        { solid: "──", dashed: "- -", dotted: "···", dashdot: "─·" })),
      this._row("Opacity", this._numberInput(drawing, "opacity", 0.1, 1, 0.1)),
      this._row("Label",   this._textInput(drawing, "label")),
      this._row("Extend",  this._pillRow(drawing, "extend", EXTEND_OPTIONS,
        { none: "none", left: "←", right: "→", both: "↔" }, "scope")),
    ];
    rows.forEach((r) => this.body.appendChild(r));
  },

  _row(label, control) {
    const r = document.createElement("div");
    r.className = "dsm-row";
    const l = document.createElement("span");
    l.className = "dsm-lbl";
    l.textContent = label;
    r.append(l, control);
    return r;
  },

  _colorInput(drawing) {
    const wrap = document.createElement("span");
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "6px";
    const inp = document.createElement("input");
    inp.type = "color";
    inp.className = "dsm-color";
    inp.value = drawing.style.color;
    const label = document.createElement("span");
    label.style.fontSize = "11px";
    label.style.color = "var(--text)";
    label.textContent = inp.value;
    inp.addEventListener("input", () => {
      drawing.style.color = inp.value;
      label.textContent = inp.value;
      this._apply();
    });
    wrap.append(inp, label);
    return wrap;
  },

  _numberInput(drawing, key, min, max, step) {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.className = "dsm-num";
    inp.min = min; inp.max = max; inp.step = step;
    inp.value = drawing.style[key];
    inp.addEventListener("input", () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v)) return;
      drawing.style[key] = v;
      this._apply();
    });
    return inp;
  },

  _textInput(drawing, key) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "dsm-text";
    inp.value = drawing.style[key] || "";
    inp.addEventListener("input", () => {
      drawing.style[key] = inp.value;
      this._apply();
    });
    return inp;
  },

  _pillRow(drawing, key, options, glyphs, group = "style") {
    const wrap = document.createElement("div");
    wrap.className = "dsm-pill-row";
    options.forEach((opt) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dsm-pill";
      if (drawing[group][key] === opt) b.classList.add("active");
      b.textContent = glyphs[opt] || opt;
      b.title = opt;
      b.addEventListener("click", () => {
        drawing[group][key] = opt;
        this._apply();
        this._render();
      });
      wrap.appendChild(b);
    });
    return wrap;
  },

  _apply() {
    const { layer } = this.current;
    layer.save();
    layer._redraw();
  },
};

export const SettingsPopover = {
  el: null,
  _outsideClose: null,
  open(anchorEl, onChange) {
    if (!this.el) this.el = document.getElementById("draw-settings-pop");
    if (!this.el) return;
    const rect = anchorEl.getBoundingClientRect();
    this.el.style.left = (rect.right + 6) + "px";
    this.el.style.top  = rect.top + "px";
    this._render(onChange);
    this.el.hidden = false;
    setTimeout(() => {
      this._outsideClose = (ev) => {
        if (!this.el.contains(ev.target) && ev.target !== anchorEl) this.close();
      };
      document.addEventListener("mousedown", this._outsideClose);
    }, 0);
  },
  close() {
    if (this.el) this.el.hidden = true;
    if (this._outsideClose) {
      document.removeEventListener("mousedown", this._outsideClose);
      this._outsideClose = null;
    }
  },
  _render(onChange) {
    const prefs = PrefsStore.get();
    this.el.querySelectorAll("[data-pref-toolbar]").forEach((b) => {
      b.classList.toggle("active", b.dataset.prefToolbar === prefs.toolbarMode);
      b.onclick = () => {
        PrefsStore.set({ toolbarMode: b.dataset.prefToolbar });
        this._render(onChange);
        if (onChange) onChange();
      };
    });
    this.el.querySelectorAll("[data-pref-snap]").forEach((b) => {
      b.classList.toggle("active", b.dataset.prefSnap === prefs.snapDefault);
      b.onclick = () => {
        PrefsStore.set({ snapDefault: b.dataset.prefSnap });
        this._render(onChange);
        if (onChange) onChange();
      };
    });
    const undoInp = document.getElementById("dsp-undo");
    if (undoInp) {
      undoInp.value = prefs.undoDepth;
      undoInp.oninput = () => {
        const v = Number(undoInp.value);
        if (Number.isFinite(v) && v >= 1) {
          PrefsStore.set({ undoDepth: v });
          if (onChange) onChange();
        }
      };
    }
  },
};

export class DrawingLayer {
  constructor(opts) {
    this.chart = opts.chart;
    this.series = opts.series;
    this.source = opts.source;
    this.symbol = opts.symbol;
    this.timeframe = opts.timeframe;

    this.wrapper = null;
    this.svg = null;
    this.handleHost = null;
    this.drawings = [];

    this.mode = "idle";
    this.activeTool = null;
    this.placePoints = [];
    this.selectedId = null;
    this.miniToolbar = null;

    this._destroyed = false;
    this._onResize = null;
    this._onVisRange = null;
    this._onKeyDown = null;

    this.history = [];
    this.histPos = 0;
    this.maxHist = PrefsStore.get().undoDepth || 50;

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

    this.wrapper.addEventListener("click", (ev) => {
      DrawingLayer._activeLayer = this;
      this._onClick(ev);
    });
    this.wrapper.addEventListener("pointerdown", () => {
      DrawingLayer._activeLayer = this;
    });
    this.wrapper.addEventListener("mousemove", (ev) => {
      if (this.mode !== "placing" || !this.activeTool) return;
      const rect = this.wrapper.getBoundingClientRect();
      this._previewCursor = {
        x: ev.clientX - rect.left,
        y: ev.clientY - rect.top,
        shiftKey: ev.shiftKey,
      };
      this._renderPreview();
    });
    this.wrapper.addEventListener("mouseleave", () => {
      if (this._previewCursor) {
        this._previewCursor = null;
        this._clearPreview();
      }
    });

    this._setOverlayInteractive(true);

    this._onResize = () => this._redraw();
    this._onVisRange = () => this._redraw();
    this.chart.timeScale().subscribeVisibleTimeRangeChange(this._onVisRange);
    window.addEventListener("resize", this._onResize);

    this._onKeyDown = (ev) => {
      if (this._destroyed) return;
      if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;

      const isUndo = (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === "z";
      const isRedo = (ev.ctrlKey || ev.metaKey) && (
        ev.key.toLowerCase() === "y" ||
        (ev.key.toLowerCase() === "z" && ev.shiftKey)
      );
      if (isUndo || isRedo) {
        const active = DrawingLayer._activeLayer || this;
        if (active !== this) return;
        DrawingLayer._activeLayer = this;
        ev.preventDefault();
        if (isUndo) this.undo(); else this.redo();
        return;
      }

      if (ev.key === "Escape" && this.mode === "placing") {
        this.setActiveTool("cursor");
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }

      if (!this.selectedId) return;
      if (ev.key === "Escape") {
        this.deselect();
        ev.stopPropagation();
      } else if (ev.key === "Delete" || ev.key === "Backspace") {
        this._handleMiniAction("del");
        ev.preventDefault();
      }
    };
    document.addEventListener("keydown", this._onKeyDown);

    this.load();
    this._redraw();
  }

  toPx(point) {
    const x = this.chart.timeScale().timeToCoordinate(point.time);
    const y = this.series.priceToCoordinate(point.price);
    if (x == null || y == null) return null;
    return { x, y };
  }

  fromPx(x, y) {
    const time  = this.chart.timeScale().coordinateToTime(x);
    const price = this.series.coordinateToPrice(y);
    if (time == null || price == null) return null;
    return { time: typeof time === "number" ? time : Number(time), price };
  }

  _snapPoint(pt, modifiers) {
    const prefs = PrefsStore.get();
    const mode = prefs.snapDefault;
    const shouldSnap =
      mode === "always" ||
      (mode === "shift" && modifiers && modifiers.shiftKey);
    if (!shouldSnap || !this.getCandles) return pt;
    const candles = this.getCandles();
    if (!candles || candles.length === 0) return pt;
    let best = candles[0], bestDiff = Math.abs(candles[0].time - pt.time);
    for (let i = 1; i < candles.length; i++) {
      const d = Math.abs(candles[i].time - pt.time);
      if (d < bestDiff) { best = candles[i]; bestDiff = d; }
    }
    const ohlc = [best.open, best.high, best.low, best.close];
    let nearest = ohlc[0], minDist = Math.abs(ohlc[0] - pt.price);
    for (let i = 1; i < ohlc.length; i++) {
      const d = Math.abs(ohlc[i] - pt.price);
      if (d < minDist) { nearest = ohlc[i]; minDist = d; }
    }
    return { time: best.time, price: nearest };
  }

  load() { this.drawings = DrawingStore.get(this.source, this.symbol); }
  save() { DrawingStore.set(this.source, this.symbol, this.drawings); }

  _redraw() {
    if (!this.svg) return;
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this._previewGroup = null;
    const sorted = this.drawings.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const d of sorted) {
      const def = TOOL_DEFS_BY_ID[d.tool];
      if (def && def.render) def.render(this.svg, d, this);
    }
    this._renderPreview();
    this._renderHandles();
  }

  _renderPreview() {
    this._clearPreview();
    if (!this.svg) return;
    if (this.mode !== "placing" || !this.activeTool) return;
    const cur = this._previewCursor;
    if (!cur) return;
    const def = this.activeTool;
    if (def.pointsNeeded > 1 && this.placePoints.length === 0) return;
    const cursorPt = this.fromPx(cur.x, cur.y);
    if (!cursorPt) return;
    const snapped = this._snapPoint(cursorPt, { shiftKey: cur.shiftKey });
    const points = [...this.placePoints, snapped];
    while (points.length < def.pointsNeeded) points.push(snapped);
    const ghost = {
      id: "_preview",
      tool: def.id,
      points,
      style: { ...def.defaultStyle, opacity: 0.55 * (def.defaultStyle.opacity ?? 1) },
      scope: { ...def.defaultScope },
      z: 1e9,
    };
    this._previewGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this._previewGroup.setAttribute("data-preview", "true");
    this._previewGroup.setAttribute("pointer-events", "none");
    this.svg.appendChild(this._previewGroup);
    try {
      def.render(this._previewGroup, ghost, this);
    } catch (_e) {
      this._clearPreview();
    }
  }

  _clearPreview() {
    if (this._previewGroup && this._previewGroup.parentNode) {
      this._previewGroup.parentNode.removeChild(this._previewGroup);
    }
    this._previewGroup = null;
  }

  setActiveTool(toolId) {
    const isCursor = toolId === "cursor" || toolId == null;
    const def = isCursor ? null : TOOL_DEFS_BY_ID[toolId];
    this._previewCursor = null;
    this._clearPreview();
    if (isCursor || !def) {
      this.mode = "idle";
      this.activeTool = null;
      this.placePoints = [];
      this._setCursor("default");
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

  select(id) { this.selectedId = id; this._renderHandles(); }
  deselect() { this.selectedId = null; this._renderHandles(); }

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
      this._attachHandleDrag(el, d, h);
      this.handleHost.appendChild(el);
    }

    const top = handles.reduce((p, c) => (c.y < p.y ? c : p), handles[0]);
    this.miniToolbar = this._buildMiniToolbar();
    this.miniToolbar.style.left = top.x + "px";
    this.miniToolbar.style.top  = Math.max(8, top.y - 36) + "px";
    this.handleHost.appendChild(this.miniToolbar);
  }

  _attachHandleDrag(el, drawing, handle) {
    const def = TOOL_DEFS_BY_ID[drawing.tool];
    if (!def) return;
    el.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try { el.setPointerCapture(ev.pointerId); } catch (_e) { /* not always supported */ }
      const before = this._snap(drawing);
      let moved = false;
      const rect = this.wrapper.getBoundingClientRect();
      let lastX = ev.clientX - rect.left;
      let lastY = ev.clientY - rect.top;
      const onMove = (mv) => {
        moved = true;
        const x = mv.clientX - rect.left;
        const y = mv.clientY - rect.top;
        if (handle.kind === "mid" && def.moveAll) {
          def.moveAll(drawing, x - lastX, y - lastY, this);
        } else if (def.moveHandle) {
          const raw = this.fromPx(x, y);
          const snapped = raw ? this._snapPoint(raw, mv) : null;
          if (snapped) {
            const px = this.toPx(snapped);
            if (px) def.moveHandle(drawing, handle.id, px.x, px.y, this);
          } else {
            def.moveHandle(drawing, handle.id, x, y, this);
          }
        }
        lastX = x; lastY = y;
        this._redraw();
      };
      const onUp = () => {
        try { el.releasePointerCapture(ev.pointerId); } catch (_e) { /* already released */ }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (moved) {
          this._pushHistory({ kind: "update", before, after: this._snap(drawing) });
          this.save();
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
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
      this._pushHistory({ kind: "delete", before: this._snap(d), after: null });
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
      this._pushHistory({ kind: "create", before: null, after: this._snap(copy) });
      this.save();
      this.select(copy.id);
      this._redraw();
    } else if (act === "top") {
      const before = this._snap(d);
      d.z = Math.max(...this.drawings.map((x) => x.z || 0)) + 1;
      this._pushHistory({ kind: "update", before, after: this._snap(d) });
      this.save();
      this._redraw();
    } else if (act === "edit") {
      StyleModal.open(d, this);
    }
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
      this.placePoints.push(this._snapPoint(pt, ev));
      this._previewCursor = { x, y, shiftKey: ev.shiftKey };
      if (this.placePoints.length < this.activeTool.pointsNeeded) this._renderPreview();
      if (this.placePoints.length >= this.activeTool.pointsNeeded) {
        if (this.placePoints.length >= 2) {
          const p0 = this.placePoints[0];
          const pN = this.placePoints[this.placePoints.length - 1];
          if (p0.time === pN.time && p0.price === pN.price) {
            this.placePoints = [];
            this.setActiveTool("cursor");
            return;
          }
        }

        const def = this.activeTool;
        const points = this.placePoints.slice();
        this.placePoints = [];

        const commit = (labelText) => {
          if (def.id === "text" && labelText === "") {
            this.setActiveTool("cursor");
            return;
          }
          const drawing = {
            id: util.newId(),
            tool: def.id,
            points,
            style: { ...def.defaultStyle,
              ...(labelText !== undefined ? { label: labelText } : {}) },
            scope: { ...def.defaultScope },
            z: this.drawings.length,
            createdAt: Math.floor(Date.now() / 1000),
          };
          this.drawings.push(drawing);
          this._pushHistory({ kind: "create", before: null, after: this._snap(drawing) });
          this.save();
          this.setActiveTool("cursor");
          this._redraw();
        };

        if (def.id === "text" && def.promptLabel) {
          def.promptLabel(this, { x, y }).then(commit);
        } else {
          commit(undefined);
        }
      }
      return;
    }

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
    this.mode = "idle";
    this.activeTool = null;
    this.placePoints = [];
    this.selectedId = null;
    this.history = [];
    this.histPos = 0;
    this.load();
    this._redraw();
  }

  _snap(d) { return JSON.parse(JSON.stringify(d)); }

  _pushHistory(entry) {
    if (this.histPos < this.history.length) this.history.length = this.histPos;
    this.history.push(entry);
    this.maxHist = PrefsStore.get().undoDepth || 50;
    while (this.history.length > this.maxHist) this.history.shift();
    this.histPos = this.history.length;
  }

  undo() {
    if (this.histPos === 0) return;
    const entry = this.history[--this.histPos];
    if (entry.kind === "create") {
      this.drawings = this.drawings.filter((d) => d.id !== entry.after.id);
    } else if (entry.kind === "delete") {
      this.drawings.push(this._snap(entry.before));
    } else if (entry.kind === "update") {
      const i = this.drawings.findIndex((d) => d.id === entry.after.id);
      if (i >= 0) this.drawings[i] = this._snap(entry.before);
    }
    this.save();
    this.selectedId = null;
    this._redraw();
  }

  redo() {
    if (this.histPos >= this.history.length) return;
    const entry = this.history[this.histPos++];
    if (entry.kind === "create") {
      this.drawings.push(this._snap(entry.after));
    } else if (entry.kind === "delete") {
      this.drawings = this.drawings.filter((d) => d.id !== entry.before.id);
    } else if (entry.kind === "update") {
      const i = this.drawings.findIndex((d) => d.id === entry.after.id);
      if (i >= 0) this.drawings[i] = this._snap(entry.after);
    }
    this.save();
    this._redraw();
  }

  eraseAll() {
    if (this.drawings.length === 0) return;
    if (!confirm(`Delete all ${this.drawings.length} drawings on this pane?`)) return;
    for (const d of this.drawings.slice()) {
      this._pushHistory({ kind: "delete", before: this._snap(d), after: null });
    }
    this.drawings = [];
    this.selectedId = null;
    this.save();
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
    if (this._onKeyDown) {
      document.removeEventListener("keydown", this._onKeyDown);
      this._onKeyDown = null;
    }
    if (this.wrapper && this.wrapper.parentNode) {
      this.wrapper.parentNode.removeChild(this.wrapper);
    }
    this.wrapper = this.svg = this.handleHost = null;
    if (DrawingLayer._activeLayer === this) DrawingLayer._activeLayer = null;
  }
}

DrawingLayer._activeLayer = null;
