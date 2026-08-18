"""Pre-market prep — the weekend / evening research routine.

Two things live here:

  1. `/api/prep/leaders` — the 6M / 3M / 1M relative-strength scan (pure compute
     in `scanners.rs_leaders`, ScanCache'd like every other scanner shell).

  2. `/api/prep/session` — a persisted record of each prep run: the date, the
     market read *at the time you did the work*, and the names you shortlisted.

The record is the part that makes this a routine rather than another dashboard.
Prep is where a plan is cheap — before the open, with no position on and no P&L
moving. By Monday 09:35 the same decision costs a lot more. Writing down what
the tape looked like on Sunday and which names you chose means Monday's
"opportunity" can be checked against Sunday's judgement instead of replacing it,
and the Discipline page gets an honest answer to "was this trade planned, or did
I find it at 10am?".

The rest of the page composes endpoints that already exist — situational
awareness for the gate, sector rotation for group leadership, the earnings
calendar for the week ahead, `/api/movers/gap` for the morning gappers. No new
aggregator: each of those is already cached and background-warmed on its own.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

import prep_ledger
from scanners import rs_leaders
from ttl_cache import ScanCache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/prep", tags=["prep"])

DATA_DIR = Path(__file__).parent / "data"
SESSIONS_PATH = DATA_DIR / "prep_sessions.json"
MAX_SESSIONS = 200          # keep the file small; this is a journal, not a database

_lock = threading.Lock()
# Prep is done when the market is shut, so the underlying day is frozen —
# ScanCache stretches this TTL on its own via market_clock.
_leaders_cache = ScanCache(active_ttl_seconds=15 * 60)


# ---------------------------------------------------------------------------
# Leaders scan
# ---------------------------------------------------------------------------

@router.get("/leaders")
def get_leaders(
    min_price: float = Query(rs_leaders.MIN_PRICE, ge=0),
    min_dollar_volume: float = Query(rs_leaders.MIN_DOLLAR_VOLUME, ge=0),
    min_adr_pct: float = Query(rs_leaders.MIN_ADR_PCT, ge=0, le=100),
    max_adr_pct: float = Query(rs_leaders.MAX_ADR_PCT, ge=0, le=100),
    top_n: int = Query(rs_leaders.TOP_N, ge=5, le=100),
    fresh: bool = Query(False, description="Bypass the response cache"),
) -> dict:
    """Rank the liquid common-stock universe by return over 6M / 3M / 1M.

    Reads the shared breadth grouped cache — no provider calls. Names appearing
    in two or more windows come back in `confluence`.
    """
    def _scan() -> dict:
        payload = rs_leaders.run(
            min_price=min_price,
            min_dollar_volume=min_dollar_volume,
            min_adr_pct=min_adr_pct,
            max_adr_pct=max_adr_pct,
            top_n=top_n,
        )
        # Record who was on the list today. Inside the scan closure, so it only
        # fires on a real scan rather than on every cache hit — the ledger
        # counts sessions, not page views.
        try:
            if payload.get("as_of") and not payload.get("error"):
                prep_ledger.record(payload["as_of"], prep_ledger.lanes_from_payload(payload))
        except Exception as e:                     # a ledger write must never fail the scan
            logger.warning("prep ledger write failed (%s)", e)
        return payload

    key = (min_price, min_dollar_volume, min_adr_pct, max_adr_pct, top_n)
    return _leaders_cache.fetch(key, _scan, force=fresh)


@router.get("/attention")
def get_attention(
    lane: str = Query("", description="Restrict to one lane (e.g. RS); blank = all"),
    long_listed: int = Query(prep_ledger.LONG_LISTED_SESSIONS, ge=1, le=200),
    limit: int = Query(20, ge=1, le=100),
) -> dict:
    """Leaders you keep seeing and never trade.

    Every scanner in this app measures the stock. This measures the gap between
    what the scan surfaced and what you acted on — the one thing that would
    have said "SNDK has been on your list for forty sessions" while it was
    still worth saying.

    Fails soft: no ledger or no workbook returns an empty list with a reason,
    because a nudge that 500s is worse than no nudge.
    """
    ledger = prep_ledger.load()
    if not ledger.get("days"):
        return {"rows": [], "sessions_in_ledger": 0,
                "reason": "No leader history recorded yet — it builds as the scan runs."}

    try:
        from trading_analysis_router import load_default_trades
        trades = (load_default_trades() or {}).get("trades") or []
    except Exception:
        # No workbook is survivable: everything then reads as never-traded,
        # which over-reports rather than hiding a name you did skip.
        trades = []

    lanes = [lane] if lane else None
    rows = prep_ledger.ignored_leaders(ledger, trades, lanes=lanes,
                                       long_listed=long_listed, limit=limit)
    return {
        "rows": rows,
        "sessions_in_ledger": len(ledger["days"]),
        "long_listed_threshold": long_listed,
        "lane": lane or "all",
        "reason": None,
    }


# ---------------------------------------------------------------------------
# Prep session record
# ---------------------------------------------------------------------------

class PrepCandidate(BaseModel):
    symbol: str
    setup_state: str | None = None
    horizons: list[str] = Field(default_factory=list)
    adr_pct: float | None = None
    from_high_pct: float | None = None
    note: str | None = None


class PrepSessionBody(BaseModel):
    date: str | None = None                  # ISO date; defaults to today (UTC)
    kind: str = "evening"                    # "weekend" | "evening"
    gate_passed: bool | None = None
    score: int | None = None
    stance: str | None = None
    regime: str | None = None
    notes: str | None = None
    candidates: list[PrepCandidate] = Field(default_factory=list)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load() -> dict:
    if not SESSIONS_PATH.exists():
        return {"sessions": []}
    try:
        obj = json.loads(SESSIONS_PATH.read_text())
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("prep: sessions file unreadable (%s) — starting fresh", e)
        return {"sessions": []}
    if not isinstance(obj, dict) or not isinstance(obj.get("sessions"), list):
        return {"sessions": []}
    return obj


def _save(obj: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    obj["sessions"] = obj.get("sessions", [])[-MAX_SESSIONS:]
    tmp = SESSIONS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, indent=2))
    tmp.replace(SESSIONS_PATH)


@router.get("/session")
def list_sessions(limit: int = Query(30, ge=1, le=MAX_SESSIONS)) -> dict:
    """Recent prep runs, newest first, plus the latest one broken out."""
    with _lock:
        sessions = _load().get("sessions", [])
    ordered = sorted(sessions, key=lambda s: s.get("date") or "", reverse=True)[:limit]
    return {"sessions": ordered, "latest": ordered[0] if ordered else None}


@router.post("/session")
def save_session(body: PrepSessionBody) -> dict:
    """Upsert the prep run for a date (one record per day — re-saving replaces).

    Upsert rather than append because prep is iterative: you open the page on
    Sunday, shortlist six names, come back after dinner and cut two. That's one
    session with a changed list, not two sessions.
    """
    date = (body.date or datetime.now(timezone.utc).date().isoformat()).strip()
    if len(date) != 10 or date[4] != "-" or date[7] != "-":
        raise HTTPException(status_code=400, detail="date must be ISO YYYY-MM-DD")

    record = {
        "date": date,
        "kind": body.kind,
        "gate_passed": body.gate_passed,
        "score": body.score,
        "stance": body.stance,
        "regime": body.regime,
        "notes": (body.notes or "").strip() or None,
        "candidates": [c.model_dump() for c in body.candidates],
        "saved_at": _now_iso(),
    }

    with _lock:
        obj = _load()
        sessions = [s for s in obj.get("sessions", []) if s.get("date") != date]
        sessions.append(record)
        sessions.sort(key=lambda s: s.get("date") or "")
        obj["sessions"] = sessions
        _save(obj)

    return {"saved": True, "session": record}


@router.delete("/session/{date}")
def delete_session(date: str) -> dict:
    with _lock:
        obj = _load()
        before = len(obj.get("sessions", []))
        obj["sessions"] = [s for s in obj.get("sessions", []) if s.get("date") != date]
        removed = before - len(obj["sessions"])
        if removed:
            _save(obj)
    return {"removed": removed}
