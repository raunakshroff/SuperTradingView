# Drawing Tools — Design Spec

**Date:** 2026-05-20
**Status:** Approved, ready for implementation plan

## Goal

Add a per-pane drawing layer to SuperTradingView. Users can place 9 kinds of annotations (trendline, horizontal line, vertical line, rectangle, fib retracement, parallel channel, arc, measurement ruler, text) on any chart, style them, edit them, and have them persist across reloads. Drawings follow the symbol — switching a pane to a different symbol hides its drawings; switching back restores them.

## Non-Goals

- Server-side persistence (drawings live in `localStorage`)
- Sharing drawings between users
- Drawing on sub-pane indicators (RSI, MACD, etc.) — drawings only live on the candle pane
- Custom drawing tool plugins from external files
- Auto-drawing (pattern recognition, AI lines)

## User-facing summary

- A **left-edge vertical toolbar** is added to each pane between the pane header and the chart canvas (~30 px wide). It hosts a cursor, 9 drawing tools, undo, erase-all, and a settings gear (13 buttons total, grouped by separator).
- The user can switch to a **floating-palette mode** (toggle in the settings gear): the toolbar disappears; clicking a "✏ Draw" button in the pane header shows the palette as a floating overlay inside the chart.
- Pick a tool, click on the chart to place points, drawing appears. The active tool returns to **Cursor** after each completed drawing (one-shot model).
- Hold **Shift** while clicking to snap the Y coordinate to the nearest candle's OHLC value. Time always snaps to the bar.
- Click an existing drawing to **select** it: it shows circular drag handles and a small floating mini-toolbar (✏ edit / ⎘ duplicate / ↑ bring-to-front / × delete). Drag endpoints to reshape, drag the mid handle to move the whole drawing.
- Click ✏ on the mini-toolbar to open the **Drawing style modal** (color, width, dash pattern, opacity, label, show-on-timeframes, extend direction).
- `Del` deletes the selected drawing. `Esc` deselects. `Ctrl/Cmd+Z` undoes the last create/delete/edit (history depth: 50).

## Architecture

### File layout

```
static/
├── drawings.js        # NEW — Tool defs, per-tool render() + hit-test, geometry helpers
├── drawings.css       # NEW — Toolbar, handle, mini-toolbar, style-modal styles
├── app.js             # MODIFY — Pane class owns a DrawingLayer instance
├── indicators.js      # unchanged
├── index.html         # MODIFY — Per-pane toolbar template, style-modal markup
└── style.css          # unchanged (token reuse from existing palette)
```

No backend changes. No new HTTP endpoints. No new Python dependencies.

### Module: `drawings.js`

Mirrors the def-driven architecture used in `indicators.js`:

```js
const TOOL_DEFS = [
  {
    id: "trendline",
    name: "Trendline",
    icon: "╱",           // unicode or SVG path
    pointsNeeded: 2,     // clicks to complete the drawing
    defaultStyle: { color: "#ffca28", width: 2, dash: "solid", opacity: 1 },
    render(svg, drawing, chart) { /* draw the shape; return root group */ },
    hitTest(drawing, x, y, chart, tol) { /* return true if (x,y) is on/near */ },
    handles(drawing, chart) { /* return [{ id, x, y, kind: "endpoint"|"mid" }] */ },
    moveHandle(drawing, handleId, x, y, chart) { /* mutate drawing.points */ },
    moveAll(drawing, dx, dy, chart) { /* mutate drawing.points by dx/dy */ },
  },
  // ... 10 more tools
];
```

Adding a new tool = appending one def. The `DrawingLayer` class iterates this array; it has no per-tool switch statements.

### Module: `DrawingLayer` (in `app.js` or top of `drawings.js`)

One instance per `Pane`. Owns:

- A SVG element overlaid on the chart canvas (positioned absolutely on `chart.panes()[0].getHTMLElement()`, same approach as the existing pane legend).
- A DOM layer for handles + mini-toolbar (siblings of the SVG, both inside the same positioned wrapper).
- An internal `Map<id, Drawing>` of drawings currently displayed.
- An undo history stack (length-capped at 50; entries are `{kind: "create"|"update"|"delete", before, after}`).
- A reference to the global drawing store (see persistence below).

The layer subscribes to the chart's `timeScale().subscribeVisibleTimeRangeChange` and a `ResizeObserver` so SVG positions stay in sync as the user pans / zooms / resizes the chart. Each redraw recomputes pixel coordinates from each drawing's `points: [{time, price}, ...]` using the chart's `timeToCoordinate` and `priceToCoordinate` APIs.

### Data model

```js
// A single drawing
{
  id: "drw_<random>",       // stable across reloads
  tool: "trendline",        // matches a TOOL_DEFS id
  points: [
    { time: 1779000000, price: 77300.5 },
    { time: 1779004500, price: 77800.0 },
  ],
  style: {
    color: "#ffca28",
    width: 2,
    dash: "solid",          // "solid" | "dashed" | "dotted" | "dashdot"
    opacity: 1,
    label: "Resistance",    // optional
  },
  scope: {
    showAllTimeframes: true, // false = only show on the timeframe noted below
    timeframe: null,         // string when showAllTimeframes is false
    extend: "none",          // "none" | "left" | "right" | "both" — applies to lines
  },
  z: 0,                      // higher = drawn on top
  createdAt: 1779000000,
}
```

### Persistence

Single `localStorage` key: `stv.drawings`. Value shape:

```js
{
  "<source>|<symbol>": [Drawing, Drawing, ...],   // e.g. "hyperliquid|BTC"
  "<source>|<symbol>": [...],
  // ...
}
```

A `DrawingStore` module (in `drawings.js`) is the single owner of reads/writes. `Pane` calls `store.get(source, symbol)` on every symbol change and pushes the result into its `DrawingLayer`. On every create/update/delete the layer calls `store.set(source, symbol, drawings)` which writes back to `localStorage` synchronously (no debounce — writes are infrequent and tiny).

A second `localStorage` key, `stv.drawingPrefs`, holds UI preferences:

```js
{ toolbarMode: "left" | "floating" }   // default: "left"
```

### Settings — toolbar placement toggle

The ⚙ at the bottom of the toolbar opens a small **Drawing settings** popover anchored to the gear button (a focused floating panel — not a modal, since the settings are few and the user may want to toggle and see the result live). It contains:

- **Toolbar placement** — radio: "Left edge (fixed)" / "Floating palette (hidden until ✏ Draw)"
- **Default snap behaviour** — radio: "Off (Shift to snap)" / "Always snap to OHLC" / "Never snap"
- **Undo history depth** — number (default 50)

Changes take effect across all panes immediately.

### Rendering

Each drawing renders into a `<g>` group inside the per-pane overlay `<svg>`. The SVG uses `vector-effect: non-scaling-stroke` on lines so stroke widths stay crisp at all zooms. Geometry primitives we'll need:

- **Line** (`<line>`) — trendline, horizontal, vertical, channel sides, ruler base
- **Path** (`<path>`) — fib levels (multiple horizontal lines via one path with M/L segments), arcs (single elliptical arc)
- **Rect** (`<rect>`) — rectangle/zone, ruler tooltip
- **Text** (`<text>` or HTML overlay) — text annotation, ruler measurement readout, level labels

The ruler tool draws a translucent rectangle + a small HTML overlay showing `Δprice`, `Δ%`, `bars`, `Δtime`. The overlay sits inside the same DOM wrapper as the handles.

### Hit testing

For each drawing the tool's `hitTest(drawing, x, y, chart, tol=4px)` runs on mousedown. The layer iterates drawings in descending `z` order so visually top-most wins. If nothing hit, the click either places a point (when a tool is active) or deselects.

Geometric helpers in `drawings.js`:

- `distPointToSegment(px, py, ax, ay, bx, by) → number` — for trendlines, channel sides, ruler base
- `pointInRect(px, py, x1, y1, x2, y2) → bool` — for rectangles
- `pointOnEllipticalArc(...) → bool` — for arcs (cheaper: test bounding box first)

### Interaction state machine

```
IDLE ──tool selected──▶ PLACING(tool, pointsSoFar)
PLACING ──click on chart──▶ if pointsSoFar+1 == tool.pointsNeeded:
                                  commit drawing, store, return to IDLE
                              else: stay in PLACING with the new point
PLACING ──Esc──▶ IDLE (cancel)
IDLE ──click on drawing──▶ SELECTED(drawing)
SELECTED ──drag handle──▶ EDITING(drawing, handleId)
SELECTED ──drag drawing body──▶ EDITING(drawing, "all")
SELECTED ──Esc / click empty──▶ IDLE
EDITING ──mouseup──▶ SELECTED (commit move, push undo entry)
SELECTED ──Del / × button──▶ IDLE (delete, push undo entry)
```

`Cursor` tool == IDLE state. Tool selection just switches the next click target.

### Undo / redo

A linear history stack on the `DrawingLayer`. Every `create`, `update`, `delete` pushes an entry with `before` and `after` snapshots of the affected drawing. `Ctrl+Z` pops and applies the inverse; `Ctrl+Y` (or `Ctrl+Shift+Z`) re-applies. Capped at 50 entries (configurable in settings). History is per-pane, lost on reload (storing it across sessions would bloat localStorage).

### Failure / edge cases

- **Symbol change mid-edit** — abort any in-progress drawing, deselect, swap the layer's drawings to the new symbol.
- **Pane removed** (grid count change) — `DrawingLayer.destroy()` removes the overlay and unsubscribes.
- **Drawing references a time outside current data range** — render whatever falls inside the visible range; clip the rest with SVG `clipPath`. Extended lines (`extend: "left"|"right"|"both"`) honour this.
- **Invalid persisted drawing** (schema changed, NaN time, missing tool) — drop it on load with a `console.warn`, don't crash.
- **Zero-length drawing** (user clicks the same point twice for a trendline) — discard, don't commit.
- **Sub-pane click** — clicks on the RSI / MACD pane are not captured by the drawing layer. The drawing layer only attaches to pane 0.

### Out of scope (deliberate)

- Drawing on sub-pane indicators
- Snap to indicator lines (only OHLC snap)
- Magnet mode (a TradingView feature)
- Pattern detection / auto-trendlines
- Drawing templates / presets
- Multi-select (select & move many at once)
- Right-click context menu (use the floating mini-toolbar instead)
- Touch / mobile gestures (desktop-only for v1)

## Toolbar buttons — full list

13 buttons total: 1 cursor + 9 drawing tools + 3 utilities (undo, erase, settings).

| # | Button | Kind | Clicks | Points stored | Notes |
|---|---|---|---|---|---|
| 1 | Cursor / Select | utility | n/a | n/a | Default mode |
| 2 | Trendline | drawing | 2 | 2 | `extend` from style |
| 3 | Horizontal line | drawing | 1 | 1 (price only, time ignored on render) | Always extends both ways |
| 4 | Vertical line | drawing | 1 | 1 (time only) | Always full height |
| 5 | Rectangle / zone | drawing | 2 | 2 | Fill = color @ 18 % opacity, stroke = color @ 100 % |
| 6 | Fibonacci retracement | drawing | 2 | 2 | Renders 0 / 0.236 / 0.382 / 0.5 / 0.618 / 0.786 / 1.0 levels |
| 7 | Parallel channel | drawing | 3 | 3 | First two = base trendline, third = offset point. Renders both parallel lines + translucent fill |
| 8 | Arc | drawing | 2 | 2 | Elliptical arc from point A to point B, bowing upward (style flag for direction later) |
| 9 | Measurement ruler | drawing | 2 | 2 | Renders bounding rect + readout: `Δprice / Δ% / bars / Δtime` |
| 10 | Text annotation | drawing | 1 | 1 | Editable label anchored to (time, price); inline input on creation |
| 11 | Undo | utility | n/a | n/a | Also `Ctrl+Z` |
| 12 | Erase all | utility | n/a | n/a | Confirm dialog |
| 13 | Settings ⚙ | utility | n/a | n/a | Opens the drawing settings popover |

## Implementation plan ordering hint

Build in this order (each milestone is independently shippable):

1. Toolbar shell, settings popover, persistence wiring (no drawings yet)
2. Trendline (proves the place / hit-test / handle / style / persist pipeline end-to-end)
3. Horizontal + Vertical lines (trivial after #2)
4. Rectangle, Fib, Channel, Arc (geometric variations)
5. Ruler + Text (UI-heavier; HTML overlays for readout / inline edit)
6. Undo / Erase / Floating-palette mode

Each milestone should be smoke-tested in a browser before moving on.
