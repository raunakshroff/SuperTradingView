/* SuperTradingView frontend
 *
 * Grid of N panes, each with its own chart, symbol, and timeframe.
 * Crypto streams from Hyperliquid WS (multiplexed). Stocks stream from
 * the Flask SSE bridge. Layout + per-pane state persisted in localStorage.
 */

// --- Theme bootstrap (must run before chart init) ---------------------------
(function () {
  const t = localStorage.getItem("stv.theme") || "dark";
  document.documentElement.setAttribute("data-theme", t);
})();

const LAYOUTS = [
  { id: 1, n: 1, label: "1 up",  cols: "1fr",             rows: "1fr",     areas: '"a"' },
  { id: 2, n: 2, label: "2 H",   cols: "1fr 1fr",         rows: "1fr",     areas: '"a b"' },
  { id: 3, n: 2, label: "2 V",   cols: "1fr",             rows: "1fr 1fr", areas: '"a" "b"' },
  { id: 4, n: 3, label: "1+2",   cols: "2fr 1fr",         rows: "1fr 1fr", areas: '"a b" "a c"' },
  { id: 5, n: 4, label: "2×2",   cols: "1fr 1fr",         rows: "1fr 1fr", areas: '"a b" "c d"' },
  { id: 6, n: 6, label: "3×2",   cols: "1fr 1fr 1fr",     rows: "1fr 1fr", areas: '"a b c" "d e f"' },
  { id: 7, n: 8, label: "4×2",   cols: "1fr 1fr 1fr 1fr", rows: "1fr 1fr", areas: '"a b c d" "e f g h"' },
];
const AREA_KEYS = ["a", "b", "c", "d", "e", "f", "g", "h"];

const DEFAULT_PANES = [
  { source: "hyperliquid", symbol: "BTC",         tf: "1m", indicators: {} },
  { source: "hyperliquid", symbol: "ETH",         tf: "1m", indicators: {} },
  { source: "hyperliquid", symbol: "SOL",         tf: "1m", indicators: {} },
  { source: "yfinance",    symbol: "RELIANCE.NS", tf: "1m", indicators: {} },
  { source: "hyperliquid", symbol: "HYPE",        tf: "1m", indicators: {} },
  { source: "yfinance",    symbol: "TCS.NS",      tf: "1m", indicators: {} },
  { source: "hyperliquid", symbol: "DOGE",        tf: "1m", indicators: {} },
  { source: "yfinance",    symbol: "INFY.NS",     tf: "1m", indicators: {} },
];


const LS_COUNT = "stv.chartCount";
const LS_PANES = "stv.panes";
const LS_LAYOUT_ID = "stv.layoutId";

// Returns the base indicator def-id from an instance key.
// "sma"        → "sma"   (single instance uses bare id for backward compat)
// "sma~123456" → "sma"   (additional instances append ~<timestamp>)
function defIdOf(key) {
  const i = key.indexOf("~");
  return i < 0 ? key : key.slice(0, i);
}

// --- Symbol registry --------------------------------------------------------

const SYMBOLS = { byKey: new Map(), all: [], timeframes: [] };

function _renderSymbolsDatalist(symbols) {
  const dl = document.getElementById("symbols-datalist");
  // Build with DOM API so user-controlled labels can't inject HTML.
  while (dl.firstChild) dl.removeChild(dl.firstChild);
  for (const s of symbols) {
    const opt = document.createElement("option");
    opt.value = s.symbol;
    opt.textContent = `${s.label} (${s.asset_class})`;
    dl.appendChild(opt);
  }
}

function _registerSymbols(symbols) {
  for (const s of symbols) {
    SYMBOLS.byKey.set(s.symbol.toUpperCase(), s);
  }
}

async function loadSymbols() {
  const res = await fetch("/symbols");
  const data = await res.json();
  SYMBOLS.all = data.symbols;
  SYMBOLS.timeframes = data.timeframes;
  _registerSymbols(data.symbols);
  _renderSymbolsDatalist(data.symbols);
}

// Debounced live search against /symbols?q=...
// The backend merges curated matches with Hyperliquid /info?meta and
// yfinance.Search (Yahoo Search API).
let _searchTimer = null;
let _searchToken = 0;

function querySymbolsDebounced(query, delay = 250) {
  clearTimeout(_searchTimer);
  if (!query || query.length < 1) {
    // Empty input: show the curated default list again
    _renderSymbolsDatalist(SYMBOLS.all);
    return;
  }
  _searchTimer = setTimeout(() => querySymbolsNow(query), delay);
}

async function querySymbolsNow(query) {
  const token = ++_searchToken;
  try {
    const res = await fetch(`/symbols?q=${encodeURIComponent(query)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (token !== _searchToken) return;  // a newer search has started
    _registerSymbols(data.symbols);
    _renderSymbolsDatalist(data.symbols);
  } catch {
    /* silent — keep last datalist contents */
  }
}

function resolveSource(symbolText) {
  const key = symbolText.trim().toUpperCase();
  const hit = SYMBOLS.byKey.get(key);
  if (hit) return { symbol: key, source: hit.source };
  // Heuristic fallback for unknown symbols
  if (key.includes(".")) return { symbol: key, source: "yfinance" };
  return { symbol: key, source: "hyperliquid" };
}

// --- Hyperliquid WS multiplexer --------------------------------------------

class HyperliquidWS {
  constructor() {
    this.url = "wss://api.hyperliquid.xyz/ws";
    this.ws = null;
    this.subs = new Map(); // key="COIN|INTERVAL" -> Set<callback>
    this.openPromise = null;
    this.backoff = 1000;
  }

  _key(coin, interval) { return `${coin.toUpperCase()}|${interval}`; }

  _connect() {
    if (this.openPromise) return this.openPromise;
    this.openPromise = new Promise((resolve) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.addEventListener("open", () => {
        this.backoff = 1000;
        // Resubscribe everything on reconnect
        for (const key of this.subs.keys()) {
          const [coin, interval] = key.split("|");
          ws.send(JSON.stringify({
            method: "subscribe",
            subscription: { type: "candle", coin, interval },
          }));
        }
        resolve();
      });
      ws.addEventListener("message", (ev) => this._onMessage(ev));
      ws.addEventListener("close", () => this._onClose());
      ws.addEventListener("error", () => { /* close handler will retry */ });
    });
    return this.openPromise;
  }

  _onClose() {
    this.ws = null;
    this.openPromise = null;
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 30000);
    setTimeout(() => {
      if (this.subs.size > 0) this._connect();
    }, wait);
    // Notify subscribers so they can show "reconnecting"
    for (const cbs of this.subs.values()) {
      for (const cb of cbs) cb({ type: "status", status: "reconnecting" });
    }
  }

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.channel !== "candle" || !msg.data) return;
    const d = msg.data;
    const key = this._key(d.s, d.i);
    const cbs = this.subs.get(key);
    if (!cbs) return;
    const candle = {
      time:   Math.floor(d.t / 1000),
      open:   Number(d.o),
      high:   Number(d.h),
      low:    Number(d.l),
      close:  Number(d.c),
      volume: Number(d.v),
    };
    for (const cb of cbs) cb({ type: "candle", candle });
  }

  async subscribe(coin, interval, cb) {
    const key = this._key(coin, interval);
    if (!this.subs.has(key)) this.subs.set(key, new Set());
    this.subs.get(key).add(cb);
    await this._connect();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        method: "subscribe",
        subscription: { type: "candle", coin, interval },
      }));
    }
    return () => this._unsubscribe(coin, interval, cb);
  }

  _unsubscribe(coin, interval, cb) {
    const key = this._key(coin, interval);
    const cbs = this.subs.get(key);
    if (!cbs) return;
    cbs.delete(cb);
    if (cbs.size === 0) {
      this.subs.delete(key);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          method: "unsubscribe",
          subscription: { type: "candle", coin, interval },
        }));
      }
    }
  }
}

const HL = new HyperliquidWS();

// --- Pane --------------------------------------------------------------------

class Pane {
  constructor(index, container, state) {
    this.index = index;
    this.state = { indicators: {}, ...state };
    if (!this.state.indicators) this.state.indicators = {};
    this.lastPrice = null;
    this.unsub = null;
    this.sse = null;
    this.flashTimer = null;
    this.candles = [];           // current candle array, kept in sync with chart
    this.indicatorViews = {};    // id -> { series: [...], def }
    this.legendNodes = [];       // legend DOM nodes attached to pane elements

    const tpl = document.getElementById("pane-template");
    this.root = tpl.content.firstElementChild.cloneNode(true);
    container.appendChild(this.root);

    this.headerEl = this.root.querySelector(".pane-header");
    this.symbolInput = this.root.querySelector(".symbol-input");
    this.tfPillsEl = this.root.querySelector(".tf-pills");
    this.fxBtn = this.root.querySelector(".fx-btn");
    this.tickerPrice = this.root.querySelector(".ticker-price");
    this.tickerChange = this.root.querySelector(".ticker-change");
    this.tickerDot = this.root.querySelector(".ticker-dot");
    this.statusBadge = this.root.querySelector(".status-badge");
    this.chartEl = this.root.querySelector(".chart");

    this.symbolInput.value = this.state.symbol;
    this._buildTfPills();

    this._buildChart();
    // Build series objects for any persisted indicators before history loads.
    // Overlays first (pane 0) in DEFS × instance order, then sub-panes.
    for (const def of Indicators.DEFS) {
      if (!def.overlay) continue;
      for (const key of Object.keys(this.state.indicators).filter((k) => defIdOf(k) === def.id).sort()) {
        this._buildIndicator(key);
      }
    }
    let paneIdx = 1;
    for (const key of this._activeSubPanes()) {
      this._buildIndicator(key, paneIdx);
      paneIdx++;
    }
    this.drawingLayer = new Drawings.DrawingLayer({
      chart:     this.chart,
      series:    this.series,
      source:    this.state.source,
      symbol:    this.state.symbol,
      timeframe: this.state.tf,
    });
    this.drawingLayer.getCandles = () => this.candles;
    this.toolBtns = this.root.querySelectorAll(".draw-tool[data-tool]");
    this.toolBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.tool;
        this._setActiveTool(id);
      });
    });
    // Let the layer flip the toolbar back to "cursor" after a one-shot draw.
    this.drawingLayer._notifyToolChange = (id) => this._reflectActiveTool(id);

    const gearBtn = this.root.querySelector('.draw-tool[data-action="settings"]');
    if (gearBtn) {
      gearBtn.addEventListener("click", () => {
        Drawings.SettingsPopover.open(gearBtn, () => {
          document.dispatchEvent(new CustomEvent("stv:drawing-prefs-changed"));
        });
      });
    }

    const undoBtn = this.root.querySelector('.draw-tool[data-action="undo"]');
    if (undoBtn) {
      undoBtn.addEventListener("click", () => this.drawingLayer.undo());
    }
    const eraseBtn = this.root.querySelector('.draw-tool[data-action="erase"]');
    if (eraseBtn) {
      eraseBtn.addEventListener("click", () => this.drawingLayer.eraseAll());
    }

    this.drawToggleBtn = this.root.querySelector('[data-action="draw-toggle"]');
    this.floatingPalette = this.root.querySelector(".draw-floating-palette");

    // Mirror every toolbar child (tools, actions, separators) into the floating palette.
    // Each clone forwards its click to the original button so all wiring carries over
    // (active state, settings popover, future undo/erase from Task 17).
    if (this.floatingPalette) {
      const toolbar = this.root.querySelector(".draw-toolbar");
      if (toolbar) {
        for (const src of Array.from(toolbar.children)) {
          const clone = src.cloneNode(true);
          // Only buttons need a click forwarder; separators are inert
          if (src.tagName === "BUTTON") {
            clone.addEventListener("click", (ev) => {
              ev.stopPropagation();
              src.click();
            });
          }
          this.floatingPalette.appendChild(clone);
        }
      }
    }

    if (this.drawToggleBtn) {
      this.drawToggleBtn.addEventListener("click", () => {
        const showing = !this.floatingPalette.hidden;
        this.floatingPalette.hidden = showing;
        this.drawToggleBtn.classList.toggle("active", !showing);
      });
    }

    this._applyPaneSizing();
    this._refreshLegends();
    this._updateFxButton();

    this.symbolInput.addEventListener("change", () => this._onSymbolChange());
    this.symbolInput.addEventListener("blur",   () => this._onSymbolChange());
    this.symbolInput.addEventListener("input", () => {
      querySymbolsDebounced(this.symbolInput.value);
    });
    this.fxBtn.addEventListener("click",        () => openIndicatorsModal(this));

    {
      const prefs = Drawings.PrefsStore.get();
      this.root.classList.toggle("draw-floating", prefs.toolbarMode === "floating");
    }

    this.subscribe();
  }

  _buildChart() {
    this.chart = LightweightCharts.createChart(this.chartEl, {
      layout: { background: { color: "#151a23" }, textColor: "#8a93a6" },
      grid: {
        vertLines: { color: "#1c2230" },
        horzLines: { color: "#1c2230" },
      },
      rightPriceScale: { borderColor: "#232a39" },
      timeScale: { borderColor: "#232a39", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
      autoSize: true,
    });
    this.series = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderUpColor: "#26a69a",
      borderDownColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    }, 0);
  }

  resize() {
    // autoSize:true handles this, but force a relayout after grid changes
    this.chart.resize(this.chartEl.clientWidth, this.chartEl.clientHeight);
  }

  setState(partial) {
    this.state = { ...this.state, ...partial };
    saveState();
  }

  _setStatus(text) {
    if (text) {
      this.statusBadge.textContent = text;
      this.statusBadge.hidden = false;
    } else {
      this.statusBadge.hidden = true;
    }
  }

  _onSymbolChange() {
    const text = this.symbolInput.value.trim();
    if (!text) {
      this.symbolInput.value = this.state.symbol;
      return;
    }
    const resolved = resolveSource(text);
    if (resolved.symbol === this.state.symbol && resolved.source === this.state.source) return;
    this.setState({ symbol: resolved.symbol, source: resolved.source });
    this.symbolInput.value = resolved.symbol;
    this.drawingLayer.setSymbol(resolved.source, resolved.symbol, this.state.tf);
    this.resubscribe();
  }

  _buildTfPills() {
    this.tfPillsEl.innerHTML = SYMBOLS.timeframes
      .map((t) => `<button class="tf-pill${t === this.state.tf ? " active" : ""}" data-tf="${t}" type="button">${t}</button>`)
      .join("");
    this.tfPillsEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".tf-pill");
      if (!btn) return;
      const tf = btn.dataset.tf;
      if (tf === this.state.tf) return;
      this.tfPillsEl.querySelectorAll(".tf-pill").forEach((b) => b.classList.toggle("active", b === btn));
      this.setState({ tf });
      this.drawingLayer.timeframe = tf;
      this.resubscribe();
    });
  }

  async subscribe() {
    this.unsubscribe();
    this.lastPrice = null;
    this.tickerPrice.textContent = "—";
    this.tickerChange.textContent = "";
    this.tickerDot.classList.remove("up", "down");
    this.series.setData([]);
    // Reset indicator series so old symbol's data doesn't linger
    for (const id of Object.keys(this.indicatorViews)) {
      for (const s of this.indicatorViews[id].series) s.setData([]);
    }
    this._setStatus("loading…");

    try {
      await this._loadHistory();
    } catch (e) {
      this._setStatus("history failed");
      console.warn("history error:", e);
    }

    if (this.state.source === "hyperliquid") {
      this._setStatus(null);
      this.unsub = await HL.subscribe(this.state.symbol, this.state.tf, (ev) => {
        if (ev.type === "status") {
          this._setStatus(ev.status === "reconnecting" ? "reconnecting…" : null);
          return;
        }
        this._setStatus(null);
        this._applyCandle(ev.candle);
      });
    } else {
      this._openSSE();
    }
  }

  async _loadHistory() {
    const url = `/history?source=${encodeURIComponent(this.state.source)}`
              + `&symbol=${encodeURIComponent(this.state.symbol)}`
              + `&tf=${encodeURIComponent(this.state.tf)}`
              + `&limit=500`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`history ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return;
    this.candles = data.map((c) => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
      volume: c.volume || 0,
    }));
    this.series.setData(this.candles.map((c) => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
    })));
    this._recomputeAllIndicators();
    const last = this.candles[this.candles.length - 1];
    this._updateTicker(last.close, /*flash=*/false);
  }

  _openSSE() {
    const url = `/stream/quotes?source=${encodeURIComponent(this.state.source)}`
              + `&symbol=${encodeURIComponent(this.state.symbol)}`
              + `&tf=${encodeURIComponent(this.state.tf)}`;
    const es = new EventSource(url);
    this.sse = es;
    es.addEventListener("message", (e) => {
      try {
        const { time, price } = JSON.parse(e.data);
        // For stocks we don't get OHLC ticks via fast_info, so we only
        // update the current candle's close. The next history reload will
        // realign bars.
        this._patchLastCandle(time, price);
        this._updateTicker(price, /*flash=*/true);
        this._setStatus(null);
      } catch { /* ignore */ }
    });
    es.addEventListener("error", () => {
      // Browser will auto-reconnect; surface the status while it tries.
      this._setStatus("reconnecting…");
    });
  }

  _patchLastCandle(time, price) {
    // For stock SSE quotes we only get a price tick. Update the last candle
    // in place (or append) so the chart and indicators stay coherent.
    if (this.candles.length === 0) {
      this.candles.push({ time, open: price, high: price, low: price, close: price, volume: 0 });
    } else {
      const last = this.candles[this.candles.length - 1];
      if (time > last.time) {
        this.candles.push({ time, open: price, high: price, low: price, close: price, volume: 0 });
      } else {
        last.close = price;
        last.high = Math.max(last.high, price);
        last.low = Math.min(last.low, price);
      }
    }
    const tail = this.candles[this.candles.length - 1];
    this.series.update({ time: tail.time, open: tail.open, high: tail.high, low: tail.low, close: tail.close });
    this._updateIndicatorTails();
  }

  _applyCandle(c) {
    const incoming = { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 };
    if (this.candles.length === 0 || incoming.time > this.candles[this.candles.length - 1].time) {
      this.candles.push(incoming);
    } else if (incoming.time === this.candles[this.candles.length - 1].time) {
      this.candles[this.candles.length - 1] = incoming;
    }
    this.series.update({
      time: incoming.time, open: incoming.open, high: incoming.high, low: incoming.low, close: incoming.close,
    });
    this._updateIndicatorTails();
    this._updateTicker(c.close, /*flash=*/true);
  }

  // --- Indicators ---------------------------------------------------------

  setIndicator(key, params) {
    const def = Indicators.DEFS.find((d) => d.id === defIdOf(key));
    if (!def) return;
    const wasNew = !this.state.indicators[key];
    this.state.indicators[key] = { ...params };
    saveState();

    if (def.overlay) {
      this._buildIndicator(key);
    } else if (wasNew) {
      this._rebuildSubPanes();
    } else {
      this._buildIndicator(key);
    }
    this._applyPaneSizing();
    this._refreshLegends();
    this._updateFxButton();
  }

  // Adds a new instance of the indicator with defId. The first instance uses
  // the bare defId as its key; additional instances append ~<timestamp>.
  addIndicatorInstance(defId) {
    const def = Indicators.DEFS.find((d) => d.id === defId);
    if (!def) return null;
    const existing = Object.keys(this.state.indicators).filter((k) => defIdOf(k) === defId);
    const key = existing.length === 0 ? defId : `${defId}~${Date.now()}`;
    const params = {};
    for (const p of def.params) params[p.key] = p.default;
    this.setIndicator(key, params);
    return key;
  }

  removeIndicator(key) {
    const def = Indicators.DEFS.find((d) => d.id === defIdOf(key));
    delete this.state.indicators[key];
    saveState();
    this._tearDownIndicator(key);
    if (def && !def.overlay) this._rebuildSubPanes();
    this._applyPaneSizing();
    this._refreshLegends();
    this._updateFxButton();
  }

  _updateFxButton() {
    const count = Object.keys(this.state.indicators).length;
    this.fxBtn.classList.toggle("has-active", count > 0);
    const countEl = this.fxBtn.querySelector(".fx-count");
    if (countEl) countEl.textContent = count > 0 ? String(count) : "";
  }

  _activeSubPanes() {
    // Return all active sub-pane instance keys in DEFS order, then by key
    // within each def so the sub-pane stack is stable across reloads.
    const result = [];
    for (const def of Indicators.DEFS) {
      if (def.overlay) continue;
      const keys = Object.keys(this.state.indicators)
        .filter((k) => defIdOf(k) === def.id)
        .sort();
      result.push(...keys);
    }
    return result;
  }

  _paneIndexFor(key) {
    const def = Indicators.DEFS.find((d) => d.id === defIdOf(key));
    if (!def || def.overlay) return 0;
    const subs = this._activeSubPanes();
    const idx = subs.indexOf(key);
    return idx >= 0 ? idx + 1 : 1;
  }

  _rebuildSubPanes() {
    // Tear down all sub-pane instances, remove extra panes, then re-add in
    // DEFS × instance order so the stack is stable.
    for (const key of Object.keys(this.indicatorViews)) {
      const def = Indicators.DEFS.find((d) => d.id === defIdOf(key));
      if (def && !def.overlay) this._tearDownIndicator(key);
    }
    const panes = this.chart.panes();
    for (let i = panes.length - 1; i >= 1; i--) {
      try { this.chart.removePane(i); } catch (_e) { /* ignore */ }
    }
    let paneIdx = 1;
    for (const key of this._activeSubPanes()) {
      this._buildIndicator(key, paneIdx);
      paneIdx++;
    }
  }

  _applyPaneSizing() {
    // Candle pane gets 3x stretch; each sub-pane gets 1x. With N sub-panes
    // the candle pane occupies 3/(3+N) of the chart's vertical space.
    const panes = this.chart.panes();
    if (panes.length === 0) return;
    panes[0].setStretchFactor(3);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);
  }

  // --- Legends ------------------------------------------------------------

  _clearLegends() {
    for (const n of this.legendNodes) {
      if (n.parentNode) n.parentNode.removeChild(n);
    }
    this.legendNodes = [];
  }

  _setActiveTool(id) {
    // The layer's setActiveTool() fires _notifyToolChange with the resolved
    // tool id (or "cursor" if the requested tool is unknown). That callback
    // is wired to _reflectActiveTool in the constructor — let it be the
    // single source of truth so the highlight matches the actual layer state.
    this.drawingLayer.setActiveTool(id);
  }

  _reflectActiveTool(id) {
    this.toolBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.tool === id));
    if (this.floatingPalette) {
      this.floatingPalette.querySelectorAll(".draw-tool[data-tool]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tool === id);
      });
    }
  }

  _refreshLegends() {
    // In LWC v5, pane HTMLElements are created on the next layout pass,
    // not synchronously after addSeries. Defer until the next frame so
    // getHTMLElement() can return a real node.
    if (this._legendPending) return;
    this._legendPending = true;
    requestAnimationFrame(() => {
      this._legendPending = false;
      this._refreshLegendsNow();
    });
  }

  _refreshLegendsNow() {
    this._clearLegends();
    const panes = this.chart.panes();
    if (panes.length === 0) return;

    const attach = (paneIdx, items) => {
      if (paneIdx >= panes.length || items.length === 0) return;
      const paneEl = panes[paneIdx].getHTMLElement();
      if (!paneEl) return;
      const computed = window.getComputedStyle(paneEl).position;
      if (computed === "static") paneEl.style.position = "relative";
      const legend = document.createElement("div");
      legend.className = "pane-legend";
      for (const { def, key } of items) legend.appendChild(this._makeLegendItem(def, key));
      paneEl.appendChild(legend);
      this.legendNodes.push(legend);
    };

    // Pane 0: all overlay indicator instances in DEFS × instance order
    const overlayItems = [];
    for (const def of Indicators.DEFS) {
      if (!def.overlay) continue;
      const keys = Object.keys(this.state.indicators)
        .filter((k) => defIdOf(k) === def.id)
        .sort();
      for (const key of keys) overlayItems.push({ def, key });
    }
    attach(0, overlayItems);

    // Each sub-pane: the instance that owns it
    const subKeys = this._activeSubPanes();
    for (let i = 0; i < subKeys.length; i++) {
      const key = subKeys[i];
      const def = Indicators.DEFS.find((d) => d.id === defIdOf(key));
      if (def) attach(i + 1, [{ def, key }]);
    }
  }

  _legendLabelFor(def, key) {
    const params = this.state.indicators[key] || {};
    const numericVals = def.params
      .map((p) => params[p.key] ?? p.default)
      .filter((v) => v != null && v !== "");
    const shortName = def.name.split(" — ")[0].split(" (")[0];
    const label = numericVals.length > 0
      ? `${shortName} (${numericVals.join(", ")})`
      : shortName;
    // Append instance number if multiple instances of the same type exist
    const allKeys = Object.keys(this.state.indicators).filter((k) => defIdOf(k) === def.id).sort();
    if (allKeys.length > 1) {
      const n = allKeys.indexOf(key) + 1;
      return `${label} #${n}`;
    }
    return label;
  }

  _makeLegendItem(def, key) {
    const item = document.createElement("div");
    item.className = "legend-item";

    const colors = this._resolveColors(def, key);
    const firstColor = Object.values(colors)[0] || "#888";
    const swatch = document.createElement("span");
    swatch.className = "legend-color";
    swatch.style.background = firstColor;
    item.appendChild(swatch);

    const labelEl = document.createElement("span");
    labelEl.className = "legend-name";
    labelEl.textContent = this._legendLabelFor(def, key);
    item.appendChild(labelEl);

    const gear = document.createElement("button");
    gear.className = "legend-gear";
    gear.type = "button";
    gear.title = `${def.name} settings`;
    gear.textContent = "⚙";
    gear.addEventListener("click", (e) => {
      e.stopPropagation();
      openIndicatorsModal(this, def.id);
    });
    item.appendChild(gear);

    const remove = document.createElement("button");
    remove.className = "legend-remove";
    remove.type = "button";
    remove.title = "Remove indicator";
    remove.textContent = "×";
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      this.removeIndicator(key);
    });
    item.appendChild(remove);

    return item;
  }

  _tearDownIndicator(id) {
    const view = this.indicatorViews[id];
    if (!view) return;
    for (const s of view.series) this.chart.removeSeries(s);
    delete this.indicatorViews[id];
  }

  _resolveColors(def, key) {
    // Merge def defaults with any per-instance user overrides.
    const stateKey = key !== undefined ? key : def.id;
    const overrides = (this.state.indicators[stateKey] || {}).colors || {};
    const out = {};
    for (const slot of def.colors || []) {
      const v = overrides[slot.key];
      out[slot.key] = typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : slot.default;
    }
    return out;
  }

  _buildIndicator(key, forcedPane) {
    this._tearDownIndicator(key);
    const def = Indicators.DEFS.find((d) => d.id === defIdOf(key));
    if (!def) return;
    const paneIndex = forcedPane !== undefined ? forcedPane : this._paneIndexFor(key);
    const colors = this._resolveColors(def, key);
    const series = def.build(this.chart, paneIndex, colors);
    this.indicatorViews[key] = { series, def };
    this._recomputeIndicator(key);
  }

  _recomputeIndicator(key) {
    if (this.candles.length === 0) return;
    const view = this.indicatorViews[key];
    if (!view) return;
    const params = this.state.indicators[key] || {};
    const colors = this._resolveColors(view.def, key);
    const data = view.def.compute(this.candles, params, colors);
    if (data != null) view.def.apply(view.series, data);
  }

  _recomputeAllIndicators() {
    for (const id of Object.keys(this.state.indicators)) {
      if (!this.indicatorViews[id]) this._buildIndicator(id);
      else this._recomputeIndicator(id);
    }
  }

  _updateIndicatorTails() {
    // Cheap path on every live tick: recompute the whole series. The arrays
    // are O(500 points) per indicator, so this is fine.
    for (const id of Object.keys(this.indicatorViews)) {
      this._recomputeIndicator(id);
    }
  }

  _updateTicker(price, flash) {
    const fmt = price >= 1000
      ? price.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : price.toLocaleString(undefined, { maximumFractionDigits: 4 });
    this.tickerPrice.textContent = fmt;

    if (this.lastPrice != null) {
      const diff = price - this.lastPrice;
      if (diff !== 0) {
        const pct = (diff / this.lastPrice) * 100;
        const sign = diff > 0 ? "▲" : "▼";
        this.tickerChange.textContent = `${sign} ${Math.abs(pct).toFixed(2)}%`;
        this.tickerChange.classList.toggle("up",   diff > 0);
        this.tickerChange.classList.toggle("down", diff < 0);
        this.tickerDot.classList.toggle("up",   diff > 0);
        this.tickerDot.classList.toggle("down", diff < 0);
        if (flash) this._flash(diff > 0 ? "up" : "down");
      }
    }
    this.lastPrice = price;
  }

  _flash(dir) {
    this.headerEl.classList.remove("flash-up", "flash-down");
    // force reflow so the class re-application restarts the transition
    void this.headerEl.offsetWidth;
    this.headerEl.classList.add(dir === "up" ? "flash-up" : "flash-down");
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.headerEl.classList.remove("flash-up", "flash-down");
    }, 220);
  }

  unsubscribe() {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    if (this.sse)   { this.sse.close(); this.sse = null; }
  }

  resubscribe() { this.subscribe(); }

  destroy() {
    this.unsubscribe();
    clearTimeout(this.flashTimer);
    this._clearLegends();
    this.drawingLayer.destroy();
    this.chart.remove();
    this.root.remove();
  }
}

// --- Grid management --------------------------------------------------------

const gridEl = document.getElementById("grid");
let currentLayoutId = 5;
let panes = [];
let paneStates = [];

function loadState() {
  let states;
  try {
    states = JSON.parse(localStorage.getItem(LS_PANES) || "null");
  } catch { states = null; }
  if (!Array.isArray(states)) states = [];
  // ensure 8 slots (we keep state for all positions even if not visible)
  while (states.length < 8) states.push({ ...DEFAULT_PANES[states.length] });
  // backfill missing fields from old persisted state
  for (let i = 0; i < states.length; i++) {
    if (!states[i].indicators || typeof states[i].indicators !== "object") {
      states[i].indicators = {};
    }
  }
  return { states };
}

function saveState() {
  for (let i = 0; i < panes.length; i++) paneStates[i] = panes[i].state;
  localStorage.setItem(LS_PANES, JSON.stringify(paneStates));
  localStorage.setItem(LS_LAYOUT_ID, String(currentLayoutId));
}

function getLayout(id) {
  return LAYOUTS.find((l) => l.id === id) || LAYOUTS[4];
}

function applyLayout(layoutId) {
  const layout = getLayout(layoutId);
  gridEl.style.display = "grid";
  gridEl.style.gridTemplateColumns = layout.cols;
  gridEl.style.gridTemplateRows = layout.rows;
  gridEl.style.gridTemplateAreas = layout.areas;
  gridEl.style.gap = "10px";
}

function buildPanes(layoutId) {
  const layout = getLayout(layoutId);
  for (const p of panes) p.destroy();
  panes = [];
  gridEl.innerHTML = "";
  for (let i = 0; i < layout.n; i++) {
    const state = paneStates[i] || { ...DEFAULT_PANES[i % DEFAULT_PANES.length] };
    const pane = new Pane(i, gridEl, state);
    if (pane.root) pane.root.style.gridArea = AREA_KEYS[i];
    panes.push(pane);
  }
  requestAnimationFrame(() => {
    for (const p of panes) p.resize();
  });
}

function layoutIconSVG(layout, size = 14) {
  const colSizes = layout.cols.split(" ").map((c) => parseFloat(c) || 1);
  const rowSizes = layout.rows.split(" ").map((r) => parseFloat(r) || 1);
  const cSum = colSizes.reduce((a, b) => a + b, 0);
  const rSum = rowSizes.reduce((a, b) => a + b, 0);
  const totW = 12, totH = 12;
  const cellW = colSizes.map((c) => (c / cSum) * totW);
  const cellH = rowSizes.map((r) => (r / rSum) * totH);
  const gridStr = layout.areas.replace(/"/g, " ").replace(/\s+/g, " ").trim().split(" ");
  const nCols = colSizes.length;
  const seen = {};
  const rects = [];
  gridStr.forEach((name) => {
    if (seen[name]) return; seen[name] = true;
    let rMin = 99, rMax = -1, cMin = 99, cMax = -1;
    gridStr.forEach((n2, j) => {
      if (n2 !== name) return;
      const rr = Math.floor(j / nCols), cc = j % nCols;
      if (rr < rMin) rMin = rr; if (rr > rMax) rMax = rr;
      if (cc < cMin) cMin = cc; if (cc > cMax) cMax = cc;
    });
    let x = 1, y = 1;
    for (let i = 0; i < cMin; i++) x += cellW[i];
    for (let i = 0; i < rMin; i++) y += cellH[i];
    let w = 0; for (let i = cMin; i <= cMax; i++) w += cellW[i];
    let h = 0; for (let i = rMin; i <= rMax; i++) h += cellH[i];
    rects.push(`<rect x="${(x + 0.5).toFixed(2)}" y="${(y + 0.5).toFixed(2)}" width="${(w - 1).toFixed(2)}" height="${(h - 1).toFixed(2)}" rx="1" fill="currentColor" fill-opacity="0.7"/>`);
  });
  return `<svg width="${size}" height="${size}" viewBox="0 0 14 14"><rect x="0.5" y="0.5" width="13" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-opacity="0.4"/>${rects.join("")}</svg>`;
}

function migrateLayoutState() {
  const newKey = localStorage.getItem(LS_LAYOUT_ID);
  if (newKey != null) {
    const id = parseInt(newKey, 10);
    return getLayout(id).id;
  }
  const legacy = parseInt(localStorage.getItem(LS_COUNT) || "4", 10);
  const map = { 1: 1, 2: 2, 4: 5, 6: 6, 8: 7 };
  const id = map[legacy] || 5;
  localStorage.setItem(LS_LAYOUT_ID, String(id));
  return id;
}

function setLayoutId(id, persist = true) {
  const layout = getLayout(id);
  currentLayoutId = layout.id;
  applyLayout(currentLayoutId);
  buildPanes(currentLayoutId);
  if (persist) {
    localStorage.setItem(LS_LAYOUT_ID, String(currentLayoutId));
    saveState();
  }
  refreshLayoutTrigger();
  refreshLayoutPopover();
}

function refreshLayoutTrigger() {
  const layout = getLayout(currentLayoutId);
  const iconEl = document.getElementById("layout-trigger-icon");
  const countEl = document.getElementById("layout-trigger-count");
  if (iconEl) iconEl.innerHTML = layoutIconSVG(layout, 14);
  if (countEl) countEl.textContent = String(layout.n);
}

function refreshLayoutPopover() {
  const grid = document.getElementById("layout-popover-grid");
  if (!grid) return;
  grid.innerHTML = "";
  for (const l of LAYOUTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "layout-preset" + (l.id === currentLayoutId ? " on" : "");
    btn.title = l.label;
    btn.dataset.id = String(l.id);
    btn.innerHTML = `${layoutIconSVG(l, 22)}<span class="layout-preset-count mono tnum">${l.n}</span>`;
    btn.addEventListener("click", () => {
      setLayoutId(l.id);
      closeLayoutPopover();
    });
    grid.appendChild(btn);
  }
}

function openLayoutPopover() {
  const pop = document.getElementById("layout-popover");
  const trig = document.getElementById("layout-trigger");
  if (pop) pop.hidden = false;
  if (trig) trig.setAttribute("aria-expanded", "true");
}
function closeLayoutPopover() {
  const pop = document.getElementById("layout-popover");
  if (pop) pop.hidden = true;
  const trig = document.getElementById("layout-trigger");
  if (trig) trig.setAttribute("aria-expanded", "false");
}

function bindLayoutPopover() {
  const trig = document.getElementById("layout-trigger");
  if (trig) {
    trig.addEventListener("click", (e) => {
      e.stopPropagation();
      const pop = document.getElementById("layout-popover");
      const open = pop && pop.hidden === false;
      if (open) closeLayoutPopover(); else openLayoutPopover();
    });
  }
  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("layout-popover-wrap");
    if (wrap && !wrap.contains(e.target)) closeLayoutPopover();
  });
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 7) {
      e.preventDefault();
      setLayoutId(n);
    }
  });
}

// --- Personality presets ----------------------------------------------------
const PERSONALITY_DEFAULTS = {
  Minimalist: { layoutId: 1, syms: [{ source: "yfinance", symbol: "NVDA" }], tf: "1D" },
  Quant:      { layoutId: 5, syms: [
    { source: "yfinance", symbol: "SPY" },
    { source: "yfinance", symbol: "NVDA" },
    { source: "yfinance", symbol: "TLT" },
    { source: "yfinance", symbol: "^VIX" },
  ], tf: "1h" },
  Scalper:    { layoutId: 5, syms: [
    { source: "yfinance", symbol: "ES=F" },
    { source: "yfinance", symbol: "NQ=F" },
    { source: "yfinance", symbol: "NVDA" },
    { source: "yfinance", symbol: "TSLA" },
  ], tf: "5m" },
  Investor:   { layoutId: 4, syms: [
    { source: "yfinance", symbol: "SPY" },
    { source: "yfinance", symbol: "TLT" },
    { source: "yfinance", symbol: "GLD" },
  ], tf: "1D" },
};

const LS_PERSONALITY = "stv.personality";

function currentPersonality() {
  return localStorage.getItem(LS_PERSONALITY) || "Quant";
}

function applyPersonality(name) {
  const preset = PERSONALITY_DEFAULTS[name];
  if (!preset) return;
  // Replace pane state for the visible slots — preserve indicators per-slot.
  for (let i = 0; i < preset.syms.length; i++) {
    const prev = paneStates[i] || { indicators: {} };
    paneStates[i] = {
      source: preset.syms[i].source,
      symbol: preset.syms[i].symbol,
      tf: preset.tf,
      indicators: prev.indicators || {},
    };
  }
  localStorage.setItem(LS_PERSONALITY, name);
  setLayoutId(preset.layoutId);
  refreshPersonalityButtons();
}

function refreshPersonalityButtons() {
  const cur = currentPersonality();
  document.querySelectorAll(".pers-btn").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.pers === cur);
  });
}

function bindPersonality() {
  document.querySelectorAll(".pers-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyPersonality(btn.dataset.pers));
  });
  refreshPersonalityButtons();
}

window.addEventListener("resize", () => {
  for (const p of panes) p.resize();
});

// --- Indicators modal ------------------------------------------------------

const modalEl = document.getElementById("indicators-modal");
const modalList = document.getElementById("indicators-list");
const modalSub = modalEl.querySelector(".modal-sub");
const modalSearchEl = document.getElementById("indicators-search");
let modalPane = null;

// Re-render the list whenever the user types in the search box
modalSearchEl.addEventListener("input", () => { if (modalPane) renderIndicatorsModal(); });

function openIndicatorsModal(pane, focusId) {
  modalPane = pane;
  modalSub.textContent = `${pane.state.symbol} · ${pane.state.tf}`;
  modalSearchEl.value = "";   // clear previous query
  renderIndicatorsModal();
  modalEl.hidden = false;
  // Auto-focus search so users can type immediately
  requestAnimationFrame(() => modalSearchEl.focus());
  if (focusId) {
    // focusId may be a bare def-id or an instance key — normalise to def-id
    const searchId = defIdOf(focusId);
    requestAnimationFrame(() => {
      const row = modalList.querySelector(`.indicator-row[data-id="${searchId}"]`);
      if (!row) return;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.classList.add("focus-flash");
      setTimeout(() => row.classList.remove("focus-flash"), 1400);
    });
  }
}

function closeIndicatorsModal() {
  modalEl.hidden = true;
  modalPane = null;
}

modalEl.addEventListener("click", (e) => {
  if (e.target.matches("[data-close]")) closeIndicatorsModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modalEl.hidden) closeIndicatorsModal();
});

function renderIndicatorsModal() {
  if (!modalPane) return;
  const active = modalPane.state.indicators;
  const query = (modalSearchEl.value || "").trim().toLowerCase();
  modalList.innerHTML = "";

  const groups = new Map();
  for (const def of Indicators.DEFS) {
    if (!groups.has(def.category)) groups.set(def.category, []);
    groups.get(def.category).push(def);
  }

  let totalVisible = 0;

  for (const [category, defs] of groups) {
    // Filter within category; always show active indicators regardless of query
    const visible = query
      ? defs.filter((d) =>
          d.name.toLowerCase().includes(query) ||
          d.category.toLowerCase().includes(query) ||
          Object.keys(active).some((k) => defIdOf(k) === d.id)
        )
      : defs;
    if (visible.length === 0) continue;
    totalVisible += visible.length;

    const header = document.createElement("div");
    header.className = "indicator-category";
    header.textContent = category;
    modalList.appendChild(header);

    for (const def of visible) {
      const instanceKeys = Object.keys(active)
        .filter((k) => defIdOf(k) === def.id)
        .sort();
      const hasInstances = instanceKeys.length > 0;

      const row = document.createElement("div");
      row.className = "indicator-row" + (hasInstances ? " is-active" : "");
      row.dataset.id = def.id;

      // ── Header row: name + add button ──────────────────────────────────
      const top = document.createElement("div");
      top.className = "indicator-top";

      const nameEl = document.createElement("div");
      nameEl.className = "ind-name";
      nameEl.textContent = def.name;

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "ind-add-btn";
      addBtn.title = hasInstances ? "Add another instance" : "Add indicator";
      addBtn.textContent = hasInstances ? "+" : "+ Add";
      addBtn.addEventListener("click", () => {
        modalPane.addIndicatorInstance(def.id);
        renderIndicatorsModal();
      });

      top.append(nameEl, addBtn);
      row.appendChild(top);

      // ── Per-instance rows ───────────────────────────────────────────────
      for (let i = 0; i < instanceKeys.length; i++) {
        const key = instanceKeys[i];
        const inst = document.createElement("div");
        inst.className = "indicator-instance";

        // Instance header: optional #N badge + params + remove button
        const instHeader = document.createElement("div");
        instHeader.className = "instance-header";

        if (instanceKeys.length > 1) {
          const badge = document.createElement("span");
          badge.className = "instance-num";
          badge.textContent = `#${i + 1}`;
          instHeader.appendChild(badge);
        }

        const paramsEl = document.createElement("div");
        paramsEl.className = "ind-params";
        for (const p of def.params) {
          const lbl = document.createElement("span");
          lbl.textContent = p.key;
          const inp = document.createElement("input");
          inp.type = "number";
          inp.value = active[key][p.key] ?? p.default;
          if (p.min  != null) inp.min  = p.min;
          if (p.max  != null) inp.max  = p.max;
          if (p.step != null) inp.step = p.step;
          inp.addEventListener("change", () => {
            const v = Number(inp.value);
            if (!Number.isFinite(v)) return;
            const cur = modalPane.state.indicators[key] || {};
            modalPane.setIndicator(key, { ...cur, [p.key]: v });
          });
          paramsEl.append(lbl, inp);
        }

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "inst-remove";
        removeBtn.textContent = "×";
        removeBtn.title = "Remove this instance";
        removeBtn.addEventListener("click", () => {
          modalPane.removeIndicator(key);
          renderIndicatorsModal();
        });

        instHeader.append(paramsEl, removeBtn);
        inst.appendChild(instHeader);

        // Colors row for this instance
        if (def.colors && def.colors.length > 0) {
          const colorsRow = document.createElement("div");
          colorsRow.className = "indicator-colors";
          const currentColors = (active[key].colors || {});
          for (const slot of def.colors) {
            const lbl = document.createElement("label");
            lbl.className = "color-slot";
            lbl.title = slot.label;
            const span = document.createElement("span");
            span.textContent = slot.label;
            const inp = document.createElement("input");
            inp.type = "color";
            inp.value = (typeof currentColors[slot.key] === "string"
              && /^#[0-9a-fA-F]{6}$/.test(currentColors[slot.key]))
                ? currentColors[slot.key]
                : slot.default;
            inp.addEventListener("change", () => {
              const cur = modalPane.state.indicators[key] || {};
              modalPane.setIndicator(key, {
                ...cur,
                colors: { ...(cur.colors || {}), [slot.key]: inp.value },
              });
            });
            lbl.append(span, inp);
            colorsRow.appendChild(lbl);
          }

          const reset = document.createElement("button");
          reset.type = "button";
          reset.className = "color-reset";
          reset.textContent = "reset";
          reset.title = "Reset colors to defaults";
          reset.addEventListener("click", () => {
            const cur = modalPane.state.indicators[key] || {};
            const next = { ...cur };
            delete next.colors;
            modalPane.setIndicator(key, next);
            renderIndicatorsModal();
          });
          colorsRow.appendChild(reset);
          inst.appendChild(colorsRow);
        }

        row.appendChild(inst);
      }

      modalList.appendChild(row);
    }
  }

  // Empty state when search returns nothing
  if (totalVisible === 0 && query) {
    const empty = document.createElement("div");
    empty.className = "modal-empty";
    empty.innerHTML = `<strong>No results</strong>No indicators match <em>"${query}"</em>`;
    modalList.appendChild(empty);
  }
}

// --- Boot -------------------------------------------------------------------

(async function main() {
  await loadSymbols();
  const { states } = loadState();
  paneStates = states;
  currentLayoutId = migrateLayoutState();
  applyLayout(currentLayoutId);
  buildPanes(currentLayoutId);
  refreshLayoutTrigger();
  refreshLayoutPopover();
  bindLayoutPopover();
  bindPersonality();

  // First run? Apply default personality (Quant) to seed states.
  if (!localStorage.getItem(LS_PERSONALITY)) {
    applyPersonality("Quant");
  }

  loadNarratives();
  loadNews();
  setInterval(loadNews, 5 * 60 * 1000);
  loadEvents();
  setInterval(loadEvents, 60 * 1000);
  loadFactors();
  setInterval(loadFactors, 5 * 60 * 1000);
  loadSignals();
  setInterval(loadSignals, 60 * 1000);
  refreshAIInsight();
  setInterval(refreshAIInsight, 60 * 1000);

  document.addEventListener("stv:drawing-prefs-changed", () => {
    const prefs = Drawings.PrefsStore.get();
    for (const p of panes) {
      p.root.classList.toggle("draw-floating", prefs.toolbarMode === "floating");
    }
  });
})();

// --- Topbar — clock, ⌘K placeholder, theme toggle ----------------------------

function startClock() {
  const el = document.getElementById("clock-time");
  if (!el) return;
  const tick = () => {
    const now = new Date();
    const hh = String((now.getUTCHours() + 19) % 24).padStart(2, "0");
    const mm = String(now.getUTCMinutes()).padStart(2, "0");
    const ss = String(now.getUTCSeconds()).padStart(2, "0");
    el.textContent = `${hh}:${mm}:${ss} ET`;
  };
  tick();
  setInterval(tick, 1000);
}

function showToast(msg) {
  let t = document.getElementById("stv-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "stv-toast";
    t.style.cssText =
      "position:fixed;bottom:60px;left:50%;transform:translateX(-50%);" +
      "padding:8px 14px;background:var(--surface-3);border:1px solid var(--line);" +
      "border-radius:var(--r-md);color:var(--ink);font-size:12px;z-index:200;" +
      "box-shadow:var(--shadow-lift);opacity:0;transition:opacity .15s;";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = "1";
  clearTimeout(t._stvHide);
  t._stvHide = setTimeout(() => { t.style.opacity = "0"; }, 1800);
}

function bindCommandK() {
  const btn = document.getElementById("cmd-k");
  if (btn) btn.addEventListener("click", () => showToast("Command palette coming soon"));
  document.addEventListener("keydown", (e) => {
    const metaK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
    if (metaK) {
      e.preventDefault();
      showToast("Command palette coming soon");
    }
  });
}

function bindThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("stv.theme", next);
  });
}

startClock();
bindCommandK();
bindThemeToggle();

// --- Narratives card --------------------------------------------------------
const RAIL_STATE = {
  narratives: [],
  activeNarrative: null,
  histCache: new Map(), // key: `${source}|${symbol}|1D` → { ts, candles }
};

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

async function loadNarratives() {
  try {
    const data = await fetchJSON("/narratives");
    RAIL_STATE.narratives = data.narratives || [];
    if (RAIL_STATE.narratives.length > 0 && !RAIL_STATE.activeNarrative) {
      RAIL_STATE.activeNarrative = RAIL_STATE.narratives[0].id;
    }
    renderNarrativesChips();
    renderNarrativesList();
  } catch (e) {
    console.warn("narratives load failed", e);
  }
}

function renderNarrativesChips() {
  const wrap = document.getElementById("narratives-chips");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (const n of RAIL_STATE.narratives) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (n.id === RAIL_STATE.activeNarrative ? " on" : "");
    b.textContent = n.title;
    b.addEventListener("click", () => {
      RAIL_STATE.activeNarrative = n.id;
      renderNarrativesChips();
      renderNarrativesList();
    });
    wrap.appendChild(b);
  }
}

async function getHistoryCached(source, symbol, tf = "1D") {
  const key = `${source}|${symbol}|${tf}`;
  const hit = RAIL_STATE.histCache.get(key);
  if (hit && Date.now() - hit.ts < 5 * 60 * 1000) return hit.candles;
  try {
    const candles = await fetchJSON(`/history?source=${encodeURIComponent(source)}&symbol=${encodeURIComponent(symbol)}&tf=${tf}&limit=60`);
    RAIL_STATE.histCache.set(key, { ts: Date.now(), candles });
    return candles;
  } catch {
    return [];
  }
}

function sparkSVG(series, up, w = 80, h = 22) {
  if (!series || series.length < 2) return "";
  const lo = Math.min(...series), hi = Math.max(...series);
  const rng = (hi - lo) || 1;
  const pts = series.map((v, i) => [
    (i / (series.length - 1)) * w,
    h - 2 - ((v - lo) / rng) * (h - 4),
  ]);
  const d = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const col = up ? "var(--up)" : "var(--down)";
  return `<svg width="${w}" height="${h}"><path d="${d}" fill="none" stroke="${col}" stroke-width="1.2" stroke-linejoin="round"/><path d="${d} L${w} ${h} L0 ${h} Z" fill="${col}" opacity="0.12"/></svg>`;
}

async function renderNarrativesList() {
  const wrap = document.getElementById("narratives-list");
  if (!wrap) return;
  const narr = RAIL_STATE.narratives.find((n) => n.id === RAIL_STATE.activeNarrative);
  if (!narr) { wrap.innerHTML = '<div class="card-empty">No narratives.</div>'; return; }
  wrap.innerHTML = '<div class="card-empty">Loading…</div>';
  const rows = await Promise.all(narr.symbols.map(async (s) => {
    const candles = await getHistoryCached(s.source, s.symbol, "1D");
    if (candles.length < 2) return { sym: s.symbol, source: s.source, last: null, chg: 0, closes: [] };
    const closes = candles.map((c) => c.c);
    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const chg = prev ? ((last - prev) / prev) * 100 : 0;
    return { sym: s.symbol, source: s.source, last, chg, closes };
  }));
  wrap.innerHTML = "";
  for (const row of rows) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "narrative-row";
    const chgCls = row.chg >= 0 ? "up" : "down";
    btn.innerHTML = `
      <span class="narrative-sym">${row.sym}</span>
      <span class="narrative-spark">${sparkSVG(row.closes.slice(-40), row.chg >= 0)}</span>
      <span class="narrative-price">${row.last != null ? row.last.toFixed(2) : "—"}</span>
      <span class="narrative-chg ${chgCls}">${row.chg >= 0 ? "+" : ""}${row.chg.toFixed(2)}%</span>
    `;
    btn.addEventListener("click", () => {
      // Jump pane 0 to this symbol using the public symbol-input flow
      if (panes[0] && panes[0].symbolInput) {
        panes[0].symbolInput.value = row.sym;
        panes[0].symbolInput.dispatchEvent(new Event("change"));
      }
    });
    wrap.appendChild(btn);
  }
}

// --- News tape --------------------------------------------------------------
async function loadNews() {
  const wrap = document.getElementById("news-list");
  if (!wrap) return;
  try {
    const data = await fetchJSON("/news");
    const items = data.news || [];
    if (items.length === 0) {
      wrap.innerHTML = '<div class="card-empty">No news.</div>';
      return;
    }
    wrap.innerHTML = "";
    for (const it of items) {
      const a = document.createElement("a");
      a.className = "news-row";
      a.href = it.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.innerHTML = `
        <span class="news-time">${it.time}</span>
        <div>
          <span class="news-source">${it.source}</span>
          <span class="news-text">${it.text}</span>
        </div>
      `;
      wrap.appendChild(a);
    }
  } catch (e) {
    wrap.innerHTML = '<div class="card-empty">News unavailable.</div>';
  }
}

// --- Events ----------------------------------------------------------------
function paneSymbolsList() {
  return panes.map((p) => p && p.state && p.state.symbol).filter(Boolean);
}

async function loadEvents() {
  const wrap = document.getElementById("events-list");
  if (!wrap) return;
  try {
    const syms = paneSymbolsList().join(",");
    const data = await fetchJSON(`/events?symbols=${encodeURIComponent(syms)}`);
    const items = data.events || [];
    if (items.length === 0) {
      wrap.innerHTML = '<div class="card-empty">No upcoming events.</div>';
      return;
    }
    wrap.innerHTML = "";
    for (const e of items) {
      const row = document.createElement("div");
      row.className = "event-row";
      row.innerHTML = `
        <span class="event-when">${e.when}</span>
        <span class="event-dot ${e.tone === "acid" ? "acid" : e.tone === "warn" ? "warn" : ""}"></span>
        <span class="event-label">${e.label}</span>
      `;
      wrap.appendChild(row);
    }
  } catch (e) {
    wrap.innerHTML = '<div class="card-empty">Events unavailable.</div>';
  }
}

// --- Factor pulse ----------------------------------------------------------
async function loadFactors() {
  const wrap = document.getElementById("factor-list");
  if (!wrap) return;
  try {
    const data = await fetchJSON("/factors");
    const items = data.factors || [];
    if (items.length === 0) {
      wrap.innerHTML = '<div class="card-empty">No factor data.</div>';
      return;
    }
    wrap.innerHTML = "";
    for (const f of items) {
      const row = document.createElement("div");
      row.className = "factor-row";
      const sign = f.z >= 0 ? "+" : "";
      const color = f.z >= 0 ? "var(--up)" : "var(--down)";
      const fillLeft = f.z >= 0 ? "50%" : `${50 + f.z * 25}%`;
      const fillWidth = `${Math.abs(f.z) * 25}%`;
      row.innerHTML = `
        <span class="factor-name">${f.name}</span>
        <div class="factor-bar">
          <div class="factor-bar-zero"></div>
          <div class="factor-bar-fill" style="left:${fillLeft};width:${fillWidth};background:${color};"></div>
        </div>
        <span class="factor-z" style="color:${color}">${sign}${f.z.toFixed(2)}σ</span>
      `;
      wrap.appendChild(row);
    }
  } catch (e) {
    wrap.innerHTML = '<div class="card-empty">Factors unavailable.</div>';
  }
}

// --- Live signals -----------------------------------------------------------
async function loadSignals() {
  const wrap = document.getElementById("signals-list");
  const countEl = document.getElementById("signals-count");
  if (!wrap) return;
  try {
    const data = await fetchJSON("/signals");
    const items = data.signals || [];
    if (countEl) countEl.textContent = `${items.length} active`;
    if (items.length === 0) {
      wrap.innerHTML = '<div class="card-empty">No active signals.</div>';
      return;
    }
    wrap.innerHTML = "";
    for (const s of items) {
      const row = document.createElement("div");
      row.className = "signal-row";
      const sig = s.sigma >= 0 ? `+${s.sigma.toFixed(1)}σ` : `${s.sigma.toFixed(1)}σ`;
      const sigColor = s.sigma >= 0 ? "var(--up)" : "var(--down)";
      row.innerHTML = `
        <span class="signal-side ${s.side}">${s.side.toUpperCase()}</span>
        <div class="signal-body">
          <div class="signal-sym">${s.symbol}</div>
          <div class="signal-msg">${s.message}</div>
        </div>
        <span class="signal-sigma" style="color:${sigColor}">${sig}</span>
      `;
      wrap.appendChild(row);
    }
  } catch (e) {
    wrap.innerHTML = '<div class="card-empty">Signals unavailable.</div>';
  }
}

// --- AI Insight (deterministic, no LLM) ------------------------------------
function _smaLast(closes, n) {
  if (closes.length < n) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  return s / n;
}

function _stdev(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

function _logReturns(closes, n) {
  const out = [];
  for (let i = closes.length - n; i < closes.length; i++) {
    if (i <= 0 || closes[i - 1] === 0) continue;
    out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}

function _rsiLast(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  const avgG = gains / period;
  const avgL = losses / period;
  if (avgL === 0 && avgG === 0) return null;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function _hiddenBullDiv(closes, rsis) {
  if (closes.length < 20 || rsis.length < 20) return false;
  const idxByPriceAsc = [...Array(20).keys()].sort((a, b) => closes[closes.length - 20 + a] - closes[closes.length - 20 + b]);
  const lows = idxByPriceAsc.slice(0, 2).sort((a, b) => a - b);
  if (lows.length !== 2) return false;
  const pLows = lows.map((i) => closes[closes.length - 20 + i]);
  const rLows = lows.map((i) => rsis[rsis.length - 20 + i]);
  if (rLows.some((r) => r == null)) return false;
  return pLows[1] > pLows[0] && rLows[1] < rLows[0];
}

function _renderInsight(symbol, candles) {
  const symEl = document.getElementById("ai-symbol");
  const askSymEl = document.getElementById("ai-ask-symbol");
  const bodyEl = document.getElementById("ai-body");
  const metricsEl = document.getElementById("ai-metrics");
  if (symEl) symEl.textContent = symbol;
  if (askSymEl) askSymEl.textContent = symbol;
  if (!candles || candles.length < 30) {
    if (bodyEl) bodyEl.textContent = "Not enough data yet.";
    if (metricsEl) metricsEl.innerHTML = "";
    return;
  }
  const closes = candles.map((c) => c.c);
  const last = closes[closes.length - 1];
  const sma200 = _smaLast(closes, Math.min(200, closes.length));
  const bullish = sma200 != null && last > sma200;

  const rets5 = _logReturns(closes, 5);
  const rets60 = _logReturns(closes, 60);
  const vol5 = _stdev(rets5);
  const vol60 = _stdev(rets60);
  const volCluster = vol5 > vol60 * 1.5;

  const rsi14 = (() => {
    const out = [];
    for (let i = 14; i < closes.length; i++) {
      out.push(_rsiLast(closes.slice(0, i + 1)));
    }
    return out;
  })();
  const hiddenBull = _hiddenBullDiv(closes, rsi14);

  const demandReclaim = last * 0.985;
  const high20 = Math.max(...closes.slice(-20));
  const impliedSigma = (vol60 || 0) * 100;

  // Similar setups — count past bars where (rsi bucket, ma-spread sign) matches
  let similar = 0, wins = 0;
  if (sma200 != null) {
    const curBucket = Math.floor((rsi14[rsi14.length - 1] || 50) / 10);
    const curMaSign = last > sma200 ? 1 : -1;
    for (let i = 14; i < closes.length - 5; i++) {
      const rs = rsi14[i - 14];
      const ma = _smaLast(closes.slice(0, i + 1), Math.min(200, i + 1));
      if (rs == null || ma == null) continue;
      const b = Math.floor(rs / 10);
      const s = closes[i] > ma ? 1 : -1;
      if (b === curBucket && s === curMaSign) {
        similar++;
        if (closes[i + 5] > closes[i]) wins++;
      }
    }
  }
  const winRate = similar > 0 ? Math.round((wins / similar) * 100) : 0;

  // OBV trend last 20 days
  let obv = 0;
  const obvSeries = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += 1;
    else if (closes[i] < closes[i - 1]) obv -= 1;
    obvSeries.push(obv);
  }
  const obv20 = obvSeries.slice(-20);
  const obvUp = obv20.length >= 2 && obv20[obv20.length - 1] > obv20[0];

  if (bodyEl) {
    bodyEl.innerHTML = `
      Regime: <span class="ai-strong">${bullish ? "bullish" : "bearish"}${volCluster ? " · vol-cluster active" : ""}</span>.
      ${hiddenBull ? 'Hidden divergence on 4H RSI vs. price · ' : ''}watch
      <span class="mono ai-strong">${demandReclaim.toFixed(2)}</span> as first demand reclaim.
    `;
  }
  if (metricsEl) {
    const rows = [
      { k: "Similar setups", v: similar > 0 ? `${similar} historical · ${winRate}% win` : "n/a" },
      { k: "Liquidity above", v: high20.toFixed(2) },
      { k: "Implied σ (1D)", v: `±${impliedSigma.toFixed(2)}%` },
      { k: "Institutional flow", v: obvUp ? "Accumulating" : "Distributing", tone: obvUp ? "up" : "down" },
    ];
    metricsEl.innerHTML = rows.map((r) => `
      <div class="ai-metric">
        <span class="ai-metric-k">${r.k}</span>
        <span class="ai-metric-v" ${r.tone ? `style="color:var(--${r.tone})"` : ""}>${r.v}</span>
      </div>
    `).join("");
  }
}

async function refreshAIInsight() {
  if (!panes[0] || !panes[0].state) return;
  const { source, symbol } = panes[0].state;
  const candles = await getHistoryCached(source, symbol, "1D");
  _renderInsight(symbol, candles);
}

document.getElementById("ai-ask")?.addEventListener("click", () => showToast("Copilot coming soon"));

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
    e.preventDefault();
    showToast("Copilot coming soon");
  }
});
