"""Single-flight coalescing on the Qullamaggie screener endpoint.

The scan pipeline takes 10-30s; the page mount, the boot warm job, and the
Setups Board can all request the identical scan within seconds of each other.
Without coalescing each one runs the full universe pipeline (this actually
happened: three concurrent wide scans). These tests pin the contract: for N
identical concurrent requests the pipeline runs once, every caller gets a
result, and the waiters are marked `coalesced`.
"""

import threading
import time

import pytest

from screener.qullamaggie import router as qr


COMMON_KWARGS = dict(
    mode="breakout", limit=5, min_dollar_vol=1.0, min_adr=0.05, min_rvol=1.5,
    day_filter=0, include_movers=False, enrich_news=False, enrich_rsi=False,
    enrich_calendar=False, enrich_blocks=False, enrich_institutional=False,
    wide=False, persist=False,
)


@pytest.fixture
def fake_pipeline(monkeypatch):
    """Stub the expensive stages; count how often the pipeline actually runs."""
    calls = {"n": 0}

    def fake_get_universe(include_movers=False):
        calls["n"] += 1
        time.sleep(0.25)  # long enough that concurrent callers overlap
        return ["AAPL"]

    monkeypatch.setattr(qr, "get_universe", fake_get_universe)
    monkeypatch.setattr(qr, "refresh_universe", lambda syms: {})
    monkeypatch.setattr(qr, "rank_candidates", lambda frames, **kw: [])
    qr._RESPONSE_CACHE.clear()
    qr._INFLIGHT.clear()
    return calls


def test_identical_concurrent_scans_run_pipeline_once(fake_pipeline):
    results = []
    def call():
        results.append(qr.get_breakouts(**COMMON_KWARGS, fresh=True))

    threads = [threading.Thread(target=call) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert fake_pipeline["n"] == 1, "pipeline must run once, not per-caller"
    assert len(results) == 3
    assert sum(1 for r in results if r.get("coalesced")) == 2
    assert all("results" in r for r in results)


def test_different_params_do_not_coalesce(fake_pipeline):
    results = []
    def call(limit):
        kw = {**COMMON_KWARGS, "limit": limit}
        results.append(qr.get_breakouts(**kw, fresh=True))

    threads = [threading.Thread(target=call, args=(n,)) for n in (5, 10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert fake_pipeline["n"] == 2  # distinct cache keys → both compute
    assert not any(r.get("coalesced") for r in results)


def test_sequential_fresh_requests_still_recompute(fake_pipeline):
    qr.get_breakouts(**COMMON_KWARGS, fresh=True)
    qr.get_breakouts(**COMMON_KWARGS, fresh=True)   # no concurrency → no coalesce
    assert fake_pipeline["n"] == 2
