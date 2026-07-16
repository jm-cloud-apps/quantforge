"""Research / validation endpoints (extracted from main.py).

Thin HTTP shells over analytics/: the cross-sectional factor model
(/api/analyze/factors) and the event-study edge validation
(/api/analyze/edge-validation), each with a 5-minute TTL cache. main.py registers
this via app.include_router.
"""

from fastapi import APIRouter, HTTPException

router = APIRouter()


# ─── Cross-sectional Factor Model ────────────────────────────────────────────
#
# Ranks the liquid universe on price/volume style factors (momentum, trend
# quality, relative strength, low-vol, short reversal, liquidity) with z-scores,
# a composite, factor rotation and factor correlation. Logic in
# analytics/factor_model.py; this is the HTTP shell + a 5-minute TTL cache.

_FACTOR_CACHE: dict = {"key": None, "result": None, "ts": 0.0}
_FACTOR_TTL_SECONDS = 5 * 60


@router.get("/api/analyze/factors")
def get_factor_model(
    min_price: float = 5.0,
    min_dollar_volume: float = 3_000_000.0,
    force: int = 0,
) -> dict:
    """Cross-sectional price/volume factor model off the breadth cache.

    Cached for 5 minutes per parameter tuple. force=1 bypasses. Returns 500 if the
    breadth cache hasn't been seeded — point the user at Market Monitor → Refresh.
    """
    import time as _time
    from analytics import factor_model as _fm

    key = (float(min_price), float(min_dollar_volume))
    if not force and _FACTOR_CACHE["key"] == key and (_time.time() - _FACTOR_CACHE["ts"]) < _FACTOR_TTL_SECONDS:
        return {**_FACTOR_CACHE["result"], "from_cache": True}

    try:
        result = _fm.run(min_price=float(min_price), min_dollar_volume=float(min_dollar_volume))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Factor model failed: {e}")

    _FACTOR_CACHE.update(key=key, result=result, ts=_time.time())
    return {**result, "from_cache": False}


# ─── Edge Validation (event-study / multiple-testing) ────────────────────────
#
# Replays a family of entry signals over the cached history and scores each
# against multiple testing (bootstrap CIs, deflated Sharpe, BH-FDR) to quantify
# data-mining risk. Logic in analytics/edge_validation.py.

_EDGE_CACHE: dict = {"key": None, "result": None, "ts": 0.0}
_EDGE_TTL_SECONDS = 5 * 60


@router.get("/api/analyze/edge-validation")
def get_edge_validation(
    horizon: int = 10,
    min_price: float = 5.0,
    min_dollar_volume: float = 3_000_000.0,
    force: int = 0,
) -> dict:
    """Event-study edge validation with multiple-testing correction.

    `horizon` is the forward holding period in trading days. Cached for 5 minutes
    per parameter tuple. force=1 bypasses. Returns 500 if the breadth cache is empty.
    """
    import time as _time
    from analytics import edge_validation as _ev

    key = (int(horizon), float(min_price), float(min_dollar_volume))
    if not force and _EDGE_CACHE["key"] == key and (_time.time() - _EDGE_CACHE["ts"]) < _EDGE_TTL_SECONDS:
        return {**_EDGE_CACHE["result"], "from_cache": True}

    try:
        result = _ev.run(horizon=int(horizon), min_price=float(min_price),
                         min_dollar_volume=float(min_dollar_volume))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Edge validation failed: {e}")

    _EDGE_CACHE.update(key=key, result=result, ts=_time.time())
    return {**result, "from_cache": False}
