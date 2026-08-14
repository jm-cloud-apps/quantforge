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
    entry_id = str(int(dt.now().timestamp() * 1000))
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

    data = _load()
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
