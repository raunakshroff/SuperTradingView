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

const COUNT_LAYOUTS = {
  1: { cols: 1, rows: 1 },
  2: { cols: 2, rows: 1 },
  4: { cols: 2, rows: 2 },
  6: { cols: 3, rows: 2 },
  8: { cols: 4, rows: 2 },
};

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
let currentCount = 4;   // tracks which layout button is active
let panes = [];
let paneStates = [];

function loadState() {
  const c = parseInt(localStorage.getItem(LS_COUNT) || "4", 10);
  const count = COUNT_LAYOUTS[c] ? c : 4;
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
  return { count, states };
}

function saveState() {
  for (let i = 0; i < panes.length; i++) paneStates[i] = panes[i].state;
  localStorage.setItem(LS_PANES, JSON.stringify(paneStates));
  localStorage.setItem(LS_COUNT, String(currentCount));
}

function applyLayout(count) {
  const layout = COUNT_LAYOUTS[count] || COUNT_LAYOUTS[4];
  gridEl.style.setProperty("--cols", layout.cols);
  gridEl.style.setProperty("--rows", layout.rows);
}

function buildPanes(count) {
  for (const p of panes) p.destroy();
  panes = [];
  gridEl.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const state = paneStates[i] || { ...DEFAULT_PANES[i % DEFAULT_PANES.length] };
    panes.push(new Pane(i, gridEl, state));
  }
  // Resize after the grid lays out
  requestAnimationFrame(() => {
    for (const p of panes) p.resize();
  });
}

function setActiveLayoutBtn(count) {
  document.querySelectorAll(".layout-btn").forEach((btn) => {
    btn.classList.toggle("active", parseInt(btn.dataset.count, 10) === count);
  });
}

document.getElementById("layout-switcher").addEventListener("click", (e) => {
  const btn = e.target.closest(".layout-btn");
  if (!btn) return;
  const count = parseInt(btn.dataset.count, 10);
  if (!COUNT_LAYOUTS[count] || count === currentCount) return;
  currentCount = count;
  setActiveLayoutBtn(count);
  applyLayout(count);
  buildPanes(count);
  saveState();
});

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
  const { count, states } = loadState();
  paneStates = states;
  currentCount = count;
  setActiveLayoutBtn(count);
  applyLayout(count);
  buildPanes(count);

  document.addEventListener("stv:drawing-prefs-changed", () => {
    const prefs = Drawings.PrefsStore.get();
    for (const p of panes) {
      p.root.classList.toggle("draw-floating", prefs.toolbarMode === "floating");
    }
  });
})();
