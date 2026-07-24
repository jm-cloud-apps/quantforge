"""ScanCache — the shared per-endpoint response cache (ttl_cache.py).

Pins the contract the six scanner/analytics shells now rely on: hit/miss,
`from_cache` stamping, force bypass, per-key isolation (multi-key, unlike the
old single-slot caches), TTL expiry, and no caching of failed computes.
"""

import pytest
from fastapi import HTTPException

import ttl_cache
from ttl_cache import ScanCache


@pytest.fixture(autouse=True)
def fixed_ttl(monkeypatch):
    """Pin the effective TTL so tests don't depend on the market clock."""
    monkeypatch.setattr(ttl_cache, "effective_cache_ttl", lambda active: active)


def test_miss_computes_then_hit_serves_cached():
    cache = ScanCache(300)
    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"value": 42}

    first = cache.fetch(("a",), compute)
    second = cache.fetch(("a",), compute)
    assert calls["n"] == 1
    assert first["from_cache"] is False
    assert second["from_cache"] is True
    assert second["value"] == 42


def test_force_bypasses_and_refreshes():
    cache = ScanCache(300)
    cache.fetch(("a",), lambda: {"value": 1})
    forced = cache.fetch(("a",), lambda: {"value": 2}, force=True)
    assert forced == {"value": 2, "from_cache": False}
    # The forced result replaced the cached one.
    assert cache.fetch(("a",), lambda: {"value": 3})["value"] == 2


def test_keys_are_isolated():
    cache = ScanCache(300)
    cache.fetch(("a",), lambda: {"value": "a"})
    cache.fetch(("b",), lambda: {"value": "b"})
    assert cache.fetch(("a",), lambda: {"value": "x"})["value"] == "a"
    assert cache.fetch(("b",), lambda: {"value": "x"})["value"] == "b"


def test_expired_entry_recomputes(monkeypatch):
    cache = ScanCache(300)
    t = {"now": 1000.0}
    monkeypatch.setattr(ttl_cache.time, "time", lambda: t["now"])
    cache.fetch(("a",), lambda: {"value": 1})
    t["now"] += 301  # past the pinned 300s TTL
    assert cache.fetch(("a",), lambda: {"value": 2})["value"] == 2


def test_failed_compute_is_not_cached():
    cache = ScanCache(300)

    def boom():
        raise HTTPException(status_code=500, detail="scan failed")

    with pytest.raises(HTTPException):
        cache.fetch(("a",), boom)
    # Next call recomputes (nothing poisoned the cache).
    assert cache.fetch(("a",), lambda: {"value": "ok"})["value"] == "ok"


def test_from_cache_stamp_does_not_mutate_stored_payload():
    cache = ScanCache(300)
    cache.fetch(("a",), lambda: {"value": 1})
    hit = cache.fetch(("a",), lambda: {"value": 9})
    hit["value"] = 999  # caller mutates its copy...
    assert cache.get(("a",))["value"] == 1  # ...stored payload untouched at top level
