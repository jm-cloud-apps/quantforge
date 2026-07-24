"""Per-endpoint response cache with a market-aware TTL.

Every scanner/analytics shell used to carry the same ~10 lines of cache
boilerplate (`{"key": None, "result": None, "ts": 0}` + a fixed-TTL check).
`ScanCache` replaces those six copies with one primitive, and upgrades them in
two ways:

- **Multi-key**: results are cached per parameter tuple instead of a single
  last-request slot, so toggling a filter and back doesn't thrash the cache.
  Memory is bounded by the tiny number of distinct parameter combinations a
  single user actually clicks through.
- **Market-aware TTL**: the active-session TTL is stretched by
  `market_clock.effective_cache_ttl` when the market is closed — the underlying
  daily data is frozen on nights/weekends/holidays, so recomputing every five
  minutes was pure waste.

Usage in a router:

    _CACHE = ScanCache(active_ttl_seconds=5 * 60)

    @router.get(...)
    def endpoint(..., force: int = 0):
        key = (param_a, param_b)
        return _CACHE.fetch(key, lambda: scanner.run(...), force=bool(force))

`fetch` returns the computed payload with `from_cache` stamped in, matching the
response contract the pages already rely on.
"""

from __future__ import annotations

import time
from typing import Any, Callable, Hashable

from market_clock import effective_cache_ttl


class ScanCache:
    def __init__(self, active_ttl_seconds: int = 5 * 60):
        self.active_ttl = int(active_ttl_seconds)
        self._store: dict[Hashable, tuple[float, dict]] = {}

    def get(self, key: Hashable) -> dict | None:
        """Return the cached payload for `key`, or None if absent/expired."""
        entry = self._store.get(key)
        if not entry:
            return None
        ts, result = entry
        if (time.time() - ts) >= effective_cache_ttl(self.active_ttl):
            return None
        return result

    def put(self, key: Hashable, result: dict) -> None:
        self._store[key] = (time.time(), result)

    def clear(self) -> None:
        self._store.clear()

    def fetch(self, key: Hashable, compute: Callable[[], dict], force: bool = False) -> dict[str, Any]:
        """Serve `key` from cache or run `compute()`, stamping `from_cache`."""
        if not force:
            cached = self.get(key)
            if cached is not None:
                return {**cached, "from_cache": True}
        result = compute()
        self.put(key, result)
        return {**result, "from_cache": False}
