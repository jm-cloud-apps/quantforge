"""Watchlists — per-user lists of tickers with entry timestamp + price.

Each entry captures the date and price at which the symbol was added, so the
UI can benchmark current price against the original entry and surface a
running return for every name on the list.

Storage: backend/data/watchlists.json. The whole file is rewritten on every
mutation (state is tiny — a handful of lists with ≤100 entries each).
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/watchlists", tags=["watchlists"])

STORE_PATH = os.path.join(os.path.dirname(__file__), "data", "watchlists.json")
_lock = threading.Lock()


class Entry(BaseModel):
    symbol: str
    added_at: str
    added_price: Optional[float] = None


class Watchlist(BaseModel):
    id: str
    name: str
    entries: list[Entry] = Field(default_factory=list)
    created_at: str
    updated_at: str

    @property
    def symbols(self) -> list[str]:  # convenience for callers that only need ticks
        return [e.symbol for e in self.entries]


class WatchlistCreate(BaseModel):
    name: str
    symbols: list[str] = Field(default_factory=list)


class WatchlistUpdate(BaseModel):
    name: Optional[str] = None
    symbols: Optional[list[str]] = None  # full replace; loses entry metadata


class AddSymbolsBody(BaseModel):
    symbols: Optional[list[str]] = None
    symbol: Optional[str] = None
    # Optional client-supplied price; if absent we fetch from the provider.
    price: Optional[float] = None


# --- Persistence + migration helpers ----------------------------------------

def _load() -> list[dict]:
    if not os.path.exists(STORE_PATH):
        return []
    try:
        with open(STORE_PATH, "r") as f:
            raw = json.load(f) or []
    except Exception:
        return []

    # Migrate any pre-entries records on read (older schema stored a flat
    # `symbols` list; entry timestamps + prices weren't tracked).
    migrated = False
    for item in raw:
        if "entries" not in item:
            now = item.get("updated_at") or item.get("created_at") or datetime.now().isoformat(timespec="seconds")
            item["entries"] = [{"symbol": s, "added_at": now, "added_price": None}
                               for s in (item.get("symbols") or [])]
            migrated = True
        item.pop("symbols", None)  # source of truth is `entries`
    if migrated:
        try:
            _save_raw(raw)
        except Exception:
            pass  # non-fatal — we'll re-migrate on next read
    return raw


def _save_raw(items: list[dict]) -> None:
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    with open(STORE_PATH, "w") as f:
        json.dump(items, f, indent=2)


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _next_id(items: list[dict]) -> str:
    existing = {item.get("id") for item in items}
    n = 1
    while f"wl_{n}" in existing:
        n += 1
    return f"wl_{n}"


def _normalize_symbol(s: str) -> str:
    return (s or "").strip().upper()


# --- Price lookup ------------------------------------------------------------

def _latest_price(symbol: str) -> Optional[float]:
    """Pull the most recent close for `symbol` via the configured provider.

    Tries Massive's `ratios` endpoint first (single call, no OHLCV history
    needed), falls back to the last bar of OHLCV.
    """
    try:
        from screener.qullamaggie.providers.massive import MassiveProvider
        mp = MassiveProvider()
        try:
            ratios = mp.fetch_ratios(symbol)
            if ratios and ratios.get("price"):
                return float(ratios["price"])
        finally:
            try:
                mp.close()
            except Exception:
                pass
    except Exception:
        pass

    try:
        from screener.qullamaggie.providers import get_provider
        provider = get_provider()
        try:
            df = provider.fetch(symbol, lookback_days=5)
            if df is not None and len(df) > 0:
                return float(df["close"].iloc[-1])
        finally:
            try:
                provider.close()
            except Exception:
                pass
    except Exception as e:
        logger.debug("latest_price fallback failed for %s: %s", symbol, e)

    return None


# --- Endpoints ---------------------------------------------------------------

@router.get("")
def list_watchlists() -> list[dict]:
    with _lock:
        return _load()


@router.post("")
def create_watchlist(body: WatchlistCreate) -> dict:
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    now = _now()
    with _lock:
        items = _load()
        if any((item.get("name") or "").lower() == name.lower() for item in items):
            raise HTTPException(status_code=409, detail=f"Watchlist '{name}' already exists")

        # Snapshot entry prices for any seeded symbols.
        seeded = []
        seen = set()
        for raw in body.symbols:
            sym = _normalize_symbol(raw)
            if not sym or sym in seen:
                continue
            seen.add(sym)
            seeded.append({"symbol": sym, "added_at": now, "added_price": _latest_price(sym)})

        wl = {
            "id": _next_id(items),
            "name": name,
            "entries": seeded,
            "created_at": now,
            "updated_at": now,
        }
        items.append(wl)
        _save_raw(items)
        return wl


@router.patch("/{wl_id}")
def update_watchlist(wl_id: str, body: WatchlistUpdate) -> dict:
    """Rename, or replace the full symbol set.

    Replacement is destructive — existing entry metadata for tickers no longer
    in the new list is lost. Use the symbols endpoints below for incremental
    edits that preserve add timestamps + prices.
    """
    with _lock:
        items = _load()
        for item in items:
            if item.get("id") != wl_id:
                continue
            if body.name is not None:
                item["name"] = body.name.strip()
            if body.symbols is not None:
                # Preserve metadata for tickers that remain.
                existing = {e["symbol"]: e for e in item.get("entries", [])}
                new_entries: list[dict] = []
                now = _now()
                seen = set()
                for raw in body.symbols:
                    sym = _normalize_symbol(raw)
                    if not sym or sym in seen:
                        continue
                    seen.add(sym)
                    if sym in existing:
                        new_entries.append(existing[sym])
                    else:
                        new_entries.append({"symbol": sym, "added_at": now, "added_price": _latest_price(sym)})
                item["entries"] = new_entries
            item["updated_at"] = _now()
            _save_raw(items)
            return item
        raise HTTPException(status_code=404, detail="Watchlist not found")


@router.delete("/{wl_id}")
def delete_watchlist(wl_id: str) -> dict:
    with _lock:
        items = _load()
        new_items = [i for i in items if i.get("id") != wl_id]
        if len(new_items) == len(items):
            raise HTTPException(status_code=404, detail="Watchlist not found")
        _save_raw(new_items)
        return {"deleted": wl_id}


@router.post("/{wl_id}/symbols")
def add_symbols(wl_id: str, body: AddSymbolsBody) -> dict:
    """Append symbols to a watchlist, snapshotting each at add time."""
    raw_symbols = body.symbols or ([] if body.symbol is None else [body.symbol])
    if not raw_symbols:
        raise HTTPException(status_code=400, detail="symbol(s) required")
    additions: list[str] = []
    seen: set[str] = set()
    for s in raw_symbols:
        sym = _normalize_symbol(s)
        if sym and sym not in seen:
            seen.add(sym)
            additions.append(sym)

    now = _now()
    with _lock:
        items = _load()
        for item in items:
            if item.get("id") != wl_id:
                continue
            existing = {e["symbol"] for e in item.get("entries", [])}
            for sym in additions:
                if sym in existing:
                    continue
                price = body.price if body.price is not None else _latest_price(sym)
                item.setdefault("entries", []).append({
                    "symbol": sym, "added_at": now, "added_price": price,
                })
                existing.add(sym)
            item["updated_at"] = now
            _save_raw(items)
            return item
        raise HTTPException(status_code=404, detail="Watchlist not found")


@router.delete("/{wl_id}/symbols/{symbol}")
def remove_symbol(wl_id: str, symbol: str) -> dict:
    sym = _normalize_symbol(symbol)
    with _lock:
        items = _load()
        for item in items:
            if item.get("id") != wl_id:
                continue
            item["entries"] = [e for e in (item.get("entries") or []) if e.get("symbol", "").upper() != sym]
            item["updated_at"] = _now()
            _save_raw(items)
            return item
        raise HTTPException(status_code=404, detail="Watchlist not found")


@router.get("/{wl_id}/benchmark")
def benchmark_watchlist(wl_id: str) -> dict:
    """Return current price + return-since-add for every entry."""
    with _lock:
        items = _load()
        target = next((i for i in items if i.get("id") == wl_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Watchlist not found")
        entries = list(target.get("entries") or [])

    benched: list[dict] = []
    for e in entries:
        sym = e["symbol"]
        added = e.get("added_price")
        current = _latest_price(sym)
        ret_pct = None
        if added and current and added > 0:
            ret_pct = (current / added - 1) * 100
        # Days held
        days_held = None
        try:
            days_held = max(0, (datetime.now() - datetime.fromisoformat(e["added_at"])).days)
        except Exception:
            pass
        benched.append({
            "symbol": sym,
            "added_at": e.get("added_at"),
            "added_price": added,
            "current_price": current,
            "return_pct": round(ret_pct, 2) if ret_pct is not None else None,
            "days_held": days_held,
        })

    # Roll-up — only count entries with both prices.
    valid = [b for b in benched if b["return_pct"] is not None]
    avg_return = round(sum(b["return_pct"] for b in valid) / len(valid), 2) if valid else None
    winners = sum(1 for b in valid if b["return_pct"] > 0)

    return {
        "watchlist_id": wl_id,
        "name": target.get("name"),
        "as_of": _now(),
        "entries": benched,
        "summary": {
            "count": len(benched),
            "scored": len(valid),
            "winners": winners,
            "losers": len(valid) - winners,
            "avg_return_pct": avg_return,
        },
    }
