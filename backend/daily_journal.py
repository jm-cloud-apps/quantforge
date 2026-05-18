"""Daily trading journal — one entry per calendar day.

Distinct from the per-trade Journal (which captures pre-trade plan / emotion /
lessons for an individual position). This is the market-wide notebook: thesis
for the day, plan for what setups you're hunting, EOD reflection, mood.

Storage: backend/data/daily_journal.json keyed by ISO date (YYYY-MM-DD).
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/journal/daily", tags=["daily-journal"])

STORE_PATH = os.path.join(os.path.dirname(__file__), "data", "daily_journal.json")
_lock = threading.Lock()


class DailyEntry(BaseModel):
    date: str  # YYYY-MM-DD
    mood: Optional[str] = None  # 'green' | 'amber' | 'red'
    market_thesis: str = ""
    plan: str = ""
    reflection: str = ""
    tags: list[str] = Field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


def _load() -> dict:
    if not os.path.exists(STORE_PATH):
        return {"entries": {}}
    try:
        with open(STORE_PATH, "r") as f:
            return json.load(f) or {"entries": {}}
    except Exception:
        return {"entries": {}}


def _save(data: dict) -> None:
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    tmp = STORE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, STORE_PATH)


def _normalize_tag(t: str) -> str:
    return (t or "").strip().lower()


def _valid_date(d: str) -> bool:
    try:
        datetime.strptime(d, "%Y-%m-%d")
        return True
    except Exception:
        return False


@router.get("")
def list_daily_entries(limit: int = 60):
    """Return recent daily entries, newest first."""
    with _lock:
        data = _load()
    entries = list(data.get("entries", {}).values())
    entries.sort(key=lambda e: e.get("date", ""), reverse=True)
    return {"entries": entries[: max(1, min(limit, 500))], "total": len(entries)}


@router.get("/{date}")
def get_daily_entry(date: str):
    if not _valid_date(date):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    with _lock:
        data = _load()
    entry = data.get("entries", {}).get(date)
    if not entry:
        # Return an empty shell so the editor can render fields immediately
        # without a 404-then-create dance — the caller saves to persist.
        return {
            "date": date,
            "mood": None,
            "market_thesis": "",
            "plan": "",
            "reflection": "",
            "tags": [],
            "exists": False,
        }
    return {**entry, "exists": True}


@router.put("/{date}")
def upsert_daily_entry(date: str, body: DailyEntry):
    if not _valid_date(date):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    if body.date and body.date != date:
        raise HTTPException(status_code=400, detail="body.date must match path date")

    now = datetime.now().isoformat(timespec="seconds")
    cleaned_tags: list[str] = []
    seen: set[str] = set()
    for t in body.tags or []:
        n = _normalize_tag(t)
        if n and n not in seen:
            seen.add(n)
            cleaned_tags.append(n)

    with _lock:
        data = _load()
        existing = data.setdefault("entries", {}).get(date)
        merged = {
            "date": date,
            "mood": body.mood,
            "market_thesis": body.market_thesis or "",
            "plan": body.plan or "",
            "reflection": body.reflection or "",
            "tags": cleaned_tags,
            "created_at": (existing or {}).get("created_at") or now,
            "updated_at": now,
        }
        data["entries"][date] = merged
        _save(data)
    return merged


@router.delete("/{date}")
def delete_daily_entry(date: str):
    if not _valid_date(date):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    with _lock:
        data = _load()
        entries = data.get("entries", {})
        if date not in entries:
            raise HTTPException(status_code=404, detail="No entry for that date")
        del entries[date]
        _save(data)
    return {"deleted": date}
