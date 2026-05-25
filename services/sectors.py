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
