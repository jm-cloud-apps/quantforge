"""Research / validation endpoints (extracted from main.py).

Thin HTTP shells over analytics/: the cross-sectional factor model
(/api/analyze/factors) and the event-study edge validation
(/api/analyze/edge-validation), each behind a per-parameter response cache
(ScanCache: 5-minute active TTL, market-aware — see ttl_cache.py). main.py
registers this via app.include_router.
"""

from fastapi import APIRouter, HTTPException

from ttl_cache import ScanCache

router = APIRouter()

_FACTOR_CACHE = ScanCache(5 * 60)
_EDGE_CACHE = ScanCache(5 * 60)


# ─── Cross-sectional Factor Model ────────────────────────────────────────────
#
# Ranks the liquid universe on price/volume style factors (momentum, trend
# quality, relative strength, low-vol, short reversal, liquidity) with z-scores,
# a composite, factor rotation and factor correlation. Logic in
# analytics/factor_model.py; this is the HTTP shell + the response cache.

@router.get("/api/analyze/factors")
def get_factor_model(
    min_price: float = 5.0,
    min_dollar_volume: float = 3_000_000.0,
    force: int = 0,
) -> dict:
    """Cross-sectional price/volume factor model off the breadth cache.

    Cached per parameter tuple (market-aware TTL). force=1 bypasses. Returns
    500 if the breadth cache hasn't been seeded — point the user at Market
    Monitor → Refresh.
    """
    from analytics import factor_model as _fm

    def _compute() -> dict:
        try:
            return _fm.run(min_price=float(min_price), min_dollar_volume=float(min_dollar_volume))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Factor model failed: {e}")

    key = (float(min_price), float(min_dollar_volume))
    return _FACTOR_CACHE.fetch(key, _compute, force=bool(force))


# ─── Edge Validation (event-study / multiple-testing) ────────────────────────
#
# Replays a family of entry signals over the cached history and scores each
# against multiple testing (bootstrap CIs, deflated Sharpe, BH-FDR) to quantify
# data-mining risk. Logic in analytics/edge_validation.py.

@router.get("/api/analyze/edge-validation")
def get_edge_validation(
    horizon: int = 10,
    min_price: float = 5.0,
    min_dollar_volume: float = 3_000_000.0,
    force: int = 0,
) -> dict:
    """Event-study edge validation with multiple-testing correction.

    `horizon` is the forward holding period in trading days. Cached per
    parameter tuple (market-aware TTL). force=1 bypasses. Returns 500 if the
    breadth cache is empty.
    """
    from analytics import edge_validation as _ev

    def _compute() -> dict:
        try:
            return _ev.run(horizon=int(horizon), min_price=float(min_price),
                           min_dollar_volume=float(min_dollar_volume))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Edge validation failed: {e}")

    key = (int(horizon), float(min_price), float(min_dollar_volume))
    return _EDGE_CACHE.fetch(key, _compute, force=bool(force))
