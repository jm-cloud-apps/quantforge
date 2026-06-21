"""FastAPI router for AI Trader — the day's top Qullamaggie trade ideas."""

import logging
import re
import time

from fastapi import APIRouter, HTTPException, Query

from market_clock import effective_cache_ttl
from .backtest import run_single, run_walkforward
from .backtest_history import load_backtest_history, record_backtest
from .engine import build_ideas
from .history import load_history_priced, record_today
from .safe import json_safe

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-trader", tags=["ai-trader"])

# build_ideas runs a full universe scan (~10-30s) + a model call, so cache the
# result. TTL is dynamic: ~30 min during the session, 4h when the market's shut.
_CACHE: dict[str, tuple[float, dict]] = {}
_TTL_ACTIVE = 1800  # 30 minutes
_HISTORY_CACHE: dict[str, tuple[float, dict]] = {}
_HISTORY_TTL = 300  # 5 minutes (re-pricing is mildly expensive)
_BT_HISTORY_CACHE: dict[str, tuple[float, dict]] = {}


@router.get("/ideas")
def get_ideas(
    budget: float = Query(500, ge=50, le=1_000_000, description="Daily buying power to size each idea to"),
    min_adr: float = Query(0.03, ge=0.0, le=1.0, description="Minimum ADR gate (0.03 = 3%)"),
    account: float = Query(25_000, ge=500, le=100_000_000, description="Total account size for risk-based sizing"),
    risk_pct: float = Query(1.0, ge=0.05, le=10.0, description="% of account risked per idea (fixed-fractional)"),
    fresh: bool = Query(False, description="Bypass the cache and re-scan"),
):
    """Scan today's market for Qullamaggie setups and return the top 0-5 ideas."""
    key = f"{budget}|{min_adr}|{account}|{risk_pct}"
    ttl = effective_cache_ttl(_TTL_ACTIVE)
    if not fresh:
        hit = _CACHE.get(key)
        if hit and (time.time() - hit[0]) < ttl:
            return {**hit[1], "cached": True, "cache_age_seconds": int(time.time() - hit[0])}

    started = time.time()
    data = build_ideas(budget=budget, min_adr=min_adr, account=account, risk_pct=risk_pct)
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
    return json_safe({**data, "cached": False, "cache_age_seconds": 0})


@router.get("/history")
def get_history(fresh: bool = Query(False, description="Bypass the 5-minute re-pricing cache")):
    """The 365-day suggestion ledger, newest first, re-priced and scored in
    R-multiples, with aggregate expectancy/track-record stats."""
    ttl = effective_cache_ttl(_HISTORY_TTL)
    if not fresh:
        hit = _HISTORY_CACHE.get("all")
        if hit and (time.time() - hit[0]) < ttl:
            return {**hit[1], "cached": True}
    data = load_history_priced()  # {records, stats}
    _HISTORY_CACHE["all"] = (time.time(), data)
    return json_safe({**data, "cached": False})


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _valid_date(d: str | None, field: str) -> str | None:
    if d and not _DATE_RE.match(d):
        raise HTTPException(status_code=422, detail=f"{field} must be YYYY-MM-DD")
    return d


@router.get("/backtest")
def get_backtest(
    as_of: str = Query(..., description="Run the engine as of this date (YYYY-MM-DD), data ≤ this date only"),
    budget: float = Query(500, ge=50, le=1_000_000),
    account: float = Query(25_000, ge=500, le=100_000_000),
    risk_pct: float = Query(1.0, ge=0.05, le=10.0),
    min_adr: float = Query(0.03, ge=0.0, le=1.0),
):
    """Point-in-time single-date backtest: what the rule-based engine would have
    recommended on `as_of`, scored forward to the latest close (no look-ahead)."""
    _valid_date(as_of, "as_of")
    started = time.time()
    data = run_single(as_of, budget=budget, account=account, risk_pct=risk_pct, min_adr=min_adr)
    logger.info("ai-trader backtest %s: %d idea(s) in %.1fs",
                as_of, len(data.get("ideas") or []), time.time() - started)
    # Persist this inspected date to the backtest ledger and bust its cache.
    try:
        record_backtest(data)
        _BT_HISTORY_CACHE.pop("all", None)
    except Exception as e:
        logger.warning("ai-trader backtest history record failed: %s", e)
    return json_safe(data)


@router.get("/backtest/walkforward")
def get_walkforward(
    start: str = Query(None, description="Window start YYYY-MM-DD (default: earliest usable)"),
    end: str = Query(None, description="Window end YYYY-MM-DD (default: latest bar)"),
    step_days: int = Query(7, ge=1, le=90, description="Calendar days between simulated dates"),
    budget: float = Query(500, ge=50, le=1_000_000),
    account: float = Query(25_000, ge=500, le=100_000_000),
    risk_pct: float = Query(1.0, ge=0.05, le=10.0),
    min_adr: float = Query(0.03, ge=0.0, le=1.0),
    fresh: bool = Query(False, description="Bypass the on-disk result cache"),
):
    """Walk-forward backtest across stepped dates → aggregate expectancy, equity
    curve (cumulative R) and by-regime breakdown. Disk-cached by parameters."""
    _valid_date(start, "start")
    _valid_date(end, "end")
    started = time.time()
    data = run_walkforward(start=start, end=end, step_days=step_days, budget=budget,
                           account=account, risk_pct=risk_pct, min_adr=min_adr, fresh=fresh)
    logger.info("ai-trader walkforward %s→%s step %dd: %d dates in %.1fs",
                data.get("params", {}).get("start"), data.get("params", {}).get("end"),
                step_days, len(data.get("dates") or []), time.time() - started)
    return json_safe(data)


@router.get("/backtest/history")
def get_backtest_history(fresh: bool = Query(False, description="Bypass the 5-minute re-pricing cache")):
    """Ledger of inspected backtest dates, re-priced to the latest close (% gain
    to today + outcome/R), newest first, with aggregate expectancy."""
    ttl = effective_cache_ttl(_HISTORY_TTL)
    if not fresh:
        hit = _BT_HISTORY_CACHE.get("all")
        if hit and (time.time() - hit[0]) < ttl:
            return {**hit[1], "cached": True}
    data = load_backtest_history()  # {records, stats}
    _BT_HISTORY_CACHE["all"] = (time.time(), data)
    return json_safe({**data, "cached": False})
