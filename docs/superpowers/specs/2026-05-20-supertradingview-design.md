# SuperTradingView — Design Spec

**Date:** 2026-05-20
**Status:** Approved, ready for implementation

## Goal

Local web app showing 1/2/4/6/8 live trading charts in a responsive split-screen grid using Lightweight Charts. Each pane independently selects symbol + timeframe. Default data sources: Hyperliquid (crypto WebSocket) and yfinance (Indian stocks via Flask SSE). Data layer is pluggable so additional brokers (Alpaca, Binance, Zerodha, Groww, Polygon) can be added by writing one class.

## Non-Goals

- Order placement / trading
- User accounts, persistence beyond browser localStorage
- Deployment, Docker, cloud hosting
- API keys for default sources

## Architecture

Single-process Flask app:

- Serves the static frontend (`/`)
- Proxies Hyperliquid `/info` for historical candles (CORS bypass)
- Bridges yfinance via SSE (`/stream/quotes`) and history (`/history`)
- Exposes symbol search (`/symbols?q=`) and source registry (`/sources`)

Frontend opens Hyperliquid's public WebSocket directly (`wss://api.hyperliquid.xyz/ws`) for crypto streaming.

## File Layout

```
SuperTradingView/
├── app.py                 Flask app + routes
├── data_source.py         DataSource ABC + HyperliquidSource + YFinanceSource + REGISTRY
├── symbols.json           Curated crypto + NSE list
├── requirements.txt       flask, yfinance, requests
└── static/
    ├── index.html         Top bar (count selector) + grid container
    ├── style.css          CSS grid + flash animations
    └── app.js             Grid logic, panes, WS/SSE clients, Lightweight Charts
```

## Pluggable Data Layer

```python
class DataSource(ABC):
    name: str
    asset_class: str  # "crypto" | "stock"

    def get_history(self, symbol: str, timeframe: str, limit: int) -> list[Candle]: ...
    def stream_quotes(self, symbol: str) -> Iterator[Quote]: ...   # generator for SSE
    def search_symbols(self, query: str) -> list[Symbol]: ...

REGISTRY: dict[str, DataSource] = {
    "hyperliquid": HyperliquidSource(),
    "yfinance":    YFinanceSource(),
}
```

`Candle = {time, open, high, low, close, volume}`; `Quote = {time, price}`. Adding a broker = new subclass + one REGISTRY entry.

## Data Flow

| Asset | History | Live |
|-------|---------|------|
| Crypto | `GET /history?source=hyperliquid&symbol=BTC&tf=1m` → proxies Hyperliquid `candleSnapshot` | Browser opens `wss://api.hyperliquid.xyz/ws`, subscribes to `candle` channel per pane |
| Stock  | `GET /history?source=yfinance&symbol=RELIANCE.NS&tf=1m` → yfinance `Ticker.history` | `EventSource("/stream/quotes?source=yfinance&symbol=...&tf=...")` → Flask polls yfinance every 2s |

## Layout Rules

CSS grid with `--cols`/`--rows` set from JS:

| Count | Layout |
|-------|--------|
| 1 | 1×1 |
| 2 | 2×1 |
| 4 | 2×2 |
| 6 | 3×2 |
| 8 | 4×2 |

Top bar `<select>` persists selection to `localStorage.chartCount`. Per-pane state `{source, symbol, timeframe}` persists to `localStorage.panes` (array indexed by pane position).

## Per-Pane UI

- Symbol picker: `<input list="symbols-datalist">` with curated suggestions (BTC, ETH, SOL, HYPE, DOGE, AVAX + RELIANCE.NS, TCS.NS, INFY.NS, HDFCBANK.NS, ICICIBANK.NS, SBIN.NS, ITC.NS). Source auto-resolved from `symbols.json`.
- Timeframe dropdown: 1m, 5m, 15m, 1h, 4h, 1d.
- Ticker bar: last price + change indicator. Background flashes green if `new > last`, red if lower; fades back to neutral after 200ms via CSS transition.
- Lightweight Charts candlestick series, auto-resize on grid changes.

## Defaults

Curated symbol set with autocomplete. Default panes on first load: BTC/1m, ETH/1m, SOL/1m, RELIANCE.NS/1m (filled as count increases).

## Failure Handling

- WS disconnect → exponential backoff reconnect (1s → 30s cap); pane shows "reconnecting…" badge.
- yfinance error / market closed → SSE keeps connection open with periodic keepalive; pane shows last known price, no flash animations.
- Invalid symbol → toast on pane, revert to last working symbol.

## Out of Scope (deliberate)

- TDD: this is glue code with mostly external dependencies; manual smoke test only.
- Production deployment, HTTPS, auth.
- Volume bars, indicators (can add later, single function per indicator).
