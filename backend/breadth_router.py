"""Breadth / situational-awareness endpoints (extracted from main.py).

The market-context engine behind Trade Today / Market Monitor: Stockbee-style
breadth snapshot + history, the situational exposure read (with a persistent daily
ledger), regime / system backtests, index-trend posture, an independent verify
recount, and the cache refresh. Every read goes through `_breadth_cached`, which
memoizes against a cheap upstream-data fingerprint (`_breadth_fingerprint`). Pure
compute over the local grouped cache + a JSON ledger — the only upstream call is
the explicit /api/breadth/refresh. main.py registers this via app.include_router
and imports `get_breadth_situational` for the Setups Board. Covered by
tests/test_breadth.py.
"""

import logging
import time

from fastapi import APIRouter, Body, HTTPException, Query

logger = logging.getLogger(__name__)

router = APIRouter()


_BREADTH_RESP_CACHE: dict[str, tuple] = {}   # key -> (fingerprint, ts, payload)
_BREADTH_ACTIVE_TTL = 300                     # 5-min backstop while trading


def _breadth_fingerprint() -> str:
    """Cheap signature of the upstream data: (#cached days, latest day, universe
    mtime). Changes exactly when a new session is cached or the universe is
    refreshed — i.e. exactly when any breadth read could change. Pure filesystem
    metadata (a filename glob + one stat), no pickle loads."""
    from breadth.cache import list_cached_days, DATA_DIR
    days = list_cached_days()
    latest = days[-1].isoformat() if days else "none"
    try:
        uni_mtime = int((DATA_DIR / "universe.json").stat().st_mtime)
    except OSError:
        uni_mtime = 0
    return f"{len(days)}:{latest}:{uni_mtime}"


def _breadth_cached(key: str, compute):
    """Return a memoized breadth read, recomputing only when the upstream data
    fingerprint changes (or, while trading, the short backstop TTL lapses).
    Annotates the payload with a small `_cache` block so callers can see whether
    the read was served from cache."""
    from market_clock import is_market_active_now
    fp = _breadth_fingerprint()
    now = time.time()
    hit = _BREADTH_RESP_CACHE.get(key)
    if hit:
        h_fp, h_ts, payload = hit
        if h_fp == fp and (not is_market_active_now() or (now - h_ts) < _BREADTH_ACTIVE_TTL):
            return {**payload, "_cache": {"hit": True, "age_seconds": int(now - h_ts), "fingerprint": fp}}
    payload = compute()
    _BREADTH_RESP_CACHE[key] = (fp, now, payload)
    return {**payload, "_cache": {"hit": False, "fingerprint": fp}}


@router.get("/api/breadth/snapshot")
def get_breadth_snapshot():
    """Latest single-day breadth read from the local cache. No API calls."""
    def _compute():
        from breadth import compute_snapshot, classify
        snap = compute_snapshot()
        snap["regime"] = classify(snap.get("metrics"))
        return snap
    return _breadth_cached("snapshot", _compute)


@router.get("/api/breadth/history")
def get_breadth_history(days: int = Query(15, ge=1, le=120)):
    """Last `days` rows of breadth metrics, oldest→newest. Drives the table
    + sparkline charts on the Market Monitor page."""
    from breadth import compute_history
    return _breadth_cached(f"history:{days}", lambda: compute_history(days=days))


# Roughly a year of trading days — how far back we seed the SA ledger from the
# breadth cache so the 1-year history chart fills in as the cache allows.
_SA_BACKFILL_DAYS = 400


def _sa_compute(trend_days: int = 30) -> dict:
    """Compute the SA read, persist today's record, and attach 1y stats.

    Shared by the snapshot + history endpoints so the ledger is seeded the same
    way from either entry point. Pure compute over cached pickles + a small
    JSON ledger write — no upstream calls.
    """
    from breadth import compute_history, assess_situational, sa_compact_record, sa_history

    full = compute_history(days=max(trend_days, _SA_BACKFILL_DAYS))
    rows = full.get("rows", [])

    # Seed/extend the durable ledger only with days that have a fully warmed-up
    # lookback. The calculator returns qtr_up_25/qtr_down_25 = 0 (not None) for
    # early rows lacking ~63 prior sessions, so gate on T2108 being defined
    # (needs 40 obs) AND the quarterly counts not being a 0/0 warmup artifact —
    # otherwise we'd plot scores computed on incomplete inputs.
    def _seedable(r: dict) -> bool:
        if r.get("t2108") is None:
            return False
        qu, qd = r.get("qtr_up_25"), r.get("qtr_down_25")
        if qu is None or qd is None or (qu + qd) == 0:
            return False
        return True

    records = [sa_compact_record(r) for r in rows if _seedable(r)]
    if records:
        sa_history.upsert(records)

    read = assess_situational(
        rows[-trend_days:] if trend_days else rows,
        universe_size=full.get("universe_size", 0),
        universe_as_of=full.get("universe_as_of"),
    )
    ledger = sa_history.load(days=365)
    read["stats"] = sa_history.stats(ledger, read.get("score"), (read.get("stance") or {}).get("level"))

    # Turn watch — the inflection read. Computed here rather than inside assess()
    # because it needs the index bars (price + volume) alongside the score, and
    # assess() is a pure function over breadth rows only.
    from breadth import index_trend
    from breadth.turn import assess_turn, index_divergence
    try:
        idx = index_trend()
        indices = idx.get("indices") or []
        read["turn"] = assess_turn(
            read.get("score"),
            (read.get("stats") or {}).get("percentile"),
            read.get("trend") or [],
            indices,
        )
        read["divergence"] = index_divergence(read.get("score"), indices)
    except Exception as e:      # never let the turn read sink the whole page
        logger.warning("turn watch failed: %s", e)
        read["turn"] = {"signals": [], "watching": False}
        read["divergence"] = None
    return read


@router.get("/api/breadth/situational")
def get_breadth_situational(trend_days: int = Query(30, ge=5, le=120)):
    """Situational-awareness read: translate the local breadth history into an
    exposure stance + per-setup lights + decision criteria + score trend, and
    record today's read into the persistent daily ledger. Pure compute over the
    cached pickles — no upstream calls. Drives the Trade Today page and the
    dashboard snippet. Memoized against the cache fingerprint (see above)."""
    return _breadth_cached(f"situational:{trend_days}", lambda: _sa_compute(trend_days))


@router.get("/api/breadth/regime-backtest")
def get_breadth_regime_backtest():
    """Regime-conditioned backtest: join the SA ledger to equal-weight universe
    forward returns and report forward return by stance level + green-vs-red
    edge per setup family. Pure compute over the cached pickles + ledger.
    Seeds the ledger first so the join has rows to work with. Memoized against
    the cache fingerprint (see above)."""
    def _compute():
        _sa_compute(30)  # ensure the ledger is seeded/current before joining
        from breadth import run_regime_backtest
        return run_regime_backtest()
    return _breadth_cached("regime-backtest", _compute)


@router.get("/api/breadth/calibration")
def get_breadth_calibration():
    """Are the exposure bands calibrated to what the tape actually paid? Reports
    per-band forward return/volatility with EPISODE counts, the weight each band
    is sized at today, and an evidence-shrunk suggested weight. Read-only — it
    never rewrites the live weights. Seeds the ledger first so the join has rows.
    Memoized on the cache fingerprint."""
    def _compute():
        _sa_compute(30)
        from breadth import run_calibration
        return run_calibration()
    return _breadth_cached("calibration", _compute)


@router.get("/api/breadth/signal-scorecard")
def get_breadth_signal_scorecard():
    """Forward-return scorecard for the Trade Today signals (verdict, turn-watch,
    divergence), measured against the unconditional base rate on the same
    equal-weight index the regime backtest uses. Reports EPISODES alongside day
    counts — regime days are autocorrelated, so runs are the honest sample size.
    Seeds the ledger first so the join has rows. Memoized on the cache
    fingerprint."""
    def _compute():
        _sa_compute(30)
        from breadth.signal_scorecard import run as run_scorecard
        return run_scorecard()
    return _breadth_cached("signal-scorecard", _compute)


@router.get("/api/breadth/index-trend")
def get_breadth_index_trend():
    """Headline index ETFs (SPY/QQQ/IWM) trend posture from the grouped cache —
    lets the Trade Today page flag breadth-vs-price divergence. Memoized against
    the cache fingerprint."""
    from breadth import index_trend
    return _breadth_cached("index-trend", lambda: index_trend())


@router.get("/api/breadth/system-backtest")
def get_breadth_system_backtest():
    """Whole-system equity curve: sizing by the exposure stance vs. always-
    invested buy-and-hold of the equal-weight universe index. Seeds the ledger
    first so the join has rows. Memoized against the cache fingerprint."""
    def _compute():
        _sa_compute(30)  # ensure the ledger is seeded/current before the join
        from breadth import run_system_backtest
        return run_system_backtest()
    return _breadth_cached("system-backtest", _compute)


@router.get("/api/breadth/verify")
def verify_breadth():
    """Independently recount today's 4%-up/down from the raw cached EOD bars
    (a separate code path from the calculator) and compare against the figure
    the pages display. Proves the pipeline from vendor data → on-screen number,
    with sample tickers the user can spot-check on any chart."""
    from breadth import recount_4pct, compute_snapshot
    rc = recount_4pct()
    snap = compute_snapshot()
    m = snap.get("metrics") or {}
    rc["official"] = {"up_4": m.get("up_4"), "down_4": m.get("down_4"), "as_of": snap.get("as_of")}
    rc["matches"] = bool(
        rc.get("available")
        and rc.get("date") == snap.get("as_of")
        and rc.get("up_4_recount") == m.get("up_4")
        and rc.get("down_4_recount") == m.get("down_4")
    )
    return rc


@router.get("/api/breadth/situational/history")
def get_breadth_situational_history(days: int = Query(365, ge=5, le=800)):
    """Persistent daily SA history (exposure score + stance level per trading
    day) for the long-range trend chart. Seeds the ledger from the breadth
    cache on first access if it's empty."""
    from breadth import sa_history
    rows = sa_history.load(days=days)
    if not rows:
        _sa_compute(30)  # seed from cache, then re-read
        rows = sa_history.load(days=days)
    return {"rows": rows, "count": len(rows)}


@router.post("/api/breadth/refresh")
def refresh_breadth(body: dict = Body(default={})):
    """Pull any missing trading days into the grouped cache, optionally
    refresh the universe list, then recompute the latest snapshot.

    Body (all optional):
      - lookback_days: int — how far back to backfill (default 130)
      - refresh_universe: bool — force a new /v3/reference/tickers pull
    """
    from breadth import (
        refresh_grouped_cache,
        refresh_universe as _refresh_universe,
        load_or_refresh_universe,
        compute_snapshot,
        classify,
    )

    universe_refreshed = False
    try:
        if body.get("refresh_universe"):
            _refresh_universe()
            universe_refreshed = True
        else:
            # Pull a universe at least once if the cache is empty — otherwise
            # the snapshot below has nothing to score against.
            before = load_or_refresh_universe()
            universe_refreshed = before.get("as_of") and not body.get("refresh_universe") is None
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Universe refresh failed: {e}")

    lookback = int(body.get("lookback_days") or 130)
    try:
        cache_summary = refresh_grouped_cache(lookback_days=lookback)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Grouped cache refresh failed: {e}")

    # New sessions may have landed in the grouped cache — drop the memoized
    # reads so the next Trade Today / Market Monitor load recomputes fresh. (The
    # fingerprint would catch a new day anyway, but a universe-only refresh with
    # the same day set is also invalidated here.)
    _BREADTH_RESP_CACHE.clear()

    snap = compute_snapshot()
    snap["regime"] = classify(snap.get("metrics"))
    return {
        "snapshot": snap,
        "cache_summary": cache_summary,
        "universe_refreshed": universe_refreshed,
    }
