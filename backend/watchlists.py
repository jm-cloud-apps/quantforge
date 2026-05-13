"""Watchlists — simple JSON-file persisted per-user lists of tickers.

Storage: backend/data/watchlists.json. The whole file is rewritten on every
mutation (state is tiny — a handful of lists with ≤100 tickers each), so we
don't need a DB layer.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/watchlists", tags=["watchlists"])

STORE_PATH = os.path.join(os.path.dirname(__file__), "data", "watchlists.json")
_lock = threading.Lock()


class Watchlist(BaseModel):
    id: str
    name: str
    symbols: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str


class WatchlistCreate(BaseModel):
    name: str
    symbols: list[str] = Field(default_factory=list)


class WatchlistUpdate(BaseModel):
    name: Optional[str] = None
    symbols: Optional[list[str]] = None


def _load() -> list[dict]:
    if not os.path.exists(STORE_PATH):
        return []
    try:
        with open(STORE_PATH, "r") as f:
            return json.load(f) or []
    except Exception:
        return []


def _save(items: list[dict]) -> None:
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    with open(STORE_PATH, "w") as f:
        json.dump(items, f, indent=2)


def _normalize(symbols: list[str]) -> list[str]:
    seen, out = set(), []
    for s in symbols:
        u = (s or "").strip().upper()
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _next_id(items: list[dict]) -> str:
    existing = {item.get("id") for item in items}
    n = 1
    while f"wl_{n}" in existing:
        n += 1
    return f"wl_{n}"


@router.get("")
def list_watchlists() -> list[Watchlist]:
    with _lock:
        return _load()


@router.post("")
def create_watchlist(body: WatchlistCreate) -> Watchlist:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    now = datetime.now().isoformat(timespec="seconds")
    with _lock:
        items = _load()
        if any((item.get("name") or "").lower() == name.lower() for item in items):
            raise HTTPException(status_code=409, detail=f"Watchlist '{name}' already exists")
        wl = {
            "id": _next_id(items),
            "name": name,
            "symbols": _normalize(body.symbols),
            "created_at": now,
            "updated_at": now,
        }
        items.append(wl)
        _save(items)
        return wl


@router.patch("/{wl_id}")
def update_watchlist(wl_id: str, body: WatchlistUpdate) -> Watchlist:
    with _lock:
        items = _load()
        for item in items:
            if item.get("id") == wl_id:
                if body.name is not None:
                    item["name"] = body.name.strip()
                if body.symbols is not None:
                    item["symbols"] = _normalize(body.symbols)
                item["updated_at"] = datetime.now().isoformat(timespec="seconds")
                _save(items)
                return item
        raise HTTPException(status_code=404, detail="Watchlist not found")


@router.delete("/{wl_id}")
def delete_watchlist(wl_id: str) -> dict:
    with _lock:
        items = _load()
        new_items = [i for i in items if i.get("id") != wl_id]
        if len(new_items) == len(items):
            raise HTTPException(status_code=404, detail="Watchlist not found")
        _save(new_items)
        return {"deleted": wl_id}


@router.post("/{wl_id}/symbols")
def add_symbols(wl_id: str, body: dict) -> Watchlist:
    """Append one or more symbols to an existing watchlist (idempotent)."""
    raw = body.get("symbols") or ([] if body.get("symbol") is None else [body["symbol"]])
    if not raw:
        raise HTTPException(status_code=400, detail="symbol(s) required")
    additions = _normalize(raw)
    with _lock:
        items = _load()
        for item in items:
            if item.get("id") == wl_id:
                existing = set(item.get("symbols") or [])
                for sym in additions:
                    if sym not in existing:
                        item.setdefault("symbols", []).append(sym)
                        existing.add(sym)
                item["updated_at"] = datetime.now().isoformat(timespec="seconds")
                _save(items)
                return item
        raise HTTPException(status_code=404, detail="Watchlist not found")


@router.delete("/{wl_id}/symbols/{symbol}")
def remove_symbol(wl_id: str, symbol: str) -> Watchlist:
    sym = symbol.strip().upper()
    with _lock:
        items = _load()
        for item in items:
            if item.get("id") == wl_id:
                item["symbols"] = [s for s in (item.get("symbols") or []) if s.upper() != sym]
                item["updated_at"] = datetime.now().isoformat(timespec="seconds")
                _save(items)
                return item
        raise HTTPException(status_code=404, detail="Watchlist not found")
