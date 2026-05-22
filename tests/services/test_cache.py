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
