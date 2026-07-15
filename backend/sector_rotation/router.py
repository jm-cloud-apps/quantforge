"""FastAPI router for sector-rotation intelligence.

Everything computes from local disk (grouped cache + sector map), so the
endpoints are fast once warm — but the panel pivot still costs a second or
two, so responses are memoized with the market-clock TTL like every other
scanner in the app.
"""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter

from market_clock import effective_cache_ttl

from .internals import compute_internals
from .leaders import compute_leaders
from .rrg import compute_rrg
from .sectors import refresh_progress

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sector-rotation", tags=["sector-rotation"])

ACTIVE_TTL_SEC = 15 * 60  # intraday: recompute at most every 15 min

_cache: dict[str, tuple[float, dict]] = {}


def _memo(key: str, compute) -> dict:
    now = time.time()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    payload = compute()
    # Don't cache warming responses — the map is filling in behind them.
    if not payload.get("warming"):
        _cache[key] = (now + effective_cache_ttl(ACTIVE_TTL_SEC), payload)
    return payload


@router.get("/internals")
def get_internals(force: int = 0):
    """Per-sector breadth internals + stealth-accumulation flags."""
    if force:
        _cache.pop("internals", None)
    payload = _memo("internals", compute_internals)
    if payload.get("warming"):
        payload = {**payload, "progress": refresh_progress()}
    return payload


@router.get("/rrg")
def get_rrg(force: int = 0):
    """RS-ratio × RS-momentum quadrant points with weekly trails."""
    if force:
        _cache.pop("rrg", None)
    return _memo("rrg", compute_rrg)


@router.get("/leaders/{sector}")
def get_leaders(sector: str, force: int = 0):
    """A sector's member stocks ranked by cross-sectional RS."""
    key = f"leaders:{sector}"
    if force:
        _cache.pop(key, None)
    return _memo(key, lambda: compute_leaders(sector))


@router.get("/mapping/progress")
def get_mapping_progress():
    """Background sector-map warm progress (for the UI's warming banner)."""
    return refresh_progress()
