// Topbar utilities: ET clock, toast notifications, theme toggle.

export function startClock() {
  const el = document.getElementById("clock-time");
  if (!el) return;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const tick = () => { el.textContent = `${fmt.format(new Date())} ET`; };
  tick();
  setInterval(tick, 1000);
}

export function showToast(msg) {
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

export function bindThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("stv.theme", next);
  });
}
