# Graph Report - .  (2026-05-22)

## Corpus Check
- Corpus is ~39,691 words - fits in a single context window. You may not need a graph.

## Summary
- 283 nodes · 449 edges · 12 communities (8 shown, 4 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.84)
- Token cost: 104,332 input · 26,083 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Indicator Definitions|Indicator Definitions]]
- [[_COMMUNITY_Pane Class & Chart Lifecycle|Pane Class & Chart Lifecycle]]
- [[_COMMUNITY_Backend Data Sources|Backend Data Sources]]
- [[_COMMUNITY_Design Docs & Specs|Design Docs & Specs]]
- [[_COMMUNITY_DrawingLayer Overlay|DrawingLayer Overlay]]
- [[_COMMUNITY_App UI State & Modals|App UI State & Modals]]
- [[_COMMUNITY_Dashboard Screenshot UI|Dashboard Screenshot UI]]
- [[_COMMUNITY_Drawing Tool Defs & Utilities|Drawing Tool Defs & Utilities]]
- [[_COMMUNITY_External Data & Architecture Spec|External Data & Architecture Spec]]
- [[_COMMUNITY_Hyperliquid WebSocket Client|Hyperliquid WebSocket Client]]
- [[_COMMUNITY_Orphan Rationale|Orphan Rationale]]
- [[_COMMUNITY_Orphan Dependency|Orphan Dependency]]

## God Nodes (most connected - your core abstractions)
1. `Pane` - 39 edges
2. `DrawingLayer` - 29 edges
3. `Drawing Tools Design Spec` - 9 edges
4. `BTC Pane (1m timeframe, EMA 20 + RSI 14)` - 9 edges
5. `HyperliquidWS` - 8 edges
6. `CLAUDE.md (Project Guide)` - 8 edges
7. `Drawing Tools Implementation Plan` - 8 edges
8. `ema()` - 7 edges
9. `HyperliquidSource` - 6 edges
10. `YFinanceSource` - 6 edges

## Surprising Connections (you probably didn't know these)
- `Pluggable Data Layer (DataSource ABC + REGISTRY)` --semantically_similar_to--> `Pluggable Data Sources Pattern`  [INFERRED] [semantically similar]
  docs/superpowers/specs/2026-05-20-supertradingview-design.md → CLAUDE.md
- `TOOL_DEFS Array (Def-driven Tools)` --semantically_similar_to--> `Self-contained Indicator Defs`  [INFERRED] [semantically similar]
  docs/superpowers/specs/2026-05-20-drawing-tools-design.md → CLAUDE.md
- `Drawing Persistence (stv.drawings, stv.drawingPrefs)` --semantically_similar_to--> `State Persistence via localStorage`  [INFERRED] [semantically similar]
  docs/superpowers/specs/2026-05-20-drawing-tools-design.md → CLAUDE.md
- `sources()` --calls--> `list_sources()`  [INFERRED]
  app.py → data_source.py
- `symbols()` --calls--> `load_symbols()`  [INFERRED]
  app.py → data_source.py

## Hyperedges (group relationships)
- **Def-driven Module Pattern (Indicators + Drawings)** — claudemd_self_contained_indicator_defs, claudemd_self_contained_drawing_tool_defs, drawingspec_tool_defs, drawingplan_tool_defs [EXTRACTED 1.00]
- **Drawing Layer End-to-End Pipeline** — drawingplan_drawinglayer, drawingplan_drawingstore, drawingplan_tool_defs, drawingplan_coordinate_helpers, drawingplan_selection_handles, drawingplan_stylemodal [EXTRACTED 1.00]
- **Frontend localStorage Persistence** — claudemd_state_persistence, drawingspec_persistence, drawingplan_drawingstore, drawingplan_prefsstore [EXTRACTED 1.00]

## Communities (12 total, 4 thin omitted)

### Community 0 - "Indicator Definitions"
Cohesion: 0.06
Nodes (23): adx(), ao(), atr(), atrSeriesRaw(), DEFS, dema(), ema(), emaSeries() (+15 more)

### Community 1 - "Pane Class & Chart Lifecycle"
Cohesion: 0.11
Nodes (5): buildPanes(), Pane, panes, resolveSource(), saveState()

### Community 2 - "Backend Data Sources"
Cohesion: 0.08
Nodes (20): ABC, history(), SuperTradingView Flask backend.  Bridges yfinance into the browser via SSE, prox, Symbol search.      - No `q`: return the curated symbols.json list (instant, no, sources(), stream_quotes(), symbols(), Candle (+12 more)

### Community 3 - "Design Docs & Specs"
Cohesion: 0.08
Nodes (36): Things That Have Bitten Us, Lightweight Charts v5 Multi-Pane, CLAUDE.md (Project Guide), Self-contained Drawing Tool Defs, Self-contained Indicator Defs, State Persistence via localStorage, Symbol Search Merged Endpoint, toPx/fromPx Coordinate Helpers (+28 more)

### Community 5 - "App UI State & Modals"
Cohesion: 0.09
Nodes (22): btn, count, COUNT_LAYOUTS, { count, states }, DEFAULT_PANES, defIdOf(), gridEl, HL (+14 more)

### Community 6 - "Dashboard Screenshot UI"
Cohesion: 0.12
Nodes (25): App Header (SuperTradingView title + Number of Charts selector), Candlestick Series (green up / red down), Number of Charts Dropdown (set to 4), Mixed Asset Coverage (crypto BTC/ETH/SOL + Indian equity RELIANCE.NS), Dark Theme Visual Styling, SuperTradingView Dashboard UI, 4-Pane 2x2 Chart Grid Layout, fx Indicators Button (per-pane) (+17 more)

### Community 7 - "Drawing Tool Defs & Utilities"
Cohesion: 0.11
Nodes (13): _DASH_KEYS, DASH_MAP, DASH_OPTIONS, DEFAULT_PREFS, DrawingStore, EXTEND_OPTIONS, FIB_LEVELS, PrefsStore (+5 more)

### Community 8 - "External Data & Architecture Spec"
Cohesion: 0.18
Nodes (12): Pluggable Data Sources Pattern, Hyperliquid WebSocket (wss://api.hyperliquid.xyz/ws), yfinance Library, Layout Switcher (5 SVG buttons), Feature List (SuperTradingView), Flask >= 3.0 Dependency, yfinance >= 0.2.40 Dependency, Data Flow (HL WS, yfinance SSE) (+4 more)

## Knowledge Gaps
- **51 isolated node(s):** `SuperTradingView Flask backend.  Bridges yfinance into the browser via SSE, prox`, `Symbol search.      - No `q`: return the curated symbols.json list (instant, no`, `Pluggable data source layer.  To add a new broker (Alpaca, Binance, Zerodha, Gro`, `Yield Quote objects as new prices arrive. Used by SSE.`, `Fetch (and cache) the full Hyperliquid perp universe from /info?meta.` (+46 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Pane` connect `Pane Class & Chart Lifecycle` to `App UI State & Modals`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `DrawingLayer` connect `DrawingLayer Overlay` to `Drawing Tool Defs & Utilities`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `HyperliquidWS` connect `Hyperliquid WebSocket Client` to `App UI State & Modals`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `SuperTradingView Flask backend.  Bridges yfinance into the browser via SSE, prox`, `Symbol search.      - No `q`: return the curated symbols.json list (instant, no`, `Pluggable data source layer.  To add a new broker (Alpaca, Binance, Zerodha, Gro` to the rest of the system?**
  _51 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Indicator Definitions` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Pane Class & Chart Lifecycle` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._
- **Should `Backend Data Sources` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._