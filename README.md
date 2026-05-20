# SuperTradingView

A local, browser-based multi-chart trading dashboard powered by [Lightweight Charts v5](https://tradingview.github.io/lightweight-charts/) and a Flask backend.

![layout](docs/specs/2026-05-20-supertradingview-design.md)

---

## Features

### Multi-chart layout
View 1, 2, 4, 6, or 8 live charts side-by-side in a responsive grid. Switch layouts with the icon buttons in the top bar — your selection and all per-pane state are persisted in `localStorage` across page reloads.

### Live data sources
| Source | Asset class | Mechanism |
|--------|------------|-----------|
| **Hyperliquid** | Crypto perpetuals | Browser WebSocket (no server round-trip) |
| **yfinance** | Indian equities & others | Flask SSE bridge (avoids CORS) |

### Per-pane controls
- **Symbol autocomplete** — type to search a curated symbol list (`symbols.json`)
- **Timeframe pills** — 1m · 5m · 15m · 1h · 4h · 1D · 1W pill buttons; active pill is highlighted
- **ƒx button** — opens the indicators modal; shows a live badge with the count of active indicators
- **Ticker bar** — colour-coded last price that flashes green/red on every tick

---

## Technical Indicators (33 total)

All indicators support customisable parameters and colours. Overlay indicators render on the main candle pane; sub-pane indicators open their own dedicated pane with a separate price axis.

| Category | Indicators |
|----------|-----------|
| **Moving Averages** | SMA, EMA, WMA, HMA, DEMA, TEMA |
| **Bands & Channels** | Bollinger Bands, Donchian Channels, Keltner Channels |
| **Volume-weighted** | VWAP (cumulative) |
| **Trend / Levels** | Parabolic SAR, SuperTrend, Ichimoku Cloud |
| **Oscillators** | RSI, Stochastic %K/%D, Stochastic RSI, Williams %R, Rate of Change, CCI, Awesome Oscillator, Ultimate Oscillator, TRIX, DPO, Chande Momentum (CMO) |
| **Momentum** | MACD, ADX (+DI / −DI), Aroon |
| **Volatility** | ATR |
| **Volume** | OBV, MFI, CMF, Volume |
| **Crossover** | MA Crossover — Golden / Death Cross |

### Multi-instance support
The same indicator can be added **multiple times** on the same chart with different parameters — e.g. SMA(20) + SMA(50) + SMA(200) on one pane. Each instance is tracked independently and shows an `#N` badge in the modal when more than one copy is active.

### MA Crossover — Golden / Death Cross
A dedicated crossover indicator that plots a fast MA and a slow MA (SMA or EMA, configurable) and stamps visual arrow markers directly on the candle chart:
- **Golden Cross** ↑ — fast MA crosses *above* slow MA (bullish signal)
- **Death Cross** ↓ — fast MA crosses *below* slow MA (bearish signal)

---

## UI / UX

### Top bar
- **Brand accent pill** — gradient mark beside the logo
- **Layout switcher** — five SVG grid-icon buttons (replaces a plain `<select>`) with the active layout highlighted

### Per-pane header
- **Timeframe pills** — horizontal scrollable pill row (replaces a `<select>`)
- **ƒx indicator button** — shows a count badge when indicators are active

### Indicators modal
- **Live search** — type to instantly filter the indicator list; shows an empty-state message when nothing matches
- **Active-state accent** — active indicators show a blue left-border highlight
- **Entrance animation** — panel slides up with a scale ease; backdrop fades in
- **Multi-instance UX** — "+ Add" button per indicator; each active instance shows a numbered header with a remove button

### Legend chips
- Per-pane overlay in the top-left of each chart
- Shows indicator name + current parameter values
- Gear icon (opens modal scrolled to that indicator) and × icon (removes instance) are **hover-only** to keep the chart clean

### General polish
- Design tokens: `--panel-3`, `--border-hi`, `--accent-hi`, consistent border radii and shadow
- Custom thin scrollbar throughout
- Hover-reveal legend controls

---

## Getting started

### Requirements
- Python 3.10+
- pip

### Install & run

```bash
pip install -r requirements.txt
python app.py          # starts on http://127.0.0.1:5173
```

Open `http://127.0.0.1:5173` in your browser.

---

## Project structure

```
SuperTradingView/
├── app.py              # Flask backend — serves static files, history, and SSE stream
├── data_source.py      # Pluggable data layer (Hyperliquid + yfinance)
├── symbols.json        # Curated symbol list with labels
├── requirements.txt
└── static/
    ├── index.html      # Shell — layout switcher, pane template, indicators modal
    ├── app.js          # Frontend — Pane class, layout management, modal wiring
    ├── indicators.js   # All 33 indicator definitions (compute + render)
    └── style.css       # Design tokens and all component styles
```

---

## Architecture notes

**Data flow**: browser → `/history` (initial candles) + `/stream/quotes` (SSE ticks) → Lightweight Charts series.

**Indicator keys**: the first instance of an indicator uses the bare `defId` as its state key (e.g. `"sma"`) so old persisted state loads correctly. Subsequent instances append a timestamp suffix (`"sma~1716200000000"`).

**Sub-pane ordering**: sub-pane indicators are rendered in DEFS declaration order, then by instance timestamp, ensuring stable reload order.

**State persistence**: `localStorage` keys `stv.chartCount` and `stv.panes` (array of per-pane objects with `symbol`, `tf`, `source`, and `indicators` map).
