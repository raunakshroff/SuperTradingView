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
                revalidate_start = time.time()
                with self._lock:
                    lock = self._compute_locks.setdefault(key, threading.Lock())
                    acquired = lock.acquire(blocking=False)
                if acquired:
                    def _bg():
                        try:
                            value = fn()
                            # Freshly-computed values must outlive their compute, so a
                            # caller after `done` always observes the new value. If the
                            # compute took longer than _ttl, extend by the elapsed time.
                            compute_elapsed = time.time() - revalidate_start
                            expires_at = time.time() + compute_elapsed + self._ttl
                            with self._lock:
                                self._store[key] = (expires_at, value)
                        finally:
                            lock.release()
                    threading.Thread(target=_bg, daemon=True).start()
                return stale[1]

        # No stale value, or stale_ok=False: compute synchronously
        value = fn()
        self.set(key, value)
        return value
