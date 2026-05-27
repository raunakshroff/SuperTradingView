// IndicatorManager: owns indicator series lifecycle, compute, and FX button.
// Extracted from Pane to keep pane.js focused on chart + subscription concerns.

import { DEFS }    from "../indicators.js";
import { defIdOf } from "./constants.js";

export class IndicatorManager {
  /**
   * @param {Object} opts
   * @param {IChartApi} opts.chart
   * @param {() => Object}  opts.getState       returns pane.state (by reference)
   * @param {() => void}    opts.onStateChange  called after state.indicators mutation
   * @param {() => Array}   opts.getCandles     returns pane.candles
   * @param {HTMLElement}   opts.fxBtn
   * @param {Function}      opts.onOpenModal
   * @param {() => void}    opts.onAfterChange  called after add/remove to refresh legends
   */
  constructor({ chart, getState, onStateChange, getCandles, fxBtn, onOpenModal, onAfterChange }) {
    this.chart        = chart;
    this._getState    = getState;
    this._notify      = onStateChange;
    this._getCandles  = getCandles;
    this._fxBtn       = fxBtn;
    this._openModal   = onOpenModal;
    this._afterChange = onAfterChange || (() => {});
    this.views        = {};   // { [key]: { series, def } }
  }

  // Build all persisted indicators (overlays first, then sub-panes in order).
  buildAll() {
    const state = this._getState();
    for (const def of DEFS) {
      if (!def.overlay) continue;
      for (const key of Object.keys(state.indicators).filter((k) => defIdOf(k) === def.id).sort()) {
        this._build(key);
      }
    }
    let paneIdx = 1;
    for (const key of this.activeSubPanes()) {
      this._build(key, paneIdx++);
    }
  }

  // Zero out all indicator series data (called before resubscribe).
  clearSeriesData() {
    for (const id of Object.keys(this.views)) {
      for (const s of this.views[id].series) s.setData([]);
    }
  }

  setIndicator(key, params) {
    const def = DEFS.find((d) => d.id === defIdOf(key));
    if (!def) return;
    const state = this._getState();
    const wasNew = !state.indicators[key];
    state.indicators[key] = { ...params };
    this._notify();

    if (def.overlay || !wasNew) {
      this._build(key);
    } else {
      this._rebuildSubPanes();
    }
    this.applyPaneSizing();
    this._updateFxButton();
    this._afterChange();
  }

  addIndicatorInstance(defId) {
    const def = DEFS.find((d) => d.id === defId);
    if (!def) return null;
    const state = this._getState();
    const existing = Object.keys(state.indicators).filter((k) => defIdOf(k) === defId);
    const key = existing.length === 0 ? defId : `${defId}~${Date.now()}`;
    const params = {};
    for (const p of def.params) params[p.key] = p.default;
    this.setIndicator(key, params);
    return key;
  }

  removeIndicator(key) {
    const def = DEFS.find((d) => d.id === defIdOf(key));
    const state = this._getState();
    delete state.indicators[key];
    this._notify();
    this._tearDown(key);
    if (def && !def.overlay) this._rebuildSubPanes();
    this.applyPaneSizing();
    this._updateFxButton();
    this._afterChange();
  }

  recomputeAll() {
    const state = this._getState();
    for (const id of Object.keys(state.indicators)) {
      if (!this.views[id]) this._build(id);
      else this._recompute(id);
    }
  }

  updateTails() {
    for (const id of Object.keys(this.views)) this._recompute(id);
  }

  applyPaneSizing() {
    const chartPanes = this.chart.panes();
    if (chartPanes.length === 0) return;
    chartPanes[0].setStretchFactor(3);
    for (let i = 1; i < chartPanes.length; i++) chartPanes[i].setStretchFactor(1);
  }

  resolveColors(def, key) {
    const state    = this._getState();
    const stateKey = key !== undefined ? key : def.id;
    const overrides = (state.indicators[stateKey] || {}).colors || {};
    const out = {};
    for (const slot of def.colors || []) {
      const v = overrides[slot.key];
      out[slot.key] = typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : slot.default;
    }
    return out;
  }

  activeSubPanes() {
    const state = this._getState();
    const result = [];
    for (const def of DEFS) {
      if (def.overlay) continue;
      const keys = Object.keys(state.indicators)
        .filter((k) => defIdOf(k) === def.id)
        .sort();
      result.push(...keys);
    }
    return result;
  }

  _paneIndexFor(key) {
    const def = DEFS.find((d) => d.id === defIdOf(key));
    if (!def || def.overlay) return 0;
    const subs = this.activeSubPanes();
    const idx = subs.indexOf(key);
    return idx >= 0 ? idx + 1 : 1;
  }

  _rebuildSubPanes() {
    for (const key of Object.keys(this.views)) {
      const def = DEFS.find((d) => d.id === defIdOf(key));
      if (def && !def.overlay) this._tearDown(key);
    }
    const chartPanes = this.chart.panes();
    for (let i = chartPanes.length - 1; i >= 1; i--) {
      try { this.chart.removePane(i); } catch (_e) { /* ignore */ }
    }
    let paneIdx = 1;
    for (const key of this.activeSubPanes()) {
      this._build(key, paneIdx++);
    }
  }

  _build(key, forcedPane) {
    this._tearDown(key);
    const def = DEFS.find((d) => d.id === defIdOf(key));
    if (!def) return;
    const paneIndex = forcedPane !== undefined ? forcedPane : this._paneIndexFor(key);
    const colors    = this.resolveColors(def, key);
    const series    = def.build(this.chart, paneIndex, colors);
    this.views[key] = { series, def };
    this._recompute(key);
  }

  _tearDown(key) {
    const view = this.views[key];
    if (!view) return;
    for (const s of view.series) this.chart.removeSeries(s);
    delete this.views[key];
  }

  _recompute(key) {
    const candles = this._getCandles();
    if (candles.length === 0) return;
    const view = this.views[key];
    if (!view) return;
    const state  = this._getState();
    const params = state.indicators[key] || {};
    const colors = this.resolveColors(view.def, key);
    const data   = view.def.compute(candles, params, colors);
    if (data != null) view.def.apply(view.series, data);
  }

  _updateFxButton() {
    const state = this._getState();
    const count = Object.keys(state.indicators).length;
    this._fxBtn.classList.toggle("has-active", count > 0);
    const countEl = this._fxBtn.querySelector(".fx-count");
    if (countEl) countEl.textContent = count > 0 ? String(count) : "";
  }
}
