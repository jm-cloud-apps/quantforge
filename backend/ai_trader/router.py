"""FastAPI router for AI Trader — the day's top Qullamaggie trade ideas."""

import json
import logging
import os
import re
import time

from fastapi import APIRouter, HTTPException, Query

from market_clock import effective_cache_ttl, is_market_active_now, last_market_close
from .backtest import run_single, run_walkforward
from .backtest_history import load_backtest_history, record_backtest
from .engine import MAX_IDEAS, build_ideas
from .history import load_history_priced, record_today
from .safe import json_safe

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai-trader", tags=["ai-trader"])

# build_ideas runs a full universe scan (~10-30s) + a model call, so cache the
# result, in memory and on disk. Freshness is session-aware:
#   * market OPEN  → 30-min TTL (intraday data moves, so re-scan periodically)
#   * market CLOSED → valid as long as it reflects the latest session's close,
#     so weekend / holiday / overnight hits serve the same scan until the next
#     session actually closes — no redundant re-scans. The refresh button
#     (fresh=1) always forces a new scan.
_CACHE: dict[str, tuple[float, dict]] = {}
_TTL_ACTIVE = 1800  # 30 minutes
_IDEAS_SCHEMA = 2  # bump when the response shape changes so stale caches are ignored
_IDEAS_DISK_CACHE = os.path.join(os.path.dirname(__file__), "..", "data", "ai_trader_ideas_cache.json")
_IDEAS_DISK_MAX = 20  # cap distinct param combos kept on disk
_HISTORY_CACHE: dict[str, tuple[float, dict]] = {}
_HISTORY_TTL = 300  # 5 minutes (re-pricing is mildly expensive)
_BT_HISTORY_CACHE: dict[str, tuple[float, dict]] = {}


def _ideas_cache_valid(ts: float) -> bool:
    """Whether a cache entry generated at `ts` is still good to serve."""
    if is_market_active_now():
        return (time.time() - ts) < _TTL_ACTIVE
    # Closed: current as long as it was generated at/after the latest close.
    return ts >= last_market_close().timestamp()


def _ideas_disk_load() -> dict:
    try:
        with open(_IDEAS_DISK_CACHE) as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _ideas_cache_get(key: str):
    """Most recent entry for `key`, checking memory then the disk cache so a
    scan survives a backend restart over a weekend."""
    hit = _CACHE.get(key)
    if hit:
        return hit
    entry = _ideas_disk_load().get(key)
    if entry and "ts" in entry and "data" in entry:
        hit = (entry["ts"], entry["data"])
        _CACHE[key] = hit
        return hit
    return None


def _ideas_cache_put(key: str, ts: float, data: dict) -> None:
    _CACHE[key] = (ts, data)
    try:
        disk = _ideas_disk_load()
        disk[key] = {"ts": ts, "data": data}
        if len(disk) > _IDEAS_DISK_MAX:  # keep the freshest combos
            disk = dict(sorted(disk.items(), key=lambda kv: kv[1].get("ts", 0), reverse=True)[:_IDEAS_DISK_MAX])
        os.makedirs(os.path.dirname(_IDEAS_DISK_CACHE), exist_ok=True)
        tmp = _IDEAS_DISK_CACHE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(disk, f)
        os.replace(tmp, _IDEAS_DISK_CACHE)
    except Exception as e:
        logger.warning("ai-trader ideas disk cache write failed: %s", e)


@router.get("/ideas")
def get_ideas(
    budget: float = Query(500, ge=50, le=1_000_000, description="Daily buying power to size each idea to"),
    min_adr: float = Query(0.03, ge=0.0, le=1.0, description="Minimum ADR gate (0.03 = 3%)"),
    account: float = Query(25_000, ge=500, le=100_000_000, description="Total account size for risk-based sizing"),
    risk_pct: float = Query(1.0, ge=0.05, le=10.0, description="% of account risked per idea (fixed-fractional)"),
    fresh: bool = Query(False, description="Bypass the cache and re-scan"),
):
    """Scan the market for Qullamaggie setups and return the top 0-10 ideas.

    Served from cache while the market is closed (weekends, holidays, overnight)
    so the scan isn't re-run on frozen data; `fresh=1` forces a re-scan."""
    # float() so a defaulted param (int 25000) keys the same as a provided one ("25000.0");
    # MAX_IDEAS + schema in the key so a config/shape change doesn't serve a stale cache.
    key = f"{float(budget)}|{float(min_adr)}|{float(account)}|{float(risk_pct)}|n{MAX_IDEAS}|s{_IDEAS_SCHEMA}"
    if not fresh:
        hit = _ideas_cache_get(key)
        if hit and _ideas_cache_valid(hit[0]):
            return json_safe({**hit[1], "cached": True, "cache_age_seconds": int(time.time() - hit[0])})

    started = time.time()
    data = json_safe(build_ideas(budget=budget, min_adr=min_adr, account=account, risk_pct=risk_pct))
    logger.info(
        "ai-trader: %d idea(s) from %d candidates in %.1fs",
        len(data.get("ideas") or []), data.get("candidates_considered", 0), time.time() - started,
    )
    _ideas_cache_put(key, time.time(), data)
    # Log one ledger entry per day (idempotent — first generation of the day wins).
    try:
        record_today(data)
    except Exception as e:
        logger.warning("ai-trader history record failed: %s", e)
    return {**data, "cached": False, "cache_age_seconds": 0}


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
