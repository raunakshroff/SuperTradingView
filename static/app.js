/* SuperTradingView frontend
 *
 * Grid of N panes, each with its own chart, symbol, and timeframe.
 * Crypto streams from Hyperliquid WS (multiplexed). Stocks stream from
 * the Flask SSE bridge. Layout + per-pane state persisted in localStorage.
 */

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

// --- Symbol registry --------------------------------------------------------

const SYMBOLS = { byKey: new Map(), all: [], timeframes: [] };

async function loadSymbols() {
  const res = await fetch("/symbols");
  const data = await res.json();
  SYMBOLS.all = data.symbols;
  SYMBOLS.timeframes = data.timeframes;
  for (const s of data.symbols) {
    SYMBOLS.byKey.set(s.symbol.toUpperCase(), s);
  }
  const dl = document.getElementById("symbols-datalist");
  dl.innerHTML = SYMBOLS.all
    .map((s) => `<option value="${s.symbol}">${s.label} (${s.asset_class})</option>`)
    .join("");
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
    this.tfSelect = this.root.querySelector(".tf-select");
    this.fxBtn = this.root.querySelector(".fx-btn");
    this.tickerPrice = this.root.querySelector(".ticker-price");
    this.tickerChange = this.root.querySelector(".ticker-change");
    this.tickerDot = this.root.querySelector(".ticker-dot");
    this.statusBadge = this.root.querySelector(".status-badge");
    this.chartEl = this.root.querySelector(".chart");

    this.tfSelect.innerHTML = SYMBOLS.timeframes
      .map((t) => `<option value="${t}">${t}</option>`)
      .join("");
    this.symbolInput.value = this.state.symbol;
    this.tfSelect.value = this.state.tf;

    this._buildChart();
    // Build series objects for any persisted indicators before history loads.
    // Overlays first (pane 0), then sub-panes in DEFS order (panes 1..N).
    for (const def of Indicators.DEFS) {
      if (def.overlay && this.state.indicators[def.id]) this._buildIndicator(def.id);
    }
    let paneIdx = 1;
    for (const def of Indicators.DEFS) {
      if (!def.overlay && this.state.indicators[def.id]) {
        this._buildIndicator(def.id, paneIdx);
        paneIdx++;
      }
    }
    this._applyPaneSizing();
    this._refreshLegends();
    this._updateFxButton();

    this.symbolInput.addEventListener("change", () => this._onSymbolChange());
    this.symbolInput.addEventListener("blur",   () => this._onSymbolChange());
    this.tfSelect.addEventListener("change",    () => this._onTfChange());
    this.fxBtn.addEventListener("click",        () => openIndicatorsModal(this));

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
    this.resubscribe();
  }

  _onTfChange() {
    const tf = this.tfSelect.value;
    if (tf === this.state.tf) return;
    this.setState({ tf });
    this.resubscribe();
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

  setIndicator(id, params) {
    const def = Indicators.DEFS.find((d) => d.id === id);
    if (!def) return;
    const wasNew = !this.state.indicators[id];
    this.state.indicators[id] = { ...params };
    saveState();

    if (def.overlay) {
      // Overlay lives on the candle pane; just rebuild it.
      this._buildIndicator(id);
    } else if (wasNew) {
      // New sub-pane indicator inserts a new pane and may shift existing
      // sub-panes (DEFS order), so rebuild all sub-pane indicators.
      this._rebuildSubPanes();
    } else {
      // Existing sub-pane: only its params/colors changed, pane stays.
      this._buildIndicator(id);
    }
    this._applyPaneSizing();
    this._refreshLegends();
    this._updateFxButton();
  }

  removeIndicator(id) {
    const def = Indicators.DEFS.find((d) => d.id === id);
    delete this.state.indicators[id];
    saveState();
    this._tearDownIndicator(id);
    if (def && !def.overlay) this._rebuildSubPanes();
    this._applyPaneSizing();
    this._refreshLegends();
    this._updateFxButton();
  }

  _updateFxButton() {
    const any = Object.keys(this.state.indicators).length > 0;
    this.fxBtn.classList.toggle("has-active", any);
  }

  _activeSubPanes() {
    // Keep DEFS order so the sub-pane stack is stable across reloads.
    return Indicators.DEFS
      .filter((d) => !d.overlay && this.state.indicators[d.id])
      .map((d) => d.id);
  }

  _paneIndexFor(id) {
    const def = Indicators.DEFS.find((d) => d.id === id);
    if (!def || def.overlay) return 0;
    const subs = this._activeSubPanes();
    const idx = subs.indexOf(id);
    return idx >= 0 ? idx + 1 : 1;
  }

  _rebuildSubPanes() {
    // Tear down every sub-pane indicator, drop empty panes, then re-add the
    // currently-enabled sub-pane indicators in DEFS order, one per pane.
    for (const def of Indicators.DEFS) {
      if (!def.overlay && this.indicatorViews[def.id]) {
        this._tearDownIndicator(def.id);
      }
    }
    const panes = this.chart.panes();
    for (let i = panes.length - 1; i >= 1; i--) {
      try { this.chart.removePane(i); } catch (_e) { /* ignore */ }
    }
    let paneIdx = 1;
    for (const def of Indicators.DEFS) {
      if (def.overlay) continue;
      if (!this.state.indicators[def.id]) continue;
      this._buildIndicator(def.id, paneIdx);
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

    const attach = (paneIdx, defs) => {
      if (paneIdx >= panes.length || defs.length === 0) return;
      const paneEl = panes[paneIdx].getHTMLElement();
      if (!paneEl) return;   // pane DOM not ready yet, will refresh on next event
      const computed = window.getComputedStyle(paneEl).position;
      if (computed === "static") paneEl.style.position = "relative";
      const legend = document.createElement("div");
      legend.className = "pane-legend";
      for (const def of defs) legend.appendChild(this._makeLegendItem(def));
      paneEl.appendChild(legend);
      this.legendNodes.push(legend);
    };

    // Pane 0: all overlay indicators
    const overlays = Indicators.DEFS.filter(
      (d) => d.overlay && this.state.indicators[d.id]
    );
    attach(0, overlays);

    // Each sub-pane: the indicator that owns it (DEFS order)
    const subs = Indicators.DEFS.filter(
      (d) => !d.overlay && this.state.indicators[d.id]
    );
    for (let i = 0; i < subs.length; i++) attach(i + 1, [subs[i]]);
  }

  _legendLabelFor(def) {
    const params = this.state.indicators[def.id] || {};
    const numericVals = def.params
      .map((p) => params[p.key] ?? p.default)
      .filter((v) => v != null && v !== "");
    const shortName = def.name.split(" — ")[0].split(" (")[0];
    return numericVals.length > 0
      ? `${shortName} (${numericVals.join(", ")})`
      : shortName;
  }

  _makeLegendItem(def) {
    const item = document.createElement("div");
    item.className = "legend-item";

    const colors = this._resolveColors(def);
    const firstColor = Object.values(colors)[0] || "#888";
    const swatch = document.createElement("span");
    swatch.className = "legend-color";
    swatch.style.background = firstColor;
    item.appendChild(swatch);

    const labelEl = document.createElement("span");
    labelEl.className = "legend-name";
    labelEl.textContent = this._legendLabelFor(def);
    item.appendChild(labelEl);

    const gear = document.createElement("button");
    gear.className = "legend-gear";
    gear.type = "button";
    gear.title = `${def.name} settings`;
    gear.textContent = "⚙"; // ⚙
    gear.addEventListener("click", (e) => {
      e.stopPropagation();
      openIndicatorsModal(this, def.id);
    });
    item.appendChild(gear);

    const remove = document.createElement("button");
    remove.className = "legend-remove";
    remove.type = "button";
    remove.title = "Remove indicator";
    remove.textContent = "×"; // ×
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      this.removeIndicator(def.id);
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

  _resolveColors(def) {
    // Merge def defaults with any per-pane user overrides.
    const overrides = (this.state.indicators[def.id] || {}).colors || {};
    const out = {};
    for (const slot of def.colors || []) {
      const v = overrides[slot.key];
      out[slot.key] = typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : slot.default;
    }
    return out;
  }

  _buildIndicator(id, forcedPane) {
    this._tearDownIndicator(id);
    const def = Indicators.DEFS.find((d) => d.id === id);
    if (!def) return;
    const paneIndex = forcedPane !== undefined ? forcedPane : this._paneIndexFor(id);
    const colors = this._resolveColors(def);
    const series = def.build(this.chart, paneIndex, colors);
    this.indicatorViews[id] = { series, def };
    this._recomputeIndicator(id);
  }

  _recomputeIndicator(id) {
    if (this.candles.length === 0) return;
    const view = this.indicatorViews[id];
    if (!view) return;
    const params = this.state.indicators[id] || {};
    const colors = this._resolveColors(view.def);
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
    this.chart.remove();
    this.root.remove();
  }
}

// --- Grid management --------------------------------------------------------

const gridEl = document.getElementById("grid");
const countSel = document.getElementById("chart-count");
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
  // Pull live state back from panes
  for (let i = 0; i < panes.length; i++) paneStates[i] = panes[i].state;
  localStorage.setItem(LS_PANES, JSON.stringify(paneStates));
  localStorage.setItem(LS_COUNT, String(parseInt(countSel.value, 10)));
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

function onCountChange() {
  const count = parseInt(countSel.value, 10);
  applyLayout(count);
  buildPanes(count);
  saveState();
}

window.addEventListener("resize", () => {
  for (const p of panes) p.resize();
});

// --- Indicators modal ------------------------------------------------------

const modalEl = document.getElementById("indicators-modal");
const modalList = document.getElementById("indicators-list");
const modalSub = modalEl.querySelector(".modal-sub");
let modalPane = null;

function openIndicatorsModal(pane, focusId) {
  modalPane = pane;
  modalSub.textContent = `${pane.state.symbol} · ${pane.state.tf}`;
  renderIndicatorsModal();
  modalEl.hidden = false;
  if (focusId) {
    requestAnimationFrame(() => {
      const row = modalList.querySelector(`.indicator-row[data-id="${focusId}"]`);
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
  modalList.innerHTML = "";

  // Group defs by category, preserving DEFS order within each group.
  const groups = new Map();
  for (const def of Indicators.DEFS) {
    if (!groups.has(def.category)) groups.set(def.category, []);
    groups.get(def.category).push(def);
  }

  for (const [category, defs] of groups) {
    const header = document.createElement("div");
    header.className = "indicator-category";
    header.textContent = category;
    modalList.appendChild(header);

    for (const def of defs) {
      const row = document.createElement("div");
      row.className = "indicator-row";
      row.dataset.id = def.id;
      const checked = !!active[def.id];

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked;
      cb.addEventListener("change", () => {
        if (cb.checked) {
          const params = {};
          for (const p of def.params) params[p.key] = p.default;
          modalPane.setIndicator(def.id, params);
        } else {
          modalPane.removeIndicator(def.id);
        }
        renderIndicatorsModal();
      });

      const name = document.createElement("div");
      name.className = "ind-name";
      name.textContent = def.name;

      const paramsEl = document.createElement("div");
      paramsEl.className = "ind-params";
      if (def.params.length > 0 && checked) {
        for (const p of def.params) {
          const lbl = document.createElement("span");
          lbl.textContent = p.key;
          const inp = document.createElement("input");
          inp.type = "number";
          inp.value = active[def.id][p.key] ?? p.default;
          if (p.min  != null) inp.min  = p.min;
          if (p.max  != null) inp.max  = p.max;
          if (p.step != null) inp.step = p.step;
          inp.addEventListener("change", () => {
            const v = Number(inp.value);
            if (!Number.isFinite(v)) return;
            const cur = modalPane.state.indicators[def.id] || {};
            modalPane.setIndicator(def.id, { ...cur, [p.key]: v });
          });
          paramsEl.append(lbl, inp);
        }
      }

      const top = document.createElement("div");
      top.className = "indicator-top";
      top.append(cb, name, paramsEl);
      row.appendChild(top);

      if (checked && def.colors && def.colors.length > 0) {
        const colorsRow = document.createElement("div");
        colorsRow.className = "indicator-colors";
        const currentColors = (active[def.id].colors || {});
        for (const slot of def.colors) {
          const lbl = document.createElement("label");
          lbl.className = "color-slot";
          lbl.title = `${slot.label} color`;
          const span = document.createElement("span");
          span.textContent = slot.label;
          const inp = document.createElement("input");
          inp.type = "color";
          inp.value = (typeof currentColors[slot.key] === "string"
            && /^#[0-9a-fA-F]{6}$/.test(currentColors[slot.key]))
              ? currentColors[slot.key]
              : slot.default;
          inp.addEventListener("change", () => {
            const cur = modalPane.state.indicators[def.id] || {};
            modalPane.setIndicator(def.id, {
              ...cur,
              colors: { ...(cur.colors || {}), [slot.key]: inp.value },
            });
          });
          lbl.append(span, inp);
          colorsRow.appendChild(lbl);
        }

        // "Reset colors to defaults" link for this indicator
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "color-reset";
        reset.textContent = "reset";
        reset.title = "Reset colors to defaults";
        reset.addEventListener("click", () => {
          const cur = modalPane.state.indicators[def.id] || {};
          const next = { ...cur };
          delete next.colors;
          modalPane.setIndicator(def.id, next);
          renderIndicatorsModal();
        });
        colorsRow.appendChild(reset);

        row.appendChild(colorsRow);
      }

      modalList.appendChild(row);
    }
  }
}

// --- Boot -------------------------------------------------------------------

(async function main() {
  await loadSymbols();
  const { count, states } = loadState();
  paneStates = states;
  countSel.value = String(count);
  applyLayout(count);
  buildPanes(count);
  countSel.addEventListener("change", onCountChange);
})();
