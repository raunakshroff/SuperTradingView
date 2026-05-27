// Single chart pane: chart init, subscriptions, legends, drawings.

import { DEFS }                                          from "../indicators.js";
import { DrawingLayer, PrefsStore, SettingsPopover }     from "../drawings.js";
import { HL }                                            from "./hyperliquid-ws.js";
import { SYMBOLS, querySymbolsDebounced, resolveSource } from "./symbols.js";
import { defIdOf }                                       from "./constants.js";
import { IndicatorManager }                              from "./indicator-manager.js";

export class Pane {
  // opts: { onStateChange, onOpenModal }
  constructor(index, container, state, opts = {}) {
    this.index = index;
    this.state = { indicators: {}, ...state };
    if (!this.state.indicators) this.state.indicators = {};
    this._onStateChange = opts.onStateChange || (() => {});
    this._openModal     = opts.onOpenModal   || (() => {});
    this.lastPrice   = null;
    this.unsub       = null;
    this.sse         = null;
    this.flashTimer  = null;
    this.candles     = [];
    this.legendNodes = [];

    const tpl = document.getElementById("pane-template");
    this.root = tpl.content.firstElementChild.cloneNode(true);
    container.appendChild(this.root);

    this.headerEl    = this.root.querySelector(".pane-header");
    this.symbolInput = this.root.querySelector(".symbol-input");
    this.tfPillsEl   = this.root.querySelector(".tf-pills");
    this.fxBtn       = this.root.querySelector(".fx-btn");
    this.tickerPrice  = this.root.querySelector(".ticker-price");
    this.tickerChange = this.root.querySelector(".ticker-change");
    this.tickerDot   = this.root.querySelector(".ticker-dot");
    this.statusBadge = this.root.querySelector(".status-badge");
    this.chartEl     = this.root.querySelector(".chart");

    this.symbolInput.value = this.state.symbol;
    this._buildTfPills();
    this._buildChart();

    this.im = new IndicatorManager({
      chart:         this.chart,
      getState:      () => this.state,
      onStateChange: () => this._onStateChange(),
      getCandles:    () => this.candles,
      fxBtn:         this.fxBtn,
      onOpenModal:   this._openModal,
      onAfterChange: () => this._refreshLegends(),
    });

    this.im.buildAll();

    this.drawingLayer = new DrawingLayer({
      chart:     this.chart,
      series:    this.series,
      source:    this.state.source,
      symbol:    this.state.symbol,
      timeframe: this.state.tf,
    });
    this.drawingLayer.getCandles = () => this.candles;

    this.toolBtns = this.root.querySelectorAll(".draw-tool[data-tool]");
    this.toolBtns.forEach((btn) => {
      btn.addEventListener("click", () => this._setActiveTool(btn.dataset.tool));
    });
    this.drawingLayer._notifyToolChange = (id) => this._reflectActiveTool(id);

    const gearBtn = this.root.querySelector('.draw-tool[data-action="settings"]');
    if (gearBtn) {
      gearBtn.addEventListener("click", () => {
        SettingsPopover.open(gearBtn, () => {
          document.dispatchEvent(new CustomEvent("stv:drawing-prefs-changed"));
        });
      });
    }
    const undoBtn  = this.root.querySelector('.draw-tool[data-action="undo"]');
    if (undoBtn)  undoBtn.addEventListener("click",  () => this.drawingLayer.undo());
    const eraseBtn = this.root.querySelector('.draw-tool[data-action="erase"]');
    if (eraseBtn) eraseBtn.addEventListener("click", () => this.drawingLayer.eraseAll());

    this.drawToggleBtn   = this.root.querySelector('[data-action="draw-toggle"]');
    this.floatingPalette = this.root.querySelector(".draw-floating-palette");

    if (this.floatingPalette) {
      const toolbar = this.root.querySelector(".draw-toolbar");
      if (toolbar) {
        for (const src of Array.from(toolbar.children)) {
          const clone = src.cloneNode(true);
          if (src.tagName === "BUTTON") {
            clone.addEventListener("click", (ev) => { ev.stopPropagation(); src.click(); });
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

    this.im.applyPaneSizing();
    this._refreshLegends();
    this.im._updateFxButton();

    this.symbolInput.addEventListener("change", () => this._onSymbolChange());
    this.symbolInput.addEventListener("blur",   () => this._onSymbolChange());
    this.symbolInput.addEventListener("input",  () => querySymbolsDebounced(this.symbolInput.value));
    this.fxBtn.addEventListener("click",        () => this._openModal(this));

    {
      const prefs = PrefsStore.get();
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
      upColor: "#26a69a", downColor: "#ef5350",
      borderUpColor: "#26a69a", borderDownColor: "#ef5350",
      wickUpColor: "#26a69a",   wickDownColor: "#ef5350",
    }, 0);
  }

  resize() {
    this.chart.resize(this.chartEl.clientWidth, this.chartEl.clientHeight);
  }

  setState(partial) {
    this.state = { ...this.state, ...partial };
    this._onStateChange();
  }

  // --- Indicator delegation (public API used by indicators-modal.js) ----------

  setIndicator(key, params)   { this.im.setIndicator(key, params); }
  addIndicatorInstance(defId) { return this.im.addIndicatorInstance(defId); }
  removeIndicator(key)        { this.im.removeIndicator(key); }

  // --- Status badge ----------------------------------------------------------

  _setStatus(text) {
    if (text) {
      this.statusBadge.textContent = text;
      this.statusBadge.hidden = false;
    } else {
      this.statusBadge.hidden = true;
    }
  }

  // --- Symbol / timeframe ---------------------------------------------------

  _onSymbolChange() {
    const text = this.symbolInput.value.trim();
    if (!text) { this.symbolInput.value = this.state.symbol; return; }
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

  // --- Data subscriptions ---------------------------------------------------

  async subscribe() {
    this.unsubscribe();
    this.lastPrice = null;
    this.tickerPrice.textContent = "—";
    this.tickerChange.textContent = "";
    this.tickerDot.classList.remove("up", "down");
    this.series.setData([]);
    this.im.clearSeriesData();
    this._setStatus("loading…");

    try {
      await this._loadHistory();
    } catch {
      this._setStatus("history failed");
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
              + `&tf=${encodeURIComponent(this.state.tf)}&limit=500`;
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
    this.im.recomputeAll();
    const last = this.candles[this.candles.length - 1];
    this._updateTicker(last.close, false);
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
        this._patchLastCandle(time, price);
        this._updateTicker(price, true);
        this._setStatus(null);
      } catch { /* ignore */ }
    });
    es.addEventListener("error", () => { this._setStatus("reconnecting…"); });
  }

  _patchLastCandle(time, price) {
    if (this.candles.length === 0) {
      this.candles.push({ time, open: price, high: price, low: price, close: price, volume: 0 });
    } else {
      const last = this.candles[this.candles.length - 1];
      if (time > last.time) {
        this.candles.push({ time, open: price, high: price, low: price, close: price, volume: 0 });
      } else {
        last.close = price;
        last.high  = Math.max(last.high, price);
        last.low   = Math.min(last.low,  price);
      }
    }
    const tail = this.candles[this.candles.length - 1];
    this.series.update({ time: tail.time, open: tail.open, high: tail.high, low: tail.low, close: tail.close });
    this.im.updateTails();
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
    this.im.updateTails();
    this._updateTicker(c.close, true);
  }

  // --- Legends --------------------------------------------------------------

  _clearLegends() {
    for (const n of this.legendNodes) {
      if (n.parentNode) n.parentNode.removeChild(n);
    }
    this.legendNodes = [];
  }

  _refreshLegends() {
    if (this._legendPending) return;
    this._legendPending = true;
    requestAnimationFrame(() => {
      this._legendPending = false;
      this._refreshLegendsNow();
    });
  }

  _refreshLegendsNow() {
    this._clearLegends();
    const chartPanes = this.chart.panes();
    if (chartPanes.length === 0) return;

    const attach = (paneIdx, items) => {
      if (paneIdx >= chartPanes.length || items.length === 0) return;
      const paneEl = chartPanes[paneIdx].getHTMLElement();
      if (!paneEl) return;
      if (window.getComputedStyle(paneEl).position === "static") paneEl.style.position = "relative";
      const legend = document.createElement("div");
      legend.className = "pane-legend";
      for (const { def, key } of items) legend.appendChild(this._makeLegendItem(def, key));
      paneEl.appendChild(legend);
      this.legendNodes.push(legend);
    };

    const overlayItems = [];
    for (const def of DEFS) {
      if (!def.overlay) continue;
      const keys = Object.keys(this.state.indicators)
        .filter((k) => defIdOf(k) === def.id)
        .sort();
      for (const key of keys) overlayItems.push({ def, key });
    }
    attach(0, overlayItems);

    const subKeys = this.im.activeSubPanes();
    for (let i = 0; i < subKeys.length; i++) {
      const key = subKeys[i];
      const def = DEFS.find((d) => d.id === defIdOf(key));
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

    const colors     = this.im.resolveColors(def, key);
    const firstColor = Object.values(colors)[0] || "#888";
    const swatch     = document.createElement("span");
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
      this._openModal(this, def.id);
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

  // --- Drawings -------------------------------------------------------------

  _setActiveTool(id) {
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

  // --- Ticker ---------------------------------------------------------------

  _updateTicker(price, flash) {
    const fmt = price >= 1000
      ? price.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : price.toLocaleString(undefined, { maximumFractionDigits: 4 });
    this.tickerPrice.textContent = fmt;

    if (this.lastPrice != null) {
      const diff = price - this.lastPrice;
      if (diff !== 0) {
        const pct  = (diff / this.lastPrice) * 100;
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
    void this.headerEl.offsetWidth;
    this.headerEl.classList.add(dir === "up" ? "flash-up" : "flash-down");
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.headerEl.classList.remove("flash-up", "flash-down");
    }, 220);
  }

  // --- Lifecycle ------------------------------------------------------------

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
