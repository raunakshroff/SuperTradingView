# Phase 1 Workspace Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the app shell to match the design's Workspace artboard (top bar + 3-column rails + bottom dock + restyled pane chrome) on the new "obsidian + acid lime" token system. Keep the existing Lightweight Charts v5 + indicators + drawings untouched. Wire 6 new backend endpoints feeding the rails with real data.

**Architecture:** CSS-token swap in `static/style.css` first (visual change only, layout unchanged). Then HTML restructure to a 3-column grid (`.workspace`) holding rails + the existing `#grid`. New layout selector replaces the count-button row with a glass popover supporting 7 presets. Backend gains a `services/` package with one module per rail card (narratives, news, events, factors, signals, sectors, breadth) sharing a single `TTLCache` whose public API is the Redis swap point for a future refactor.

**Tech Stack:** Vanilla JS (no framework), Lightweight Charts v5.2.0, CSS custom properties + Grid, Flask, yfinance, `feedparser` (new dep), pytest (new dev dep). Theme persisted in `localStorage["stv.theme"]`. Personality persisted in `localStorage["stv.personality"]`. Layout persisted in `localStorage["stv.layoutId"]` (replaces `stv.chartCount` with one-release back-compat).

**Testing model:** Python services tested with pytest (`tests/services/`). Frontend changes verified manually in browser via the "Verify in browser" convention from the drawing-tools plan: hard-refresh, perform listed actions, confirm listed outcomes.

**Spec:** [docs/superpowers/specs/2026-05-22-phase1-workspace-shell-design.md](../specs/2026-05-22-phase1-workspace-shell-design.md)

**Branch:** `claude/design-phase1-workspace-shell` (already created off `main`).

---

## File map

**Create:**

| Path | Purpose |
|---|---|
| `narratives.json` | Curated themes — 6 narratives × ~6 symbols. Read by `services/narratives.py`. |
| `factor_universe.json` | 100 S&P 100-ish tickers used by factor pulse. |
| `events.json` | Hand-curated economic calendar (next-7-days). Manually maintained weekly. |
| `services/__init__.py` | Package marker. |
| `services/_cache.py` | `TTLCache` w/ thread-safe `get_or_compute(..., stale_ok=True)`. Redis swap point. |
| `services/narratives.py` | Reads `narratives.json`, returns themes list. |
| `services/news.py` | RSS aggregator over Yahoo / Reuters / MarketWatch. |
| `services/events.py` | FRED/calendar JSON + yfinance earnings dates. |
| `services/sectors.py` | yfinance `info["sector"]` lookup w/ persistent `sectors_cache.json`. |
| `services/factors.py` | Cross-sectional z-scores, factor-portfolio Sharpe over 60d. |
| `services/signals.py` | Server-side RSI / MA-cross / breakout / divergence helpers; scans universe. |
| `services/breadth.py` | Advancers/decliners over universe + `^TNX` + `^VIX`. |
| `tests/__init__.py`, `tests/services/__init__.py` | pytest package markers. |
| `tests/services/test_cache.py` | TTLCache unit tests. |
| `tests/services/test_narratives.py`, `test_news.py`, `test_events.py`, `test_sectors.py`, `test_factors.py`, `test_signals.py`, `test_breadth.py` | One test file per service. yfinance + feedparser mocked. |
| `pytest.ini` | pytest config — rootdir, testpaths. |

**Modify:**

| Path | What changes |
|---|---|
| `requirements.txt` | Add `feedparser>=6.0`, `pytest>=8.0`. |
| `app.py` | Add 6 new routes: `/narratives`, `/factors`, `/events`, `/signals`, `/news`, `/quote/breadth`. |
| `static/index.html` | Replace `.layout-switcher` row with single popover button. Add `.workspace`, `.rail-left`, `.rail-right`, `.bottom-dock`. Add `<link>` for Google Fonts (Geist + Geist Mono). Topbar gains personality control, ⌘K button, clock, avatar. |
| `static/style.css` | Token block fully replaced. New `[data-theme="light"]` block. Helpers (`.glass`, `.pill`, `.chip`, `.kbd`, `.live-dot`, `.grain`, `.mono`, `.tnum`). Topbar / pane / modal / drawing rewritten against new tokens. New `.workspace`, `.rail`, `.bottom-dock`, popover styles. |
| `static/app.js` | Add `LAYOUTS` array + `PERSONALITY_DEFAULTS` + clock interval + popover layout selector + personality switcher + rail fetchers + theme toggle. Migrate `stv.chartCount` → `stv.layoutId`. **No changes inside the `Pane` class itself.** |
| `static/drawings.css` | Re-skin toolbar/active states against new tokens (acid). |

**No changes to:** `data_source.py`, `symbols.json`, `static/indicators.js`, `static/drawings.js`.

---

## Conventions used in this plan

- **Verify in browser** means: start the Flask server (`py -3 app.py`), open `http://127.0.0.1:5173` in a hard-refreshed browser (Ctrl+Shift+R), perform the listed actions, confirm the listed outcomes.
- **Verify with pytest** means: from project root, run the listed `py -3 -m pytest …` command, confirm PASS.
- Each task ends with a commit on the `claude/design-phase1-workspace-shell` branch.
- Code blocks for Python use `py -3` (the Windows launcher); the CLAUDE.md notes this is the only Python launcher on this machine.
- All new helper functions/types declared in a task keep the same names in later tasks. Type/name consistency is checked in the self-review at the bottom.

---

## Task 1: Backend skeleton — deps, services package, TTLCache, pytest

**Files:**
- Modify: `requirements.txt`
- Create: `pytest.ini`
- Create: `services/__init__.py`
- Create: `services/_cache.py`
- Create: `tests/__init__.py`
- Create: `tests/services/__init__.py`
- Create: `tests/services/test_cache.py`

- [ ] **Step 1: Update `requirements.txt`**

```
flask>=3.0
yfinance>=0.2.40
requests>=2.31
feedparser>=6.0
pytest>=8.0
```

- [ ] **Step 2: Install new deps**

Run: `py -3 -m pip install -r requirements.txt`
Expected: `feedparser` and `pytest` install successfully.

- [ ] **Step 3: Create `pytest.ini`**

```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_functions = test_*
addopts = -ra -q
```

- [ ] **Step 4: Create `services/__init__.py`**

```python
"""SuperTradingView server-side services for the workspace shell rails."""
```

- [ ] **Step 5: Create `tests/__init__.py` and `tests/services/__init__.py`**

Both files contain only:

```python
```

(empty — just package markers).

- [ ] **Step 6: Write the failing TTLCache tests**

`tests/services/test_cache.py`:

```python
import threading
import time

import pytest

from services._cache import TTLCache, MISSING


def test_set_and_get():
    c = TTLCache(ttl_seconds=10)
    c.set("k", 42)
    assert c.get("k") == 42


def test_get_missing_returns_sentinel():
    c = TTLCache(ttl_seconds=10)
    assert c.get("nope") is MISSING


def test_get_expired_returns_missing():
    c = TTLCache(ttl_seconds=0.01)
    c.set("k", "v")
    time.sleep(0.05)
    assert c.get("k") is MISSING


def test_get_or_compute_calls_fn_on_miss():
    c = TTLCache(ttl_seconds=10)
    calls = []
    val = c.get_or_compute("k", lambda: (calls.append(1), 7)[1])
    assert val == 7
    assert calls == [1]


def test_get_or_compute_returns_cached_on_hit():
    c = TTLCache(ttl_seconds=10)
    c.set("k", "cached")
    val = c.get_or_compute("k", lambda: "fresh")
    assert val == "cached"


def test_get_or_compute_stale_ok_returns_stale_and_recomputes():
    c = TTLCache(ttl_seconds=0.01)
    c.set("k", "old")
    time.sleep(0.05)

    done = threading.Event()

    def slow():
        time.sleep(0.05)
        done.set()
        return "new"

    val = c.get_or_compute("k", slow, stale_ok=True)
    # Returns stale value immediately
    assert val == "old"
    # Background recompute eventually finishes and updates the cache
    assert done.wait(timeout=2.0)
    # Allow the cache write to land
    time.sleep(0.05)
    assert c.get("k") == "new"


def test_get_or_compute_stale_ok_with_no_value_blocks():
    c = TTLCache(ttl_seconds=10)
    val = c.get_or_compute("k", lambda: "first", stale_ok=True)
    # No stale value to return, so it must block on the compute
    assert val == "first"


def test_thread_safety_concurrent_writes():
    c = TTLCache(ttl_seconds=10)

    def writer(i):
        for j in range(100):
            c.set(f"k{i}", j)

    threads = [threading.Thread(target=writer, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    # Last value written per key
    for i in range(8):
        assert c.get(f"k{i}") == 99
```

- [ ] **Step 7: Run the tests to confirm they fail**

Run: `py -3 -m pytest tests/services/test_cache.py -v`
Expected: All 8 tests FAIL with `ImportError: cannot import name 'TTLCache' from 'services._cache'`.

- [ ] **Step 8: Implement `services/_cache.py`**

```python
"""Thread-safe in-process TTL cache with stale-while-revalidate.

Public API is intentionally minimal so the backing store can later be swapped
to Redis without changing service-layer callers:

    c = TTLCache(ttl_seconds=300)
    c.set(key, value)
    c.get(key)                          # returns MISSING sentinel if absent/expired
    c.get_or_compute(key, fn, stale_ok=True)

Caches are process-local. Services instantiate them at module load.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Hashable


class _Missing:
    """Sentinel for absent / expired entries."""
    def __repr__(self) -> str:
        return "MISSING"


MISSING = _Missing()


class TTLCache:
    def __init__(self, ttl_seconds: float):
        self._ttl = float(ttl_seconds)
        self._store: dict[Hashable, tuple[float, Any]] = {}
        self._lock = threading.Lock()
        # Per-key locks so the same key's background recompute doesn't fan out
        self._compute_locks: dict[Hashable, threading.Lock] = {}

    def get(self, key: Hashable) -> Any:
        with self._lock:
            entry = self._store.get(key)
        if entry is None:
            return MISSING
        expires_at, value = entry
        if time.time() >= expires_at:
            return MISSING
        return value

    def _raw(self, key: Hashable) -> tuple[float, Any] | None:
        with self._lock:
            return self._store.get(key)

    def set(self, key: Hashable, value: Any) -> None:
        expires_at = time.time() + self._ttl
        with self._lock:
            self._store[key] = (expires_at, value)

    def get_or_compute(
        self,
        key: Hashable,
        fn: Callable[[], Any],
        *,
        stale_ok: bool = False,
    ) -> Any:
        fresh = self.get(key)
        if fresh is not MISSING:
            return fresh

        if stale_ok:
            stale = self._raw(key)
            if stale is not None:
                # Trigger background recompute exactly once per key
                with self._lock:
                    lock = self._compute_locks.get(key)
                    if lock is None:
                        lock = threading.Lock()
                        self._compute_locks[key] = lock
                if lock.acquire(blocking=False):
                    def _bg():
                        try:
                            value = fn()
                            self.set(key, value)
                        finally:
                            lock.release()
                    threading.Thread(target=_bg, daemon=True).start()
                return stale[1]

        # No stale value, or stale_ok=False: compute synchronously
        value = fn()
        self.set(key, value)
        return value
```

- [ ] **Step 9: Run the tests to confirm they pass**

Run: `py -3 -m pytest tests/services/test_cache.py -v`
Expected: All 8 tests PASS.

- [ ] **Step 10: Commit**

```bash
git add requirements.txt pytest.ini services/ tests/
git commit -m "feat(services): add TTLCache utility with stale-while-revalidate"
```

---

## Task 2: Design tokens + fonts + theme switching

**Files:**
- Modify: `static/index.html`
- Modify: `static/style.css`

Replace the existing `:root` token block with the design's full token system + light theme. No layout changes yet — same DOM, restyled.

- [ ] **Step 1: Add Geist + Geist Mono + Instrument Serif `<link>` to `index.html` `<head>`**

Insert after the existing `<link rel="stylesheet" href="/static/drawings.css" />` line:

```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap">
```

- [ ] **Step 2: Replace the `:root` block at the top of `static/style.css`**

Replace lines 1-22 (the existing `:root` block) with the full token system from `/tmp/design/supertradingview/project/styles.css` lines 1-95 (the `:root` body, excluding `@import` since fonts are linked in HTML now). Concretely:

```css
:root {
  /* Surfaces — graduated obsidian */
  --void:        #050506;
  --canvas:      #0a0a0c;
  --surface-1:   #0f1012;
  --surface-2:   #15171a;
  --surface-3:   #1c1f23;
  --surface-4:   #24282d;

  /* Hairlines */
  --line-faint:  rgba(255,255,255,0.04);
  --line-soft:   rgba(255,255,255,0.07);
  --line:        rgba(255,255,255,0.10);
  --line-strong: rgba(255,255,255,0.16);

  /* Text */
  --ink:         #f1f2f4;
  --ink-mute:    #a8acb3;
  --ink-soft:    #6c7079;
  --ink-faint:   #44484f;
  --ink-ghost:   #2c2f35;

  /* Acid accent (electric lime) */
  --acid:        #d4ff3a;
  --acid-soft:   rgba(212,255,58,0.18);
  --acid-glow:   rgba(212,255,58,0.35);
  --acid-deep:   #9bc91c;
  --on-acid:     #0a0a0c;

  /* PnL — desaturated, refined */
  --up:          #5fbb7e;
  --up-soft:     rgba(95,187,126,0.16);
  --up-glow:     rgba(95,187,126,0.32);
  --down:        #d6635f;
  --down-soft:   rgba(214,99,95,0.16);
  --down-glow:   rgba(214,99,95,0.32);

  /* Volume / signal palette (cool) */
  --signal:      #6ea8ff;
  --signal-soft: rgba(110,168,255,0.16);
  --warn:        #e8b04a;
  --warn-soft:   rgba(232,176,74,0.14);

  /* Radii */
  --r-xs: 4px;
  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 14px;
  --r-xl: 20px;

  /* Shadows — soft, layered */
  --shadow-1: 0 1px 0 rgba(255,255,255,0.04) inset, 0 1px 2px rgba(0,0,0,0.4);
  --shadow-2: 0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.5);
  --shadow-lift: 0 1px 0 rgba(255,255,255,0.06) inset, 0 24px 60px rgba(0,0,0,0.7), 0 2px 6px rgba(0,0,0,0.4);

  /* Type */
  --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --font-serif: 'Instrument Serif', Georgia, serif;

  /* Legacy aliases — kept while migrating older selectors. Remove in Task 6. */
  --bg:         var(--canvas);
  --panel:      var(--surface-1);
  --panel-2:    var(--surface-2);
  --panel-3:    var(--surface-3);
  --border:     var(--line);
  --border-hi:  var(--line-strong);
  --text:       var(--ink);
  --text-dim:   var(--ink-mute);
  --text-faint: var(--ink-faint);
  --accent:     var(--acid);
  --accent-hi:  var(--acid-deep);
  --topbar-h:   48px;
  --radius-sm:  var(--r-sm);
  --radius:     var(--r-md);
  --radius-lg:  var(--r-lg);
  --shadow-modal: var(--shadow-lift);
}
```

The "legacy aliases" block is a bridge so existing selectors keep working while we rebuild section-by-section. Task 6 removes them once every selector uses the new tokens directly.

- [ ] **Step 3: Append the `[data-theme="light"]` block + helpers + animations to `static/style.css`**

Append immediately after the `:root` block:

```css
/* Reset within the trading surfaces only */
body {
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-feature-settings: 'cv11', 'ss01', 'ss03';
  letter-spacing: -0.01em;
}

.mono { font-family: var(--font-mono); font-feature-settings: 'tnum', 'zero', 'ss01'; }
.tnum { font-variant-numeric: tabular-nums; }
.serif { font-family: var(--font-serif); }

.up { color: var(--up); }
.down { color: var(--down); }
.muted { color: var(--ink-mute); }
.soft { color: var(--ink-soft); }
.faint { color: var(--ink-faint); }

.pill {
  display: inline-flex; align-items: center; gap: 6px;
  height: 22px; padding: 0 8px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--line-soft);
  font-size: 11px;
  color: var(--ink-mute);
  letter-spacing: 0.01em;
}
.pill.acid { background: var(--acid-soft); border-color: transparent; color: var(--acid); }
.pill.up   { background: var(--up-soft);   border-color: transparent; color: var(--up); }
.pill.down { background: var(--down-soft); border-color: transparent; color: var(--down); }

.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 8px; border-radius: var(--r-sm);
  background: var(--surface-2);
  border: 1px solid var(--line-soft);
  font-size: 11px; color: var(--ink-mute);
  cursor: pointer; transition: background .12s, border-color .12s, color .12s;
}
.chip:hover { background: var(--surface-3); color: var(--ink); border-color: var(--line); }
.chip.on   { background: var(--surface-3); color: var(--ink); border-color: var(--line); }

.kbd {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 4px;
  background: var(--surface-3); border: 1px solid var(--line);
  font-family: var(--font-mono); font-size: 10px;
  color: var(--ink-mute);
}

.glass {
  background: linear-gradient(180deg, rgba(28,31,35,0.86), rgba(15,16,18,0.86));
  backdrop-filter: blur(24px) saturate(140%);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
  border: 1px solid var(--line-soft);
  box-shadow: var(--shadow-2);
}

@keyframes stv-pulse {
  0%,100% { opacity: 1; transform: scale(1); }
  50%     { opacity: 0.4; transform: scale(0.85); }
}
.live-dot {
  display: inline-block;
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--up); box-shadow: 0 0 8px var(--up-glow);
  animation: stv-pulse 2.2s ease-in-out infinite;
}

/* ── Light theme ─────────────────────────────────────────────────────── */
[data-theme="light"] {
  --void:        #1a1a1a;
  --canvas:      #fbfaf6;
  --surface-1:   #ffffff;
  --surface-2:   #f3f1ea;
  --surface-3:   #e6e2d6;
  --surface-4:   #d4cfbe;

  --line-faint:  rgba(0,0,0,0.04);
  --line-soft:   rgba(0,0,0,0.08);
  --line:        rgba(0,0,0,0.12);
  --line-strong: rgba(0,0,0,0.20);

  --ink:         #15171a;
  --ink-mute:    #4a4d52;
  --ink-soft:    #7a7d82;
  --ink-faint:   #abaeb2;
  --ink-ghost:   #d2cebe;

  --acid:        #6b8e00;
  --acid-soft:   rgba(107,142,0,0.12);
  --acid-glow:   rgba(107,142,0,0.32);
  --acid-deep:   #4a6500;
  --on-acid:     #ffffff;

  --up:          #2d7d4d;
  --up-soft:     rgba(45,125,77,0.12);
  --up-glow:     rgba(45,125,77,0.30);
  --down:        #c0413d;
  --down-soft:   rgba(192,65,61,0.12);
  --down-glow:   rgba(192,65,61,0.32);

  --signal:      #2a5fc8;
  --signal-soft: rgba(42,95,200,0.10);
  --warn:        #a47318;
  --warn-soft:   rgba(164,115,24,0.12);

  --shadow-1:    0 1px 2px rgba(0,0,0,0.06);
  --shadow-2:    0 1px 0 rgba(255,255,255,0.4) inset, 0 6px 20px rgba(0,0,0,0.07);
  --shadow-lift: 0 1px 0 rgba(255,255,255,0.5) inset, 0 20px 50px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.05);
}

[data-theme="light"] .glass {
  background: linear-gradient(180deg, rgba(255,255,254,0.86), rgba(248,247,243,0.86));
  border-color: rgba(0,0,0,0.06);
  box-shadow: 0 1px 0 rgba(255,255,255,0.5) inset, 0 8px 24px rgba(0,0,0,0.06);
}

[data-theme="light"] input,
[data-theme="light"] select { color-scheme: light; }
```

- [ ] **Step 4: Add theme bootstrap to `static/app.js` (at the very top, before any other code)**

```js
// --- Theme bootstrap (must run before chart init) ---------------------------
(function () {
  const t = localStorage.getItem("stv.theme") || "dark";
  document.documentElement.setAttribute("data-theme", t);
})();
```

- [ ] **Step 5: Verify in browser**

1. `py -3 app.py`
2. Hard-refresh `http://127.0.0.1:5173`
3. Confirm: app loads with dark obsidian background (was `#0b0e13`, now `#0a0a0c`), Geist sans font visible in topbar/labels, chart still renders, layout buttons still work.
4. In DevTools console: `localStorage.setItem("stv.theme","light"); location.reload();`
5. Confirm: surfaces flip to warm paper tones (`#fbfaf6` canvas, `#ffffff` panels), text becomes dark, accent darkens to olive. Chart still renders.
6. Reset: `localStorage.setItem("stv.theme","dark"); location.reload();`

- [ ] **Step 6: Commit**

```bash
git add static/index.html static/style.css static/app.js
git commit -m "style: introduce obsidian + acid token system with light theme"
```

---

## Task 3: Page shell restructure — 3-column workspace

**Files:**
- Modify: `static/index.html`
- Modify: `static/style.css`

Wrap `#grid` in a new `.workspace` 3-column container with empty rail placeholders, and add an empty `.bottom-dock`. Don't add card content yet (Tasks 8-15 fill the rails). Confirms chart still renders inside the new container.

- [ ] **Step 1: Restructure `<body>` in `static/index.html`**

Replace the existing `<main id="grid" class="grid"></main>` line with:

```html
  <main class="workspace">
    <aside class="rail rail-left" id="rail-left">
      <!-- Cards added in Task 8 (Narratives), Task 12 (Factor Pulse), Task 10 (Events) -->
    </aside>
    <div class="grid" id="grid"></div>
    <aside class="rail rail-right" id="rail-right">
      <!-- Cards added in Task 14 (AI Insight), Task 13 (Live Signals), Task 9 (News Tape) -->
    </aside>
  </main>
  <footer class="bottom-dock" id="bottom-dock">
    <!-- Populated in Task 15 -->
  </footer>
```

- [ ] **Step 2: Add layout CSS to `static/style.css` (append at end)**

```css
/* ── Workspace shell ─────────────────────────────────────────────────── */
html, body {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--canvas);
}

.workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 260px 1fr 280px;
  gap: 10px;
  padding: 10px;
  background: var(--canvas);
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.grid {
  min-width: 0;
  min-height: 0;
}

.bottom-dock {
  height: 36px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 14px;
  border-top: 1px solid var(--line-faint);
  background: var(--canvas);
  font-family: var(--font-mono);
  font-feature-settings: 'tnum';
  font-size: 11px;
  color: var(--ink-soft);
  flex-shrink: 0;
}

/* Hide rails below 1280px — chart grid gets full width */
@media (max-width: 1280px) {
  .workspace {
    grid-template-columns: 1fr;
  }
  .rail { display: none; }
}
```

- [ ] **Step 3: Verify in browser**

1. Hard-refresh.
2. Confirm: chart grid is now sandwiched between two empty 260/280px-wide columns. Below the grid, a thin 36px strip is visible (empty bottom dock).
3. Resize the window narrower than 1280px: rails disappear, chart grid uses full width.
4. Layout switcher (the old icon row in the topbar) still cycles 1/2/4/6/8 panes.

- [ ] **Step 4: Commit**

```bash
git add static/index.html static/style.css
git commit -m "feat(shell): 3-column workspace layout with rail placeholders"
```

---

## Task 4: Topbar rebuild — brand, personality, ⌘K, clock, avatar

**Files:**
- Modify: `static/index.html`
- Modify: `static/style.css`
- Modify: `static/app.js`

Old topbar has just brand + layout-switcher. New topbar adds 4 elements. Layout selector stays in its current row position for now — Task 5 replaces it with the popover version.

- [ ] **Step 1: Replace the `<header class="topbar">` block in `static/index.html`**

Replace the entire existing `<header class="topbar">…</header>` block (lines 12-62 in the current file) with:

```html
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark"></span>
      SuperTradingView
    </div>

    <div class="topbar-sep"></div>

    <!-- Workspace personality segmented control -->
    <div class="personality" id="personality" role="group" aria-label="Workspace personality">
      <button class="pers-btn" data-pers="Minimalist" type="button">Minimalist</button>
      <button class="pers-btn" data-pers="Quant" type="button">Quant</button>
      <button class="pers-btn" data-pers="Scalper" type="button">Scalper</button>
      <button class="pers-btn" data-pers="Investor" type="button">Investor</button>
    </div>

    <!-- ⌘K command palette placeholder -->
    <button class="cmd-k" id="cmd-k" type="button" title="Command palette (⌘K)">
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">
        <circle cx="5.5" cy="5.5" r="3.5"/><path d="M8.5 8.5 L11 11"/>
      </svg>
      <span>Search markets, run signal, ask copilot…</span>
      <span class="cmd-k-hint"><span class="kbd">⌘</span><span class="kbd">K</span></span>
    </button>

    <!-- Clock + live dot -->
    <div class="clock">
      <span class="live-dot"></span>
      <span class="clock-time mono tnum" id="clock-time">--:--:-- ET</span>
    </div>

    <!-- Visual grid-layout switcher (replaced by popover in Task 5) -->
    <div class="layout-switcher" id="layout-switcher" role="group" aria-label="Chart layout">
      <button class="layout-btn" data-count="1" title="Single chart" type="button">
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
          <rect x="1" y="1" width="14" height="10" rx="1.5"/>
        </svg>
      </button>
      <button class="layout-btn" data-count="2" title="2 charts" type="button">
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
          <rect x="1" y="1" width="6" height="10" rx="1.5"/>
          <rect x="9" y="1" width="6" height="10" rx="1.5"/>
        </svg>
      </button>
      <button class="layout-btn" data-count="4" title="4 charts" type="button">
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
          <rect x="1" y="1" width="6" height="4" rx="1"/>
          <rect x="9" y="1" width="6" height="4" rx="1"/>
          <rect x="1" y="7" width="6" height="4" rx="1"/>
          <rect x="9" y="7" width="6" height="4" rx="1"/>
        </svg>
      </button>
      <button class="layout-btn" data-count="6" title="6 charts" type="button">
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
          <rect x="1"    y="1" width="3.5" height="4" rx="0.8"/>
          <rect x="6.25" y="1" width="3.5" height="4" rx="0.8"/>
          <rect x="11.5" y="1" width="3.5" height="4" rx="0.8"/>
          <rect x="1"    y="7" width="3.5" height="4" rx="0.8"/>
          <rect x="6.25" y="7" width="3.5" height="4" rx="0.8"/>
          <rect x="11.5" y="7" width="3.5" height="4" rx="0.8"/>
        </svg>
      </button>
      <button class="layout-btn" data-count="8" title="8 charts" type="button">
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
          <rect x="1"    y="1" width="2.5" height="4" rx="0.6"/>
          <rect x="4.5"  y="1" width="2.5" height="4" rx="0.6"/>
          <rect x="8"    y="1" width="2.5" height="4" rx="0.6"/>
          <rect x="11.5" y="1" width="2.5" height="4" rx="0.6"/>
          <rect x="1"    y="7" width="2.5" height="4" rx="0.6"/>
          <rect x="4.5"  y="7" width="2.5" height="4" rx="0.6"/>
          <rect x="8"    y="7" width="2.5" height="4" rx="0.6"/>
          <rect x="11.5" y="7" width="2.5" height="4" rx="0.6"/>
        </svg>
      </button>
    </div>

    <!-- Theme toggle -->
    <button class="theme-toggle" id="theme-toggle" type="button" title="Toggle theme">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
        <circle cx="7" cy="7" r="3"/>
        <path d="M7 1v2 M7 11v2 M1 7h2 M11 7h2 M2.5 2.5l1.4 1.4 M10.1 10.1l1.4 1.4 M2.5 11.5l1.4-1.4 M10.1 3.9l1.4-1.4" stroke-linecap="round"/>
      </svg>
    </button>

    <!-- Avatar -->
    <div class="avatar" title="Account">QT</div>
  </header>
```

- [ ] **Step 2: Rewrite the topbar CSS section in `static/style.css`**

Find the existing topbar block (starts with `/* ── Top bar ────…`, around line 37) and replace through the end of `.layout-btn.active` rules. Replace with:

```css
/* ── Top bar ─────────────────────────────────────────────────────────── */
.topbar {
  height: 48px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--line-faint);
  background: var(--canvas);
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--ink);
  user-select: none;
}
.brand-mark {
  width: 22px; height: 22px; border-radius: 6px;
  background: var(--void); border: 1px solid var(--line);
  position: relative;
}
.brand-mark::after {
  content: '';
  position: absolute; inset: 0;
  background:
    linear-gradient(45deg, transparent 30%, var(--acid) 30%, var(--acid) 35%, transparent 35%) center/8px 8px no-repeat;
}

.topbar-sep {
  width: 1px; height: 18px; background: var(--line-faint);
}

.personality {
  display: flex;
  gap: 1px;
  background: var(--surface-1);
  border: 1px solid var(--line-faint);
  border-radius: var(--r-sm);
  padding: 2px;
}
.pers-btn {
  padding: 4px 10px;
  font-size: 11px;
  background: transparent;
  border: none;
  border-radius: var(--r-xs);
  color: var(--ink-soft);
  cursor: pointer;
  font-family: inherit;
}
.pers-btn:hover { color: var(--ink); }
.pers-btn.on {
  background: var(--surface-3);
  color: var(--ink);
  font-weight: 500;
}

.cmd-k {
  flex: 1;
  max-width: 460px;
  margin-left: auto;
  margin-right: auto;
  height: 30px;
  padding: 0 12px;
  background: var(--surface-1);
  border: 1px solid var(--line-faint);
  border-radius: var(--r-md);
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-soft);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}
.cmd-k:hover { border-color: var(--line); color: var(--ink); }
.cmd-k > span:nth-of-type(1) { font-size: 12px; flex: 1; }
.cmd-k-hint { display: flex; gap: 3px; }

.clock {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
}
.clock-time { font-size: 10px; color: var(--ink-soft); }

.theme-toggle, .avatar {
  flex-shrink: 0;
}
.theme-toggle {
  width: 30px; height: 30px;
  background: var(--surface-1);
  border: 1px solid var(--line-faint);
  border-radius: var(--r-sm);
  color: var(--ink-soft);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.theme-toggle:hover { background: var(--surface-2); color: var(--ink); }

.avatar {
  width: 30px; height: 30px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--surface-4), var(--surface-2));
  border: 1px solid var(--line-soft);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600;
  color: var(--ink-mute);
  cursor: pointer;
  user-select: none;
}

/* Existing layout switcher restyle */
.layout-switcher {
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--surface-1);
  border: 1px solid var(--line-faint);
  border-radius: var(--r-sm);
  padding: 3px;
}
.layout-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 26px;
  background: transparent;
  border: none;
  border-radius: var(--r-xs);
  color: var(--ink-soft);
  cursor: pointer;
  transition: background 100ms ease, color 100ms ease;
}
.layout-btn:hover { background: var(--surface-2); color: var(--ink); }
.layout-btn.active {
  background: var(--acid-soft);
  color: var(--acid);
}
.layout-btn svg { display: block; }
```

- [ ] **Step 3: Append topbar JS to `static/app.js` (at the very end of the file)**

```js
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
```

- [ ] **Step 4: Verify in browser**

1. Hard-refresh.
2. Confirm topbar shows in order: brand · separator · 4-button personality · ⌘K search bar · clock with live green dot · 5-button layout switcher · theme toggle icon · QT avatar.
3. Clock updates every second.
4. Click ⌘K button → toast "Command palette coming soon" appears bottom-center for ~1.8s.
5. Press Ctrl+K → same toast.
6. Click theme toggle → surfaces flip to light theme. Click again → back to dark. Reload — theme persists.

- [ ] **Step 5: Commit**

```bash
git add static/index.html static/style.css static/app.js
git commit -m "feat(topbar): personality control, command-K placeholder, clock, theme toggle"
```

---

## Task 5: Layout selector — 7-preset popover with localStorage migration

**Files:**
- Modify: `static/index.html`
- Modify: `static/style.css`
- Modify: `static/app.js`

Replace the inline row of 5 layout buttons with a single button that opens a glass popover containing 7 preset icons. Migrate `localStorage["stv.chartCount"]` → `stv.layoutId` on first load.

- [ ] **Step 1: Replace `.layout-switcher` markup in `static/index.html`**

Replace the entire `<div class="layout-switcher" id="layout-switcher" …>…</div>` block (the 5 inline buttons) with:

```html
    <div class="layout-popover-wrap" id="layout-popover-wrap">
      <button class="layout-trigger" id="layout-trigger" type="button" aria-haspopup="true" aria-expanded="false">
        <span class="layout-trigger-icon" id="layout-trigger-icon"></span>
        <span class="layout-trigger-count mono tnum" id="layout-trigger-count">4</span>
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M2 3.5 L4.5 6 L7 3.5"/>
        </svg>
      </button>
      <div class="layout-popover glass" id="layout-popover" hidden>
        <div class="layout-popover-title">Chart layout</div>
        <div class="layout-popover-grid" id="layout-popover-grid"></div>
        <div class="layout-popover-foot">
          <span>Hold <span class="kbd">⌘</span> + <span class="kbd">1-7</span></span>
          <span>Max 8 panes</span>
        </div>
      </div>
    </div>
```

- [ ] **Step 2: Add popover CSS to `static/style.css` (append at end)**

```css
/* ── Layout popover ──────────────────────────────────────────────────── */
.layout-popover-wrap { position: relative; }

.layout-trigger {
  height: 30px;
  padding: 0 10px;
  background: var(--surface-2);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-md);
  color: var(--ink);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: inherit;
}
.layout-trigger:hover { background: var(--surface-3); }
.layout-trigger[aria-expanded="true"] { background: var(--surface-3); }
.layout-trigger-icon { display: inline-flex; }
.layout-trigger-icon svg { display: block; }
.layout-trigger-count { font-size: 11px; color: var(--ink-mute); }

.layout-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  padding: 10px;
  z-index: 30;
  min-width: 220px;
  border-radius: var(--r-md);
}

.layout-popover-title {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-soft);
  padding: 4px 6px 8px;
}

.layout-popover-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.layout-preset {
  padding: 10px 6px 6px;
  background: var(--surface-2);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-sm);
  color: var(--ink-mute);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  transition: all .12s;
  font-family: inherit;
}
.layout-preset:hover { color: var(--ink); border-color: var(--line); }
.layout-preset.on {
  background: var(--acid-soft);
  border-color: var(--acid);
  color: var(--acid);
}
.layout-preset svg { display: block; }
.layout-preset-count { font-size: 9px; letter-spacing: 0.04em; }

.layout-popover-foot {
  margin-top: 8px;
  padding: 8px 6px 2px;
  border-top: 1px solid var(--line-faint);
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--ink-soft);
}
```

- [ ] **Step 3: Replace the layout-related JS in `static/app.js`**

Replace the existing `COUNT_LAYOUTS` constant (around line 8) and these existing functions: `applyLayout`, `setActiveLayoutBtn`, and the `document.getElementById("layout-switcher").addEventListener(...)` block (around lines 901-937).

Substitute with:

```js
// --- Layout presets ---------------------------------------------------------
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

const LS_LAYOUT_ID = "stv.layoutId";

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
    if (pane.el) pane.el.style.gridArea = AREA_KEYS[i];
    panes.push(pane);
  }
  requestAnimationFrame(() => {
    for (const p of panes) p.resize();
  });
}

// SVG icon for a single layout preset
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

// State + popover wiring
let currentLayoutId = 5;

function migrateLayoutState() {
  const newKey = localStorage.getItem(LS_LAYOUT_ID);
  if (newKey != null) {
    const id = parseInt(newKey, 10);
    return getLayout(id).id;
  }
  // Legacy: stv.chartCount → layoutId
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
  document.getElementById("layout-popover").hidden = false;
  document.getElementById("layout-trigger").setAttribute("aria-expanded", "true");
}
function closeLayoutPopover() {
  const pop = document.getElementById("layout-popover");
  if (pop) pop.hidden = true;
  const trig = document.getElementById("layout-trigger");
  if (trig) trig.setAttribute("aria-expanded", "false");
}

function bindLayoutPopover() {
  document.getElementById("layout-trigger").addEventListener("click", (e) => {
    e.stopPropagation();
    const open = document.getElementById("layout-popover").hidden === false;
    if (open) closeLayoutPopover(); else openLayoutPopover();
  });
  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("layout-popover-wrap");
    if (wrap && !wrap.contains(e.target)) closeLayoutPopover();
  });
  // ⌘1..⌘7 → switch layout
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 7) {
      e.preventDefault();
      setLayoutId(n);
    }
  });
}
```

- [ ] **Step 4: Replace the boot block at the bottom of `static/app.js`**

Find the existing "--- Boot ---" section and the `loadState()` + `setActiveLayoutBtn(currentCount)` + `applyLayout(currentCount)` + `buildPanes(currentCount)` sequence. Replace with:

```js
// --- Boot ------------------------------------------------------------------
(async () => {
  await fetchSymbols();
  const { states } = loadState();
  paneStates = states;
  currentLayoutId = migrateLayoutState();
  applyLayout(currentLayoutId);
  buildPanes(currentLayoutId);
  refreshLayoutTrigger();
  refreshLayoutPopover();
  bindLayoutPopover();
})();
```

(If your existing boot block uses a different function name like `init()` or has the symbol-fetch inline, preserve that — only the layout calls change. The two key replacements are: drop `setActiveLayoutBtn` and `currentCount` references; replace with `currentLayoutId`, `applyLayout`, `buildPanes`, `refreshLayoutTrigger`, `refreshLayoutPopover`, `bindLayoutPopover`.)

- [ ] **Step 5: Update `loadState()` to use layout id**

Find the existing `loadState()` function. Replace its body with:

```js
function loadState() {
  let states;
  try {
    states = JSON.parse(localStorage.getItem(LS_PANES) || "null");
  } catch { states = null; }
  if (!Array.isArray(states)) states = [];
  while (states.length < 8) states.push({ ...DEFAULT_PANES[states.length] });
  for (let i = 0; i < states.length; i++) {
    if (!states[i].indicators || typeof states[i].indicators !== "object") {
      states[i].indicators = {};
    }
  }
  return { states };
}
```

(`count` removed from the return — `currentLayoutId` handles layout.)

- [ ] **Step 6: Verify in browser**

1. Hard-refresh. The old layout-switcher row is gone; in its place is one button showing the current layout's mini-icon + count + chevron.
2. Click the button → glass popover drops below it with 7 preset tiles. Active preset has acid border.
3. Click each preset (1 up, 2H, 2V, 1+2, 2×2, 3×2, 4×2). Chart grid rebuilds correctly each time, including the **new** 2 V (stacked), 1+2 (one big + two stacked), and 4×2 (8 panes) presets.
4. Press ⌘5 / Ctrl+5 → 2×2 layout. Try ⌘1, ⌘7 etc.
5. Click outside popover → it closes.
6. Reload → last selected layout persists.
7. Test migration: in DevTools console: `localStorage.removeItem("stv.layoutId"); localStorage.setItem("stv.chartCount","6"); location.reload();` → app loads with 3×2 layout (id=6), and `localStorage.getItem("stv.layoutId")` is `"6"`.

- [ ] **Step 7: Commit**

```bash
git add static/index.html static/style.css static/app.js
git commit -m "feat(layout): 7-preset popover layout selector with localStorage migration"
```

---

## Task 6: Pane chrome restyle (CSS only, no JS changes)

**Files:**
- Modify: `static/style.css`
- Modify: `static/drawings.css`

Restyle the pane internals to match the design's `ChartPane`. **No changes** to `Pane` class, indicators, or drawings logic. After this task, remove the legacy alias block from Task 2.

- [ ] **Step 1: Rewrite the pane/grid CSS section in `static/style.css`**

Find the existing `.grid`, `.pane`, `.pane-header`, `.pane-body`, `.symbol-input`, `.tf-pills`, `.fx-btn`, `.ph-draw-toggle`, `.pane-divider`, `.ticker`, `.ticker-dot`, `.ticker-price`, `.ticker-change`, `.status-badge`, `.chart` selectors (somewhere mid-file). Replace those rules with:

```css
/* ── Pane chrome ─────────────────────────────────────────────────────── */
.pane {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--surface-1);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-md);
  overflow: hidden;
}

.pane-header {
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--line-faint);
  flex-shrink: 0;
}

.symbol-input {
  padding: 5px 10px;
  background: var(--surface-2);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-sm);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  min-width: 0;
  flex: 0 0 90px;
  outline: none;
}
.symbol-input:focus { border-color: var(--acid); }

.tf-pills {
  display: flex;
  gap: 1px;
  background: var(--surface-2);
  border-radius: var(--r-sm);
  padding: 2px;
}
.tf-pills button {
  padding: 3px 8px;
  font-size: 11px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  background: transparent;
  border: none;
  border-radius: var(--r-xs);
  color: var(--ink-soft);
  cursor: pointer;
}
.tf-pills button:hover { color: var(--ink); }
.tf-pills button.active {
  background: var(--surface-4);
  color: var(--ink);
}

.fx-btn, .ph-draw-toggle {
  width: 26px;
  height: 26px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--r-sm);
  color: var(--ink-soft);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  font-family: inherit;
}
.fx-btn:hover, .ph-draw-toggle:hover {
  background: var(--surface-3);
  color: var(--ink);
}
.fx-btn .fx-icon { font-style: italic; font-weight: 600; font-size: 12px; }
.fx-btn .fx-count {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--acid);
  color: var(--on-acid);
  font-size: 9px;
  font-weight: 600;
  display: none;
  align-items: center;
  justify-content: center;
}
.fx-btn .fx-count:not(:empty) { display: flex; }

.pane-divider {
  width: 1px;
  height: 16px;
  background: var(--line-faint);
}

.ticker {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-left: auto;
}
.ticker-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink-faint);
}
.ticker-dot.live {
  background: var(--up);
  box-shadow: 0 0 8px var(--up-glow);
  animation: stv-pulse 2.2s ease-in-out infinite;
}
.ticker-price {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 16px;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: -0.02em;
}
.ticker-change {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: var(--ink-mute);
}
.ticker-change.up   { color: var(--up); }
.ticker-change.down { color: var(--down); }

.status-badge {
  padding: 2px 6px;
  background: var(--down-soft);
  color: var(--down);
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
}

.pane-body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.chart {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
```

- [ ] **Step 2: Update drawing toolbar styles in `static/drawings.css`**

Find the `.draw-toolbar`, `.draw-tool`, `.draw-tool.active`, and `.draw-tool-sep` selectors. Replace them with:

```css
.draw-toolbar {
  width: 36px;
  background: var(--surface-1);
  border-right: 1px solid var(--line-faint);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 0;
  gap: 2px;
  flex-shrink: 0;
}

.draw-tool {
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  border-radius: var(--r-sm);
  color: var(--ink-soft);
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
}
.draw-tool:hover {
  background: var(--surface-3);
  color: var(--ink);
}
.draw-tool.active {
  background: var(--acid-soft);
  color: var(--acid);
}

.draw-tool-sep {
  width: 16px;
  height: 1px;
  background: var(--line-faint);
  margin: 2px 0;
}
```

- [ ] **Step 3: Remove the legacy alias block from `static/style.css`**

Delete the "Legacy aliases" block added in Task 2 (`--bg`, `--panel`, `--panel-2`, `--panel-3`, `--border`, `--border-hi`, `--text`, `--text-dim`, `--text-faint`, `--accent`, `--accent-hi`, `--topbar-h`, `--radius-sm`, `--radius`, `--radius-lg`, `--shadow-modal`). Then search the rest of the file for any remaining `var(--bg)`, `var(--panel)`, `var(--text)` etc. and convert each to its new-token equivalent:

| Legacy | New token |
|---|---|
| `var(--bg)` | `var(--canvas)` |
| `var(--panel)` | `var(--surface-1)` |
| `var(--panel-2)` | `var(--surface-2)` |
| `var(--panel-3)` | `var(--surface-3)` |
| `var(--border)` | `var(--line)` |
| `var(--border-hi)` | `var(--line-strong)` |
| `var(--text)` | `var(--ink)` |
| `var(--text-dim)` | `var(--ink-mute)` |
| `var(--text-faint)` | `var(--ink-faint)` |
| `var(--accent)` | `var(--acid)` |
| `var(--accent-hi)` | `var(--acid-deep)` |
| `var(--radius-sm)` | `var(--r-sm)` |
| `var(--radius)` | `var(--r-md)` |
| `var(--radius-lg)` | `var(--r-lg)` |
| `var(--shadow-modal)` | `var(--shadow-lift)` |

- [ ] **Step 4: Verify in browser**

1. Hard-refresh.
2. Confirm pane chrome matches design: rounded `var(--r-md)` corners, header padding `10px 12px`, symbol input looks like a button with mono font, tf pills as a single segmented control with `var(--surface-4)` active, fx button + drawing toggle are 26×26 ghost icons, ticker price is mono and 16px-bold, green/red change badge to the right.
3. Click drawing toggle → drawing toolbar appears on the left with acid-tinted active state.
4. Open indicators modal (ƒx button) → modal background uses new surfaces.
5. Toggle theme → all pane chrome adapts.

- [ ] **Step 5: Commit**

```bash
git add static/style.css static/drawings.css
git commit -m "style(pane): restyle pane chrome + drawing toolbar against new tokens"
```

---

## Task 7: Personality presets wired

**Files:**
- Modify: `static/app.js`

Clicking a personality button replaces all pane symbols + timeframes and applies the preset's layout id. Per-pane indicators are preserved.

- [ ] **Step 1: Append personality logic to `static/app.js` (after the layout code)**

```js
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
```

- [ ] **Step 2: Call `bindPersonality()` from the boot block**

In the `(async () => { … })()` boot block (added in Task 5), append `bindPersonality();` after `bindLayoutPopover();`.

- [ ] **Step 3: Apply default personality on first run only**

In the boot block, just after `bindPersonality();`, add:

```js
  // First run? Apply default personality (Quant) to seed states.
  if (!localStorage.getItem(LS_PERSONALITY)) {
    applyPersonality("Quant");
  }
```

- [ ] **Step 4: Verify in browser**

1. In DevTools: `localStorage.clear(); location.reload();` to simulate first run.
2. Confirm Quant preset is active (its button has `.on`), layout is 2×2 with SPY / NVDA / TLT / ^VIX.
3. Click "Minimalist" → layout collapses to 1 up, single NVDA chart, "Minimalist" button is active.
4. Click "Scalper" → 2×2 with ES=F / NQ=F / NVDA / TSLA at 5m.
5. Click "Investor" → 1+2 layout with SPY / TLT / GLD at 1D.
6. Reload → last personality persists; layout + symbols restored.
7. Add an SMA20 to a pane manually, then switch personalities — the indicator should remain on the same pane slot (state preservation by slot index).

- [ ] **Step 5: Commit**

```bash
git add static/app.js
git commit -m "feat(personality): 4 presets (Minimalist/Quant/Scalper/Investor) with state preservation"
```

---

## Task 8: Narratives — backend service + endpoint + left rail card

**Files:**
- Create: `narratives.json`
- Create: `services/narratives.py`
- Create: `tests/services/test_narratives.py`
- Modify: `app.py`
- Modify: `static/index.html`
- Modify: `static/style.css`
- Modify: `static/app.js`

- [ ] **Step 1: Create `narratives.json`**

```json
{
  "narratives": [
    {
      "id": "ai",
      "title": "AI boom",
      "desc": "Compute + inference scale-out",
      "symbols": [
        {"source": "yfinance", "symbol": "NVDA"},
        {"source": "yfinance", "symbol": "AMD"},
        {"source": "yfinance", "symbol": "AVGO"},
        {"source": "yfinance", "symbol": "SMCI"},
        {"source": "yfinance", "symbol": "PLTR"},
        {"source": "yfinance", "symbol": "ARM"}
      ]
    },
    {
      "id": "energy",
      "title": "Energy cycle",
      "desc": "Upstream + services + integrated",
      "symbols": [
        {"source": "yfinance", "symbol": "XOM"},
        {"source": "yfinance", "symbol": "CVX"},
        {"source": "yfinance", "symbol": "OXY"},
        {"source": "yfinance", "symbol": "SLB"},
        {"source": "yfinance", "symbol": "COP"},
        {"source": "yfinance", "symbol": "EOG"}
      ]
    },
    {
      "id": "war",
      "title": "War risk",
      "desc": "Defense primes + contractors",
      "symbols": [
        {"source": "yfinance", "symbol": "LMT"},
        {"source": "yfinance", "symbol": "NOC"},
        {"source": "yfinance", "symbol": "RTX"},
        {"source": "yfinance", "symbol": "GD"},
        {"source": "yfinance", "symbol": "HII"},
        {"source": "yfinance", "symbol": "LDOS"}
      ]
    },
    {
      "id": "cuts",
      "title": "Rate cuts",
      "desc": "Long-duration + rate-sensitives",
      "symbols": [
        {"source": "yfinance", "symbol": "TLT"},
        {"source": "yfinance", "symbol": "HYG"},
        {"source": "yfinance", "symbol": "XLU"},
        {"source": "yfinance", "symbol": "XLRE"},
        {"source": "yfinance", "symbol": "IYR"},
        {"source": "yfinance", "symbol": "VNQ"}
      ]
    },
    {
      "id": "reflation",
      "title": "Reflation",
      "desc": "Industrials + materials + miners",
      "symbols": [
        {"source": "yfinance", "symbol": "CAT"},
        {"source": "yfinance", "symbol": "DE"},
        {"source": "yfinance", "symbol": "FCX"},
        {"source": "yfinance", "symbol": "VALE"},
        {"source": "yfinance", "symbol": "X"},
        {"source": "yfinance", "symbol": "NUE"}
      ]
    },
    {
      "id": "mag7",
      "title": "Mag 7",
      "desc": "Megacap tech basket",
      "symbols": [
        {"source": "yfinance", "symbol": "AAPL"},
        {"source": "yfinance", "symbol": "MSFT"},
        {"source": "yfinance", "symbol": "GOOGL"},
        {"source": "yfinance", "symbol": "AMZN"},
        {"source": "yfinance", "symbol": "NVDA"},
        {"source": "yfinance", "symbol": "META"},
        {"source": "yfinance", "symbol": "TSLA"}
      ]
    }
  ]
}
```

- [ ] **Step 2: Write the failing narratives tests**

`tests/services/test_narratives.py`:

```python
import json
from pathlib import Path

import pytest

from services.narratives import load_narratives, list_narratives


def test_list_narratives_returns_seeded_themes(tmp_path):
    data = {"narratives": [
        {"id": "a", "title": "A", "desc": "", "symbols": [{"source": "yfinance", "symbol": "AAA"}]},
    ]}
    p = tmp_path / "narratives.json"
    p.write_text(json.dumps(data))
    result = list_narratives(p)
    assert result == data["narratives"]


def test_list_narratives_missing_file_returns_empty(tmp_path):
    p = tmp_path / "absent.json"
    result = list_narratives(p)
    assert result == []


def test_list_narratives_malformed_file_returns_empty(tmp_path):
    p = tmp_path / "narratives.json"
    p.write_text("{not valid json")
    result = list_narratives(p)
    assert result == []


def test_load_narratives_reads_real_file():
    repo_root = Path(__file__).resolve().parents[2]
    real = repo_root / "narratives.json"
    if not real.exists():
        pytest.skip("narratives.json not seeded yet")
    items = list_narratives(real)
    assert len(items) >= 6
    ids = {n["id"] for n in items}
    assert {"ai", "energy", "war", "cuts", "reflation", "mag7"}.issubset(ids)
```

- [ ] **Step 3: Run the tests — they should fail**

Run: `py -3 -m pytest tests/services/test_narratives.py -v`
Expected: ImportError on `services.narratives`.

- [ ] **Step 4: Implement `services/narratives.py`**

```python
"""Narratives — curated themed groupings of symbols.

Reads from `narratives.json` at the project root. Schema:

    {"narratives": [
        {"id": "ai", "title": "AI boom", "desc": "...", "symbols": [{"source": ..., "symbol": ...}]}
    ]}
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_narratives(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"narratives": []}


def list_narratives(path: Path) -> list[dict[str, Any]]:
    data = load_narratives(path)
    items = data.get("narratives", [])
    return items if isinstance(items, list) else []
```

- [ ] **Step 5: Run the tests — confirm pass**

Run: `py -3 -m pytest tests/services/test_narratives.py -v`
Expected: All 4 tests PASS.

- [ ] **Step 6: Add `/narratives` route to `app.py`**

Add this import at the top with the other imports:

```python
from services.narratives import list_narratives
```

Add this constant near `SYMBOLS_FILE`:

```python
NARRATIVES_FILE = BASE_DIR / "narratives.json"
```

Add this route after the existing `/symbols` route:

```python
@app.route("/narratives")
def narratives():
    return jsonify({"narratives": list_narratives(NARRATIVES_FILE)})
```

- [ ] **Step 7: Smoke-test endpoint**

Start server: `py -3 app.py`
Run: `py -3 -c "import urllib.request,json; print(json.dumps(json.loads(urllib.request.urlopen('http://127.0.0.1:5173/narratives').read()), indent=2)[:300])"`
Expected: JSON with 6 narratives, "ai" first.

- [ ] **Step 8: Add narratives card markup to `static/index.html`**

Inside `<aside class="rail rail-left" id="rail-left">…</aside>`, add as the first child:

```html
      <section class="card narratives-card glass" id="narratives-card">
        <div class="chip-row" id="narratives-chips"></div>
        <div class="narratives-list" id="narratives-list">
          <div class="card-empty">Loading narratives…</div>
        </div>
      </section>
```

- [ ] **Step 9: Add card + narrative CSS to `static/style.css`**

Append:

```css
/* ── Rail cards ──────────────────────────────────────────────────────── */
.card {
  border-radius: var(--r-lg);
  padding: 14px;
  flex-shrink: 0;
}

.card-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}
.card-title-text { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; color: var(--ink); }
.card-title-sub { font-size: 10px; color: var(--ink-soft); }

.card-empty {
  font-size: 11px;
  color: var(--ink-soft);
  padding: 8px 0;
  text-align: center;
}

.chip-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  padding: 0 2px 8px;
}

.narratives-list { display: flex; flex-direction: column; gap: 1px; }

.narrative-row {
  display: grid;
  grid-template-columns: 52px 1fr 70px 60px;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 6px 4px;
  border-radius: var(--r-sm);
  color: var(--ink);
  text-align: left;
  font-family: inherit;
  transition: background .12s;
}
.narrative-row:hover { background: var(--surface-2); }
.narrative-sym { font-family: var(--font-mono); font-size: 11px; font-weight: 600; }
.narrative-spark { height: 24px; position: relative; }
.narrative-price {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  text-align: right;
  color: var(--ink);
}
.narrative-chg {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  text-align: right;
}
.narrative-chg.up { color: var(--up); }
.narrative-chg.down { color: var(--down); }
```

- [ ] **Step 10: Add narrative rendering to `static/app.js`**

Append to the end:

```js
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
```

- [ ] **Step 11: Wire narratives load into boot**

In the boot block, after `bindPersonality();` and the first-run check, append:

```js
  loadNarratives();
```

- [ ] **Step 12: Verify in browser**

1. Hard-refresh.
2. Confirm left rail's top card shows 6 chip buttons (AI boom, Energy cycle, War risk, Rate cuts, Reflation, Mag 7) with "AI boom" active.
3. Below, 6 symbol rows each show: ticker · sparkline · last price · day %.
4. Click "Energy cycle" chip → list switches to XOM / CVX / OXY / SLB / COP / EOG.
5. Click an NVDA row in "AI boom" → pane 0 jumps to NVDA.

- [ ] **Step 13: Commit**

```bash
git add narratives.json services/narratives.py tests/services/test_narratives.py app.py static/index.html static/style.css static/app.js
git commit -m "feat(rail): narratives card backed by /narratives endpoint"
```

---

## Task 9: News tape — backend service + endpoint + right rail card

**Files:**
- Create: `services/news.py`
- Create: `tests/services/test_news.py`
- Modify: `app.py`
- Modify: `static/index.html`
- Modify: `static/style.css`
- Modify: `static/app.js`

- [ ] **Step 1: Write the failing news tests**

`tests/services/test_news.py`:

```python
from unittest.mock import patch, MagicMock

from services.news import _entry_to_item, fetch_news


def test_entry_to_item_yahoo():
    e = MagicMock()
    e.title = "Headline about NVDA"
    e.link = "https://finance.yahoo.com/news/abc"
    e.published_parsed = (2026, 5, 22, 14, 12, 0, 0, 0, 0)
    item = _entry_to_item(e, "finance.yahoo.com")
    assert item["text"] == "Headline about NVDA"
    assert item["url"] == "https://finance.yahoo.com/news/abc"
    assert item["source"] == "YAHOO"
    assert item["time"] == "14:12"


def test_entry_to_item_reuters():
    e = MagicMock()
    e.title = "Markets close higher"
    e.link = "https://reuters.com/business/abc"
    e.published_parsed = (2026, 5, 22, 13, 48, 0, 0, 0, 0)
    item = _entry_to_item(e, "feeds.reuters.com")
    assert item["source"] == "RTRS"


def test_fetch_news_merges_and_sorts():
    fake_y = MagicMock()
    fake_y.entries = [MagicMock(title="Y1", link="https://finance.yahoo.com/y1",
                                 published_parsed=(2026, 5, 22, 12, 0, 0, 0, 0, 0))]
    fake_r = MagicMock()
    fake_r.entries = [MagicMock(title="R1", link="https://reuters.com/r1",
                                 published_parsed=(2026, 5, 22, 14, 0, 0, 0, 0, 0))]
    fake_m = MagicMock()
    fake_m.entries = []

    with patch("services.news.feedparser.parse", side_effect=[fake_y, fake_r, fake_m]):
        items = fetch_news()

    # Newer first
    assert items[0]["text"] == "R1"
    assert items[1]["text"] == "Y1"


def test_fetch_news_handles_failing_feed():
    fake_ok = MagicMock()
    fake_ok.entries = [MagicMock(title="OK", link="https://reuters.com/x",
                                  published_parsed=(2026, 5, 22, 14, 0, 0, 0, 0, 0))]
    fake_bad = MagicMock(side_effect=Exception("boom"))

    with patch("services.news.feedparser.parse", side_effect=[Exception("boom"), fake_ok, Exception("boom")]):
        items = fetch_news()
    assert len(items) == 1
    assert items[0]["text"] == "OK"
```

- [ ] **Step 2: Run the tests — they should fail**

Run: `py -3 -m pytest tests/services/test_news.py -v`
Expected: ImportError on `services.news`.

- [ ] **Step 3: Implement `services/news.py`**

```python
"""News tape — RSS aggregator over Yahoo Finance, Reuters Business, MarketWatch.

Returns the latest 10 headlines merged + sorted desc by publish time. Cached
5 minutes via TTLCache. Failures per feed are swallowed silently — empty
contribution rather than 500.
"""

from __future__ import annotations

import time
from typing import Any
from urllib.parse import urlparse

import feedparser

from services._cache import TTLCache

FEEDS = [
    "https://finance.yahoo.com/rss/topstories",
    "https://feeds.reuters.com/reuters/businessNews",
    "https://feeds.marketwatch.com/marketwatch/topstories/",
]

_SOURCE_MAP = {
    "finance.yahoo.com": "YAHOO",
    "feeds.reuters.com": "RTRS",
    "reuters.com": "RTRS",
    "feeds.marketwatch.com": "WSJ",
    "marketwatch.com": "WSJ",
}

_cache = TTLCache(ttl_seconds=300)


def _entry_to_item(entry: Any, host: str) -> dict[str, Any]:
    pp = getattr(entry, "published_parsed", None)
    if pp:
        hh = f"{pp[3]:02d}"
        mm = f"{pp[4]:02d}"
        ts_str = f"{hh}:{mm}"
        ts_epoch = int(time.mktime(tuple(pp)))
    else:
        ts_str = "--:--"
        ts_epoch = 0
    source = _SOURCE_MAP.get(host, host.split(".")[0].upper())
    return {
        "time": ts_str,
        "ts_epoch": ts_epoch,
        "source": source,
        "text": getattr(entry, "title", ""),
        "url": getattr(entry, "link", ""),
    }


def fetch_news() -> list[dict[str, Any]]:
    def _compute():
        items: list[dict[str, Any]] = []
        for url in FEEDS:
            try:
                parsed = feedparser.parse(url)
                host = urlparse(url).netloc
                for e in getattr(parsed, "entries", [])[:8]:
                    items.append(_entry_to_item(e, host))
            except Exception:
                continue
        items.sort(key=lambda x: x.get("ts_epoch", 0), reverse=True)
        return items[:10]

    return _cache.get_or_compute("news", _compute, stale_ok=True)
```

- [ ] **Step 4: Run the tests — confirm pass**

Run: `py -3 -m pytest tests/services/test_news.py -v`
Expected: All 4 tests PASS.

- [ ] **Step 5: Add `/news` route to `app.py`**

Add import:

```python
from services.news import fetch_news
```

Add route:

```python
@app.route("/news")
def news():
    return jsonify({"news": fetch_news()})
```

- [ ] **Step 6: Add news markup to `static/index.html`**

Inside `<aside class="rail rail-right">`:

```html
      <section class="card news-card glass" id="news-card">
        <div class="card-title"><span class="card-title-text">Tape</span></div>
        <div class="news-list" id="news-list">
          <div class="card-empty">Loading news…</div>
        </div>
      </section>
```

- [ ] **Step 7: Add news CSS to `static/style.css`**

```css
.news-list { display: flex; flex-direction: column; }
.news-row {
  display: flex;
  gap: 8px;
  padding: 6px 0;
  border-top: 1px solid var(--line-faint);
  text-decoration: none;
  color: inherit;
}
.news-row:first-child { border-top: none; }
.news-time {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  color: var(--ink-soft);
  min-width: 36px;
  flex-shrink: 0;
}
.news-source {
  font-size: 9px;
  color: var(--acid);
  margin-right: 6px;
  font-weight: 600;
}
.news-text {
  font-size: 11px;
  color: var(--ink-mute);
  line-height: 1.4;
}
```

- [ ] **Step 8: Add news loader to `static/app.js`**

```js
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
```

In the boot block, after `loadNarratives();`, append:

```js
  loadNews();
  setInterval(loadNews, 5 * 60 * 1000);
```

- [ ] **Step 9: Verify in browser**

1. Start server, hard-refresh.
2. Right rail bottom shows "Tape" card with up to 10 headlines from Yahoo / Reuters / MarketWatch.
3. Each row: time · acid source code · headline. Hover shows pointer.
4. Click a headline → opens in new tab.

- [ ] **Step 10: Commit**

```bash
git add services/news.py tests/services/test_news.py app.py static/index.html static/style.css static/app.js
git commit -m "feat(rail): news tape backed by /news RSS aggregator"
```

---

## Task 10: Events — service + endpoint + left rail card

**Files:**
- Create: `events.json`
- Create: `services/events.py`
- Create: `tests/services/test_events.py`
- Modify: `app.py`
- Modify: `static/index.html`
- Modify: `static/style.css`
- Modify: `static/app.js`

- [ ] **Step 1: Create `events.json`**

```json
{
  "calendar": [
    {"date": "2026-05-22", "time": "14:00", "label": "FOMC Minutes",         "tone": "warn"},
    {"date": "2026-05-23", "time": "08:30", "label": "CPI release",          "tone": "neutral"},
    {"date": "2026-05-23", "time": "14:00", "label": "Powell speech",        "tone": "neutral"},
    {"date": "2026-05-24", "time": "08:30", "label": "Jobless claims",       "tone": "neutral"},
    {"date": "2026-05-27", "time": "08:30", "label": "PCE inflation",        "tone": "warn"},
    {"date": "2026-05-28", "time": "10:00", "label": "Consumer confidence",  "tone": "neutral"}
  ]
}
```

(Update this file weekly as part of normal repo maintenance.)

- [ ] **Step 2: Write failing tests**

`tests/services/test_events.py`:

```python
import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch, MagicMock

from services.events import load_calendar, humanize_when, list_events


def test_load_calendar_reads_json(tmp_path):
    p = tmp_path / "events.json"
    p.write_text(json.dumps({"calendar": [
        {"date": "2026-05-22", "time": "14:00", "label": "FOMC", "tone": "warn"},
    ]}))
    items = load_calendar(p)
    assert len(items) == 1
    assert items[0]["label"] == "FOMC"


def test_humanize_when_in_minutes():
    now = datetime(2026, 5, 22, 13, 42, tzinfo=timezone.utc)
    when_dt = datetime(2026, 5, 22, 14, 0, tzinfo=timezone.utc)
    assert humanize_when(when_dt, now=now) == "in 18m"


def test_humanize_when_today_time():
    now = datetime(2026, 5, 22, 10, 0, tzinfo=timezone.utc)
    when_dt = datetime(2026, 5, 22, 15, 30, tzinfo=timezone.utc)
    assert humanize_when(when_dt, now=now) == "15:30"


def test_humanize_when_tomorrow():
    now = datetime(2026, 5, 22, 10, 0, tzinfo=timezone.utc)
    when_dt = datetime(2026, 5, 23, 8, 30, tzinfo=timezone.utc)
    assert humanize_when(when_dt, now=now) == "Tomorrow"


def test_humanize_when_dow_for_week():
    now = datetime(2026, 5, 22, 10, 0, tzinfo=timezone.utc)  # Friday
    when_dt = datetime(2026, 5, 28, 10, 0, tzinfo=timezone.utc)  # next Thursday
    assert humanize_when(when_dt, now=now) == "Thu"


def test_list_events_merges_calendar_and_earnings(tmp_path):
    p = tmp_path / "events.json"
    p.write_text(json.dumps({"calendar": [
        {"date": "2026-05-22", "time": "14:00", "label": "FOMC", "tone": "warn"},
    ]}))

    fake_ticker = MagicMock()
    fake_cal_df = MagicMock()
    fake_cal_df.iloc = [{"Earnings Date": datetime(2026, 5, 22, 21, 0, tzinfo=timezone.utc)}]
    fake_ticker.calendar = {"Earnings Date": [datetime(2026, 5, 22, 21, 0, tzinfo=timezone.utc)]}

    with patch("services.events.yf.Ticker", return_value=fake_ticker):
        now = datetime(2026, 5, 22, 10, 0, tzinfo=timezone.utc)
        items = list_events(p, ["NVDA"], now=now)

    labels = [it["label"] for it in items]
    assert "FOMC" in labels
    assert any("NVDA earnings" in lbl for lbl in labels)


def test_list_events_handles_yf_error(tmp_path):
    p = tmp_path / "events.json"
    p.write_text(json.dumps({"calendar": []}))
    with patch("services.events.yf.Ticker", side_effect=Exception("network")):
        items = list_events(p, ["NVDA"])
    assert items == []
```

- [ ] **Step 3: Run tests — they should fail**

Run: `py -3 -m pytest tests/services/test_events.py -v`
Expected: ImportError.

- [ ] **Step 4: Implement `services/events.py`**

```python
"""Events — economic calendar + per-symbol earnings dates.

Calendar comes from `events.json` (hand-curated weekly). Earnings dates from
yfinance.Ticker(sym).calendar. Returns next 7 days, sorted asc.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import yfinance as yf

from services._cache import TTLCache

_earnings_cache = TTLCache(ttl_seconds=3600)


def load_calendar(path: Path) -> list[dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("calendar", [])
    except (OSError, json.JSONDecodeError):
        return []


def humanize_when(when_dt: datetime, *, now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    delta = when_dt - now
    mins = int(delta.total_seconds() // 60)
    if 0 <= mins < 60:
        return f"in {mins}m"
    if when_dt.date() == now.date():
        return when_dt.strftime("%H:%M")
    if when_dt.date() == (now.date() + timedelta(days=1)):
        return "Tomorrow"
    days_ahead = (when_dt.date() - now.date()).days
    if 1 < days_ahead < 7:
        return when_dt.strftime("%a")
    return when_dt.strftime("%b %d")


def _earnings_for(sym: str) -> datetime | None:
    def _compute():
        try:
            cal = yf.Ticker(sym).calendar
            if isinstance(cal, dict):
                dates = cal.get("Earnings Date")
                if dates and len(dates) > 0:
                    d = dates[0]
                    if isinstance(d, datetime):
                        return d.replace(tzinfo=d.tzinfo or timezone.utc)
            return None
        except Exception:
            return None

    return _earnings_cache.get_or_compute(f"earn:{sym}", _compute, stale_ok=True)


def list_events(
    calendar_path: Path,
    symbols: Iterable[str],
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    horizon = now + timedelta(days=7)
    out: list[dict[str, Any]] = []

    for item in load_calendar(calendar_path):
        try:
            dt_str = f"{item['date']} {item.get('time', '00:00')}"
            when_dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        except (KeyError, ValueError):
            continue
        if when_dt < now or when_dt > horizon:
            continue
        out.append({
            "when": humanize_when(when_dt, now=now),
            "label": item.get("label", ""),
            "tone": item.get("tone", "neutral"),
            "ts": when_dt.isoformat(),
        })

    for sym in symbols:
        when_dt = _earnings_for(sym)
        if when_dt is None:
            continue
        if when_dt < now or when_dt > horizon:
            continue
        delta_hours = (when_dt - now).total_seconds() / 3600
        tone = "acid" if delta_hours < 24 else "neutral"
        out.append({
            "when": humanize_when(when_dt, now=now),
            "label": f"{sym} earnings",
            "tone": tone,
            "ts": when_dt.isoformat(),
        })

    out.sort(key=lambda x: x["ts"])
    return out
```

- [ ] **Step 5: Run the tests — confirm pass**

Run: `py -3 -m pytest tests/services/test_events.py -v`
Expected: PASS (some warnings about yfinance imports are OK).

- [ ] **Step 6: Add `/events` route to `app.py`**

Add imports + constant:

```python
from services.events import list_events
EVENTS_FILE = BASE_DIR / "events.json"
```

Add route:

```python
@app.route("/events")
def events():
    syms_arg = request.args.get("symbols", "")
    symbols = [s.strip() for s in syms_arg.split(",") if s.strip()]
    return jsonify({"events": list_events(EVENTS_FILE, symbols)})
```

- [ ] **Step 7: Add events markup to `static/index.html`**

Inside `.rail-left`, after the narratives card:

```html
      <section class="card events-card glass" id="events-card">
        <div class="card-title"><span class="card-title-text">Upcoming events</span></div>
        <div class="events-list" id="events-list">
          <div class="card-empty">Loading…</div>
        </div>
      </section>
```

- [ ] **Step 8: Add events CSS**

```css
.events-list { display: flex; flex-direction: column; gap: 8px; }
.event-row { display: flex; align-items: center; gap: 10px; }
.event-when {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  color: var(--ink-soft);
  min-width: 56px;
}
.event-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ink-soft);
}
.event-dot.acid {
  background: var(--acid);
  box-shadow: 0 0 8px var(--acid-glow);
}
.event-dot.warn { background: var(--warn); }
.event-label { font-size: 11px; color: var(--ink); }
```

- [ ] **Step 9: Add events loader**

In `static/app.js`:

```js
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
```

In boot, after `loadNews();`, append:

```js
  loadEvents();
  setInterval(loadEvents, 60 * 1000);
```

- [ ] **Step 10: Verify in browser**

1. Hard-refresh.
2. Left rail second card "Upcoming events" lists items from `events.json` filtered to next 7 days.
3. Each row has time-label dot in the correct tone (acid = earnings <24h, warn = FOMC/CPI, neutral = grey).
4. If yfinance returns earnings dates within 7 days for current pane symbols, those rows also appear (label: "NVDA earnings", etc.).

- [ ] **Step 11: Commit**

```bash
git add events.json services/events.py tests/services/test_events.py app.py static/index.html static/style.css static/app.js
git commit -m "feat(rail): events card backed by /events (calendar + yfinance earnings)"
```

---

## Task 11: Sectors service (backend only, no UI yet)

**Files:**
- Create: `services/sectors.py`
- Create: `tests/services/test_sectors.py`

Built now so Phase 2's Sectors UI can land without backend work. Persists lookup results to `sectors_cache.json` so server restarts don't re-hit yfinance.

- [ ] **Step 1: Write failing tests**

`tests/services/test_sectors.py`:

```python
import json
from pathlib import Path
from unittest.mock import patch, MagicMock

from services.sectors import SectorLookup


def test_get_sector_caches_in_memory(tmp_path):
    fake_ticker = MagicMock()
    fake_ticker.info = {"sector": "Technology"}
    with patch("services.sectors.yf.Ticker", return_value=fake_ticker) as ticker_cls:
        s = SectorLookup(tmp_path / "cache.json")
        assert s.get("NVDA") == "Technology"
        assert s.get("NVDA") == "Technology"  # second call — no new ticker fetch
        assert ticker_cls.call_count == 1


def test_get_sector_persists_to_disk(tmp_path):
    fake_ticker = MagicMock()
    fake_ticker.info = {"sector": "Energy"}
    cache_file = tmp_path / "cache.json"
    with patch("services.sectors.yf.Ticker", return_value=fake_ticker):
        s = SectorLookup(cache_file)
        s.get("XOM")
        s.flush()
    assert cache_file.exists()
    on_disk = json.loads(cache_file.read_text())
    assert on_disk["XOM"] == "Energy"


def test_get_sector_loads_existing_cache(tmp_path):
    cache_file = tmp_path / "cache.json"
    cache_file.write_text(json.dumps({"AAPL": "Technology"}))
    with patch("services.sectors.yf.Ticker") as ticker_cls:
        s = SectorLookup(cache_file)
        assert s.get("AAPL") == "Technology"
        ticker_cls.assert_not_called()


def test_get_sector_unknown_returns_unknown(tmp_path):
    fake_ticker = MagicMock()
    fake_ticker.info = {}
    with patch("services.sectors.yf.Ticker", return_value=fake_ticker):
        s = SectorLookup(tmp_path / "cache.json")
        assert s.get("WHAT") == "Unknown"


def test_get_sector_yf_error_returns_unknown(tmp_path):
    with patch("services.sectors.yf.Ticker", side_effect=Exception("net")):
        s = SectorLookup(tmp_path / "cache.json")
        assert s.get("XXX") == "Unknown"


def test_bulk_returns_dict(tmp_path):
    def make_ticker(sym):
        m = MagicMock()
        m.info = {"sector": {"AAPL": "Technology", "XOM": "Energy"}.get(sym, "Unknown")}
        return m
    with patch("services.sectors.yf.Ticker", side_effect=make_ticker):
        s = SectorLookup(tmp_path / "cache.json")
        out = s.bulk(["AAPL", "XOM"])
    assert out == {"AAPL": "Technology", "XOM": "Energy"}
```

- [ ] **Step 2: Run the tests — they should fail**

Run: `py -3 -m pytest tests/services/test_sectors.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `services/sectors.py`**

```python
"""Sectors — yfinance-driven sector lookup with on-disk + in-memory caching.

`SectorLookup` is the public class. Pass it a Path to a JSON cache file.
On instantiation, it loads any existing cache. On `flush()`, it writes the
current in-memory map back to disk.

Surface API is intentionally small so a Redis-backed implementation can drop
in later (replace the dict + file with a Redis hash).
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Iterable

import yfinance as yf


class SectorLookup:
    def __init__(self, cache_path: Path):
        self.cache_path = cache_path
        self._lock = threading.Lock()
        self._cache: dict[str, str] = {}
        try:
            with cache_path.open("r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    self._cache = {str(k): str(v) for k, v in loaded.items()}
        except (OSError, json.JSONDecodeError):
            self._cache = {}
        self._dirty = False

    def get(self, symbol: str) -> str:
        with self._lock:
            hit = self._cache.get(symbol)
        if hit is not None:
            return hit
        try:
            info = yf.Ticker(symbol).info
            sector = info.get("sector") if isinstance(info, dict) else None
        except Exception:
            sector = None
        sector = sector if isinstance(sector, str) and sector else "Unknown"
        with self._lock:
            self._cache[symbol] = sector
            self._dirty = True
        return sector

    def bulk(self, symbols: Iterable[str]) -> dict[str, str]:
        return {s: self.get(s) for s in symbols}

    def flush(self) -> None:
        with self._lock:
            if not self._dirty:
                return
            try:
                self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                with self.cache_path.open("w", encoding="utf-8") as f:
                    json.dump(self._cache, f, indent=2)
                self._dirty = False
            except OSError:
                pass
```

- [ ] **Step 4: Run the tests — confirm pass**

Run: `py -3 -m pytest tests/services/test_sectors.py -v`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/sectors.py tests/services/test_sectors.py
git commit -m "feat(services): SectorLookup with persistent on-disk cache"
```

---

## Task 12: Factor Pulse — universe + service + endpoint + left rail card

**Files:**
- Create: `factor_universe.json`
- Create: `services/factors.py`
- Create: `tests/services/test_factors.py`
- Modify: `app.py`
- Modify: `static/index.html`
- Modify: `static/style.css`
- Modify: `static/app.js`

- [ ] **Step 1: Create `factor_universe.json` (S&P 100 constituents)**

```json
{
  "symbols": [
    "AAPL","ABBV","ABT","ACN","ADBE","AIG","AMD","AMGN","AMT","AMZN",
    "AVGO","AXP","BA","BAC","BK","BKNG","BLK","BMY","C","CAT",
    "CHTR","CL","CMCSA","COF","COP","COST","CRM","CSCO","CVS","CVX",
    "DE","DHR","DIS","DOW","DUK","EMR","EXC","F","FDX","GD",
    "GE","GILD","GM","GOOG","GOOGL","GS","HD","HON","IBM","INTC",
    "JNJ","JPM","KHC","KMI","KO","LIN","LLY","LMT","LOW","MA",
    "MCD","MDLZ","MDT","MET","META","MMM","MO","MRK","MS","MSFT",
    "NEE","NFLX","NKE","NVDA","ORCL","PEP","PFE","PG","PM","PYPL",
    "QCOM","RTX","SBUX","SCHW","SO","SPG","T","TGT","TMO","TMUS",
    "TSLA","TXN","UNH","UNP","UPS","USB","V","VZ","WBA","WFC"
  ]
}
```

- [ ] **Step 2: Write failing factor tests**

`tests/services/test_factors.py`:

```python
import math
from unittest.mock import patch, MagicMock

import pytest

from services.factors import (
    zscore,
    momentum_12m_1m,
    realized_vol,
    factor_portfolio_strength,
    compute_factors,
)


def test_zscore_basic():
    vals = [1.0, 2.0, 3.0, 4.0, 5.0]
    z = zscore(vals)
    # mean=3, stdev=~1.581
    assert z[0] == pytest.approx(-1.2649, abs=1e-3)
    assert z[2] == pytest.approx(0.0, abs=1e-3)
    assert z[4] == pytest.approx(1.2649, abs=1e-3)


def test_zscore_constant_returns_zeros():
    assert zscore([3.0, 3.0, 3.0]) == [0.0, 0.0, 0.0]


def test_zscore_empty_returns_empty():
    assert zscore([]) == []


def test_momentum_12m_1m_classical():
    # 252 days of data — last close = 100; 1mo ago (21 days) close = 110;
    # 12mo ago (252 days) close = 80. Expected: (100/80) - (100/110)
    closes = [80.0] + [80.0] * 230 + [110.0] + [110.0] * 19 + [100.0]
    assert len(closes) == 252
    m = momentum_12m_1m(closes)
    assert m == pytest.approx(100/80 - 100/110, abs=1e-6)


def test_momentum_short_history_returns_none():
    assert momentum_12m_1m([1.0, 2.0]) is None


def test_realized_vol_returns_float():
    closes = [100, 101, 99, 102, 98, 103, 100]
    v = realized_vol(closes, lookback=5)
    assert isinstance(v, float)
    assert v > 0


def test_realized_vol_too_short_returns_none():
    assert realized_vol([100, 101], lookback=10) is None


def test_factor_portfolio_strength_uses_top_bottom_quintiles():
    syms = ["A","B","C","D","E","F","G","H","I","J"]
    scores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    # 60d cum returns — top quintile (J,I) returns +5%, bottom (A,B) returns -5%
    returns = {
        "A": [-0.01]*60, "B": [-0.01]*60, "C": [0.0]*60, "D": [0.0]*60, "E": [0.0]*60,
        "F": [0.0]*60, "G": [0.0]*60, "H": [0.0]*60, "I": [0.005]*60, "J": [0.005]*60,
    }
    s = factor_portfolio_strength(syms, scores, returns)
    # Long (I+J) cum return ~ (1.005)^60 - 1; Short (A+B) ~ (0.99)^60 - 1
    # Positive number since long > short
    assert s > 0


def test_factor_portfolio_strength_empty_returns_zero():
    assert factor_portfolio_strength([], [], {}) == 0.0


def test_compute_factors_returns_six_factors():
    syms = [f"S{i}" for i in range(20)]

    def fake_history(sym, lookback=260):
        # Each symbol gets a slightly different price history
        base = 100 + (hash(sym) % 50)
        return [base + i * 0.1 for i in range(260)]

    fake_info = {
        f"S{i}": {"trailingPE": 10 + i, "returnOnEquity": 0.1 + i * 0.01,
                  "revenueGrowth": 0.05 + i * 0.005, "marketCap": 1e9 * (i + 1)}
        for i in range(20)
    }

    with patch("services.factors.fetch_closes", side_effect=fake_history), \
         patch("services.factors.fetch_info", side_effect=lambda s: fake_info[s]):
        out = compute_factors(syms)

    names = [f["name"] for f in out]
    assert names == ["Momentum", "Quality", "Value", "Low Vol", "Growth", "Size (SMB)"]
    for f in out:
        assert "z" in f
        assert "weight" in f
```

- [ ] **Step 3: Run the tests — they should fail**

Run: `py -3 -m pytest tests/services/test_factors.py -v`
Expected: ImportError.

- [ ] **Step 4: Implement `services/factors.py`**

```python
"""Factor Pulse — cross-sectional z-scores + factor-portfolio Sharpe-like strength.

Six factors:
  Momentum  — classical 12-1 (252d - 21d return)
  Quality   — return on equity
  Value     — earnings yield (1 / trailingPE)
  Low Vol   — negative of 60d realized vol
  Growth    — revenue YoY growth
  Size      — negative of log(marketCap)

For each factor:
  1. Compute raw value per symbol over the universe
  2. z-score across the universe
  3. Sort by z; long top quintile, short bottom quintile (equal-weight)
  4. Compute the factor portfolio's 60d cumulative return / 60d return stdev
  5. Return that Sharpe-like ratio as `z`; `weight` is |z| clipped to [0,1]

Cached 30 minutes server-side with stale-while-revalidate.
"""

from __future__ import annotations

import math
import statistics
from typing import Callable

import yfinance as yf

from services._cache import TTLCache

_cache = TTLCache(ttl_seconds=30 * 60)
_LOOKBACK_DAYS = 260


def zscore(values: list[float]) -> list[float]:
    if not values:
        return []
    mean = sum(values) / len(values)
    if len(values) < 2:
        return [0.0] * len(values)
    var = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    stdev = math.sqrt(var)
    if stdev == 0:
        return [0.0] * len(values)
    return [(v - mean) / stdev for v in values]


def momentum_12m_1m(closes: list[float]) -> float | None:
    if len(closes) < 252:
        return None
    last = closes[-1]
    return last / closes[-252] - last / closes[-21]


def realized_vol(closes: list[float], *, lookback: int = 60) -> float | None:
    if len(closes) < lookback + 1:
        return None
    rets = []
    for i in range(-lookback, 0):
        if closes[i - 1] == 0:
            continue
        rets.append(math.log(closes[i] / closes[i - 1]))
    if len(rets) < 2:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var) * math.sqrt(252)


def factor_portfolio_strength(
    symbols: list[str],
    scores: list[float],
    returns_by_sym: dict[str, list[float]],
) -> float:
    if not symbols or not scores:
        return 0.0
    n = len(symbols)
    if n < 5:
        return 0.0
    paired = sorted(zip(symbols, scores), key=lambda p: p[1])
    quintile = max(1, n // 5)
    short_set = [s for s, _ in paired[:quintile]]
    long_set = [s for s, _ in paired[-quintile:]]

    def portfolio_returns(syms):
        # Daily mean across the symbols in the basket
        per_day = []
        for d in range(60):
            rs = []
            for s in syms:
                lst = returns_by_sym.get(s, [])
                if d < len(lst):
                    rs.append(lst[d])
            if rs:
                per_day.append(sum(rs) / len(rs))
        return per_day

    long_d = portfolio_returns(long_set)
    short_d = portfolio_returns(short_set)
    if not long_d or not short_d:
        return 0.0

    diff = [l - s for l, s in zip(long_d, short_d)]
    cum = 1.0
    for d in diff:
        cum *= (1 + d)
    cum_return = cum - 1
    if len(diff) < 2:
        return 0.0
    mean = sum(diff) / len(diff)
    var = sum((d - mean) ** 2 for d in diff) / (len(diff) - 1)
    stdev = math.sqrt(var)
    if stdev == 0:
        return 0.0
    return cum_return / (stdev * math.sqrt(len(diff)))


def fetch_closes(symbol: str, lookback: int = _LOOKBACK_DAYS) -> list[float] | None:
    try:
        hist = yf.Ticker(symbol).history(period="2y", interval="1d")
        closes = [float(c) for c in hist["Close"].tolist() if c is not None and not math.isnan(float(c))]
        return closes[-lookback:] if len(closes) >= lookback else closes
    except Exception:
        return None


def fetch_info(symbol: str) -> dict:
    try:
        info = yf.Ticker(symbol).info
        return info if isinstance(info, dict) else {}
    except Exception:
        return {}


def _safe_div(a, b):
    try:
        return a / b
    except (TypeError, ZeroDivisionError):
        return None


def compute_factors(symbols: list[str]) -> list[dict]:
    closes_by_sym: dict[str, list[float]] = {}
    info_by_sym: dict[str, dict] = {}
    for s in symbols:
        c = fetch_closes(s)
        if c and len(c) >= 60:
            closes_by_sym[s] = c
            info_by_sym[s] = fetch_info(s) or {}

    universe = list(closes_by_sym.keys())
    returns_by_sym: dict[str, list[float]] = {}
    for s, c in closes_by_sym.items():
        rets = []
        for i in range(-60, 0):
            if c[i - 1] == 0:
                rets.append(0.0)
            else:
                rets.append(c[i] / c[i - 1] - 1)
        returns_by_sym[s] = rets

    def raw_per_factor(fname: str) -> list[float | None]:
        out = []
        for s in universe:
            c = closes_by_sym[s]
            info = info_by_sym[s]
            if fname == "Momentum":
                out.append(momentum_12m_1m(c))
            elif fname == "Low Vol":
                v = realized_vol(c)
                out.append(-v if v is not None else None)
            elif fname == "Quality":
                roe = info.get("returnOnEquity")
                out.append(float(roe) if isinstance(roe, (int, float)) else None)
            elif fname == "Value":
                pe = info.get("trailingPE")
                ey = _safe_div(1.0, float(pe)) if isinstance(pe, (int, float)) and pe > 0 else None
                out.append(ey)
            elif fname == "Growth":
                g = info.get("revenueGrowth")
                out.append(float(g) if isinstance(g, (int, float)) else None)
            elif fname == "Size (SMB)":
                mc = info.get("marketCap")
                out.append(-math.log(float(mc)) if isinstance(mc, (int, float)) and mc > 0 else None)
        return out

    factor_order = ["Momentum", "Quality", "Value", "Low Vol", "Growth", "Size (SMB)"]
    results = []
    for fname in factor_order:
        raw = raw_per_factor(fname)
        filtered = [(s, r) for s, r in zip(universe, raw) if r is not None]
        if len(filtered) < 5:
            results.append({"name": fname, "z": 0.0, "weight": 0.0})
            continue
        syms, vals = zip(*filtered)
        scores = zscore(list(vals))
        strength = factor_portfolio_strength(list(syms), scores, returns_by_sym)
        z = max(-2.0, min(2.0, strength * 10))  # rescale into [-2, 2]
        weight = min(1.0, abs(z) / 1.0)
        results.append({"name": fname, "z": round(z, 2), "weight": round(weight, 2)})
    return results


def factors_cached(symbols: list[str]) -> list[dict]:
    return _cache.get_or_compute(
        "factors", lambda: compute_factors(symbols), stale_ok=True
    )
```

- [ ] **Step 5: Run the tests — confirm pass**

Run: `py -3 -m pytest tests/services/test_factors.py -v`
Expected: All 9 tests PASS.

- [ ] **Step 6: Add `/factors` route to `app.py`**

```python
from services.factors import factors_cached
import json as _json

FACTOR_UNIVERSE_FILE = BASE_DIR / "factor_universe.json"

def _factor_universe():
    try:
        with FACTOR_UNIVERSE_FILE.open("r", encoding="utf-8") as f:
            return _json.load(f).get("symbols", [])
    except (OSError, _json.JSONDecodeError):
        return []

@app.route("/factors")
def factors():
    return jsonify({"factors": factors_cached(_factor_universe())})
```

- [ ] **Step 7: Smoke test endpoint**

Server running. Run: `py -3 -c "import urllib.request,json; print(json.dumps(json.loads(urllib.request.urlopen('http://127.0.0.1:5173/factors').read()), indent=2))"`
Expected: First call may take 30-60s (yfinance fetching 100 symbols). Returns 6 factors with z + weight. Second call within 30min returns instantly from cache.

- [ ] **Step 8: Add factor pulse markup**

In `.rail-left`, after the events card:

```html
      <section class="card factor-card glass" id="factor-card">
        <div class="card-title">
          <span class="card-title-text">Factor pulse</span>
          <span class="card-title-sub mono">z-score · 60d</span>
        </div>
        <div class="factor-list" id="factor-list">
          <div class="card-empty">Computing factors…</div>
        </div>
      </section>
```

- [ ] **Step 9: Add factor CSS**

```css
.factor-list { display: flex; flex-direction: column; gap: 7px; }
.factor-row {
  display: grid;
  grid-template-columns: 78px 1fr 48px;
  align-items: center;
  gap: 8px;
}
.factor-name { font-size: 11px; color: var(--ink-mute); }
.factor-bar {
  position: relative;
  height: 4px;
  background: var(--surface-2);
  border-radius: 2px;
}
.factor-bar-zero {
  position: absolute;
  left: 50%;
  top: -2px;
  bottom: -2px;
  width: 1px;
  background: var(--line);
}
.factor-bar-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 2px;
}
.factor-z {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  text-align: right;
}
```

- [ ] **Step 10: Add factor loader**

In `static/app.js`:

```js
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
```

In boot, after `loadEvents();`:

```js
  loadFactors();
  setInterval(loadFactors, 5 * 60 * 1000);
```

- [ ] **Step 11: Verify in browser**

1. Hard-refresh. First load shows "Computing factors…".
2. After 30-60s (first run), card populates with 6 factors as bipolar bars.
3. Subsequent reloads return instantly from cache.
4. Each row: factor name · bipolar bar · z-score in mono.

- [ ] **Step 12: Commit**

```bash
git add factor_universe.json services/factors.py tests/services/test_factors.py app.py static/index.html static/style.css static/app.js
git commit -m "feat(rail): factor pulse card backed by /factors (100-symbol universe)"
```

---

## Task 13: Live Signals — service + endpoint + right rail card

**Files:**
- Create: `services/signals.py`
- Create: `tests/services/test_signals.py`
- Modify: `app.py`
- Modify: `static/index.html`
- Modify: `static/style.css`
- Modify: `static/app.js`

Port a small indicator math subset (RSI, SMA, breakout, hidden divergence) to Python so signals run server-side over the factor universe.

- [ ] **Step 1: Write failing signals tests**

`tests/services/test_signals.py`:

```python
import math
from unittest.mock import patch

import pytest

from services.signals import sma, rsi, hidden_bull_div, hidden_bear_div, scan_signals


def test_sma_basic():
    assert sma([1, 2, 3, 4, 5], 3) == [None, None, 2.0, 3.0, 4.0]


def test_sma_too_short():
    assert sma([1, 2], 3) == [None, None]


def test_rsi_constant_returns_none():
    # All gains == 0 → undefined RSI
    out = rsi([100] * 20, 14)
    assert out[-1] is None


def test_rsi_monotonic_up_approaches_100():
    closes = [100 + i for i in range(30)]
    out = rsi(closes, 14)
    assert out[-1] is not None and out[-1] > 99


def test_hidden_bull_div_detects():
    # Price makes higher low, RSI makes lower low → hidden bullish divergence
    # Two lows: oldest first
    prices_at_lows = [100, 102]
    rsis_at_lows = [40, 35]
    assert hidden_bull_div(prices_at_lows, rsis_at_lows) is True


def test_hidden_bull_div_no_signal():
    prices_at_lows = [100, 95]
    rsis_at_lows = [40, 35]
    assert hidden_bull_div(prices_at_lows, rsis_at_lows) is False


def test_hidden_bear_div_detects():
    prices_at_highs = [110, 108]
    rsis_at_highs = [65, 70]
    assert hidden_bear_div(prices_at_highs, rsis_at_highs) is True


def test_scan_signals_returns_signals():
    def fake_closes(sym):
        # Symbol "BULL" trending up, "BEAR" trending down
        if sym == "BULL":
            return [100 + i * 0.5 for i in range(300)]
        if sym == "BEAR":
            return [200 - i * 0.5 for i in range(300)]
        return [100] * 300  # flat

    with patch("services.signals.fetch_closes", side_effect=fake_closes):
        out = scan_signals(["BULL", "BEAR", "FLAT"])
    # Expect at least one trend-break or breakout per non-flat symbol
    syms = {s["symbol"] for s in out}
    assert "BULL" in syms or "BEAR" in syms


def test_scan_signals_handles_missing_data():
    def fake_closes(sym):
        return None

    with patch("services.signals.fetch_closes", side_effect=fake_closes):
        out = scan_signals(["NULL"])
    assert out == []
```

- [ ] **Step 2: Run tests — they should fail**

Run: `py -3 -m pytest tests/services/test_signals.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `services/signals.py`**

```python
"""Live signals — scans a universe for trade setups using simple indicator math.

Three signal types per symbol:
  - Trend break: close crosses 200-SMA after 20+ bars on the wrong side
  - Hidden divergence: price/RSI HH-LL pattern on last 20 bars
  - Liquidity sweep + reclaim: wick beyond 20d high/low, body closes back inside

Returns top 5 signals by absolute sigma score. Cached 60s.
"""

from __future__ import annotations

import math
import statistics
from typing import Any

import yfinance as yf

from services._cache import TTLCache

_cache = TTLCache(ttl_seconds=60)


def sma(values: list[float], n: int) -> list[float | None]:
    out: list[float | None] = []
    s = 0.0
    for i, v in enumerate(values):
        if i < n - 1:
            s += v
            out.append(None)
            continue
        if i == n - 1:
            s += v
            out.append(s / n)
        else:
            s += v - values[i - n]
            out.append(s / n)
    return out


def rsi(closes: list[float], n: int = 14) -> list[float | None]:
    if len(closes) < n + 1:
        return [None] * len(closes)
    out: list[float | None] = [None] * len(closes)
    gains = []
    losses = []
    for i in range(1, n + 1):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))
    avg_g = sum(gains) / n
    avg_l = sum(losses) / n
    if avg_l == 0 and avg_g == 0:
        return out
    if avg_l == 0:
        out[n] = 100.0
    else:
        rs = avg_g / avg_l
        out[n] = 100 - 100 / (1 + rs)
    for i in range(n + 1, len(closes)):
        diff = closes[i] - closes[i - 1]
        g = max(diff, 0.0)
        l = max(-diff, 0.0)
        avg_g = (avg_g * (n - 1) + g) / n
        avg_l = (avg_l * (n - 1) + l) / n
        if avg_l == 0 and avg_g == 0:
            out[i] = None
        elif avg_l == 0:
            out[i] = 100.0
        else:
            rs = avg_g / avg_l
            out[i] = 100 - 100 / (1 + rs)
    return out


def hidden_bull_div(prices_at_lows: list[float], rsis_at_lows: list[float]) -> bool:
    if len(prices_at_lows) < 2 or len(rsis_at_lows) < 2:
        return False
    return prices_at_lows[-1] > prices_at_lows[-2] and rsis_at_lows[-1] < rsis_at_lows[-2]


def hidden_bear_div(prices_at_highs: list[float], rsis_at_highs: list[float]) -> bool:
    if len(prices_at_highs) < 2 or len(rsis_at_highs) < 2:
        return False
    return prices_at_highs[-1] < prices_at_highs[-2] and rsis_at_highs[-1] > rsis_at_highs[-2]


def fetch_closes(symbol: str) -> list[float] | None:
    try:
        hist = yf.Ticker(symbol).history(period="1y", interval="1d")
        closes = [float(c) for c in hist["Close"].tolist() if c is not None and not math.isnan(float(c))]
        return closes if len(closes) >= 200 else None
    except Exception:
        return None


def _signals_for_symbol(symbol: str, closes: list[float]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    n = len(closes)
    sma200 = sma(closes, 200)
    rsi14 = rsi(closes, 14)

    # 1. Trend break — close crosses sma200 after 20+ bars on wrong side
    if sma200[-1] is not None and sma200[-21] is not None:
        was_below = all((closes[i] < (sma200[i] or 0)) for i in range(-21, -1) if sma200[i] is not None)
        was_above = all((closes[i] > (sma200[i] or float("inf"))) for i in range(-21, -1) if sma200[i] is not None)
        if was_below and closes[-1] > sma200[-1]:
            out.append({"symbol": symbol, "side": "long", "message": "Trend break · 200-SMA reclaim", "sigma": 1.5})
        elif was_above and closes[-1] < sma200[-1]:
            out.append({"symbol": symbol, "side": "short", "message": "Trend break · 200-SMA loss", "sigma": -1.5})

    # 2. Hidden divergence — look for two local lows / highs in last 20 bars
    window = closes[-20:]
    rsi_window = [r for r in rsi14[-20:] if r is not None]
    if len(window) >= 20 and len(rsi_window) >= 20:
        # Approximate "lows" as the two lowest points
        sorted_low_idx = sorted(range(20), key=lambda i: window[i])[:2]
        sorted_low_idx.sort()
        if len(sorted_low_idx) == 2:
            p_lows = [window[i] for i in sorted_low_idx]
            r_lows = [rsi14[len(closes) - 20 + i] for i in sorted_low_idx]
            if all(r is not None for r in r_lows) and hidden_bull_div(p_lows, r_lows):
                out.append({"symbol": symbol, "side": "long", "message": "Hidden bull div · 4H", "sigma": 1.3})
        sorted_hi_idx = sorted(range(20), key=lambda i: -window[i])[:2]
        sorted_hi_idx.sort()
        if len(sorted_hi_idx) == 2:
            p_his = [window[i] for i in sorted_hi_idx]
            r_his = [rsi14[len(closes) - 20 + i] for i in sorted_hi_idx]
            if all(r is not None for r in r_his) and hidden_bear_div(p_his, r_his):
                out.append({"symbol": symbol, "side": "short", "message": "Hidden bear div · 4H", "sigma": -1.3})

    # 3. Liquidity sweep + reclaim (uses close vs 20d high/low — close-only approximation)
    window20 = closes[-21:-1]  # excluding latest
    if window20:
        hi20 = max(window20)
        lo20 = min(window20)
        if closes[-1] > hi20 * 1.01:
            out.append({"symbol": symbol, "side": "long", "message": "Liq sweep · reclaim", "sigma": 2.1})
        elif closes[-1] < lo20 * 0.99:
            out.append({"symbol": symbol, "side": "short", "message": "Liq break · breakdown", "sigma": -2.1})

    return out


def scan_signals(symbols: list[str]) -> list[dict[str, Any]]:
    all_signals: list[dict[str, Any]] = []
    for s in symbols:
        closes = fetch_closes(s)
        if closes is None:
            continue
        all_signals.extend(_signals_for_symbol(s, closes))
    all_signals.sort(key=lambda x: -abs(x["sigma"]))
    return all_signals[:5]


def signals_cached(symbols: list[str]) -> list[dict[str, Any]]:
    return _cache.get_or_compute(
        "signals", lambda: scan_signals(symbols), stale_ok=True
    )
```

- [ ] **Step 4: Run the tests — confirm pass**

Run: `py -3 -m pytest tests/services/test_signals.py -v`
Expected: PASS.

- [ ] **Step 5: Add `/signals` route to `app.py`**

```python
from services.signals import signals_cached

@app.route("/signals")
def signals():
    return jsonify({"signals": signals_cached(_factor_universe())})
```

- [ ] **Step 6: Add signals markup**

In `.rail-right`, before the news card:

```html
      <section class="card signals-card glass" id="signals-card">
        <div class="card-title">
          <span class="card-title-text">Live signals</span>
          <span class="pill acid" id="signals-count">0 active</span>
        </div>
        <div class="signals-list" id="signals-list">
          <div class="card-empty">Scanning…</div>
        </div>
      </section>
```

- [ ] **Step 7: Add signals CSS**

```css
.signals-list { display: flex; flex-direction: column; }
.signal-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-top: 1px solid var(--line-faint);
}
.signal-row:first-child { border-top: none; }
.signal-side {
  font-size: 9px;
  font-weight: 600;
  padding: 2px 5px;
  border-radius: 3px;
  letter-spacing: 0.05em;
}
.signal-side.long  { background: var(--up-soft);   color: var(--up); }
.signal-side.short { background: var(--down-soft); color: var(--down); }
.signal-body { flex: 1; min-width: 0; }
.signal-sym {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--ink);
}
.signal-msg { font-size: 10px; color: var(--ink-soft); }
.signal-sigma {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}
```

- [ ] **Step 8: Add signals loader**

```js
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
```

In boot, after `loadFactors();`:

```js
  loadSignals();
  setInterval(loadSignals, 60 * 1000);
```

- [ ] **Step 9: Verify in browser**

1. Hard-refresh. First load: "Scanning…" then populates within a minute.
2. Right rail middle card shows up to 5 signal rows: LONG/SHORT badge · symbol+message · σ value.
3. Pill in header shows "N active".

- [ ] **Step 10: Commit**

```bash
git add services/signals.py tests/services/test_signals.py app.py static/index.html static/style.css static/app.js
git commit -m "feat(rail): live signals card with server-side indicator scanner"
```

---

## Task 14: AI Insight card (client-side, no LLM)

**Files:**
- Modify: `static/index.html`
- Modify: `static/style.css`
- Modify: `static/app.js`

Deterministic insight derived from the active pane's current state. Pure client-side — no new endpoints.

- [ ] **Step 1: Add insight markup**

In `.rail-right`, as the first child (above signals card):

```html
      <section class="card ai-card glass" id="ai-card">
        <div class="ai-head">
          <div class="ai-icon">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
              <circle cx="6.5" cy="6.5" r="3.2"/>
              <path d="M6.5 1v1.5 M6.5 10v1.5 M1 6.5h1.5 M10 6.5h1.5 M2.8 2.8l1.1 1.1 M9.1 9.1l1.1 1.1 M2.8 10.2l1.1-1.1 M9.1 3.9l1.1-1.1"/>
            </svg>
          </div>
          <span class="ai-title">Copilot · <span id="ai-symbol">—</span></span>
          <span class="pill acid ai-live">LIVE</span>
        </div>
        <div class="ai-body" id="ai-body">Hover any pane to see insight…</div>
        <div class="ai-metrics" id="ai-metrics"></div>
        <button class="ai-ask" id="ai-ask" type="button">
          <span style="color:var(--acid)">＋</span>
          <span>Ask copilot about <span id="ai-ask-symbol">—</span>…</span>
          <span class="kbd">⌘ J</span>
        </button>
      </section>
```

- [ ] **Step 2: Add AI card CSS**

```css
.ai-card { display: flex; flex-direction: column; gap: 12px; }
.ai-head { display: flex; align-items: center; gap: 8px; }
.ai-icon {
  width: 22px; height: 22px;
  border-radius: 6px;
  background: linear-gradient(135deg, var(--acid), var(--acid-deep));
  color: var(--on-acid);
  display: flex; align-items: center; justify-content: center;
}
.ai-title { font-size: 13px; font-weight: 600; }
.ai-live { margin-left: auto; font-size: 9px; }

.ai-body {
  font-size: 11px;
  color: var(--ink-mute);
  line-height: 1.55;
}
.ai-body .ai-strong { color: var(--ink); }

.ai-metrics { display: flex; flex-direction: column; gap: 6px; }
.ai-metric {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  border: 1px solid var(--line-faint);
}
.ai-metric-k { font-size: 10px; color: var(--ink-soft); }
.ai-metric-v {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}

.ai-ask {
  padding: 8px 10px;
  background: var(--surface-2);
  border: 1px dashed var(--line);
  border-radius: var(--r-sm);
  color: var(--ink-mute);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
}
.ai-ask > span:last-child { margin-left: auto; }
.ai-ask:hover { background: var(--surface-3); color: var(--ink); }
```

- [ ] **Step 3: Add insight computation logic to `static/app.js`**

```js
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
```

In boot, after `loadSignals();`:

```js
  refreshAIInsight();
  setInterval(refreshAIInsight, 60 * 1000);
```

- [ ] **Step 4: Verify in browser**

1. Hard-refresh.
2. Right rail top card shows "Copilot · {symbol}" with body paragraph + 4 metric rows.
3. Switch personality → AI card updates within a minute (or immediately on next manual refresh).
4. Click "Ask copilot" or press ⌘J → "Copilot coming soon" toast.

- [ ] **Step 5: Commit**

```bash
git add static/index.html static/style.css static/app.js
git commit -m "feat(rail): AI insight card with deterministic regime/divergence analysis"
```

---

## Task 15: Bottom dock — breadth endpoint + dock rendering

**Files:**
- Create: `services/breadth.py`
- Create: `tests/services/test_breadth.py`
- Modify: `app.py`
- Modify: `static/index.html`
- Modify: `static/style.css`
- Modify: `static/app.js`

- [ ] **Step 1: Write failing breadth tests**

`tests/services/test_breadth.py`:

```python
from unittest.mock import patch, MagicMock

from services.breadth import compute_breadth


def test_compute_breadth_returns_dict():
    def fake_history(sym):
        if sym == "^TNX": return [42.0, 43.17]
        if sym == "^VIX": return [15.5, 16.2]
        # adv vs dec
        if sym in ("AAPL", "MSFT"): return [99.0, 100.0]
        return [101.0, 100.0]  # decliners

    with patch("services.breadth.fetch_last_two", side_effect=fake_history):
        out = compute_breadth(["AAPL", "MSFT", "X1", "X2", "X3"])
    assert out["adv"] == 2
    assert out["dec"] == 3
    assert out["us10y"] == 4.317  # ^TNX is yields * 10 in yfinance
    assert out["vix"] == 16.2


def test_compute_breadth_handles_missing_data():
    with patch("services.breadth.fetch_last_two", return_value=None):
        out = compute_breadth(["AAPL"])
    assert out == {"adv": 0, "dec": 0, "us10y": None, "vix": None}
```

- [ ] **Step 2: Run — should fail**

Run: `py -3 -m pytest tests/services/test_breadth.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `services/breadth.py`**

```python
"""Breadth — advancers/decliners over universe + ^TNX + ^VIX."""

from __future__ import annotations

import math
from typing import Any

import yfinance as yf

from services._cache import TTLCache

_cache = TTLCache(ttl_seconds=60)


def fetch_last_two(symbol: str) -> list[float] | None:
    try:
        hist = yf.Ticker(symbol).history(period="5d", interval="1d")
        closes = [float(c) for c in hist["Close"].tolist() if c is not None and not math.isnan(float(c))]
        return closes[-2:] if len(closes) >= 2 else None
    except Exception:
        return None


def compute_breadth(symbols: list[str]) -> dict[str, Any]:
    adv = 0
    dec = 0
    for s in symbols:
        cl = fetch_last_two(s)
        if not cl or len(cl) < 2:
            continue
        if cl[-1] > cl[-2]:
            adv += 1
        elif cl[-1] < cl[-2]:
            dec += 1

    tnx = fetch_last_two("^TNX")
    vix = fetch_last_two("^VIX")
    us10y = round(tnx[-1] / 10, 3) if tnx else None
    vix_val = round(vix[-1], 2) if vix else None

    return {"adv": adv, "dec": dec, "us10y": us10y, "vix": vix_val}


def breadth_cached(symbols: list[str]) -> dict[str, Any]:
    return _cache.get_or_compute(
        "breadth", lambda: compute_breadth(symbols), stale_ok=True
    )
```

- [ ] **Step 4: Run — confirm pass**

Run: `py -3 -m pytest tests/services/test_breadth.py -v`
Expected: PASS.

- [ ] **Step 5: Add `/quote/breadth` route to `app.py`**

```python
from services.breadth import breadth_cached

@app.route("/quote/breadth")
def quote_breadth():
    return jsonify(breadth_cached(_factor_universe()))
```

- [ ] **Step 6: Add dock markup to `static/index.html`**

Replace the existing `<footer class="bottom-dock" id="bottom-dock"></footer>` line with:

```html
  <footer class="bottom-dock" id="bottom-dock">
    <span class="dock-lbl">P/L Day</span>
    <span class="dock-val up" id="dock-pl">+12,847.43</span>
    <span class="pill" style="font-size:9px;">DEMO</span>
    <span class="dock-sep"></span>
    <span class="dock-lbl">Open</span>
    <span class="dock-val" id="dock-pos">6</span>
    <span class="dock-sep"></span>
    <span class="dock-lbl">Exposure</span>
    <span class="dock-val" id="dock-exp">62%</span>
    <span class="dock-sep"></span>
    <span class="dock-lbl">Risk-on · factor tilt:</span>
    <span class="dock-val" id="dock-tilt" style="color:var(--acid)">—</span>
    <span class="dock-spacer"></span>
    <span class="dock-pair"><span style="color:var(--up)">▲</span> <span id="dock-adv">—</span> advancers</span>
    <span class="dock-pair"><span style="color:var(--down)">▼</span> <span id="dock-dec">—</span> decliners</span>
    <span class="dock-lbl">·</span>
    <span class="dock-pair">VIX <span class="dock-val" id="dock-vix">—</span></span>
    <span class="dock-lbl">·</span>
    <span class="dock-pair">US10Y <span class="dock-val" id="dock-tnx">—%</span></span>
  </footer>
```

- [ ] **Step 7: Add dock CSS**

```css
.dock-lbl { color: var(--ink-soft); }
.dock-val { color: var(--ink); font-weight: 600; }
.dock-val.up { color: var(--up); }
.dock-val.down { color: var(--down); }
.dock-sep {
  width: 1px;
  height: 14px;
  background: var(--line-faint);
}
.dock-spacer { flex: 1; }
.dock-pair { display: inline-flex; align-items: center; gap: 4px; }
```

- [ ] **Step 8: Add dock loader**

```js
// --- Bottom dock ------------------------------------------------------------
async function loadBreadth() {
  try {
    const data = await fetchJSON("/quote/breadth");
    const adv = document.getElementById("dock-adv");
    const dec = document.getElementById("dock-dec");
    const vix = document.getElementById("dock-vix");
    const tnx = document.getElementById("dock-tnx");
    if (adv) adv.textContent = data.adv ?? "—";
    if (dec) dec.textContent = data.dec ?? "—";
    if (vix) vix.textContent = data.vix != null ? data.vix.toFixed(2) : "—";
    if (tnx) tnx.textContent = data.us10y != null ? data.us10y.toFixed(3) + "%" : "—%";
  } catch {}
}

async function refreshDockTilt() {
  try {
    const data = await fetchJSON("/factors");
    const factors = data.factors || [];
    if (factors.length === 0) return;
    const top = factors.slice().sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
    const el = document.getElementById("dock-tilt");
    if (el && top) {
      const sign = top.z >= 0 ? "+" : "";
      el.textContent = `${top.name.toLowerCase()} ${sign}${top.z.toFixed(2)}σ`;
    }
  } catch {}
}
```

In boot, after `refreshAIInsight();`:

```js
  loadBreadth();
  refreshDockTilt();
  setInterval(loadBreadth, 60 * 1000);
  setInterval(refreshDockTilt, 5 * 60 * 1000);
```

- [ ] **Step 9: Verify in browser**

1. Hard-refresh.
2. Bottom dock shows: P/L Day +12,847.43 [DEMO] · Open 6 · Exposure 62% · "Risk-on · factor tilt: {factor} +0.42σ" · advancers/decliners · VIX 16.20 · US10Y 4.317%.
3. Mock P/L values clearly tagged with [DEMO] pill.
4. Adv/dec, VIX, US10Y all reflect real yfinance values.

- [ ] **Step 10: Commit**

```bash
git add services/breadth.py tests/services/test_breadth.py app.py static/index.html static/style.css static/app.js
git commit -m "feat(dock): bottom dock with real breadth + VIX + US10Y"
```

---

## Task 16: Final polish + README + smoke pass

**Files:**
- Modify: `static/style.css`
- Modify: `README.md`

- [ ] **Step 1: Light theme polish pass**

In `static/style.css`, append these light-theme tweaks at the end:

```css
/* Light theme — drawing toolbar contrast bump */
[data-theme="light"] .draw-tool { color: var(--ink-mute); }
[data-theme="light"] .draw-tool:hover { background: var(--surface-3); }
[data-theme="light"] .draw-tool.active { background: var(--acid-soft); color: var(--acid); }

/* Light theme — pane border softer */
[data-theme="light"] .pane { border-color: var(--line-soft); }

/* Light theme — sparkline area opacity */
[data-theme="light"] .narrative-spark path[fill] { opacity: 0.18; }
```

- [ ] **Step 2: Update README.md — note Phase 1 redesign + rail features**

Find the "Features" section. Add (or rewrite) a paragraph describing:
- New obsidian + acid token system; light/dark theme toggle in topbar.
- 3-column workspace shell with narratives / factors / events on the left; AI insight / signals / news on the right.
- 7-preset layout selector (1 up, 2H, 2V, 1+2, 2×2, 3×2, 4×2) with ⌘1-⌘7 keyboard switching.
- 4 personality presets (Minimalist / Quant / Scalper / Investor).
- AI insight card is deterministic (not LLM); ⌘K and "Ask copilot" buttons are placeholders for future work.
- Bottom dock shows real advancers/decliners + VIX + US10Y; P/L is `DEMO`-tagged mock.

(Use a single paragraph — match the existing README's prose style.)

- [ ] **Step 3: Smoke test sweep**

Server running. In a hard-refreshed browser:

1. **Layout sweep**: Press ⌘1 through ⌘7. Each layout renders correctly. Click outside popover closes it.
2. **Personality sweep**: Click each of Minimalist / Quant / Scalper / Investor. Symbols + layout update.
3. **Theme toggle**: Click theme toggle. All surfaces flip. Reload — persists.
4. **Narratives**: Click each of 6 chips. Click a row → pane 0 jumps to that symbol.
5. **Factor pulse**: Bars and z values visible. Refresh page — bars come from cache (instant).
6. **Events**: Card lists at least the FOMC entry. Switch personality — events refreshes.
7. **Signals**: ≥1 active signal row.
8. **News**: ≥3 headlines, each clickable.
9. **AI Insight**: Body paragraph + 4 metric rows reflect pane 0's symbol.
10. **Bottom dock**: Adv/dec are integers, VIX + US10Y are populated.
11. **Indicators modal still works**: Click ƒx, search "rsi", toggle it on. Sub-pane renders.
12. **Drawings still work**: Toggle drawing toolbar, draw a trendline, undo, redo.
13. **Hard-refresh + reload state**: Same layout/personality/theme/drawings/indicators.

If any of the 13 above fail, fix and re-verify before commit.

- [ ] **Step 4: Final commit + push**

```bash
git add static/style.css README.md
git commit -m "docs+polish: Phase 1 workspace shell ready for review"
git push -u origin claude/design-phase1-workspace-shell
```

- [ ] **Step 5: Inform the user**

Output: Branch `claude/design-phase1-workspace-shell` is pushed. Phase 1 complete. The Workspace artboard is live; Focus Mode / Copilot / Sectors / Tablet / Mobile / Ultra-wide artboards remain for future phases. PR open at: (URL from `git push` output).

---

## Self-review

**Spec coverage check:**

| Spec section | Plan task(s) |
|---|---|
| 1. Visual system | Task 2 (tokens + theme) |
| 2. Page shell | Task 3 |
| 3. Topbar | Tasks 4, 5 |
| 4a. Narratives | Task 8 |
| 4b. Factor pulse | Task 12 |
| 4c. Events | Task 10 |
| 5a. AI Insight | Task 14 |
| 5b. Live Signals | Task 13 |
| 5c. News Tape | Task 9 |
| 6. Bottom dock | Task 15 |
| 7. Pane chrome restyle | Task 6 |
| 8. Personality presets | Task 7 |
| 9. Backend additions | Tasks 1, 8, 9, 10, 11, 12, 13, 15 |
| Sectors module (deferred surfacing) | Task 11 |
| 10. Risks / migration | Task 5 covers layout migration; tests cover yfinance failures |

All spec sections covered. The Redis swap point is satisfied via `TTLCache` and `SectorLookup`'s public APIs — no service consumer touches the storage detail.

**Type/name consistency check:**

- `TTLCache`, `MISSING`, `get_or_compute(stale_ok=...)` — same across `services/_cache.py` and every consumer.
- `list_narratives`, `fetch_news`, `list_events`, `humanize_when`, `compute_factors`, `factors_cached`, `scan_signals`, `signals_cached`, `compute_breadth`, `breadth_cached`, `SectorLookup`, `fetch_closes` — single definition each, referenced consistently.
- `LAYOUTS`, `AREA_KEYS`, `PERSONALITY_DEFAULTS`, `LS_LAYOUT_ID`, `LS_PERSONALITY`, `RAIL_STATE`, `fetchJSON`, `getHistoryCached`, `sparkSVG`, `paneSymbolsList`, `_renderInsight`, `refreshAIInsight` — single definition each.
- Pane class is **not modified**; rail click handlers use the existing `symbolInput` + `dispatchEvent("change")` flow.

**Placeholder scan:** No "TBD", no "see above", no "similar to N", no "add appropriate handling". Every step contains the actual code.

**Scope check:** Single Phase 1 plan with 16 tasks; no subsystem fits independently better (the rails depend on backend endpoints, the shell wires them in). Decomposition would only split into "all-backend then all-frontend" which is less testable per-feature.

---

End of plan.

