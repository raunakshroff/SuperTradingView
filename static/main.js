// Application entry point. Imports all modules and boots the app.

import { loadSymbols }         from "./modules/symbols.js";
import { bootGrid, panes }     from "./modules/grid.js";
import { bindPersonality, currentPersonality, applyPersonality }
                               from "./modules/personality.js";
import { startClock, bindThemeToggle } from "./modules/topbar.js";
import { bindCommandK }        from "./modules/command-palette.js";
import { loadNarratives }      from "./modules/rail.js";
import { loadNews }            from "./modules/news.js";
import { loadEvents }          from "./modules/events.js";
import { loadFactors }         from "./modules/factors.js";
import { loadSignals }         from "./modules/signals.js";
import { refreshAIInsight, bindAIInsight } from "./modules/ai-insight.js";
import { loadBreadth, refreshDockTilt }    from "./modules/dock.js";
import { PrefsStore }          from "./drawings.js";

(async function boot() {
  await loadSymbols();

  bootGrid();
  bindPersonality();

  if (!localStorage.getItem("stv.personality")) {
    applyPersonality("Quant");
  }

  loadNarratives();
  loadNews();
  setInterval(loadNews,    5 * 60 * 1000);
  loadEvents();
  setInterval(loadEvents,  60 * 1000);
  loadFactors();
  setInterval(loadFactors, 5 * 60 * 1000);
  loadSignals();
  setInterval(loadSignals, 60 * 1000);
  refreshAIInsight();
  setInterval(refreshAIInsight, 60 * 1000);
  loadBreadth();
  refreshDockTilt();
  setInterval(loadBreadth,     60 * 1000);
  setInterval(refreshDockTilt, 5 * 60 * 1000);

  document.addEventListener("stv:drawing-prefs-changed", () => {
    const prefs = PrefsStore.get();
    for (const p of panes) {
      p.root.classList.toggle("draw-floating", prefs.toolbarMode === "floating");
    }
  });

  startClock();
  bindCommandK();
  bindThemeToggle();
  bindAIInsight();
})();
