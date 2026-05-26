// News tape: fetch /news and render the list.

import { fetchJSON } from "./rail.js";

export async function loadNews() {
  const wrap = document.getElementById("news-list");
  if (!wrap) return;
  try {
    const data  = await fetchJSON("/news");
    const items = data.news || [];
    if (items.length === 0) {
      wrap.innerHTML = '<div class="card-empty">No news.</div>';
      return;
    }
    wrap.innerHTML = "";
    for (const it of items) {
      const a = document.createElement("a");
      a.className = "news-row";
      a.href      = it.url;
      a.target    = "_blank";
      a.rel       = "noopener noreferrer";

      const timeEl = document.createElement("span");
      timeEl.className   = "news-time";
      timeEl.textContent = it.time;

      const body   = document.createElement("div");
      const srcEl  = document.createElement("span");
      srcEl.className   = "news-source";
      srcEl.textContent = it.source;
      const txtEl  = document.createElement("span");
      txtEl.className   = "news-text";
      txtEl.textContent = it.text;
      body.appendChild(srcEl);
      body.appendChild(document.createTextNode(" "));
      body.appendChild(txtEl);

      a.appendChild(timeEl);
      a.appendChild(body);
      wrap.appendChild(a);
    }
  } catch {
    wrap.innerHTML = '<div class="card-empty">News unavailable.</div>';
  }
}
