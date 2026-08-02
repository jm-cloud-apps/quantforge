"""HTTP shell for the discipline analytics (backend/discipline.py).

Thin by design: load the plan store + the trade workbook, hand them to the pure
module, cache the answer. Two endpoints with deliberately different costs —

  GET /api/discipline/scorecard  — the full process review (reconciliation +
      hold-time + post-exit excursion + setup decay). Reads the breadth grouped
      cache for the excursion pass, so it is the expensive one; ScanCache'd.
  GET /api/discipline/today      — the circuit-breaker read the Trade Today page
      calls on every mount. Cheap, short TTL, no price data.

Both read the same workbook the analytics page does, through
`trading_analysis_router.load_default_trades`, so the review-notes overlay and
the scale-out formula evaluation apply here too (bypassing that helper silently
drops every scaled-out trade — see CLAUDE.md "Trade data pipeline").
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

import discipline
from trade_plans_router import _load as _load_plans
from trading_analysis_router import load_default_trades
from ttl_cache import ScanCache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/discipline", tags=["discipline"])

# The scorecard walks the grouped cache for post-exit excursion; 15 min active
# TTL (stretched automatically when the market is closed).
_SCORECARD_CACHE = ScanCache(active_ttl_seconds=15 * 60)
# The breaker must feel live — a plan logged 30s ago has to clear the gate.
_TODAY_CACHE = ScanCache(active_ttl_seconds=30)

# Default review window. 180 days ≈ two quarters: long enough for per-setup
# samples to mean something, short enough that a regime from a year ago isn't
# propping up the numbers. This is the fix for the all-time default that was
# hiding the recent drawdown behind a positive lifetime total.
DEFAULT_WINDOW_DAYS = 180


def _plans() -> list[dict]:
    return list((_load_plans().get("plans") or {}).values())


def _trades(window_days: Optional[int]) -> list[dict]:
    """Closed trades from the default workbook, optionally trailing-windowed."""
    try:
        payload = load_default_trades()
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=f"Could not load trades: {exc}")

    trades = payload.get("trades") or []
    if not window_days:
        return trades
    cutoff = date.today() - timedelta(days=int(window_days))
    kept = []
    for t in trades:
        exit_day = discipline._to_date(t.get("exit_date"))
        if exit_day and exit_day >= cutoff:
            kept.append(t)
    return kept


def _grouped_bars(trades: list[dict], sessions: int) -> dict:
    """Grouped daily bars covering the trades' exits + the forward window.

    Returns {} when the breadth cache is empty so the excursion section is
    simply omitted rather than the whole scorecard failing — the cache is a
    background-warmed convenience, not a hard dependency.
    """
    try:
        from breadth import cache as breadth_cache
    except Exception:
        return {}

    exits = [d for d in (discipline._to_date(t.get("exit_date")) for t in trades) if d]
    if not exits:
        return {}
    try:
        # Pad the end so the last trade still has a forward window; the cache
        # simply has fewer days there and the excursion pass handles that.
        start = min(exits)
        end = max(exits) + timedelta(days=sessions * 2)
        return breadth_cache.load_cached_window(start, end)
    except Exception as exc:
        logger.warning("discipline: grouped-cache read failed (%s); skipping excursion", exc)
        return {}


@router.get("/scorecard")
def scorecard(
    window_days: int = Query(DEFAULT_WINDOW_DAYS, ge=0, le=3650,
                             description="Trailing window in days; 0 = all time"),
    decay_window: int = Query(discipline.DECAY_WINDOW, ge=4, le=100),
    post_exit_sessions: int = Query(discipline.POST_EXIT_SESSIONS, ge=1, le=60),
    force: int = 0,
) -> dict:
    """The full process review: plan compliance, hold time, and setup decay."""

    def compute() -> dict:
        trades = _trades(window_days)
        plans = _plans()
        bars = _grouped_bars(trades, post_exit_sessions)
        return {
            "window_days": window_days or None,
            "trade_count": len(trades),
            "reconciliation": discipline.reconcile(plans, trades),
            "hold_time": discipline.hold_time_report(trades, bars, post_exit_sessions),
            "decay": discipline.setup_decay(trades, window=decay_window),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        }

    return _SCORECARD_CACHE.fetch(
        (window_days, decay_window, post_exit_sessions), compute, force=bool(force)
    )


@router.get("/today")
def today(force: int = 0) -> dict:
    """Circuit-breaker state for the Trade Today gate."""

    def compute() -> dict:
        # Month-to-date only — the breaker never needs deep history.
        return discipline.circuit_breaker(_plans(), _trades(60))

    return _TODAY_CACHE.fetch(("today",), compute, force=bool(force))
