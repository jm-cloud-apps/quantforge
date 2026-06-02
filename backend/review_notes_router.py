"""Per-trade review notes sidecar.

The user reviews trades by writing entry/exit thoughts, lessons, grade, etc.
Today those live in Trades.xlsx; the trade-log-formatter script also writes
to that workbook. Two writers fighting over the same file is fragile, so
this router keeps review notes in a JSON sidecar keyed by a deterministic
trade key (symbol|entry_date|entry_price|quantity).

`load_default_trades` calls `merge_review_notes_into_trades` to overlay
sidecar values onto each trade record at read time — the UI never has to
juggle two sources of truth.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/review", tags=["review-notes"])

STORE_PATH = os.path.join(os.path.dirname(__file__), "data", "review_notes.json")
_lock = threading.Lock()

# --- OHLC bars cache (for the review chart) --------------------------------
_MASSIVE_BASE = "https://api.massive.com"
_bars_cache_lock = threading.Lock()
_bars_cache: dict = {}  # key -> {"data": list, "ts": float}
_BARS_TTL_SECONDS = 30 * 60  # historical bars don't change; refresh occasionally

# Fields that the user edits during a review session. Stored verbatim under
# each trade key. Keep this list small + flat so the sidecar stays diff-able.
EDITABLE_FIELDS = (
    "entry_notes",  # thesis / why this entry
    "exit_notes",   # why this exit / what worked or didn't
    "notes",        # legacy free-form notes (kept for back-compat)
    "lessons",      # what to do differently next time
    "setup",
    "emotion",
    "grade",
    "conviction",
    "stop_price",
    "target_price",
    "tags",
)


# --- Sidecar I/O ------------------------------------------------------------

def _load() -> dict:
    if not os.path.exists(STORE_PATH):
        return {"version": 1, "notes": {}}
    try:
        with open(STORE_PATH, "r") as f:
            data = json.load(f) or {}
            if "notes" not in data:
                data["notes"] = {}
            return data
    except Exception:
        return {"version": 1, "notes": {}}


def _save(data: dict) -> None:
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    tmp = STORE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, STORE_PATH)


def trade_key(trade: dict) -> Optional[str]:
    """Build a stable composite key for a trade.

    Uses symbol + entry_date + entry_price + quantity, which is unique in
    practice even when the same name is traded multiple times in a session.
    Returns None if essentials are missing.
    """
    sym = (trade.get("symbol") or "").upper().strip()
    edate = trade.get("entry_date") or ""
    if isinstance(edate, str) and "T" in edate:
        edate = edate.split("T")[0]
    try:
        eprice = float(trade.get("entry_price") or 0)
    except Exception:
        eprice = 0.0
    try:
        qty = float(trade.get("quantity") or 0)
    except Exception:
        qty = 0.0
    if not sym or not edate:
        return None
    return f"{sym}|{edate}|{eprice:.4f}|{qty:.0f}"


def merge_review_notes_into_trades(trades: list[dict]) -> list[dict]:
    """Overlay sidecar notes onto each trade record (non-destructive: only
    overwrites keys that the sidecar actually has)."""
    with _lock:
        store = _load()
    notes_map = store.get("notes") or {}
    if not notes_map:
        return trades
    for t in trades:
        k = trade_key(t)
        if not k:
            continue
        n = notes_map.get(k)
        if not n:
            continue
        for field in EDITABLE_FIELDS:
            if field in n and n[field] not in (None, ""):
                t[field] = n[field]
        # Surface a flag for the UI so it can mark reviewed trades.
        t["_has_review_notes"] = True
        if n.get("updated_at"):
            t["_review_updated_at"] = n["updated_at"]
    return trades


# --- API models -------------------------------------------------------------

class NotePayload(BaseModel):
    # All optional — partial updates supported.
    entry_notes: Optional[str] = None
    exit_notes: Optional[str] = None
    notes: Optional[str] = None
    lessons: Optional[str] = None
    setup: Optional[str] = None
    emotion: Optional[str] = None
    grade: Optional[str] = None
    conviction: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    tags: Optional[list[str]] = Field(default=None)


class IdentifiedNotePayload(NotePayload):
    """When the caller doesn't already know the trade_key, they can send the
    raw trade identifiers and we'll derive it server-side. The frontend uses
    this path so it doesn't have to replicate the keying logic."""
    symbol: str
    entry_date: str
    entry_price: Optional[float] = 0.0
    quantity: Optional[float] = 0.0


# --- Endpoints --------------------------------------------------------------

@router.get("/notes")
def list_notes() -> dict:
    """Return the full notes map keyed by trade_key.

    Small payload — the UI uses this to know which trades already have notes
    so the "needs review" filter can be computed client-side without a per-
    trade roundtrip.
    """
    with _lock:
        store = _load()
    return {"notes": store.get("notes") or {}, "count": len(store.get("notes") or {})}


@router.put("/notes")
def upsert_note(payload: IdentifiedNotePayload) -> dict:
    """Create or update a single trade's notes."""
    trade_like = {
        "symbol": payload.symbol,
        "entry_date": payload.entry_date,
        "entry_price": payload.entry_price,
        "quantity": payload.quantity,
    }
    key = trade_key(trade_like)
    if not key:
        raise HTTPException(status_code=400, detail="symbol + entry_date are required")

    now = datetime.now().isoformat(timespec="seconds")
    incoming = {k: v for k, v in payload.dict(exclude={"symbol", "entry_date", "entry_price", "quantity"}).items() if v is not None}

    with _lock:
        store = _load()
        existing = (store.get("notes") or {}).get(key) or {}
        merged = {**existing, **incoming}
        merged["updated_at"] = now
        if not existing.get("created_at"):
            merged["created_at"] = now
        # Always remember the trade identifiers so the sidecar is self-
        # describing if someone reads it without the workbook handy.
        merged["_symbol"] = payload.symbol.upper().strip()
        merged["_entry_date"] = (payload.entry_date or "").split("T")[0]
        if payload.entry_price is not None:
            merged["_entry_price"] = float(payload.entry_price)
        if payload.quantity is not None:
            merged["_quantity"] = float(payload.quantity)
        store.setdefault("notes", {})[key] = merged
        _save(store)

    return {"key": key, "note": merged}


@router.delete("/notes/{key}")
def delete_note(key: str) -> dict:
    with _lock:
        store = _load()
        notes = store.get("notes") or {}
        if key in notes:
            del notes[key]
            store["notes"] = notes
            _save(store)
            return {"deleted": key}
    raise HTTPException(status_code=404, detail="note not found")


# --- OHLC bars for the review chart ----------------------------------------

_ALLOWED_TIMESPANS = {"minute", "hour", "day", "week"}


@router.get("/bars")
def get_review_bars(
    symbol: str = Query(..., min_length=1),
    frm: str = Query(..., description="Window start YYYY-MM-DD"),
    to: str = Query(..., description="Window end YYYY-MM-DD"),
    multiplier: int = Query(5, ge=1, le=60),
    timespan: str = Query("minute"),
) -> dict:
    """Return OHLC bars for a ticker over [frm, to] at the given resolution.

    Powers the trade-review candlestick chart. Bars come back in the shape
    lightweight-charts wants: time is epoch SECONDS (UTC) for intraday spans
    and a 'YYYY-MM-DD' string for daily+ spans, so the frontend can plot
    either without reshaping.
    """
    timespan = (timespan or "minute").lower()
    if timespan not in _ALLOWED_TIMESPANS:
        raise HTTPException(status_code=400, detail=f"timespan must be one of {sorted(_ALLOWED_TIMESPANS)}")

    api_key = os.getenv("MASSIVE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="MASSIVE_API_KEY not configured")

    sym = symbol.upper().strip()
    cache_key = f"{sym}|{frm}|{to}|{multiplier}|{timespan}"
    now = time.time()
    with _bars_cache_lock:
        entry = _bars_cache.get(cache_key)
        if entry and (now - entry["ts"]) < _BARS_TTL_SECONDS:
            return {"symbol": sym, "timespan": timespan, "multiplier": multiplier,
                    "bars": entry["data"], "count": len(entry["data"]), "from_cache": True}

    path = f"/v2/aggs/ticker/{sym}/range/{multiplier}/{timespan}/{frm}/{to}"
    try:
        r = httpx.get(
            _MASSIVE_BASE + path,
            params={"adjusted": "true", "sort": "asc", "limit": 50000, "apiKey": api_key},
            timeout=20,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Massive request error: {e}")

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Massive HTTP {r.status_code}: {r.text[:200]}")

    results = (r.json() or {}).get("results") or []
    intraday = timespan in ("minute", "hour")
    bars: list[dict] = []
    for b in results:
        t_ms = b.get("t")
        if t_ms is None:
            continue
        if intraday:
            t_val: Any = int(t_ms // 1000)  # epoch seconds (UTC)
        else:
            # Daily+ → date string keyed to the bar's UTC day.
            t_val = datetime.utcfromtimestamp(t_ms / 1000).strftime("%Y-%m-%d")
        bars.append({
            "time": t_val,
            "open": b.get("o"),
            "high": b.get("h"),
            "low": b.get("l"),
            "close": b.get("c"),
            "volume": b.get("v"),
        })

    with _bars_cache_lock:
        _bars_cache[cache_key] = {"data": bars, "ts": now}

    return {"symbol": sym, "timespan": timespan, "multiplier": multiplier,
            "bars": bars, "count": len(bars), "from_cache": False}
