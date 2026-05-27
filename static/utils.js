// Shared utilities used across modules.

export function withAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export async function fetchJSON(url) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    return r.json();
  } finally {
    clearTimeout(timer);
  }
}
