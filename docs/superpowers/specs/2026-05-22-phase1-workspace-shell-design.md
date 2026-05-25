# Phase 1 — Workspace Shell Redesign

**Date:** 2026-05-22
**Branch:** `claude/design-phase1-workspace-shell`
**Source design:** Claude Design handoff bundle (`/tmp/design/supertradingview/`) — Workspace artboard
**Status:** Spec — awaiting user review before implementation plan

---

## Goal

Replace the current app shell with the design's **Workspace** artboard (top bar + 3-column layout + bottom dock + per-pane chrome), styled with the new "obsidian + acid lime" token system. Keep the existing Lightweight Charts v5 chart engine, indicator framework, and drawing layer untouched.

## Scope (in)

- New visual system: tokens, Geist + Geist Mono fonts, light/dark themes
- New page shell: 48px topbar + 3-column workspace (260px left rail / center grid / 280px right rail) + 36px bottom dock
- Topbar: brand · personality segmented control · ⌘K placeholder button · live clock · 7-preset layout selector · avatar mock
- Left rail: Narratives card · Factor Pulse · Events
- Right rail: AI Insight (deterministic, not LLM) · Live Signals · News Tape
- Bottom dock: P/L (mock, badged "demo") · advancers/decliners (real) · US10Y · VIX
- Per-pane chrome restyle (no logic changes)
- 4 personality presets (Minimalist / Quant / Scalper / Investor) that set chart count + symbols
- Light/dark theme toggle (persisted)
- 6 new backend endpoints + 4 new service modules

## Scope (out — explicitly deferred)

- Focus Mode, AI Copilot screen, Sectors RRG, Watchlist screens (narratives/heatmap/quant), Ultra-wide, Tablet, Mobile artboards
- Real ⌘K command palette logic (button is a placeholder this round)
- Real LLM copilot (deterministic insight only)
- Portfolio / order management (P/L stays mock-with-badge)
- NYSE TICK (no free data source; replaced with VIX)
- Redis caching layer (server-side dict caches this round; Redis follows as a separate refactor)

---

## 1. Visual system

Wholesale-copy the design package's `styles.css` (`/tmp/design/supertradingview/project/styles.css`) into the top of `static/style.css`, replacing the current `:root` block. Includes:

- Surfaces (`--void` through `--surface-4`), hairlines, text scale (`--ink` → `--ink-ghost`)
- Acid accent (`--acid` = `#d4ff3a`, with `--acid-soft`/`--acid-glow`/`--acid-deep`/`--on-acid`)
- P&L (`--up` = `#5fbb7e`, `--down` = `#d6635f`, plus soft/glow variants)
- Signals/warn (`--signal`, `--warn`)
- Radii (`--r-xs` through `--r-xl`), shadows (`--shadow-1/2/lift`)
- Type tokens (`--font-sans` Geist, `--font-mono` Geist Mono, `--font-serif` Instrument Serif)
- Utility classes: `.pill`, `.chip`, `.kbd`, `.glass`, `.grain`, `.vignette`, `.depth-mask`, `.live-dot`, `.mono`, `.tnum`, `.serif`, `.up`/`.down`/`.muted`/`.soft`/`.faint`
- `[data-theme="light"]` full token override

Apply theme via `document.documentElement.setAttribute('data-theme', ...)`. Persist in `localStorage["stv.theme"]`. Default dark.

The existing `style.css` body (~700 lines of pane/topbar/modal styling) is rewritten section-by-section against the new tokens; structure preserved.

## 2. Page shell

New layout in `index.html`:

```
<body>
  <header class="topbar">…</header>
  <main class="workspace">
    <aside class="rail rail-left">…</aside>
    <div class="grid" id="grid">…</div>
    <aside class="rail rail-right">…</aside>
  </main>
  <footer class="bottom-dock">…</footer>
</body>
```

CSS:
- `body` is `display: flex; flex-direction: column`
- `.workspace` is `display: grid; grid-template-columns: 260px 1fr 280px; gap: 10px; padding: 10px`
- Below 1280px viewport: rails hidden via `display: none`, grid is full-width

The existing `<template id="pane-template">` and its template clone logic stay as-is — only the surrounding chrome moves.

## 3. Topbar

```
[brand]  [personality 4-segment]  …  [⌘K search button]  …  [● 14:32:08 ET]  [layout selector]  [avatar]
```

- **Personality segmented control** — 4 buttons. Active state uses `--surface-3` background. Click sets `state.personality` (see § 8) and applies preset.
- **⌘K button** — visually styled per design (icon + "Search markets, run signal, ask copilot…" + `⌘ K` kbd hint). On click, shows a toast: "Command palette coming soon". `⌘K` keyboard shortcut wired to the same toast.
- **Clock** — `setInterval(updateClock, 1000)`. Format: `HH:MM:SS ET` (UTC+5 hack, no real TZ lib).
- **Layout selector** — the current row of 5 inline icon buttons in `index.html` (`.layout-switcher` with `data-count="1/2/4/6/8"`) is replaced with a **single button + glass popover**. The button shows the active layout's mini SVG icon + count + chevron; clicking opens a 4-column grid of all 7 preset icons. Repositioned to top-right (current is between brand and grid switcher's previous position). Expanded to 7 presets:

| ID | Label | Count | Areas |
|---|---|---|---|
| 1 | 1 up | 1 | `"a"` |
| 2 | 2 H | 2 | `"a b"` |
| 3 | 2 V | 2 | `"a" "b"` |
| 4 | 1+2 | 3 | `"a b" "a c"` |
| 5 | 2×2 | 4 | `"a b" "c d"` |
| 6 | 3×2 | 6 | `"a b c" "d e f"` |
| 7 | 4×2 | 8 | `"a b c d" "e f g h"` |

Current persisted state is just `stv.chartCount` (1/2/4/6/8). Migration: on load, if `stv.layoutId` is absent, map count → closest layoutId (1→1, 2→2, 4→5, 6→6, 8→7). New key: `localStorage["stv.layoutId"]`. Old key kept for back-compat read for one release.

The layout selector renders the design's mini SVG layout icons in a glass popover.

- **Avatar** — initials "QT" in a gradient square. Click is no-op for now.

## 4. Left rail components

All three cards are `.glass` with `var(--r-lg)` corners, `padding: 14px`.

### 4a. Narratives

UI: chip row at top (one per narrative theme) + the selected narrative's symbol list with sparkline + last + day %.

Data: `GET /narratives` returns `[{id, title, desc, symbols: ["NVDA", "AMD", ...]}]`. Server reads `narratives.json` (committed to repo). Initial seed matches design:

| id | Title | Theme |
|---|---|---|
| ai | AI boom | NVDA, AMD, AVGO, SMCI, PLTR, ARM |
| energy | Energy cycle | XOM, CVX, OXY, SLB, COP, EOG |
| war | War risk | LMT, NOC, RTX, GD, HII, LDOS |
| cuts | Rate cuts | TLT, HYG, XLU, REZ, REIT, XLRE |
| reflation | Reflation | CAT, DE, FCX, VALE, X, NUE |
| mag7 | Mag 7 | AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA |

Sparkline data comes from existing `/history?source=yf&symbol={sym}&tf=1D`, last 40 candles. Client caches per `(source,symbol)` in-memory for 5 min.

### 4b. Factor Pulse

6 factors with z-scores rendered as bipolar bar:

| Factor | Computation |
|---|---|
| Momentum | (price_t / price_{t-252} - price_t / price_{t-21}) — classic 12-1 |
| Low Vol | -stdev(log returns, 60d) (negated so positive = low-vol leadership) |
| Size | -log(market_cap) (negated so positive = small-cap leadership) |
| Value | -P/E (negated so positive = value leadership) |
| Quality | ROE |
| Growth | revenue YoY growth |

Universe: **100 large-cap US equities**, hand-curated `factor_universe.json` (S&P 100-ish constituents).

Computation, per factor:
1. Compute each symbol's raw factor value (see table above).
2. Standardize: z-score across the 100-symbol universe.
3. Form a top-quintile / bottom-quintile "factor portfolio": equal-weight long top 20, short bottom 20.
4. Compute that portfolio's 60-day cumulative return.
5. Divide by the portfolio's 60-day return stdev — yields a Sharpe-like factor strength reading.

This single number is the `z` shown in the design's bipolar bar. Positive = factor is *paying* in the current regime; negative = factor is *losing*.

Data sources:
- Price data: `yfinance.Ticker(sym).history(period="2y", interval="1d")`
- Fundamentals (mkt cap, P/E, ROE, rev growth): `yfinance.Ticker(sym).info` — slow first call (~500ms/symbol), batched
- All cached server-side in a simple dict with 30-min TTL (factor pulse re-computes lazily)

Endpoint: `GET /factors` returns `[{name, z, weight}]`. Empty/stale-friendly: returns last cached value while recomputing in background thread.

### 4c. Events

Returns next 7 days of:
- **FRED economic releases** — CPI, FOMC minutes, FOMC rate decision, NFP, PPI, GDP, Powell speeches. Source: hand-curated `events.json` updated weekly **OR** scrape https://www.federalreserve.gov/json/calendar.json (free, no key). Start with hand-curated; swap to scrape in a follow-up.
- **Earnings dates** for symbols currently shown in any pane — `yfinance.Ticker(sym).calendar` → `Earnings Date`.

Endpoint: `GET /events?symbols=AAPL,MSFT,...` returns `[{when, label, tone}]` where:
- `when` is human-readable ("in 18m", "15:30", "Tomorrow", "Thu")
- `tone` is `"acid"` (next earnings <24h), `"warn"` (<1h FOMC/CPI), or `"neutral"`

Server-side caching: hand-curated calendar reread on file change; earnings cached 1h per symbol.

## 5. Right rail components

### 5a. AI Insight

**Not a real LLM.** Deterministic insight derived from current chart state.

UI per design: header with acid-gradient icon + "Copilot · {SYM}" + LIVE pill. Body paragraph using cited helpers. 4 metric rows. "Ask copilot about {SYM} · ⌘J" button (placeholder).

Insight generation (client-side, in `app.js`):
- **Direction**: bullish if `last > sma200`, else bearish
- **Regime**: "vol-cluster active" if 5d realized vol > 1.5× 60d realized vol
- **Hidden divergence**: reuse existing `indicators.js` RSI computation; check if price made higher high but RSI made lower high over last 20 bars
- **First demand reclaim**: `last × 0.985` (placeholder formula matching design)
- **Similar setups**: count bars in last 252 where (RSI, MA-spread, vol-bucket) match current ±tolerance → "{N} historical · {W}% win" (win = next 5-bar return > 0)
- **Liquidity above**: highest high last 20d
- **Implied σ (1D)**: realized 60d vol ÷ √252 expressed as percentage
- **Institutional flow**: "Accumulating" if 20d OBV trending up else "Distributing"

The "Ask copilot" button shows the same "coming soon" toast as ⌘K.

### 5b. Live Signals

`GET /signals?symbols=...` (the curated factor universe). Server runs the existing indicator math:
- **Hidden bull/bear divergence** on RSI (last 4H bars)
- **Trend break** — close crosses 200-MA after 20+ bars below/above
- **Liquidity sweep + reclaim** — wick beyond 20d high/low, body closes back inside

Returns top 5 by strength, format: `[{symbol, side: "long"|"short", message, sigma}]`. Cached 60s.

### 5c. News Tape

`GET /news` uses Python `feedparser` over:
- Yahoo Finance Top Stories: `https://finance.yahoo.com/rss/topstories`
- Reuters Business: `https://feeds.reuters.com/reuters/businessNews`
- MarketWatch Top Stories: `https://feeds.marketwatch.com/marketwatch/topstories/`

Returns latest 10 items merged + sorted by `published`, format: `[{time, source: "BBG"|"RTRS"|"WSJ"|..., text, url}]`. Source label uses simple host-to-shortcode map. Cached 5 min.

`feedparser` is the only new Python dep.

## 6. Bottom dock

Single horizontal row, mono font, `--ink-soft` for labels, `--ink` for values.

| Field | Source |
|---|---|
| P/L Day | **Mock** — hardcoded `+$12,847.43`. Badged with a small `demo` pill so it's clearly fake |
| Open positions | **Mock** — hardcoded `6` |
| Exposure | **Mock** — hardcoded `62%` |
| Risk-on / factor tilt | Derived from `/factors` — pick top-z factor, display "{factor} +{z}σ" |
| Advancers / Decliners | Computed from existing pane symbols + factor universe day-change |
| US10Y | `^TNX` via existing yfinance source, polled 5 min |
| VIX | `^VIX` via existing yfinance source, polled 5 min |

`GET /quote/breadth?universe=…` returns `{adv, dec, us10y, vix, top_factor}`. Cached 60s.

## 7. Pane chrome restyle

CSS-only changes to `static/style.css`. **No JS changes to `app.js`'s pane/chart/indicator/drawing logic.**

Changes per pane:
- `.pane` gets `var(--r-md)` corners, `var(--surface-1)` background, `var(--line-soft)` border
- `.pane-header` padding `10px 12px`, `var(--line-faint)` bottom border
- Symbol `<input>` styled to look like a button (background `--surface-2`, border `--line-soft`, mono font, weight 600)
- `.tf-pills` becomes a segmented control with `--surface-2` track and `--surface-4` active
- `.fx-btn` and `.ph-draw-toggle` repainted as 26×26 ghost icon buttons
- `.ticker-price` switched to `var(--font-mono)` + `font-feature-settings: tnum`, weight 600, size 18px
- `.ticker-change` repainted with `--up`/`--down`
- `.draw-toolbar` background changes to `--surface-1`, active tool gets `--acid-soft` background + `--acid` foreground
- Indicator legend chips (`_refreshLegends` output): restyled to the design's "● SMA 20 · ● SMA 50 · LIVE" inline mono format. Existing JS already produces these; only the CSS class styling changes.

## 8. Personality presets

Client-side object in `app.js`:

```js
const PERSONALITY_DEFAULTS = {
  Minimalist: { layoutId: 1, syms: ['NVDA'],                       tf: '1D' },
  Quant:      { layoutId: 5, syms: ['SPY','NVDA','TLT','^VIX'],    tf: '1H' },
  Scalper:    { layoutId: 5, syms: ['ES=F','NQ=F','NVDA','TSLA'],  tf: '5m' },
  Investor:   { layoutId: 4, syms: ['SPY','TLT','GLD'],            tf: '1D' },
};
```

Behavior:
- Default on first run: Quant
- Switching personality re-runs `setLayoutId` + replaces all pane symbols + sets all pane timeframes
- Existing per-pane indicators are *kept* (do not reset)
- Persisted as `localStorage["stv.personality"]`

## 9. Backend additions

### New files

| Path | Purpose |
|---|---|
| `narratives.json` | Curated themes (see § 4a table) |
| `factor_universe.json` | 100 S&P 100-ish tickers |
| `events.json` | Hand-curated economic calendar (next-7-days, manually maintained) |
| `services/__init__.py` | Package marker |
| `services/factors.py` | Factor z-score computation + caching |
| `services/sectors.py` | Yfinance-driven sector lookup + cache |
| `services/news.py` | RSS aggregation |
| `services/events.py` | FRED + yfinance earnings calendar |
| `services/signals.py` | Live signal scanner using existing indicator math |
| `services/breadth.py` | Adv/dec/US10Y/VIX aggregation |
| `services/_cache.py` | Simple dict cache w/ TTL; Redis swap point later |

### New routes in `app.py`

| Route | Returns | Cache |
|---|---|---|
| `GET /narratives` | `[{id, title, desc, symbols}]` | static (read on startup, re-read on file change) |
| `GET /factors` | `[{name, z, weight}]` | 30 min server-side |
| `GET /events?symbols=…` | `[{when, label, tone}]` | 1h per-symbol earnings; calendar reread on file change |
| `GET /signals?symbols=…` | `[{symbol, side, message, sigma}]` | 60s |
| `GET /news` | `[{time, source, text, url}]` | 5 min |
| `GET /quote/breadth?universe=…` | `{adv, dec, us10y, vix, top_factor}` | 60s |

All routes are read-only, JSON, follow existing Flask error-handling conventions.

### Caching strategy

`services/_cache.py` exposes:

```python
class TTLCache:
    def __init__(self, ttl_seconds: int): ...
    def get(self, key) -> Any | _MISSING: ...
    def set(self, key, value): ...
    def get_or_compute(self, key, fn, *, stale_ok: bool = True) -> Any: ...
```

`stale_ok=True` returns stale value while triggering background recompute (factor pulse uses this). Thread-safe via `threading.Lock`.

**Redis swap point**: `_cache.py`'s public API stays the same; in a future refactor, the dict backing store is replaced with Redis (`SET key value EX ttl`). Service callers don't change.

### New Python dependencies

- `feedparser` — RSS parsing

That's it. Sector data comes from existing `yfinance` import; no new deps.

### Sector lookup (deferred surfacing, but built now)

Even though there's no Sectors UI in Phase 1, the **factor pulse** universe needs sector groupings (some factors are sector-neutral in real implementations; we'll keep this simple — no neutralization in Phase 1 — but sectors data is needed for Phase 2's RRG board so we build the cache layer now).

`services/sectors.py`:
- `get_sector(sym) -> str` — lazy lookup via `yfinance.Ticker(sym).info.get("sector")`
- Server-side dict cache, no TTL (sectors don't change); persisted to `sectors_cache.json` so we don't re-hit yfinance on every restart
- First call per symbol blocks ~500ms; subsequent calls are instant

## 10. Risks / things to validate

| Risk | Mitigation |
|---|---|
| `yfinance.info` is slow & unreliable (rate-limit hangs) | Per-symbol cache; pre-warm factor universe at startup in a background thread; fall back to last-known good value |
| RSS feeds break / 403 | Cache stale value indefinitely on error; degrade gracefully — empty list better than 500 |
| Geist fonts blocked on client (corp networks) | CSS `font-family` fallback chain `-apple-system, BlinkMacSystemFont, …` |
| `^VIX` / `^TNX` not available on some yfinance versions | Existing `YFinanceSource.get_history` already handles these; verified |
| Layout migration breaks user's persisted state | Read both `stv.chartCount` (legacy) and `stv.layoutId` (new); migrate on first load and write new key; keep reading legacy for one release |
| Free RSS feeds limit news to titles-only | Acceptable for Phase 1 — tape design only shows source + headline, no body |
| New left/right rails compete with chart width on small screens | Hide rails < 1280px viewport; chart grid fills full width |
| Personality switch loses user's per-pane symbol customizations | Confirm dialog before applying? **Decision**: no confirm — switching personalities is the explicit user action; expected to mutate panes |

## 11. Migration plan summary

This is a destructive visual overhaul of `static/style.css`, `static/index.html`, and `static/app.js`. To minimize risk:
1. Work on `claude/design-phase1-workspace-shell` branch (done)
2. Implement tokens + shell first; confirm chart still renders
3. Add rails one card at a time (mock data first, then real); confirm chart unaffected each step
4. Add personality switching
5. Backend endpoints last; rails read real data
6. Manual smoke test of: indicators modal, drawing toolbar, undo/redo, multi-pane, theme toggle, personality switch, all 7 layout presets

Old branch (`main`) remains the rollback target.

---

## Open questions

None. Awaiting user review.
