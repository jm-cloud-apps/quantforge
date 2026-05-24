"""Earnings + catalyst calendar.

Returns earnings rows for a forward N-day window grouped by date. Supports
filtering to a single watchlist so the trader can see "what's reporting in my
names this week" without scrolling the full universe.

Data sources (in order of preference):
  1. Massive `/benzinga/v1/earnings` — richest schema (importance, fiscal_period)
     but gated behind a paid plan tier; returns 403 NOT_AUTHORIZED otherwise.
  2. Finnhub `/calendar/earnings` — free-tier friendly, no extras but covers
     US listings with EPS/revenue est+actual and a BMO/AMC marker.

Whichever succeeds first wins. The 30-min in-memory cache keys results by
window + provider so a 403 from Massive doesn't poison the Finnhub path.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import date, datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

_WATCHLISTS_PATH = os.path.join(os.path.dirname(__file__), "data", "watchlists.json")

_cache_lock = threading.Lock()
_cache: dict = {"key": None, "data": None, "ts": 0.0, "provider": None}
_CACHE_TTL_SECONDS = 30 * 60


def _today() -> date:
    return datetime.now().date()


def _load_watchlist_symbols(wl_id: str) -> list[str]:
    if not os.path.exists(_WATCHLISTS_PATH):
        return []
    try:
        with open(_WATCHLISTS_PATH, "r") as f:
            items = json.load(f) or []
    except Exception:
        return []
    for item in items:
        if item.get("id") == wl_id:
            entries = item.get("entries") or []
            return [e.get("symbol", "").upper() for e in entries if e.get("symbol")]
    return []


# --- Provider fetchers ------------------------------------------------------

def _fetch_via_massive(start: str, end: str) -> tuple[list[dict], Optional[str]]:
    """Try Massive's Benzinga earnings endpoint. Returns (rows, error_message)."""
    api_key = os.getenv("MASSIVE_API_KEY")
    if not api_key:
        return [], "MASSIVE_API_KEY not configured"

    try:
        from screener.qullamaggie.providers.massive import MassiveProvider
    except Exception as e:
        return [], f"Massive provider import failed: {e}"

    mp = MassiveProvider()
    try:
        # Use the bulk method first; if it returns 0 silently, retry with a
        # single direct HTTP call so we can surface the actual status code.
        rows = mp.fetch_earnings_window(start, end)
        if rows:
            return rows, None
        # Direct probe to surface the real failure reason for the UI.
        probe = httpx.get(
            "https://api.massive.com/benzinga/v1/earnings",
            params={"date.gte": start, "date.lte": end, "limit": 1, "apiKey": api_key},
            timeout=15,
        )
        if probe.status_code == 200:
            return [], None  # endpoint works but window is genuinely empty
        try:
            body = probe.json()
            msg = body.get("message") or body.get("status") or probe.text[:200]
        except Exception:
            msg = probe.text[:200]
        return [], f"Massive HTTP {probe.status_code}: {msg}"
    except Exception as e:
        return [], f"Massive request error: {e}"
    finally:
        try:
            mp.close()
        except Exception:
            pass


def _fetch_via_finnhub(start: str, end: str) -> tuple[list[dict], Optional[str]]:
    """Try Finnhub's earnings calendar. Returns (rows, error_message)."""
    api_key = os.getenv("FINNHUB_API_KEY")
    if not api_key:
        return [], "FINNHUB_API_KEY not configured"

    try:
        r = httpx.get(
            "https://finnhub.io/api/v1/calendar/earnings",
            params={"from": start, "to": end, "token": api_key},
            timeout=20,
        )
    except Exception as e:
        return [], f"Finnhub request error: {e}"

    if r.status_code != 200:
        return [], f"Finnhub HTTP {r.status_code}: {r.text[:200]}"

    try:
        payload = r.json() or {}
    except Exception as e:
        return [], f"Finnhub JSON decode error: {e}"

    arr = payload.get("earningsCalendar") or []
    out: list[dict] = []
    for row in arr:
        sym = (row.get("symbol") or "").upper()
        if not sym:
            continue
        # Finnhub `hour` field: 'bmo' | 'amc' | 'dmh' | '' (during market / TBD)
        hour = (row.get("hour") or "").lower()
        time_bucket = hour if hour in ("bmo", "amc") else None
        out.append({
            "symbol": sym,
            "date": row.get("date"),
            "time": time_bucket,
            "eps_estimate": row.get("epsEstimate"),
            "eps_actual": row.get("epsActual"),
            "revenue_estimate": row.get("revenueEstimate"),
            "revenue_actual": row.get("revenueActual"),
            "currency": None,
            "exchange": None,
            "importance": None,
            "fiscal_period": f"Q{row.get('quarter')}" if row.get("quarter") else None,
            "fiscal_year": row.get("year"),
        })
    return out, None


# --- Endpoint ---------------------------------------------------------------

@router.get("/earnings")
def get_earnings(
    days: int = Query(7, ge=1, le=30),
    wl_id: Optional[str] = None,
    force: int = 0,
) -> dict:
    """Return earnings rows for the forward `days`-day window.

    Tries Massive first, falls back to Finnhub. Surfaces the provider name and
    any upstream errors so the UI can explain a 403/quota issue.
    """
    start = _today()
    end = start + timedelta(days=max(1, days))
    cache_key = (start.isoformat(), end.isoformat())

    with _cache_lock:
        cached_valid = (
            not force
            and _cache["key"] == cache_key
            and (time.time() - _cache["ts"]) < _CACHE_TTL_SECONDS
            and _cache["data"] is not None
            # Don't trust a cached zero-result — likely the previous fetch
            # failed silently. Always re-probe in that case.
            and len(_cache["data"]) > 0
        )
        if cached_valid:
            rows = list(_cache["data"])
            provider = _cache["provider"]
            from_cache = True
        else:
            rows = None
            provider = None
            from_cache = False

    errors: list[str] = []
    if rows is None:
        # Massive first — its data is richer (importance scores, etc.).
        m_rows, m_err = _fetch_via_massive(start.isoformat(), end.isoformat())
        if m_rows:
            rows = m_rows
            provider = "massive"
        else:
            if m_err:
                errors.append(f"massive: {m_err}")
            f_rows, f_err = _fetch_via_finnhub(start.isoformat(), end.isoformat())
            if f_rows:
                rows = f_rows
                provider = "finnhub"
            else:
                if f_err:
                    errors.append(f"finnhub: {f_err}")
                rows = []

        if rows:
            with _cache_lock:
                _cache["key"] = cache_key
                _cache["data"] = list(rows)
                _cache["ts"] = time.time()
                _cache["provider"] = provider

    # Hard fail if every provider errored AND we have nothing — clearer UX
    # than silently rendering "no earnings".
    if not rows and errors:
        raise HTTPException(
            status_code=503,
            detail=f"Earnings providers unavailable. {' / '.join(errors)}",
        )

    # --- Watchlist filtering ------------------------------------------------
    watchlist_meta = None
    watchlist_symbols: set[str] = set()
    if wl_id:
        symbols = _load_watchlist_symbols(wl_id)
        if not symbols:
            watchlist_meta = {"id": wl_id, "name": None, "symbols": []}
        else:
            watchlist_symbols = set(symbols)
            try:
                with open(_WATCHLISTS_PATH, "r") as f:
                    items = json.load(f) or []
                wl_obj = next((i for i in items if i.get("id") == wl_id), None)
                watchlist_meta = {
                    "id": wl_id,
                    "name": (wl_obj or {}).get("name"),
                    "symbols": sorted(symbols),
                }
            except Exception:
                watchlist_meta = {"id": wl_id, "name": None, "symbols": sorted(symbols)}

    watchlist_hits = [r for r in rows if r["symbol"] in watchlist_symbols] if watchlist_symbols else []

    # --- Group by date + time bucket ---------------------------------------
    by_date_map: dict[str, dict] = {}
    for r in rows:
        d = r.get("date")
        if not d:
            continue
        bucket = "bmo" if r.get("time") == "bmo" else ("amc" if r.get("time") == "amc" else "other")
        slot = by_date_map.setdefault(d, {"date": d, "bmo": [], "amc": [], "other": []})
        slot[bucket].append({**r, "in_watchlist": r["symbol"] in watchlist_symbols})

    def _sort_key(row: dict) -> tuple:
        imp = row.get("importance")
        # Importance: higher = more important (Massive only). Watchlist names
        # float to the top, then importance, then alpha for stability.
        return (
            0 if row.get("in_watchlist") else 1,
            -(imp if isinstance(imp, (int, float)) else 0),
            row.get("symbol") or "",
        )

    for slot in by_date_map.values():
        for k in ("bmo", "amc", "other"):
            slot[k].sort(key=_sort_key)

    by_date = sorted(by_date_map.values(), key=lambda s: s["date"])

    return {
        "window": {"start": start.isoformat(), "end": end.isoformat(), "days": days},
        "by_date": by_date,
        "watchlist_hits": [{**r, "in_watchlist": True} for r in watchlist_hits],
        "total": len(rows),
        "watchlist": watchlist_meta,
        "provider": provider,
        "provider_errors": errors or None,
        "from_cache": from_cache,
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }
