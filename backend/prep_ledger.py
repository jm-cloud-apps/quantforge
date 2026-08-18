"""Which names keep showing up on the leader list, and which of those you never trade.

The scanners measure the stock. This measures **your attention**, which is a
different quantity and the one that was actually missing.

SNDK is the case that prompted it: Stage Analysis classified it Stage 2 with RS
rank 99-100 continuously from $219, and the RS-leadership lane would have
carried it for six straight months. Neither fact, on its own, ever said the
thing that mattered — *this name has been on your list for forty sessions and
you have never once traded it*. A scan that surfaces names is not the same as a
system that notices you keep skipping one.

Two pieces:

- a small append-only **ledger** of who was on the list each session, written
  when the scan runs (and backfillable from the breadth cache, because the scan
  is a pure function of it — so the flag has history from the day it ships
  rather than in three months);
- a pure **join** against the trade log that turns that into a per-symbol
  verdict: how long it's been listed, whether you've ever traded it, and how
  long ago.

Deliberately counts *sessions listed*, not consecutive streaks. A leader that
drops off for a week during a pullback and comes back has not reset its claim
on your attention, and a streak counter would say it had.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable, Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent / "data"
LEDGER_PATH = DATA_DIR / "prep_ledger.json"
MAX_DAYS = 400              # ~18 months of sessions; this is a ledger, not a warehouse

# A name has to have been around a while before "you keep ignoring this" is a
# fair thing to say. Roughly a month of sessions.
LONG_LISTED_SESSIONS = 20

_lock = threading.Lock()


# --- store ------------------------------------------------------------------

def load(path: Path | None = None) -> dict:
    p = path or LEDGER_PATH
    if not p.exists():
        return {"days": {}}
    try:
        obj = json.loads(p.read_text())
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("prep ledger unreadable (%s) — starting fresh", e)
        return {"days": {}}
    if not isinstance(obj, dict) or not isinstance(obj.get("days"), dict):
        return {"days": {}}
    return obj


def save(obj: dict, path: Path | None = None) -> None:
    p = path or LEDGER_PATH
    days = obj.get("days", {})
    if len(days) > MAX_DAYS:                       # keep the newest MAX_DAYS
        for k in sorted(days)[: len(days) - MAX_DAYS]:
            days.pop(k, None)
    with _lock:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(obj, separators=(",", ":")))
        tmp.replace(p)


def record(as_of: str, lanes: dict[str, Iterable[str]], path: Path | None = None) -> dict:
    """Write one session's lane membership. Idempotent per date — re-running the
    scan on the same day overwrites rather than double-counting."""
    if not as_of:
        return load(path)
    obj = load(path)
    obj["days"][str(as_of)] = {k: sorted({str(s).upper() for s in v}) for k, v in lanes.items()}
    save(obj, path)
    return obj


def lanes_from_payload(payload: dict) -> dict[str, list[str]]:
    """Lane -> symbols out of an rs_leaders.run() response."""
    out: dict[str, list[str]] = {}
    for h in payload.get("horizons") or []:
        key = h.get("key")
        if key:
            out[key] = [r["symbol"] for r in (h.get("rows") or []) if r.get("symbol")]
    conf = [r["symbol"] for r in (payload.get("confluence") or []) if r.get("symbol")]
    if conf:
        out["confluence"] = conf
    return out


# --- the join ---------------------------------------------------------------

def _to_date(value: Any) -> Optional[date]:
    if value in (None, "", 0):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "")).date()
        except ValueError:
            return None
    return None


def attention(ledger: dict, trades: list[dict], lanes: Optional[Iterable[str]] = None,
              long_listed: int = LONG_LISTED_SESSIONS) -> dict[str, dict]:
    """Per-symbol attention record built from the ledger and the trade log.

    `lanes` restricts which lanes count toward "listed" (default: all of them).
    Returns symbol -> {sessions_listed, first_listed, last_listed, lanes,
    ever_traded, last_traded, sessions_since_listed_first_traded, long_listed}.
    """
    days = ledger.get("days") or {}
    wanted = set(lanes) if lanes else None

    listed: dict[str, dict] = {}
    for day in sorted(days):
        for lane, syms in (days[day] or {}).items():
            if wanted is not None and lane not in wanted:
                continue
            for raw in syms:
                # Normalise on read as well as on write: the trade join
                # uppercases, so a stray lower-case ledger row would silently
                # read as never-traded — the exact wrong answer.
                sym = str(raw).upper().strip()
                if not sym:
                    continue
                rec = listed.setdefault(sym, {
                    "symbol": sym, "sessions_listed": 0,
                    "first_listed": day, "last_listed": day, "lanes": set(),
                })
                # One session counts once even if the name is in several lanes.
                if rec["last_listed"] != day or rec["sessions_listed"] == 0:
                    rec["sessions_listed"] += 1
                rec["last_listed"] = day
                rec["lanes"].add(lane)

    traded: dict[str, date] = {}
    for t in trades or []:
        sym = str(t.get("symbol") or "").upper().strip()
        d = _to_date(t.get("entry_date"))
        if sym and d and (sym not in traded or d > traded[sym]):
            traded[sym] = d

    out: dict[str, dict] = {}
    for sym, rec in listed.items():
        first = _to_date(rec["first_listed"])
        last_trade = traded.get(sym)
        out[sym] = {
            "symbol": sym,
            "sessions_listed": rec["sessions_listed"],
            "first_listed": rec["first_listed"],
            "last_listed": rec["last_listed"],
            "lanes": sorted(rec["lanes"]),
            "ever_traded": last_trade is not None,
            "last_traded": last_trade.isoformat() if last_trade else None,
            # Traded *since* it started showing up? A position from a year
            # before it became a leader isn't evidence you acted on this.
            "traded_since_listed": bool(last_trade and first and last_trade >= first),
            "long_listed": rec["sessions_listed"] >= long_listed,
        }
    return out


def ignored_leaders(ledger: dict, trades: list[dict], lanes: Optional[Iterable[str]] = None,
                    long_listed: int = LONG_LISTED_SESSIONS, limit: int = 20) -> list[dict]:
    """Long-listed and never acted on — ranked by how long you've been ignoring it.

    This is the whole point of the module: not "here are leaders" (every scan
    says that) but "here are leaders you have watched go by".
    """
    rows = [
        r for r in attention(ledger, trades, lanes=lanes, long_listed=long_listed).values()
        if r["long_listed"] and not r["traded_since_listed"]
    ]
    rows.sort(key=lambda r: -r["sessions_listed"])
    return rows[:limit]


# --- backfill ---------------------------------------------------------------

def backfill(sessions: int = 180, step: int = 1, path: Path | None = None) -> dict:
    """Seed the ledger by replaying the scan over cached history.

    The leader scan is a pure function of the breadth cache, so "who was on the
    list on 2026-03-16" is recoverable rather than lost. Without this the flag
    would say nothing useful for months, and a signal that only works later is
    a signal you will not trust when it arrives.

    Imports are local: this is an offline maintenance path, and the module's
    read side must stay importable without pandas/numpy in the way.
    """
    from breadth.cache import list_cached_days
    from scanners import rs_leaders

    all_days = sorted(list_cached_days())
    if not all_days:
        return {"recorded": 0, "error": "breadth cache is empty"}

    real = rs_leaders.list_cached_days
    obj = load(path)
    recorded = 0
    try:
        targets = all_days[-sessions:][::step]
        for cutoff in targets:
            rs_leaders.list_cached_days = lambda c=cutoff: [d for d in all_days if d <= c]
            try:
                payload = rs_leaders.run()
            except Exception as e:            # a short window early on simply has no scan
                logger.debug("backfill skipped %s (%s)", cutoff, e)
                continue
            if payload.get("error"):
                continue
            lanes = lanes_from_payload(payload)
            if not lanes:
                continue
            obj["days"][str(payload.get("as_of") or cutoff)] = {
                k: sorted(set(v)) for k, v in lanes.items()
            }
            recorded += 1
    finally:
        rs_leaders.list_cached_days = real

    save(obj, path)
    return {"recorded": recorded, "days_in_ledger": len(obj["days"])}
