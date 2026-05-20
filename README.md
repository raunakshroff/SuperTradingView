# SuperTradingView

A local trading dashboard. Watch up to 8 live charts side-by-side, each with its own symbol, timeframe, and any combination of 32 technical indicators. Crypto streams in real time from Hyperliquid; Indian stocks come from a Flask bridge over yfinance. Built on Lightweight Charts v5 with native multi-pane support.

![SuperTradingView dashboard](docs/screenshot.png)

## Features

- **Configurable grid** — 1, 2, 4, 6, or 8 charts in the cleanest layout per count (1×1, 2×1, 2×2, 3×2, 4×2). Selection persists across reloads.
- **Independent panes** — each pane picks its own symbol and timeframe (1m, 5m, 15m, 1h, 4h, 1d). Per-pane state persists in `localStorage`.
- **Two default data sources, swappable**
  - **Hyperliquid** for crypto via the public WebSocket (`wss://api.hyperliquid.xyz/ws`), opened directly from the browser. Historical candles are proxied through Flask to avoid CORS.
  - **yfinance** for Indian stocks (NSE), bridged into the browser via Server-Sent Events. Polls every 2 s, emits on price change.
- **Pluggable data layer** — drop in Alpaca / Binance / Zerodha / Groww / Polygon by writing one class in [`data_source.py`](data_source.py) and adding it to the `REGISTRY`. No frontend changes needed.
- **32 technical indicators** with custom params and per-line colours:

  | Category | Indicators |
  |---|---|
  | Moving Averages | SMA, EMA, WMA, HMA, DEMA, TEMA |
  | Bands & Channels | Bollinger Bands, Donchian, Keltner |
  | Volume-weighted | VWAP |
  | Trend / Levels | Parabolic SAR, SuperTrend, Ichimoku Cloud |
  | Oscillators | RSI, Stochastic, Stochastic RSI, Williams %R, ROC, CCI, Awesome Osc, Ultimate Osc, TRIX, DPO, CMO |
  | Momentum | MACD, ADX (+DI/-DI), Aroon |
  | Volatility | ATR |
  | Volume | OBV, MFI, CMF, Volume |

  Sub-pane indicators (RSI, MACD, ADX, etc.) render in their own pane below the candles with their own price axis. Stretch factors scale automatically so the price chart stays usable however many sub-panes you stack.
- **Per-pane legend chips** in the top-left of each pane: indicator name + params + colour swatch + settings gear (⚙ opens the indicators modal scrolled to that exact indicator) + quick remove (×).
- **Live colour-coded ticker bar** in each pane header that flashes green or red on every price change.
- **Live symbol search** — as you type in any symbol input, the dropdown queries the backend, which merges:
  - a curated quick-load list of 30 popular Hyperliquid perps and NSE tickers (instant),
  - the full **Hyperliquid perp universe** via `/info?meta` (cached 1 hour),
  - **Yahoo Finance's global search** via `yfinance.Search` — equities, ETFs, indices, futures, crypto across every exchange Yahoo indexes.

  Type `TSLA` and you'll get Tesla + leveraged ETFs; type `tata motors` and you'll get the NSE/BSE listings; type `PEPE` and you'll get Hyperliquid's `kPEPE` perp. Each match carries its source so the chart routes correctly.
- **No build step, no deployment, no API keys** required for the default sources.

## Quick start

```bash
git clone https://github.com/raunakshroff/SuperTradingView.git
cd SuperTradingView
pip install -r requirements.txt
python app.py
```

Then open <http://127.0.0.1:5173>.

Requirements: Python 3.10+ and an internet connection (for the Hyperliquid WS and yfinance HTTP calls). The Lightweight Charts library is loaded from a CDN.

## Project layout

```
SuperTradingView/
├── app.py              # Flask app: /, /sources, /symbols, /history, /stream/quotes (SSE)
├── data_source.py      # DataSource ABC + HyperliquidSource + YFinanceSource + REGISTRY
├── symbols.json        # Curated quick-load list (instant); live search supplements via Hyperliquid + Yahoo
├── requirements.txt    # flask, yfinance, requests
└── static/
    ├── index.html      # Topbar, grid, pane template, indicators modal
    ├── style.css       # Dark theme, grid layout, modal, legend chips, flash animations
    ├── indicators.js   # 32 indicator defs with build / compute / apply per indicator
    └── app.js          # Pane class, Hyperliquid WS multiplexer, SSE client, modal, legends
```

## Adding a new data source

Subclass `DataSource` in [`data_source.py`](data_source.py) and register it:

```python
class AlpacaSource(DataSource):
    name = "alpaca"
    asset_class = "stock"

    def get_history(self, symbol: str, timeframe: str, limit: int = 500) -> list[Candle]:
        ...

    def stream_quotes(self, symbol: str, timeframe: str) -> Iterator[Quote]:
        # yield Quote objects; the Flask /stream/quotes endpoint relays them via SSE
        ...

    def search_symbols(self, query: str) -> list[dict]:
        return []

REGISTRY["alpaca"] = AlpacaSource()
```

Add a few `{ "symbol": "...", "label": "...", "source": "alpaca", "asset_class": "stock" }` entries to [`symbols.json`](symbols.json) and the frontend dropdowns + autocomplete pick them up automatically.

## Adding a new indicator

Append one definition to `DEFS` in [`static/indicators.js`](static/indicators.js):

```js
{
  id: "myind", name: "My Indicator", category: "Custom",
  overlay: true,        // true = draws on candle pane, false = own sub-pane
  params: [{ key: "period", default: 14, min: 2, max: 500 }],
  colors: [{ key: "line", label: "Line", default: "#42a5f5" }],
  build:   (chart, paneIndex, col) => [ohlcLine(chart, col.line, paneIndex)],
  compute: (candles, p)            => myMath(candles, +p.period),
  apply:   (series, data)          => series[0].setData(data),
}
```

The modal, chart wiring, persistence, sub-pane layout, legend chip, and colour pickers pick it up with no further changes.

## Architecture notes

- **Frontend is a single page with no framework** — `static/app.js` is ~700 lines of vanilla JS organised around a `Pane` class. One chart instance per pane.
- **Hyperliquid WebSocket multiplexer** — a single WS connection feeds every crypto pane via a callback registry, with exponential-backoff reconnect (1 s → 30 s cap).
- **yfinance over SSE** — `stream_quotes()` is a Python generator polled every 2 s; new prices are wrapped in `Quote` and yielded to the SSE response. The browser uses `EventSource` and patches the in-memory candle array (since `fast_info` only gives ticks, not OHLC bars).
- **Lightweight Charts v5 multi-pane** — sub-pane indicators are added via `chart.addSeries(LineSeries, opts, paneIndex)` with proportional `setStretchFactor`. Pane DOM is created on the next layout pass, so legend rendering is deferred via `requestAnimationFrame`.
- **State persistence** — `stv.chartCount` and `stv.panes` in `localStorage`. Per-pane state shape: `{ source, symbol, tf, indicators: { [id]: { ...params, colors: { [slot]: hex } } } }`.

## What's deliberately out of scope

- Order placement and any kind of trading
- User accounts, auth, deployment, Docker, cloud
- Heavy frontend frameworks
- Tests (it's mostly glue code around external services — manual smoke testing on the dashboard itself)

## License

MIT (do whatever you want with this).
