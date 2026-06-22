"""FastAPI router for the Theme Radar."""

import logging
import time

from fastapi import APIRouter, Query

from market_clock import effective_cache_ttl
from .safe import json_safe
from .engine import build_analysis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/theme-radar", tags=["theme-radar"])

# A full fetch (~150 tickers) + model call is expensive; cache it. ~20 min while
# the market is open, ~4h when closed (data is frozen).
_CACHE: dict[str, tuple[float, dict]] = {}
_TTL_ACTIVE = 1200


@router.get("/analysis")
def get_analysis(fresh: bool = Query(False, description="Bypass the cache and re-analyze")):
    """Cross-reference theme strength with the immediate tape → Near-Term
    Velocity Matrix + commentary."""
    ttl = effective_cache_ttl(_TTL_ACTIVE)
    if not fresh:
        hit = _CACHE.get("all")
        if hit and (time.time() - hit[0]) < ttl:
            return json_safe({**hit[1], "cached": True, "cache_age_seconds": int(time.time() - hit[0])})

    started = time.time()
    data = json_safe(build_analysis())
    logger.info("theme-radar: %d themes analyzed in %.1fs",
                data.get("themes_considered", 0), time.time() - started)
    _CACHE["all"] = (time.time(), data)
    return {**data, "cached": False, "cache_age_seconds": 0}
