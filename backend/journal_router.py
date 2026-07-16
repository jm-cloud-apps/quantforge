"""Trade Journal CRUD endpoints (extracted from main.py).

Per-trade journaling — pre-trade plan, entry/exit emotion, lessons, rating, tags —
persisted to data/journal.json. main.py registers this via app.include_router and
imports `_load_journal` for the analytics endpoint that merges journal data. (The
/api/journal/calendar P&L endpoint stays in main.py: it's trades-workbook
analytics, not journal CRUD.)
"""

import json
import os
import threading
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


# ─── Trade Journal ────────────────────────────────────────────────────────────

JOURNAL_PATH = os.getenv("JOURNAL_PATH", os.path.join(os.path.dirname(__file__), "data", "journal.json"))
_journal_lock = threading.Lock()


class JournalEntry(BaseModel):
    trade_id: str
    pre_trade_plan: str = ""
    emotion_entry: str = ""
    emotion_exit: str = ""
    lessons_learned: str = ""
    rating: int = 0
    tags: List[str] = []


def _load_journal() -> dict:
    with _journal_lock:
        if os.path.exists(JOURNAL_PATH):
            with open(JOURNAL_PATH, "r") as f:
                return json.load(f)
        return {"entries": {}}


def _save_journal(data: dict):
    with _journal_lock:
        os.makedirs(os.path.dirname(JOURNAL_PATH), exist_ok=True)
        with open(JOURNAL_PATH, "w") as f:
            json.dump(data, f, indent=2)


@router.get("/api/journal/entries")
def list_journal_entries():
    journal = _load_journal()
    entries = list(journal["entries"].values())
    entries.sort(key=lambda e: e.get("trade_id", ""), reverse=True)
    return {"entries": entries, "total": len(entries)}


@router.get("/api/journal/entries/{trade_id:path}")
def get_journal_entry(trade_id: str):
    journal = _load_journal()
    entry = journal["entries"].get(trade_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return entry


@router.post("/api/journal/entries")
def save_journal_entry(entry: JournalEntry):
    journal = _load_journal()
    journal["entries"][entry.trade_id] = entry.dict()
    _save_journal(journal)
    return {"status": "saved", "trade_id": entry.trade_id}


@router.delete("/api/journal/entries/{trade_id:path}")
def delete_journal_entry(trade_id: str):
    journal = _load_journal()
    if trade_id not in journal["entries"]:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    del journal["entries"][trade_id]
    _save_journal(journal)
    return {"status": "deleted", "trade_id": trade_id}


@router.get("/api/journal/stats")
def get_journal_stats():
    journal = _load_journal()
    entries = list(journal["entries"].values())
    if not entries:
        return {"total": 0, "avg_rating": 0, "emotions": {}, "top_tags": [], "rated_entries": 0}

    ratings = [e["rating"] for e in entries if e.get("rating", 0) > 0]
    emotions_entry = {}
    emotions_exit = {}
    tag_counts = {}

    for e in entries:
        if e.get("emotion_entry"):
            emotions_entry[e["emotion_entry"]] = emotions_entry.get(e["emotion_entry"], 0) + 1
        if e.get("emotion_exit"):
            emotions_exit[e["emotion_exit"]] = emotions_exit.get(e["emotion_exit"], 0) + 1
        for tag in e.get("tags", []):
            tag_counts[tag] = tag_counts.get(tag, 0) + 1

    top_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:10]

    return {
        "total": len(entries),
        "rated_entries": len(ratings),
        "avg_rating": round(sum(ratings) / len(ratings), 1) if ratings else 0,
        "emotions_entry": emotions_entry,
        "emotions_exit": emotions_exit,
        "top_tags": [{"tag": t, "count": c} for t, c in top_tags],
    }


@router.get("/api/journal/search")
def search_journal(q: str = ""):
    if not q:
        return {"entries": [], "total": 0}
    journal = _load_journal()
    q_lower = q.lower()
    results = []
    for entry in journal["entries"].values():
        searchable = " ".join([
            entry.get("trade_id", ""),
            entry.get("pre_trade_plan", ""),
            entry.get("lessons_learned", ""),
            entry.get("emotion_entry", ""),
            entry.get("emotion_exit", ""),
            " ".join(entry.get("tags", [])),
        ]).lower()
        if q_lower in searchable:
            results.append(entry)
    return {"entries": results, "total": len(results)}
