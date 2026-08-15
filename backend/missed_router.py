"""Missed Book — the trades you didn't take.

The mirror of playbook_router: the Playbook records the setups you executed well,
this records the ones you didn't take at all, with the screenshot, the reason,
and what it went on to do. Persisted to data/missed.json (+ data/missed_screenshots/).

Two design decisions carry the whole module:

1. **Not every miss is a mistake.** A setup your rules correctly declined is a
   process *success*, and lumping it in with hesitation turns the page into a
   regret machine that argues for overtrading. So every entry carries a
   `verdict`, and only `missed` entries accrue cost. `passed` entries are
   counted and reported separately, as evidence the filters worked.

2. **Two R numbers, never one.** `r_best` measures to the extreme the stock
   reached, which you would not have caught; `r_real` measures to the exit you'd
   actually have taken (a rail break, a target) and only exists when you say
   where that was. Summing maxima produces a large fictional number — the same
   trap discipline.post_exit_excursion avoids by measuring to the close — so the
   summary reports the two sums separately, each with its own n.
"""

import json
import os
import threading
from datetime import datetime as dt
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

import missed_suggest
from security import _enforce_upload_limit, _safe_within

router = APIRouter()

MISSED_PATH = os.getenv("MISSED_PATH", os.path.join(os.path.dirname(__file__), "data", "missed.json"))
MISSED_SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), "data", "missed_screenshots")
_missed_lock = threading.Lock()

MAX_SCREENSHOTS = 4

# Controlled vocabulary for `verdict`. The honest three-way split: it was a
# miss, it was a correct pass, or you still can't tell.
VERDICTS = ("missed", "passed", "unclear")

# Controlled vocabulary for `reason`. Free text can't be aggregated, and the
# entire point of logging misses is to answer "which failure mode costs me the
# most" — so the UI offers exactly these and the summary groups by them.
# Grouped by what the fix would be, which is not the same as what happened:
#   process   — the setup never reached you, or reached you without a plan
#   execution — you had it and didn't act, or acted too late
#   capacity  — you were structurally unable to take it
#   correct   — the rules declined it, and they were right to
REASON_GROUPS = {
    "process": (
        "not on the watchlist",
        "no plan written",
        "scan missed it",
    ),
    "execution": (
        "saw it, hesitated",
        "away from the screen",
        "entry already gone — wouldn't chase",
        "stopped out earlier, wouldn't re-enter",
        "waited for a better price",
    ),
    "capacity": (
        "at max positions",
        "risk budget spent",
        "no buying power",
    ),
    "correct": (
        "regime gate said no",
        "rules said no — correct pass",
        "setup wasn't clean enough",
    ),
}

REASONS = tuple(r for group in REASON_GROUPS.values() for r in group)

_REASON_GROUP_OF = {r: g for g, rs in REASON_GROUPS.items() for r in rs}


# --- Pure math --------------------------------------------------------------
# Kept module-level and side-effect free so tests can hit them directly.

def r_multiple(direction: str, entry, stop, price) -> Optional[float]:
    """R between `entry` and `price`, risking to `stop`. None when undefined.

    Direction-aware: a short's risk is above the entry and its reward below it.
    Returns None rather than 0 for a non-positive risk distance — a stop on the
    wrong side of the entry is a data-entry error, not a zero-risk trade.
    """
    if entry is None or stop is None or price is None:
        return None
    try:
        entry, stop, price = float(entry), float(stop), float(price)
    except (TypeError, ValueError):
        return None
    risk = (entry - stop) if direction != "short" else (stop - entry)
    if risk <= 0:
        return None
    reward = (price - entry) if direction != "short" else (entry - price)
    return round(reward / risk, 2)


def pct_move(direction: str, entry, price) -> Optional[float]:
    """Percent move from entry to price, signed in the trade's favour."""
    if entry is None or price is None:
        return None
    try:
        entry, price = float(entry), float(price)
    except (TypeError, ValueError):
        return None
    if entry <= 0:
        return None
    move = (price - entry) if direction != "short" else (entry - price)
    return round(move / entry * 100, 2)


FORWARD_SESSIONS = 20   # how far ahead "what did it do" looks
TRAIL_MA = 10           # the rail the realistic exit is trailed against


def _bar(frame, symbol: str) -> Optional[dict]:
    """One symbol's OHLC out of a session frame.

    Accepts either a pandas frame indexed by symbol (what breadth.cache hands
    back) or a plain dict-of-dicts, so the pricing logic can be tested without
    building DataFrames.
    """
    try:
        if hasattr(frame, "index"):
            if symbol not in frame.index:
                return None
            return {
                "high": float(frame.at[symbol, "high"]),
                "low": float(frame.at[symbol, "low"]),
                "close": float(frame.at[symbol, "close"]),
            }
        row = frame.get(symbol)
        if not row:
            return None
        return {"high": float(row["high"]), "low": float(row["low"]), "close": float(row["close"])}
    except (KeyError, TypeError, ValueError):
        return None


def forward_prices(symbol: str, start, bars_by_date: dict, direction: str = "long",
                   sessions: int = FORWARD_SESSIONS, ma_period: int = TRAIL_MA) -> Optional[dict]:
    """What the name did after `start`, priced the two ways the page reports.

    - `peak` is the best price *touched* in the window. Structurally biased: over
      twenty sessions almost any volatile name prints a good high somewhere, and
      nobody sells there. It feeds the "best case" column that exists to be
      distrusted.
    - `trail_exit` is the close of the first session that closes through the
      `ma_period` rail — the exit the trading rules actually prescribe, and a
      decision that could really have been taken. It feeds the realistic column.
      When the rail never breaks inside the window, the last close stands in and
      `trail_hit` says so.

    Filling these from the cache rather than from memory is the point: a
    self-reported "it went to 58" drifts toward whatever story is being told
    that day, and the R totals inherit the drift.

    The grouped cache is **unadjusted**, so a split inside the window reads as a
    huge move — anything beyond ±90% is refused rather than returned (the same
    hazard discipline.post_exit_excursion guards against).
    """
    symbol = (symbol or "").upper()
    if not symbol or start is None or not bars_by_date:
        return None
    long_side = direction != "short"

    session_days = sorted(bars_by_date.keys())
    forward = [d for d in session_days if d > start][:sessions]
    if not forward:
        return None

    # Seed the rail with the closes *before* the entry, otherwise the first
    # sessions have no average to break and the exit reads as too late.
    closes = []
    for d in [x for x in session_days if x <= start][-(ma_period - 1):]:
        bar = _bar(bars_by_date[d], symbol)
        if bar:
            closes.append(bar["close"])

    # The pre-entry close is the anchor the split guard measures against. The
    # first *forward* close is no use: a split prints on that bar too, so a
    # one-session window would compare the artefact to itself.
    ref_close = closes[-1] if closes else None

    peak = peak_day = None
    trail_exit = trail_day = None
    last_close = first_close = None
    used = 0

    for d in forward:
        bar = _bar(bars_by_date[d], symbol)
        if bar is None:
            continue
        used += 1
        if first_close is None:
            first_close = bar["close"]
        last_close = bar["close"]

        candidate = bar["high"] if long_side else bar["low"]
        if peak is None or (candidate > peak if long_side else candidate < peak):
            peak, peak_day = candidate, d

        closes.append(bar["close"])
        if trail_exit is None and len(closes) >= ma_period:
            ma = sum(closes[-ma_period:]) / ma_period
            if (bar["close"] < ma) if long_side else (bar["close"] > ma):
                trail_exit, trail_day = bar["close"], d

    if peak is None or first_close is None:
        return None

    # Unadjusted-cache artefact: a split, not a move.
    anchor = ref_close if ref_close else first_close
    if anchor and abs((peak - anchor) / anchor * 100) > 90:
        return None

    hit = trail_exit is not None
    return {
        "symbol": symbol,
        "direction": "long" if long_side else "short",
        "sessions_used": used,
        # The close going in — what the move is measured against when there's no
        # entry price yet (a shortlisted name you never actually bought).
        "ref_close": round(ref_close, 4) if ref_close else None,
        "peak": round(peak, 4),
        "peak_date": peak_day.isoformat(),
        "trail_exit": round(trail_exit if hit else last_close, 4),
        "trail_exit_date": (trail_day or forward[used - 1 if used else 0]).isoformat() if hit
                           else forward[-1].isoformat(),
        "trail_hit": hit,
        "trail_ma": ma_period,
        "last_close": round(last_close, 4),
    }


def first_trigger(symbol: str, start, bars_by_date: dict, ma_period: int = TRAIL_MA,
                  within: int = 15):
    """The first session at or after `start` that closes back above the rail.

    A prep shortlist is an instruction to *watch*, not to buy — so measuring a
    trade from the night you wrote the name down is measuring the wrong thing.
    A name can sit under its 10-day for a week and then trigger; anchoring on
    the shortlist date reports the chop and hides the move that followed.

    So: walk forward to the first close back above the rail — the earliest
    session on which the setup was actually buyable — and treat that as the
    entry. Returns None when it never triggers inside `within` sessions, which
    is the honest answer that there was no trade to miss.
    """
    symbol = (symbol or "").upper()
    if not symbol or start is None or not bars_by_date:
        return None

    session_days = sorted(bars_by_date.keys())
    closes = []
    for d in [x for x in session_days if x < start][-(ma_period - 1):]:
        bar = _bar(bars_by_date[d], symbol)
        if bar:
            closes.append(bar["close"])

    for d in [x for x in session_days if x >= start][:within]:
        bar = _bar(bars_by_date[d], symbol)
        if bar is None:
            continue
        closes.append(bar["close"])
        if len(closes) >= ma_period:
            ma = sum(closes[-ma_period:]) / ma_period
            if bar["close"] > ma:
                return d
    return None


def _num(v):
    """Form floats arrive as '' when the field was left blank."""
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def price_fields(direction: str, entry, stop, peak, exit_price) -> dict:
    """The derived block every entry carries. `peak` is the best price reached
    in the trade's favour (the high for a long, the low for a short); `exit` is
    where you'd realistically have got out."""
    return {
        "r_best": r_multiple(direction, entry, stop, peak),
        "r_real": r_multiple(direction, entry, stop, exit_price),
        "pct_best": pct_move(direction, entry, peak),
    }


def summarize(entries: List[dict]) -> dict:
    """Aggregate the book. Every sum ships with the n it was computed over —
    a total R is meaningless without knowing how many entries could price it."""
    missed = [e for e in entries if e.get("verdict") == "missed"]
    passed = [e for e in entries if e.get("verdict") == "passed"]
    unclear = [e for e in entries if e.get("verdict") == "unclear"]

    def _bucket(rows: List[dict]) -> dict:
        best = [e["r_best"] for e in rows if e.get("r_best") is not None]
        real = [e["r_real"] for e in rows if e.get("r_real") is not None]
        return {
            "count": len(rows),
            "r_best_sum": round(sum(best), 2) if best else None,
            "r_best_n": len(best),
            "r_real_sum": round(sum(real), 2) if real else None,
            "r_real_n": len(real),
        }

    by_reason = {}
    for e in missed:
        reason = e.get("reason") or "unspecified"
        by_reason.setdefault(reason, []).append(e)
    reasons = [
        {"reason": k, "group": _REASON_GROUP_OF.get(k, "other"), **_bucket(v)}
        for k, v in by_reason.items()
    ]
    # Rank by realized cost where it's known, then by count — a reason with no
    # priced entries still deserves a row, it just can't claim a dollar figure.
    reasons.sort(key=lambda r: (-(r["r_real_sum"] or 0), -r["count"]))

    by_group = {}
    for e in missed:
        group = _REASON_GROUP_OF.get(e.get("reason"), "other")
        by_group.setdefault(group, []).append(e)
    groups = [{"group": k, **_bucket(v)} for k, v in by_group.items()]
    groups.sort(key=lambda g: -g["count"])

    by_setup = {}
    for e in missed:
        setup = e.get("setup") or "unspecified"
        by_setup.setdefault(setup, []).append(e)
    setups = [{"setup": k, **_bucket(v)} for k, v in by_setup.items()]
    setups.sort(key=lambda s: -s["count"])

    by_month = {}
    for e in missed:
        month = (e.get("date") or "")[:7]
        if month:
            by_month.setdefault(month, []).append(e)
    months = [{"month": k, **_bucket(v)} for k, v in sorted(by_month.items())]

    return {
        "total": len(entries),
        "missed": _bucket(missed),
        "passed": {"count": len(passed)},
        "unclear": {"count": len(unclear)},
        "by_reason": reasons,
        "by_group": groups,
        "by_setup": setups,
        "by_month": months,
    }


# --- Store ------------------------------------------------------------------

def _new_id(entries: dict) -> str:
    """A millisecond stamp, stepped forward until it's actually free.

    The bare `int(time * 1000)` this started as (inherited from
    playbook_router) silently *overwrote* an entry when two writes landed in
    the same millisecond — logging two suggestions in quick succession, or a
    double-submit. It survived local runs and failed on a faster CI box, which
    is the worst way for a data-loss bug to behave.
    """
    stamp = int(dt.now().timestamp() * 1000)
    while str(stamp) in entries:
        stamp += 1
    return str(stamp)


def _load() -> dict:
    with _missed_lock:
        if os.path.exists(MISSED_PATH):
            with open(MISSED_PATH, "r") as f:
                return json.load(f)
        return {"entries": {}}


def _save(data: dict):
    with _missed_lock:
        os.makedirs(os.path.dirname(MISSED_PATH), exist_ok=True)
        with open(MISSED_PATH, "w") as f:
            json.dump(data, f, indent=2)


async def _store_screenshots(entry_id: str, files, existing: List[str]) -> List[str]:
    """Write uploads to disk, returning the updated filename list. Filenames are
    always server-generated (entry id + index + extension), never the client's."""
    saved = list(existing)
    if not files:
        return saved
    os.makedirs(MISSED_SCREENSHOTS_DIR, exist_ok=True)
    for f in files:
        if not f or not f.filename:
            continue
        if len(saved) >= MAX_SCREENSHOTS:
            raise HTTPException(status_code=400, detail=f"At most {MAX_SCREENSHOTS} screenshots per entry")
        contents = await f.read()
        _enforce_upload_limit(contents, "Screenshot")
        ext = os.path.splitext(f.filename)[1].lower() or ".png"
        if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
            raise HTTPException(status_code=400, detail=f"Unsupported image type: {ext}")
        name = f"{entry_id}-{int(dt.now().timestamp() * 1000)}{ext}"
        with open(os.path.join(MISSED_SCREENSHOTS_DIR, name), "wb") as out:
            out.write(contents)
        saved.append(name)
    return saved


def _remove_files(names):
    for name in names or []:
        try:
            path = _safe_within(MISSED_SCREENSHOTS_DIR, name)
        except HTTPException:
            continue
        if os.path.exists(path):
            os.remove(path)


def _clean_verdict(v: str) -> str:
    v = (v or "").strip().lower()
    return v if v in VERDICTS else "missed"


def _require_reason(verdict: str, reason: str) -> None:
    """A miss with no reason is a row that can't be aggregated.

    The ranked-reason table is the only thing on the page that turns a diary
    into a diagnosis, and one blank entry pollutes it silently by landing in
    "unspecified". Passes and unclears are exempt — you don't always know yet.
    """
    if verdict == "missed" and not (reason or "").strip():
        raise HTTPException(
            status_code=422,
            detail="A missed entry needs a reason — it's what the summary ranks.",
        )


def _clean_tags(tags: str) -> List[str]:
    return [t.strip() for t in (tags or "").split(",") if t.strip()]


# --- Routes -----------------------------------------------------------------

@router.get("/api/missed/entries")
def list_missed_entries():
    entries = list(_load()["entries"].values())
    entries.sort(key=lambda e: (e.get("date", ""), e.get("created_at", "")), reverse=True)
    return {
        "entries": entries,
        "total": len(entries),
        "verdicts": list(VERDICTS),
        "reason_groups": {k: list(v) for k, v in REASON_GROUPS.items()},
    }


@router.get("/api/missed/summary")
def missed_summary():
    return summarize(list(_load()["entries"].values()))


@router.get("/api/missed/price-check")
def price_check(symbol: str, date: str, direction: str = "long",
                sessions: int = FORWARD_SESSIONS):
    """Fill the two price fields from the grouped cache instead of from memory.

    Fails soft on every path — no cache, no coverage, an unparseable date — so a
    missing local cache degrades the form to manual entry rather than blocking
    the log. Nothing here fetches from a provider.
    """
    try:
        start = dt.fromisoformat(date).date()
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")

    try:
        from datetime import timedelta

        from breadth import cache as breadth_cache
        # Reach back far enough to seed the trail average, forward far enough
        # that `sessions` trading days fit inside the calendar window.
        window = breadth_cache.load_cached_window(
            start - timedelta(days=TRAIL_MA * 3),
            start + timedelta(days=sessions * 2 + 10),
        )
    except Exception:
        return {"available": False, "reason": "The local grouped-price cache isn't available."}

    if not window:
        return {"available": False, "reason": "No cached sessions cover that date."}

    result = forward_prices(symbol, start, window, direction=direction, sessions=sessions)
    if result is None:
        return {"available": False, "reason": f"No cached bars for {symbol.upper()} after {date}."}
    return {"available": True, **result}


@router.get("/api/missed/suggestions")
def suggestions(days: int = 90, min_move: float = missed_suggest.MIN_MOVE_PCT,
                sessions: int = FORWARD_SESSIONS):
    """Names you shortlisted on Prep, never traded, that then went somewhere.

    Fails soft at every join — no prep sessions, no workbook, no cache — because
    a suggestion list is an assistant, not a source of truth. An empty list with
    a reason is always better than a 500 on the page that holds your log.
    """
    from datetime import timedelta

    since = dt.now().date() - timedelta(days=days)

    try:
        from prep_router import _load as _load_prep
        prep_sessions = _load_prep().get("sessions", [])
    except Exception:
        return {"suggestions": [], "reason": "No prep sessions have been saved yet."}
    if not prep_sessions:
        return {"suggestions": [], "reason": "No prep sessions have been saved yet."}

    try:
        from trading_analysis_router import load_default_trades
        trades = (load_default_trades() or {}).get("trades") or []
    except Exception:
        # No workbook is survivable: every shortlisted name simply reads as
        # untaken, which over-suggests rather than hiding a real miss.
        trades = []

    try:
        from breadth import cache as breadth_cache
        window = breadth_cache.load_cached_window(
            since - timedelta(days=TRAIL_MA * 3),
            dt.now().date(),
        )
    except Exception:
        window = {}
    if not window:
        return {"suggestions": [], "reason": "The local grouped-price cache isn't available."}

    def _forward(symbol, day):
        # Anchor on the trigger, not the shortlist date — see first_trigger.
        anchor = first_trigger(symbol, day, window)
        if anchor is None:
            return None
        priced = forward_prices(symbol, anchor, window, sessions=sessions)
        if priced:
            priced["anchor_date"] = anchor.isoformat()
        return priced

    rows = missed_suggest.suggest(
        prep_sessions, trades, list(_load()["entries"].values()), _forward,
        since=since, min_move_pct=min_move,
    )
    return {"suggestions": rows, "count": len(rows), "since": since.isoformat()}


@router.post("/api/missed/entries")
async def create_missed_entry(
    symbol: str = Form(...),
    date: str = Form(...),
    setup: str = Form(""),
    direction: str = Form("long"),
    verdict: str = Form("missed"),
    reason: str = Form(""),
    entry: str = Form(""),
    stop: str = Form(""),
    peak: str = Form(""),
    exit_price: str = Form(""),
    why_good: str = Form(""),
    lesson: str = Form(""),
    tags: str = Form(""),
    # Must be List[...] with a list default rather than Optional[List[...]]:
    # FastAPI only treats the former as a sequence field, so the Optional form
    # hands a bare UploadFile to pydantic on a single-file post and 422s.
    screenshots: List[UploadFile] = File(default=[]),
):
    _require_reason(_clean_verdict(verdict), reason)
    data = _load()
    entry_id = _new_id(data["entries"])
    direction = "short" if (direction or "").strip().lower() == "short" else "long"
    prices = {"entry": _num(entry), "stop": _num(stop), "peak": _num(peak), "exit_price": _num(exit_price)}
    files = await _store_screenshots(entry_id, screenshots, [])

    record = {
        "id": entry_id,
        "symbol": symbol.upper().strip(),
        "date": date,
        "setup": setup.strip(),
        "direction": direction,
        "verdict": _clean_verdict(verdict),
        "reason": reason.strip(),
        **prices,
        **price_fields(direction, prices["entry"], prices["stop"], prices["peak"], prices["exit_price"]),
        "why_good": why_good,
        "lesson": lesson,
        "tags": _clean_tags(tags),
        "screenshots": files,
        "created_at": dt.now().isoformat(),
        "updated_at": dt.now().isoformat(),
    }

    data["entries"][entry_id] = record
    _save(data)
    return {"status": "created", "entry": record}


@router.patch("/api/missed/entries/{entry_id}")
async def update_missed_entry(
    entry_id: str,
    symbol: str = Form(...),
    date: str = Form(...),
    setup: str = Form(""),
    direction: str = Form("long"),
    verdict: str = Form("missed"),
    reason: str = Form(""),
    entry: str = Form(""),
    stop: str = Form(""),
    peak: str = Form(""),
    exit_price: str = Form(""),
    why_good: str = Form(""),
    lesson: str = Form(""),
    tags: str = Form(""),
    # Must be List[...] with a list default rather than Optional[List[...]]:
    # FastAPI only treats the former as a sequence field, so the Optional form
    # hands a bare UploadFile to pydantic on a single-file post and 422s.
    screenshots: List[UploadFile] = File(default=[]),
    remove_screenshots: str = Form(""),
):
    data = _load()
    if entry_id not in data["entries"]:
        raise HTTPException(status_code=404, detail="Missed entry not found")

    _require_reason(_clean_verdict(verdict), reason)
    record = data["entries"][entry_id]
    direction = "short" if (direction or "").strip().lower() == "short" else "long"

    drop = {n.strip() for n in (remove_screenshots or "").split(",") if n.strip()}
    kept = [n for n in record.get("screenshots", []) if n not in drop]
    _remove_files([n for n in record.get("screenshots", []) if n in drop])
    kept = await _store_screenshots(entry_id, screenshots, kept)

    prices = {"entry": _num(entry), "stop": _num(stop), "peak": _num(peak), "exit_price": _num(exit_price)}
    record.update({
        "symbol": symbol.upper().strip(),
        "date": date,
        "setup": setup.strip(),
        "direction": direction,
        "verdict": _clean_verdict(verdict),
        "reason": reason.strip(),
        **prices,
        **price_fields(direction, prices["entry"], prices["stop"], prices["peak"], prices["exit_price"]),
        "why_good": why_good,
        "lesson": lesson,
        "tags": _clean_tags(tags),
        "screenshots": kept,
        "updated_at": dt.now().isoformat(),
    })

    data["entries"][entry_id] = record
    _save(data)
    return {"status": "updated", "entry": record}


@router.delete("/api/missed/entries/{entry_id}")
def delete_missed_entry(entry_id: str):
    data = _load()
    if entry_id not in data["entries"]:
        raise HTTPException(status_code=404, detail="Missed entry not found")
    _remove_files(data["entries"][entry_id].get("screenshots", []))
    del data["entries"][entry_id]
    _save(data)
    return {"status": "deleted", "id": entry_id}


@router.get("/api/missed/screenshots/{filename}")
def get_missed_screenshot(filename: str):
    filepath = _safe_within(MISSED_SCREENSHOTS_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(filepath)
