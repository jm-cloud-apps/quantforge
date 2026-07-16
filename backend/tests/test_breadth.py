"""Characterization tests for the breadth / situational read.

They exercise the memoized `_breadth_cached` path and `_sa_compute` against the
local grouped cache, so they need a warmed cache and are skipped otherwise (e.g. a
fresh checkout / CI without data). They guard the situational + snapshot endpoints
and `_sa_compute` across the extraction into breadth_router.py.

`ANALYTICS_MODULE` is the only thing that changes with the move: `main` while the
routes live there, `breadth_router` once extracted.
"""

import importlib

import pytest

from breadth.cache import list_cached_days

pytestmark = pytest.mark.skipif(
    len(list_cached_days()) < 60,
    reason="needs a warmed breadth grouped cache (Market Monitor → Refresh)",
)

ANALYTICS_MODULE = "breadth_router"

bm = importlib.import_module(ANALYTICS_MODULE)


def test_sa_compute_returns_score_and_stance():
    read = bm._sa_compute(30)
    assert isinstance(read, dict)
    assert "score" in read
    assert isinstance(read.get("stance"), dict) and "level" in read["stance"]


def test_situational_endpoint_shape_and_cache_annotation():
    r = bm.get_breadth_situational(trend_days=30)
    assert "score" in r and "stance" in r
    assert "_cache" in r                       # _breadth_cached wraps every read


def test_situational_read_is_memoized():
    bm.get_breadth_situational(trend_days=30)           # warm the cache
    r2 = bm.get_breadth_situational(trend_days=30)      # identical fingerprint → hit
    assert r2["_cache"]["hit"] is True


def test_snapshot_has_regime_and_cache():
    snap = bm.get_breadth_snapshot()
    assert "regime" in snap and "_cache" in snap
