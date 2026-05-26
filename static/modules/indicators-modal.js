// Indicators modal: search, per-instance param editing, color pickers.
// Opened by Pane via a callback so there is no circular module dependency.

import { DEFS } from "../indicators.js";
import { defIdOf } from "./constants.js";

const modalEl      = document.getElementById("indicators-modal");
const modalList    = document.getElementById("indicators-list");
const modalSub     = modalEl.querySelector(".modal-sub");
const modalSearchEl = document.getElementById("indicators-search");

let modalPane = null;

modalSearchEl.addEventListener("input", () => { if (modalPane) renderIndicatorsModal(); });

export function openIndicatorsModal(pane, focusId) {
  modalPane = pane;
  modalSub.textContent = `${pane.state.symbol} · ${pane.state.tf}`;
  modalSearchEl.value = "";
  renderIndicatorsModal();
  modalEl.hidden = false;
  requestAnimationFrame(() => modalSearchEl.focus());
  if (focusId) {
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

export function closeIndicatorsModal() {
  modalEl.hidden = true;
  modalPane = null;
}

modalEl.addEventListener("click", (e) => {
  if (e.target.matches("[data-close]")) closeIndicatorsModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modalEl.hidden) closeIndicatorsModal();
});

export function renderIndicatorsModal() {
  if (!modalPane) return;
  const active = modalPane.state.indicators;
  const query  = (modalSearchEl.value || "").trim().toLowerCase();
  modalList.innerHTML = "";

  const groups = new Map();
  for (const def of DEFS) {
    if (!groups.has(def.category)) groups.set(def.category, []);
    groups.get(def.category).push(def);
  }

  let totalVisible = 0;

  for (const [category, defs] of groups) {
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

      for (let i = 0; i < instanceKeys.length; i++) {
        const key = instanceKeys[i];
        const inst = document.createElement("div");
        inst.className = "indicator-instance";

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

  if (totalVisible === 0 && query) {
    const empty = document.createElement("div");
    empty.className = "modal-empty";
    empty.innerHTML = `<strong>No results</strong>No indicators match <em>"${query}"</em>`;
    modalList.appendChild(empty);
  }
}
