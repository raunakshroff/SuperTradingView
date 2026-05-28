// tests/frontend/_sandbox.js
//
// Loads an IIFE-wrapped browser script in a fresh Node vm context with a
// minimal window/localStorage/document shim, and returns the resulting
// window object. Source files are not modified.

const fs   = require("node:fs");
const path = require("node:path");
const vm   = require("node:vm");

function makeFakeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] ?? null,
  };
}

function makeFakeDocument() {
  // Just enough for top-level IIFE code that touches document. The drawings
  // file calls document.createElementNS only inside render(), which our tests
  // never invoke directly, so a no-op stub is fine.
  const stub = () => ({
    setAttribute() {}, appendChild() {}, removeChild() {},
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0 }),
    style: {}, dataset: {}, textContent: "",
  });
  return {
    createElement: stub,
    createElementNS: stub,
    body: stub(),
    documentElement: stub(),
    addEventListener() {}, removeEventListener() {},
  };
}

/**
 * Load a browser script (path relative to this file) into a fresh sandbox.
 * Returns the sandbox's `window` object so callers can read `window.Indicators`
 * or `window.Drawings`.
 */
function loadBrowserScript(relPath) {
  const abs = path.resolve(__dirname, relPath);
  const code = fs.readFileSync(abs, "utf8");
  const window = {};
  const sandbox = {
    window,
    localStorage: makeFakeLocalStorage(),
    document: makeFakeDocument(),
    // The scripts also reference these globals indirectly through other code,
    // but the parts we test don't touch them. Provide harmless stubs anyway.
    LightweightCharts: {
      LineSeries: "LineSeries",
      HistogramSeries: "HistogramSeries",
    },
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  // Mirror sandbox globals onto window so `window.foo` and bare `foo` agree.
  sandbox.window.localStorage = sandbox.localStorage;
  sandbox.window.document = sandbox.document;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: abs });
  return window;
}

module.exports = { loadBrowserScript };
