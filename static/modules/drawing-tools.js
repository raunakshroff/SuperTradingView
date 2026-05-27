// Drawing tool definitions: geometry helpers + TOOL_DEFS array.

import { withAlpha } from "../utils.js";

export function distPointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export const DASH_MAP = {
  solid: null,
  dashed: "8,4",
  dotted: "2,3",
  dashdot: "8,4,2,4",
};

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];

export const TOOL_DEFS = [
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

      const dPrice = b.price - a.price;
      const dPct = a.price === 0 ? 0 : (dPrice / a.price) * 100;
      const dTime = Math.abs(b.time - a.time);
      const tfSec = ({ "1m":60, "5m":300, "15m":900, "1h":3600, "4h":14400, "1d":86400 })[layer.timeframe] || 60;
      const bars = Math.round(dTime / tfSec);
      const dHours = dTime / 3600;
      const tStr = dHours >= 24 ? `${(dHours/24).toFixed(1)}d`
                 : dHours >= 1  ? `${dHours.toFixed(1)}h`
                                : `${Math.round(dTime/60)}m`;

      const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
      fo.setAttribute("x", (pa.x + pb.x) / 2 - 70);
      fo.setAttribute("y", Math.min(pa.y, pb.y) - 38);
      fo.setAttribute("width", 140);
      fo.setAttribute("height", 36);
      const div = document.createElement("div");
      div.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      div.className = "draw-ruler-readout";
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
        const cleanup = () => { if (inp.parentNode) inp.parentNode.removeChild(inp); };
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

export const TOOL_DEFS_BY_ID = Object.fromEntries(TOOL_DEFS.map((t) => [t.id, t]));
