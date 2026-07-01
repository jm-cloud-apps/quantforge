"""Watchlist — a single consolidated list of tickers, each stamped with the
date + price at which it was added.

There is exactly one list (no named sub-lists). Every entry caches the last
fetched price and the return-since-add so the UI can render instantly on load
without hitting a data provider; prices only refresh when the user explicitly
asks for it via `POST /api/watchlist/refresh`.

Storage: backend/data/watchlists.json. The whole file is rewritten on every
mutation (state is tiny — well under a few hundred entries).
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])

STORE_PATH = os.path.join(os.path.dirname(__file__), "data", "watchlists.json")
_lock = threading.Lock()


class AddSymbolsBody(BaseModel):
    symbols: Optional[list[str]] = None
    symbol: Optional[str] = None
    # Optional client-supplied price; if absent we fetch from the provider.
    price: Optional[float] = None


# --- Persistence + migration helpers ----------------------------------------

def _empty() -> dict:
    return {"entries": [], "updated_at": _now(), "priced_at": None}


def _load() -> dict:
    """Return the single watchlist object, migrating older formats on read.

    Legacy formats handled:
      * a list of named watchlists (each with its own `entries`) — all entries
        are merged into one list, deduped by symbol keeping the earliest add.
      * the pre-`entries` flat-`symbols` schema nested inside those lists.
    """
    if not os.path.exists(STORE_PATH):
        return _empty()
    try:
        with open(STORE_PATH, "r") as f:
            raw = json.load(f)
    except Exception:
        return _empty()

    # Already the single-object format.
    if isinstance(raw, dict) and "entries" in raw:
        raw.setdefault("updated_at", _now())
        raw.setdefault("priced_at", None)
        return raw

    # Legacy: list of named watchlists -> merge into one.
    if isinstance(raw, list):
        merged: dict[str, dict] = {}
        for item in raw:
            entries = item.get("entries")
            if entries is None:
                # pre-entries flat schema
                ts = item.get("updated_at") or item.get("created_at") or _now()
                entries = [{"symbol": s, "added_at": ts, "added_price": None}
                           for s in (item.get("symbols") or [])]
            for e in entries:
                sym = _normalize_symbol(e.get("symbol", ""))
                if not sym:
                    continue
                kept = merged.get(sym)
                # Keep the earliest add for a symbol seen in multiple lists.
                if kept is None or (e.get("added_at") or "") < (kept.get("added_at") or ""):
                    merged[sym] = {
                        "symbol": sym,
                        "added_at": e.get("added_at") or _now(),
                        "added_price": e.get("added_price"),
                        "current_price": e.get("current_price"),
                        "return_pct": e.get("return_pct"),
                        "priced_at": e.get("priced_at"),
                    }
        obj = {
            "entries": sorted(merged.values(), key=lambda e: e.get("added_at") or ""),
            "updated_at": _now(),
            "priced_at": None,
        }
        try:
            _save_raw(obj)
        except Exception:
            pass  # non-fatal — we'll re-migrate on next read
        return obj

    return _empty()


def _save_raw(obj: dict) -> None:
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    with open(STORE_PATH, "w") as f:
        json.dump(obj, f, indent=2)


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _normalize_symbol(s: str) -> str:
    return (s or "").strip().upper()


# --- Shared accessor (used by other routers) --------------------------------

def load_symbols() -> list[str]:
    """Return all symbols on the watchlist. Safe for other modules to import."""
    with _lock:
        return [e["symbol"] for e in _load().get("entries", []) if e.get("symbol")]


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


def _summary(entries: list[dict]) -> dict:
    valid = [e for e in entries if e.get("return_pct") is not None]
    avg = round(sum(e["return_pct"] for e in valid) / len(valid), 2) if valid else None
    winners = sum(1 for e in valid if e["return_pct"] > 0)
    return {
        "count": len(entries),
        "scored": len(valid),
        "winners": winners,
        "losers": len(valid) - winners,
        "avg_return_pct": avg,
    }


def _with_meta(obj: dict) -> dict:
    """Attach derived fields (days_held, summary) onto the response."""
    entries = []
    for e in obj.get("entries", []):
        days_held = None
        try:
            days_held = max(0, (datetime.now() - datetime.fromisoformat(e["added_at"])).days)
        except Exception:
            pass
        entries.append({**e, "days_held": days_held})
    return {
        "entries": entries,
        "updated_at": obj.get("updated_at"),
        "priced_at": obj.get("priced_at"),
        "summary": _summary(entries),
    }


# --- Endpoints ---------------------------------------------------------------

@router.get("")
def get_watchlist() -> dict:
    """Return the watchlist with its *cached* prices — no provider calls."""
    with _lock:
        return _with_meta(_load())


@router.post("/symbols")
def add_symbols(body: AddSymbolsBody) -> dict:
    """Append symbols, snapshotting the add price for each new ticker."""
    raw_symbols = body.symbols or ([] if body.symbol is None else [body.symbol])
    additions: list[str] = []
    seen: set[str] = set()
    for s in raw_symbols:
        sym = _normalize_symbol(s)
        if sym and sym not in seen:
            seen.add(sym)
            additions.append(sym)
    if not additions:
        raise HTTPException(status_code=400, detail="symbol(s) required")

    now = _now()
    with _lock:
        obj = _load()
        existing = {e["symbol"] for e in obj.get("entries", [])}
        for sym in additions:
            if sym in existing:
                continue
            price = body.price if body.price is not None else _latest_price(sym)
            obj.setdefault("entries", []).append({
                "symbol": sym,
                "added_at": now,
                "added_price": price,
                # Seed "now" with the add price so the row reads 0% until the
                # first explicit refresh, rather than showing a blank.
                "current_price": price,
                "return_pct": 0.0 if price else None,
                "priced_at": now if price else None,
            })
            existing.add(sym)
        obj["updated_at"] = now
        _save_raw(obj)
        return _with_meta(obj)


@router.delete("/symbols/{symbol}")
def remove_symbol(symbol: str) -> dict:
    sym = _normalize_symbol(symbol)
    with _lock:
        obj = _load()
        obj["entries"] = [e for e in obj.get("entries", []) if e.get("symbol", "").upper() != sym]
        obj["updated_at"] = _now()
        _save_raw(obj)
        return _with_meta(obj)


@router.post("/refresh")
def refresh_prices() -> dict:
    """Fetch the latest price for every ticker, recompute return-since-add,
    and persist the results so subsequent loads are instant."""
    with _lock:
        obj = _load()
        entries = [dict(e) for e in obj.get("entries", [])]

    now = _now()
    for e in entries:
        current = _latest_price(e["symbol"])
        if current is not None:
            e["current_price"] = current
            added = e.get("added_price")
            e["return_pct"] = round((current / added - 1) * 100, 2) if added and added > 0 else None
            e["priced_at"] = now

    with _lock:
        # Re-load + patch in case the list changed under us, then persist.
        obj = _load()
        by_sym = {e["symbol"]: e for e in entries}
        for e in obj.get("entries", []):
            fresh = by_sym.get(e["symbol"])
            if fresh:
                e["current_price"] = fresh.get("current_price")
                e["return_pct"] = fresh.get("return_pct")
                e["priced_at"] = fresh.get("priced_at")
        obj["priced_at"] = now
        obj["updated_at"] = now
        _save_raw(obj)
        return _with_meta(obj)
