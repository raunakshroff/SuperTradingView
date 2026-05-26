/* SuperTradingView drawing layer.
 *
 * ES-module exports:
 *   - DrawingStore: per-(source, symbol) drawing list in localStorage
 *   - PrefsStore:   user UI prefs (toolbar mode, default snap, undo depth)
 *   - DrawingLayer: per-pane drawing layer
 *   - TOOL_DEFS:    list of available drawing tools
 *   - util:         geometry + ID helpers
 */

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

function withAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];

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
      const rect = layer.svg.getBoundingClientRect();
      let x1 = pa.x, y1 = pa.y, x2 = pb.x, y2 = pb.y;
      const dx = x2 - x1, dy = y2 - y1;
      const slope = dx === 0 ? Infinity : dy / dx;
      const ext = drawing.scope.extend || "none";
      if (slope !== Infinity && (ext === "left" || ext === "both")) {
        const ny = y1 - slope * x1;
        x1 = 0; y1 = ny;
      }
      if (slope !== Infinity && (ext === "right" || ext === "both")) {
        const ny = y2 + slope * (rect.width - x2);
        x2 = rect.width; y2 = ny;
      }
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("data-drawing-id", drawing.id);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x1); line.setAttribute("y1", y1);
      line.setAttribute("x2", x2); line.setAttribute("y2", y2);
      line.setAttribute("stroke", drawing.style.color);
      line.setAttribute("stroke-width", drawing.style.width);
      line.setAttribute("stroke-opacity", drawing.style.opacity);
      line.setAttribute("stroke-linecap", "round");
      const dash = DASH_MAP[drawing.style.dash];
      if (dash) line.setAttribute("stroke-dasharray", dash);
      g.appendChild(line);
      if (drawing.style.label) {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("x", pb.x + 6);
        t.setAttribute("y", pb.y - 4);
        t.setAttribute("fill", drawing.style.color);
        t.setAttribute("font-size", "10");
        t.textContent = drawing.style.label;
        g.appendChild(t);
      }
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

    moveHandle(drawing, handleId, x, y, layer) {
      const pt = layer.fromPx(x, y);
      if (!pt) return;
      // handleId comes from h.id which can be 0 or 1 (numbers). Dataset stores
      // strings; accept both forms so the caller doesn't have to normalize.
      if (handleId === 0 || handleId === "0") drawing.points[0] = pt;
      else if (handleId === 1 || handleId === "1") drawing.points[1] = pt;
    },

    moveAll(drawing, dx, dy, layer) {
      const oldA = layer.toPx(drawing.points[0]);
      const oldB = layer.toPx(drawing.points[1]);
      if (!oldA || !oldB) return;
      const newA = layer.fromPx(oldA.x + dx, oldA.y + dy);
      const newB = layer.fromPx(oldB.x + dx, oldB.y + dy);
      if (newA) drawing.points[0] = newA;
      if (newB) drawing.points[1] = newB;
    },
  },
  {
    id: "horizontal",
    name: "Horizontal line",
    pointsNeeded: 1,
    defaultStyle: { color: "#42a5f5", width: 1, dash: "dashed", opacity: 1 },
    defaultScope: { showAllTimeframes: true, extend: "both" },

    render(svg, drawing, layer) {
      const [a] = drawing.points;
      const py = layer.series.priceToCoordinate(a.price);
      if (py == null) return;
      const w = layer.svg.getBoundingClientRect().width;
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("data-drawing-id", drawing.id);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", 0); line.setAttribute("y1", py);
      line.setAttribute("x2", w); line.setAttribute("y2", py);
      line.setAttribute("stroke", drawing.style.color);
      line.setAttribute("stroke-width", drawing.style.width);
      line.setAttribute("stroke-opacity", drawing.style.opacity);
      const dash = DASH_MAP[drawing.style.dash];
      if (dash) line.setAttribute("stroke-dasharray", dash);
      g.appendChild(line);
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", w - 4);
      label.setAttribute("y", py - 2);
      label.setAttribute("text-anchor", "end");
      label.setAttribute("fill", drawing.style.color);
      label.setAttribute("font-size", "10");
      label.textContent = drawing.style.label || (a.price >= 1000
        ? a.price.toLocaleString(undefined, { maximumFractionDigits: 2 })
        : a.price.toLocaleString(undefined, { maximumFractionDigits: 4 }));
      g.appendChild(label);
      svg.appendChild(g);
    },

    hitTest(drawing, x, y, layer, tol = 5) {
      const py = layer.series.priceToCoordinate(drawing.points[0].price);
      if (py == null) return false;
      return Math.abs(y - py) <= tol;
    },

    handles(drawing, layer) {
      const py = layer.series.priceToCoordinate(drawing.points[0].price);
      if (py == null) return [];
      const w = layer.svg.getBoundingClientRect().width;
      return [{ id: 0, kind: "endpoint", x: w / 2, y: py }];
    },

    moveHandle(drawing, handleId, x, y, layer) {
      const pt = layer.fromPx(x, y);
      if (pt) drawing.points[0].price = pt.price;
    },

    moveAll(drawing, dx, dy, layer) {
      const py = layer.series.priceToCoordinate(drawing.points[0].price);
      if (py == null) return;
      const newPrice = layer.series.coordinateToPrice(py + dy);
      if (newPrice != null) drawing.points[0].price = newPrice;
    },
  },
  {
    id: "vertical",
    name: "Vertical line",
    pointsNeeded: 1,
    defaultStyle: { color: "#ab47bc", width: 1, dash: "dashed", opacity: 1 },
    defaultScope: { showAllTimeframes: true, extend: "both" },

    render(svg, drawing, layer) {
      const [a] = drawing.points;
      const px = layer.chart.timeScale().timeToCoordinate(a.time);
      if (px == null) return;
      const h = layer.svg.getBoundingClientRect().height;
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("data-drawing-id", drawing.id);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", px); line.setAttribute("y1", 0);
      line.setAttribute("x2", px); line.setAttribute("y2", h);
      line.setAttribute("stroke", drawing.style.color);
      line.setAttribute("stroke-width", drawing.style.width);
      line.setAttribute("stroke-opacity", drawing.style.opacity);
      const dash = DASH_MAP[drawing.style.dash];
      if (dash) line.setAttribute("stroke-dasharray", dash);
      g.appendChild(line);
      if (drawing.style.label) {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("x", px + 4);
        t.setAttribute("y", 14);
        t.setAttribute("fill", drawing.style.color);
        t.setAttribute("font-size", "10");
        t.textContent = drawing.style.label;
        g.appendChild(t);
      }
      svg.appendChild(g);
    },

    hitTest(drawing, x, y, layer, tol = 5) {
      const px = layer.chart.timeScale().timeToCoordinate(drawing.points[0].time);
      if (px == null) return false;
      return Math.abs(x - px) <= tol;
    },

    handles(drawing, layer) {
      const px = layer.chart.timeScale().timeToCoordinate(drawing.points[0].time);
      if (px == null) return [];
      const h = layer.svg.getBoundingClientRect().height;
      return [{ id: 0, kind: "endpoint", x: px, y: h / 2 }];
    },

    moveHandle(drawing, handleId, x, y, layer) {
      const pt = layer.fromPx(x, y);
      if (pt) drawing.points[0].time = pt.time;
    },

    moveAll(drawing, dx, dy, layer) {
      const px = layer.chart.timeScale().timeToCoordinate(drawing.points[0].time);
      if (px == null) return;
      const newTime = layer.chart.timeScale().coordinateToTime(px + dx);
      if (newTime != null) drawing.points[0].time = typeof newTime === "number" ? newTime : Number(newTime);
    },
  },
  {
    id: "rectangle",
    name: "Rectangle",
    pointsNeeded: 2,
    defaultStyle: { color: "#26a69a", width: 1, dash: "solid", opacity: 1 },
    defaultScope: { showAllTimeframes: true, extend: "none" },

    render(svg, drawing, layer) {
      const pa = layer.toPx(drawing.points[0]);
      const pb = layer.toPx(drawing.points[1]);
      if (!pa || !pb) return;
      const x = Math.min(pa.x, pb.x), y = Math.min(pa.y, pb.y);
      const w = Math.abs(pb.x - pa.x), h = Math.abs(pb.y - pa.y);
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("data-drawing-id", drawing.id);
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", x); r.setAttribute("y", y);
      r.setAttribute("width", w); r.setAttribute("height", h);
      r.setAttribute("fill", withAlpha(drawing.style.color, 0.18 * drawing.style.opacity));
      r.setAttribute("stroke", drawing.style.color);
      r.setAttribute("stroke-width", drawing.style.width);
      r.setAttribute("stroke-opacity", drawing.style.opacity);
      const dash = DASH_MAP[drawing.style.dash];
      if (dash) r.setAttribute("stroke-dasharray", dash);
      g.appendChild(r);
      svg.appendChild(g);
    },

    hitTest(drawing, x, y, layer, tol = 4) {
      const pa = layer.toPx(drawing.points[0]);
      const pb = layer.toPx(drawing.points[1]);
      if (!pa || !pb) return false;
      const x1 = Math.min(pa.x, pb.x) - tol, x2 = Math.max(pa.x, pb.x) + tol;
      const y1 = Math.min(pa.y, pb.y) - tol, y2 = Math.max(pa.y, pb.y) + tol;
      return x >= x1 && x <= x2 && y >= y1 && y <= y2;
    },

    handles(drawing, layer) {
      const pa = layer.toPx(drawing.points[0]);
      const pb = layer.toPx(drawing.points[1]);
      if (!pa || !pb) return [];
      return [
        { id: 0,   kind: "endpoint", x: pa.x, y: pa.y },
        { id: 1,   kind: "endpoint", x: pb.x, y: pb.y },
        { id: "mid", kind: "mid",    x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
      ];
    },

    moveHandle(drawing, handleId, x, y, layer) {
      const pt = layer.fromPx(x, y);
      if (!pt) return;
      if (handleId == 0) drawing.points[0] = pt;
      else if (handleId == 1) drawing.points[1] = pt;
    },

    moveAll(drawing, dx, dy, layer) {
      const newPts = drawing.points.map((p) => {
        const px = layer.toPx(p);
        if (!px) return p;
        return layer.fromPx(px.x + dx, px.y + dy) || p;
      });
      drawing.points = newPts;
    },
  },
  {
    id: "fib",
    name: "Fibonacci retracement",
    pointsNeeded: 2,
    defaultStyle: { color: "#ec407a", width: 1, dash: "dashed", opacity: 0.9 },
    defaultScope: { showAllTimeframes: true, extend: "none" },

    render(svg, drawing, layer) {
      const pa = layer.toPx(drawing.points[0]);
      const pb = layer.toPx(drawing.points[1]);
      if (!pa || !pb) return;
      const xMin = Math.min(pa.x, pb.x), xMax = Math.max(pa.x, pb.x);
      const priceHi = Math.max(drawing.points[0].price, drawing.points[1].price);
      const priceLo = Math.min(drawing.points[0].price, drawing.points[1].price);
      const range = priceHi - priceLo;
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("data-drawing-id", drawing.id);
      for (const lvl of FIB_LEVELS) {
        const price = priceHi - range * lvl;
        const py = layer.series.priceToCoordinate(price);
        if (py == null) continue;
        const isEdge = lvl === 0 || lvl === 1;
        const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
        ln.setAttribute("x1", xMin); ln.setAttribute("y1", py);
        ln.setAttribute("x2", xMax); ln.setAttribute("y2", py);
        ln.setAttribute("stroke", drawing.style.color);
        ln.setAttribute("stroke-width", isEdge ? drawing.style.width + 1 : drawing.style.width);
        ln.setAttribute("stroke-opacity", drawing.style.opacity);
        if (!isEdge && drawing.style.dash !== "solid") {
          const dash = DASH_MAP[drawing.style.dash] || "4,3";
          ln.setAttribute("stroke-dasharray", dash);
        }
        g.appendChild(ln);
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("x", xMax + 4);
        t.setAttribute("y", py + 3);
        t.setAttribute("fill", drawing.style.color);
        t.setAttribute("font-size", "9");
        t.textContent = lvl.toFixed(3).replace(/\.?0+$/, "");
        g.appendChild(t);
      }
      svg.appendChild(g);
    },

    hitTest(drawing, x, y, layer, tol = 5) {
      const pa = layer.toPx(drawing.points[0]);
      const pb = layer.toPx(drawing.points[1]);
      if (!pa || !pb) return false;
      if (x < Math.min(pa.x, pb.x) - tol || x > Math.max(pa.x, pb.x) + tol) return false;
      const priceHi = Math.max(drawing.points[0].price, drawing.points[1].price);
      const priceLo = Math.min(drawing.points[0].price, drawing.points[1].price);
      const range = priceHi - priceLo;
      for (const lvl of FIB_LEVELS) {
        const py = layer.series.priceToCoordinate(priceHi - range * lvl);
        if (py != null && Math.abs(y - py) <= tol) return true;
      }
      return false;
    },

    handles(drawing, layer) {
      const pa = layer.toPx(drawing.points[0]);
      const pb = layer.toPx(drawing.points[1]);
      if (!pa || !pb) return [];
      return [
        { id: 0, kind: "endpoint", x: pa.x, y: pa.y },
        { id: 1, kind: "endpoint", x: pb.x, y: pb.y },
        { id: "mid", kind: "mid", x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
      ];
    },

    moveHandle(drawing, handleId, x, y, layer) {
      const pt = layer.fromPx(x, y);
      if (!pt) return;
      if (handleId == 0) drawing.points[0] = pt;
      else if (handleId == 1) drawing.points[1] = pt;
    },

    moveAll(drawing, dx, dy, layer) {
      const newPts = drawing.points.map((p) => {
        const px = layer.toPx(p);
        if (!px) return p;
        return layer.fromPx(px.x + dx, px.y + dy) || p;
      });
      drawing.points = newPts;
    },
  },
  {
    id: "channel",
    name: "Parallel channel",
    pointsNeeded: 3,
    defaultStyle: { color: "#9ccc65", width: 1, dash: "solid", opacity: 0.9 },
    defaultScope: { showAllTimeframes: true, extend: "none" },

    /**
     * points[0], points[1] = base trendline (A, B)
     * points[2]            = offset reference (C) — the parallel line passes through C
     *                        parallel to AB.
     */
    render(svg, drawing, layer) {
      const A = layer.toPx(drawing.points[0]);
      const B = layer.toPx(drawing.points[1]);
      const C = layer.toPx(drawing.points[2]);
      if (!A || !B || !C) return;
      const dx = B.x - A.x, dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const t = (C.x - A.x) * nx + (C.y - A.y) * ny;
      const D = { x: A.x + nx * t, y: A.y + ny * t };
      const E = { x: B.x + nx * t, y: B.y + ny * t };

      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("data-drawing-id", drawing.id);

      const fill = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      fill.setAttribute("points", `${A.x},${A.y} ${B.x},${B.y} ${E.x},${E.y} ${D.x},${D.y}`);
      fill.setAttribute("fill", withAlpha(drawing.style.color, 0.12 * drawing.style.opacity));
      fill.setAttribute("stroke", "none");
      g.appendChild(fill);

      const base = document.createElementNS("http://www.w3.org/2000/svg", "line");
      base.setAttribute("x1", A.x); base.setAttribute("y1", A.y);
      base.setAttribute("x2", B.x); base.setAttribute("y2", B.y);
      base.setAttribute("stroke", drawing.style.color);
      base.setAttribute("stroke-width", drawing.style.width);
      base.setAttribute("stroke-opacity", drawing.style.opacity);
      const dash = DASH_MAP[drawing.style.dash];
      if (dash) base.setAttribute("stroke-dasharray", dash);
      g.appendChild(base);

      const par = document.createElementNS("http://www.w3.org/2000/svg", "line");
      par.setAttribute("x1", D.x); par.setAttribute("y1", D.y);
      par.setAttribute("x2", E.x); par.setAttribute("y2", E.y);
      par.setAttribute("stroke", drawing.style.color);
      par.setAttribute("stroke-width", drawing.style.width);
      par.setAttribute("stroke-opacity", drawing.style.opacity);
      if (dash) par.setAttribute("stroke-dasharray", dash);
      g.appendChild(par);

      svg.appendChild(g);
    },

    hitTest(drawing, x, y, layer, tol = 5) {
      const A = layer.toPx(drawing.points[0]);
      const B = layer.toPx(drawing.points[1]);
      const C = layer.toPx(drawing.points[2]);
      if (!A || !B || !C) return false;
      if (distPointToSegment(x, y, A.x, A.y, B.x, B.y) <= tol) return true;
      const dx = B.x - A.x, dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const t = (C.x - A.x) * nx + (C.y - A.y) * ny;
      const D = { x: A.x + nx * t, y: A.y + ny * t };
      const E = { x: B.x + nx * t, y: B.y + ny * t };
      return distPointToSegment(x, y, D.x, D.y, E.x, E.y) <= tol;
    },

    handles(drawing, layer) {
      const out = [];
      drawing.points.forEach((p, i) => {
        const px = layer.toPx(p);
        if (px) out.push({ id: i, kind: "endpoint", x: px.x, y: px.y });
      });
      return out;
    },

    moveHandle(drawing, handleId, x, y, layer) {
      const pt = layer.fromPx(x, y);
      if (pt) drawing.points[+handleId] = pt;
    },

    moveAll(drawing, dx, dy, layer) {
      drawing.points = drawing.points.map((p) => {
        const px = layer.toPx(p);
        if (!px) return p;
        return layer.fromPx(px.x + dx, px.y + dy) || p;
      });
    },
  },
  {
    id: "arc",
    name: "Arc",
    pointsNeeded: 2,
    defaultStyle: { color: "#42a5f5", width: 1.5, dash: "solid", opacity: 1 },
    defaultScope: { showAllTimeframes: true, extend: "none" },

    render(svg, drawing, layer) {
      const pa = layer.toPx(drawing.points[0]);
      const pb = layer.toPx(drawing.points[1]);
      if (!pa || !pb) return;
      const rx = Math.abs(pb.x - pa.x) / 2;
      const ry = Math.abs(pb.y - pa.y) / 2 + Math.abs(pb.x - pa.x) / 4;
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("data-drawing-id", drawing.id);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${pa.x},${pa.y} A ${rx},${ry} 0 0 0 ${pb.x},${pb.y}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", drawing.style.color);
      path.setAttribute("stroke-width", drawing.style.width);
      path.setAttribute("stroke-opacity", drawing.style.opacity);
      const dash = DASH_MAP[drawing.style.dash];
      if (dash) path.setAttribute("stroke-dasharray", dash);
      g.appendChild(path);
      svg.appendChild(g);
    },

    hitTest(drawing, x, y, layer, tol = 6) {
      const pa = layer.toPx(drawing.points[0]);
      const pb = layer.toPx(drawing.points[1]);
      if (!pa || !pb) return false;
      const x1 = Math.min(pa.x, pb.x) - tol, x2 = Math.max(pa.x, pb.x) + tol;
      const yMin = Math.min(pa.y, pb.y) - Math.abs(pb.x - pa.x) / 4 - tol;
      const yMax = Math.max(pa.y, pb.y) + tol;
      return x >= x1 && x <= x2 && y >= yMin && y <= yMax;
    },

    handles(drawing, layer) {
      return drawing.points.map((p, i) => {
        const px = layer.toPx(p);
        return px ? { id: i, kind: "endpoint", x: px.x, y: px.y } : null;
      }).filter(Boolean);
    },

    moveHandle(drawing, handleId, x, y, layer) {
      const pt = layer.fromPx(x, y);
      if (pt) drawing.points[+handleId] = pt;
    },

    moveAll(drawing, dx, dy, layer) {
      drawing.points = drawing.points.map((p) => {
        const px = layer.toPx(p);
        if (!px) return p;
        return layer.fromPx(px.x + dx, px.y + dy) || p;
      });
    },
  },
  {
    id: "ruler",
    name: "Measurement ruler",
    pointsNeeded: 2,
    defaultStyle: { color: "#26c6da", width: 1, dash: "solid", opacity: 1 },
    defaultScope: { showAllTimeframes: true, extend: "none" },

    render(svg, drawing, layer) {
      const a = drawing.points[0], b = drawing.points[1];
      const pa = layer.toPx(a), pb = layer.toPx(b);
      if (!pa || !pb) return;
      const x = Math.min(pa.x, pb.x), y = Math.min(pa.y, pb.y);
      const w = Math.abs(pb.x - pa.x), h = Math.abs(pb.y - pa.y);
      const isUp = b.price >= a.price;
      const color = isUp ? "#26a69a" : "#ef5350";
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("data-drawing-id", drawing.id);

      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", x); r.setAttribute("y", y);
      r.setAttribute("width", w); r.setAttribute("height", h);
      r.setAttribute("fill", withAlpha(color, 0.15));
      r.setAttribute("stroke", color);
      r.setAttribute("stroke-width", 1);
      r.setAttribute("stroke-dasharray", "3,3");
      g.appendChild(r);

      // Compute readout numbers
      const dPrice = b.price - a.price;
      const dPct = a.price === 0 ? 0 : (dPrice / a.price) * 100;
      const dTime = Math.abs(b.time - a.time);
      const tfSec = ({ "1m":60, "5m":300, "15m":900, "1h":3600, "4h":14400, "1d":86400 })[layer.timeframe] || 60;
      const bars = Math.round(dTime / tfSec);
      const dHours = dTime / 3600;
      const tStr = dHours >= 24 ? `${(dHours/24).toFixed(1)}d`
                 : dHours >= 1  ? `${dHours.toFixed(1)}h`
                                : `${Math.round(dTime/60)}m`;

      // Render readout via foreignObject so we can use HTML styling
      const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
      fo.setAttribute("x", (pa.x + pb.x) / 2 - 70);
      fo.setAttribute("y", Math.min(pa.y, pb.y) - 38);
      fo.setAttribute("width", 140);
      fo.setAttribute("height", 36);
      const div = document.createElement("div");
      div.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      div.className = "draw-ruler-readout";
      // Build line1 + line2 via DOM (avoid innerHTML for user-derived numbers — minor XSS hygiene)
      const line1 = document.createElement("div");
      line1.className = "line1";
      line1.textContent = `${dPrice >= 0 ? "+" : ""}${dPrice.toFixed(2)} (${dPct >= 0 ? "+" : ""}${dPct.toFixed(2)}%)`;
      const line2 = document.createElement("div");
      line2.className = "line2";
      line2.textContent = `${bars} bar${bars === 1 ? "" : "s"} · ${tStr}`;
      div.append(line1, line2);
      fo.appendChild(div);
      g.appendChild(fo);

      svg.appendChild(g);
    },

    hitTest(drawing, x, y, layer, tol = 4) {
      const pa = layer.toPx(drawing.points[0]);
      const pb = layer.toPx(drawing.points[1]);
      if (!pa || !pb) return false;
      const x1 = Math.min(pa.x, pb.x) - tol, x2 = Math.max(pa.x, pb.x) + tol;
      const y1 = Math.min(pa.y, pb.y) - tol, y2 = Math.max(pa.y, pb.y) + tol;
      return x >= x1 && x <= x2 && y >= y1 && y <= y2;
    },

    handles(drawing, layer) {
      const pa = layer.toPx(drawing.points[0]);
      const pb = layer.toPx(drawing.points[1]);
      if (!pa || !pb) return [];
      return [
        { id: 0, kind: "endpoint", x: pa.x, y: pa.y },
        { id: 1, kind: "endpoint", x: pb.x, y: pb.y },
      ];
    },

    moveHandle(drawing, handleId, x, y, layer) {
      const pt = layer.fromPx(x, y);
      if (pt) drawing.points[+handleId] = pt;
    },

    moveAll(drawing, dx, dy, layer) {
      drawing.points = drawing.points.map((p) => {
        const px = layer.toPx(p);
        if (!px) return p;
        return layer.fromPx(px.x + dx, px.y + dy) || p;
      });
    },
  },
  {
    id: "text",
    name: "Text",
    pointsNeeded: 1,
    defaultStyle: { color: "#9ccc65", width: 1, dash: "solid", opacity: 1, label: "" },
    defaultScope: { showAllTimeframes: true, extend: "none" },

    render(svg, drawing, layer) {
      const pa = layer.toPx(drawing.points[0]);
      if (!pa) return;
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("data-drawing-id", drawing.id);
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", pa.x);
      dot.setAttribute("cy", pa.y);
      dot.setAttribute("r", 2);
      dot.setAttribute("fill", drawing.style.color);
      g.appendChild(dot);
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", pa.x + 6);
      text.setAttribute("y", pa.y + 4);
      text.setAttribute("fill", drawing.style.color);
      text.setAttribute("font-size", "11");
      text.setAttribute("opacity", drawing.style.opacity);
      text.textContent = drawing.style.label || "(text)";
      g.appendChild(text);
      svg.appendChild(g);
    },

    hitTest(drawing, x, y, layer, tol = 6) {
      const pa = layer.toPx(drawing.points[0]);
      if (!pa) return false;
      return x >= pa.x - tol && x <= pa.x + 80 && Math.abs(y - pa.y) <= 10;
    },

    handles(drawing, layer) {
      const pa = layer.toPx(drawing.points[0]);
      if (!pa) return [];
      return [{ id: 0, kind: "endpoint", x: pa.x, y: pa.y }];
    },

    moveHandle(drawing, handleId, x, y, layer) {
      const pt = layer.fromPx(x, y);
      if (pt) drawing.points[0] = pt;
    },

    moveAll(drawing, dx, dy, layer) {
      const px = layer.toPx(drawing.points[0]);
      if (!px) return;
      const np = layer.fromPx(px.x + dx, px.y + dy);
      if (np) drawing.points[0] = np;
    },

    /**
     * Called by DrawingLayer after the user clicks once. Prompts the user
     * for label text via an inline DOM input anchored to the click position.
     * Resolves with the entered text (empty string cancels).
     */
    promptLabel(layer, screenPt) {
      return new Promise((resolve) => {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.className = "draw-text-inline";
        Object.assign(inp.style, {
          position: "absolute",
          left: screenPt.x + "px",
          top: (screenPt.y - 10) + "px",
          zIndex: 7,
        });
        layer.handleHost.appendChild(inp);
        inp.focus();
        let done = false;
        const cleanup = () => {
          if (inp.parentNode) inp.parentNode.removeChild(inp);
        };
        const finish = (val) => {
          if (done) return;
          done = true;
          cleanup();
          resolve(val);
        };
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") finish(inp.value);
          else if (e.key === "Escape") finish("");
        });
        inp.addEventListener("blur", () => finish(inp.value));
      });
    },
  },
];

const TOOL_DEFS_BY_ID = Object.fromEntries(TOOL_DEFS.map((t) => [t.id, t]));

const DASH_OPTIONS = ["solid", "dashed", "dotted", "dashdot"];
const EXTEND_OPTIONS = ["none", "left", "right", "both"];

const StyleModal = {
  el: null,
  body: null,
  sub: null,
  deleteBtn: null,
  current: null,   // { drawing, layer }
  _before: null,   // snapshot of drawing at open(), for undo entry

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
      // Record the delete in history so Ctrl+Z restores the drawing.
      layer._pushHistory({ kind: "delete", before: layer._snap(drawing), after: null });
      // Discard the pending update entry (we're deleting, not editing).
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
    // Commit any pending edit as a single history entry on close.
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

const SettingsPopover = {
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
    // Close when clicking outside (defer one tick so the gear-click itself doesn't close us)
    setTimeout(() => {
      this._outsideClose = (ev) => {
        if (!this.el.contains(ev.target) && ev.target !== anchorEl) {
          this.close();
        }
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
    this._onKeyDown = null;

    // Undo / redo history (per pane, in-memory only).
    this.history = [];        // { kind: "create"|"update"|"delete", before, after }
    this.histPos = 0;         // index of next push; also the undo cursor
    this.maxHist = PrefsStore.get().undoDepth || 50;

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

    this.wrapper.addEventListener("click", (ev) => {
      DrawingLayer._activeLayer = this;
      this._onClick(ev);
    });
    // Also mark active on pointerdown so drag-initiating clicks on handles
    // (which stop propagation before bubbling to the click listener) still
    // mark this layer as the most-recently-interacted.
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

    // Cursor mode must remain interactive so clicks can hit-test for selection.
    this._setOverlayInteractive(true);

    this._onResize = () => this._redraw();
    this._onVisRange = () => this._redraw();
    this.chart.timeScale().subscribeVisibleTimeRangeChange(this._onVisRange);
    window.addEventListener("resize", this._onResize);

    this._onKeyDown = (ev) => {
      if (this._destroyed) return;
      // Don't hijack typing in form controls
      if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;

      // Ctrl/Cmd + Z (undo) and Ctrl/Cmd + Y / Shift+Z (redo).
      // Only the most-recently-active layer handles them; the
      // module-level DrawingLayer._activeLayer is set whenever any
      // layer's overlay receives a click. For the common 1-pane case
      // this picks the only layer; for multi-pane it picks whichever
      // the user last interacted with.
      const isUndo = (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === "z";
      const isRedo = (ev.ctrlKey || ev.metaKey) && (
        ev.key.toLowerCase() === "y" ||
        (ev.key.toLowerCase() === "z" && ev.shiftKey)
      );
      if (isUndo || isRedo) {
        // Route to the most-recently-interacted layer. Fall back to "this"
        // if nothing has been clicked yet (first action after boot).
        const active = DrawingLayer._activeLayer || this;
        if (active !== this) return;
        // Mark this layer active going forward (so the next keypress without
        // any new click also routes here, not to whichever other layer was
        // registered later).
        DrawingLayer._activeLayer = this;
        ev.preventDefault();
        if (isUndo) this.undo(); else this.redo();
        return;
      }

      // Esc cancels an in-progress placement and returns to cursor mode.
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

  _snapPoint(pt, modifiers) {
    const prefs = PrefsStore.get();
    const mode = prefs.snapDefault;      // "shift" | "always" | "never"
    const shouldSnap =
      mode === "always" ||
      (mode === "shift" && modifiers && modifiers.shiftKey);
    if (!shouldSnap || !this.getCandles) return pt;
    const candles = this.getCandles();
    if (!candles || candles.length === 0) return pt;
    // Find the candle whose time is closest to pt.time
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
    this._previewGroup = null;     // was removed with the rest
    // Sort by z so higher-z draws on top
    const sorted = this.drawings.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const d of sorted) {
      const def = TOOL_DEFS_BY_ID[d.tool];
      if (def && def.render) def.render(this.svg, d, this);
    }
    this._renderPreview();
    this._renderHandles();
  }

  /**
   * While placing a multi-click drawing, render a ghost of the in-progress
   * shape using placePoints + the current cursor position. Without this the
   * user sees nothing between the 1st and Nth click and assumes the tool is
   * broken. Cleared on commit, Esc, or tool change.
   */
  _renderPreview() {
    this._clearPreview();
    if (!this.svg) return;
    if (this.mode !== "placing" || !this.activeTool) return;
    const cur = this._previewCursor;
    if (!cur) return;
    const def = this.activeTool;
    // For 2+ point tools, wait for at least one committed point before previewing.
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
    // Any tool change cancels an in-progress placement preview.
    this._previewCursor = null;
    this._clearPreview();
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
      this._attachHandleDrag(el, d, h);
      this.handleHost.appendChild(el);
    }

    // Mini-toolbar above the topmost handle
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
          // Mid drag moves the whole shape; no snap here since dx/dy is relative.
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
      // Refresh the in-progress preview to reflect the new committed point.
      this._previewCursor = { x, y, shiftKey: ev.shiftKey };
      if (this.placePoints.length < this.activeTool.pointsNeeded) this._renderPreview();
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

        const def = this.activeTool;
        const points = this.placePoints.slice();
        this.placePoints = [];

        const commit = (labelText) => {
          if (def.id === "text" && labelText === "") {
            // empty cancel — don't commit a label-less text drawing
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
          // setActiveTool fires _notifyToolChange itself.
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
    // Undo history is per-pane and per-symbol — clear it on symbol change
    // so undo doesn't try to operate on drawings that no longer belong.
    this.history = [];
    this.histPos = 0;
    this.load();
    this._redraw();
  }

  // --- Undo / redo / erase-all ----------------------------------------

  _snap(d) { return JSON.parse(JSON.stringify(d)); }

  _pushHistory(entry) {
    // Trim any forward-history when a new action is taken after an undo.
    if (this.histPos < this.history.length) {
      this.history.length = this.histPos;
    }
    this.history.push(entry);
    // Refresh max from prefs in case the user just changed it
    this.maxHist = PrefsStore.get().undoDepth || 50;
    while (this.history.length > this.maxHist) {
      this.history.shift();
    }
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

// Static: the most-recently-interacted DrawingLayer instance. Used to
// route global Ctrl+Z / Ctrl+Y to the right pane when multiple panes
// exist. Set on any pointerdown/click in a layer's overlay.
DrawingLayer._activeLayer = null;

export { DrawingStore, PrefsStore, DrawingLayer, TOOL_DEFS, StyleModal, SettingsPopover, util };
