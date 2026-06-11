"""FastAPI router for AI Trader — the day's top Qullamaggie trade ideas."""

import logging
import time

from fastapi import APIRouter, Query

from market_clock import effective_cache_ttl
from .engine import build_ideas
from .history import load_history_priced, record_today

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-trader", tags=["ai-trader"])

# build_ideas runs a full universe scan (~10-30s) + a model call, so cache the
# result. TTL is dynamic: ~30 min during the session, 4h when the market's shut.
_CACHE: dict[str, tuple[float, dict]] = {}
_TTL_ACTIVE = 1800  # 30 minutes
_HISTORY_CACHE: dict[str, tuple[float, list]] = {}
_HISTORY_TTL = 300  # 5 minutes (re-pricing is mildly expensive)


@router.get("/ideas")
def get_ideas(
    budget: float = Query(500, ge=50, le=1_000_000, description="Daily buying power to size each idea to"),
    min_adr: float = Query(0.03, ge=0.0, le=1.0, description="Minimum ADR gate (0.03 = 3%)"),
    fresh: bool = Query(False, description="Bypass the cache and re-scan"),
):
    """Scan today's market for Qullamaggie setups and return the top 0-3 ideas."""
    key = f"{budget}|{min_adr}"
    ttl = effective_cache_ttl(_TTL_ACTIVE)
    if not fresh:
        hit = _CACHE.get(key)
        if hit and (time.time() - hit[0]) < ttl:
            return {**hit[1], "cached": True, "cache_age_seconds": int(time.time() - hit[0])}

    started = time.time()
    data = build_ideas(budget=budget, min_adr=min_adr)
    logger.info(
        "ai-trader: %d idea(s) from %d candidates in %.1fs",
        len(data.get("ideas") or []), data.get("candidates_considered", 0), time.time() - started,
    )
    _CACHE[key] = (time.time(), data)
    # Log one ledger entry per day (idempotent — first generation of the day wins).
    try:
        record_today(data)
    except Exception as e:
        logger.warning("ai-trader history record failed: %s", e)
    return {**data, "cached": False, "cache_age_seconds": 0}


@router.get("/history")
def get_history(fresh: bool = Query(False, description="Bypass the 5-minute re-pricing cache")):
    """The 365-day suggestion ledger, newest first, re-priced to the latest close."""
    ttl = effective_cache_ttl(_HISTORY_TTL)
    if not fresh:
        hit = _HISTORY_CACHE.get("all")
        if hit and (time.time() - hit[0]) < ttl:
            return {"records": hit[1], "cached": True}
    records = load_history_priced()
    _HISTORY_CACHE["all"] = (time.time(), records)
    return {"records": records, "cached": False}
