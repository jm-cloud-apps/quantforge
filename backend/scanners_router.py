"""Find-Setups scanner endpoints (extracted from main.py).

Thin HTTP shells over the pure scanner modules in scanners/, each with a small
per-parameter TTL cache: read the breadth grouped cache, run a pure scanner,
cache the result. main.py registers this via `app.include_router`. Paths are
unchanged from when these lived in main.py, so the frontend and the autorefresh
warm jobs need no changes.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter()


# ─── $9 Million Method Scanner ───────────────────────────────────────────────
#
# Stockbee's volume-filtered breakout system. Rules + classification live in
# scanners/ep9m.py; this is just the HTTP shell + a small TTL cache so the
# page doesn't recompute the whole panel on every click.

_EP9M_CACHE: dict = {"key": None, "result": None, "ts": 0.0}
_EP9M_TTL_SECONDS = 5 * 60


@router.get("/api/scanner/9m")
def get_9m_scan(
    min_volume: int = 9_000_000,
    min_price: float = 3.0,
    require_compression: int = 0,
    require_not_late: int = 0,
    force: int = 0,
) -> dict:
    """Run the $9 Million Method scanner against the breadth cache.

    Hard filters are always applied. Compression and "not late" are computed
    as soft signals; pass `require_compression=1` or `require_not_late=1` to
    promote them to hard gates (Stockbee's stricter formulation).

    Cached for 5 minutes per parameter tuple. force=1 bypasses. Returns 500
    if the breadth cache hasn't been seeded — point the user at Market
    Monitor → Refresh to build it.
    """
    import time as _time
    from scanners import ep9m as _ep9m

    key = (int(min_volume), float(min_price), bool(require_compression), bool(require_not_late))
    if not force and _EP9M_CACHE["key"] == key and (_time.time() - _EP9M_CACHE["ts"]) < _EP9M_TTL_SECONDS:
        cached = _EP9M_CACHE["result"]
        return {**cached, "from_cache": True}

    try:
        result = _ep9m.run(
            min_volume=int(min_volume),
            min_price=float(min_price),
            require_compression=bool(require_compression),
            require_not_late=bool(require_not_late),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"9M scan failed: {e}")

    _EP9M_CACHE["key"] = key
    _EP9M_CACHE["result"] = result
    _EP9M_CACHE["ts"] = _time.time()
    return {**result, "from_cache": False}


# ─── Reversal Setup Scanner ──────────────────────────────────────────────────
#
# Stockbee's "Reversal Bullish" intraday-exhaustion scan: a fresh 5-day low that
# recovered to close near the high on a long lower tail. Rules live in
# scanners/reversal.py; this is just the HTTP shell + a 5-minute TTL cache.

_REVERSAL_CACHE: dict = {"key": None, "result": None, "ts": 0.0}
_REVERSAL_TTL_SECONDS = 5 * 60


@router.get("/api/scanner/reversal")
def get_reversal_scan(
    min_volume: int = 290_000,
    min_price: float = 5.0,
    require_strong_tail: int = 0,
    require_green: int = 0,
    force: int = 0,
) -> dict:
    """Run the reversal-bullish scanner against the breadth cache.

    Hard filters (price, volume, fresh 5-day low, recovery ≥ 60%, lower-tail-
    dominant candle, prior-3-session liquidity floor) are always applied. The
    "3–5× tail" and green-close refinements are computed as soft signals; pass
    `require_strong_tail=1` or `require_green=1` to promote them to hard gates.

    Cached for 5 minutes per parameter tuple. force=1 bypasses. Returns 500 if
    the breadth cache hasn't been seeded — point the user at Market Monitor →
    Refresh to build it.
    """
    import time as _time
    from scanners import reversal as _reversal

    key = (int(min_volume), float(min_price), bool(require_strong_tail), bool(require_green))
    if not force and _REVERSAL_CACHE["key"] == key and (_time.time() - _REVERSAL_CACHE["ts"]) < _REVERSAL_TTL_SECONDS:
        cached = _REVERSAL_CACHE["result"]
        return {**cached, "from_cache": True}

    try:
        result = _reversal.run(
            min_volume=int(min_volume),
            min_price=float(min_price),
            require_strong_tail=bool(require_strong_tail),
            require_green=bool(require_green),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reversal scan failed: {e}")

    _REVERSAL_CACHE["key"] = key
    _REVERSAL_CACHE["result"] = result
    _REVERSAL_CACHE["ts"] = _time.time()
    return {**result, "from_cache": False}


# ─── Stage Analysis Scanner ──────────────────────────────────────────────────
#
# Stan Weinstein's four-stage cycle (Stage 1 base → Stage 2 advance → Stage 3
# top → Stage 4 decline) read off a 30-week-MA proxy on the daily grouped-cache.
# Classification rules live in scanners/stage_analysis.py; this is the HTTP shell
# + a 5-minute TTL cache.

_STAGE_CACHE: dict = {"key": None, "result": None, "ts": 0.0}
_STAGE_TTL_SECONDS = 5 * 60


@router.get("/api/scanner/stage")
def get_stage_scan(
    min_price: float = 5.0,
    min_dollar_volume: float = 5_000_000,
    force: int = 0,
) -> dict:
    """Classify every liquid US name into a Weinstein stage off the breadth cache.

    Uses a 150-day (≈30-week) SMA proxy, its 4-week slope, Mansfield relative
    strength vs SPY, and volume expansion to bucket names into Stage 1-4 — with
    Stage 1→2 breakouts and fresh Stage 2 advancers sorted to the top.

    Cached for 5 minutes per parameter tuple. force=1 bypasses. Returns 500 if
    the breadth cache hasn't been seeded — point the user at Market Monitor →
    Refresh to build it (a bigger lookback gives a fuller 30-week MA).
    """
    import time as _time
    from scanners import stage_analysis as _stage

    key = (float(min_price), float(min_dollar_volume))
    if not force and _STAGE_CACHE["key"] == key and (_time.time() - _STAGE_CACHE["ts"]) < _STAGE_TTL_SECONDS:
        cached = _STAGE_CACHE["result"]
        return {**cached, "from_cache": True}

    try:
        result = _stage.run(
            min_price=float(min_price),
            min_dollar_volume=float(min_dollar_volume),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stage scan failed: {e}")

    _STAGE_CACHE["key"] = key
    _STAGE_CACHE["result"] = result
    _STAGE_CACHE["ts"] = _time.time()
    return {**result, "from_cache": False}


# ─── 200-day MA Reclaim Scanner ──────────────────────────────────────────────
#
# A long-term trend flip: a name that sat below its 200-day MA for weeks (bearish)
# and has just reclaimed the line (bullish). Rules live in scanners/ma_reclaim.py;
# this is the HTTP shell + a 5-minute TTL cache. Reads the same grouped cache as
# the breadth/stage/reversal scanners — zero extra API calls.

_MA_RECLAIM_CACHE: dict = {"key": None, "result": None, "ts": 0.0}
_MA_RECLAIM_TTL_SECONDS = 5 * 60


@router.get("/api/scanner/ma-reclaim")
def get_ma_reclaim_scan(
    min_price: float = 5.0,
    min_dollar_volume: float = 5_000_000,
    require_ma_turning: int = 0,
    require_rs: int = 0,
    exclude_extended: int = 0,
    force: int = 0,
) -> dict:
    """Scan the breadth cache for fresh 200-day-MA reclaims.

    Hard filters (liquidity, above the 200d today, a fresh cross within the last
    ~10 sessions, and a sustained ≥25-session stretch below the line first) are
    always applied. "MA turning up", "RS leading" and "not extended" are computed
    as soft signals; pass `require_ma_turning=1`, `require_rs=1` or
    `exclude_extended=1` to promote them to hard gates.

    Cached for 5 minutes per parameter tuple. force=1 bypasses. Returns 500 if the
    breadth cache hasn't been seeded — point the user at Market Monitor → Refresh
    to build it (a bigger lookback gives a true 200-day MA rather than a proxy).
    """
    import time as _time
    from scanners import ma_reclaim as _ma_reclaim

    key = (float(min_price), float(min_dollar_volume), bool(require_ma_turning),
           bool(require_rs), bool(exclude_extended))
    if not force and _MA_RECLAIM_CACHE["key"] == key and (_time.time() - _MA_RECLAIM_CACHE["ts"]) < _MA_RECLAIM_TTL_SECONDS:
        cached = _MA_RECLAIM_CACHE["result"]
        return {**cached, "from_cache": True}

    try:
        result = _ma_reclaim.run(
            min_price=float(min_price),
            min_dollar_volume=float(min_dollar_volume),
            require_ma_turning=bool(require_ma_turning),
            require_rs=bool(require_rs),
            exclude_extended=bool(exclude_extended),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"MA reclaim scan failed: {e}")

    _MA_RECLAIM_CACHE["key"] = key
    _MA_RECLAIM_CACHE["result"] = result
    _MA_RECLAIM_CACHE["ts"] = _time.time()
    return {**result, "from_cache": False}
