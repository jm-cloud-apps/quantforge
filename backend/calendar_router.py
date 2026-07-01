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

import asyncio
import httpx
from fastapi import APIRouter, Body, HTTPException, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

_WATCHLISTS_PATH = os.path.join(os.path.dirname(__file__), "data", "watchlists.json")

_cache_lock = threading.Lock()
_cache: dict = {"key": None, "data": None, "ts": 0.0, "provider": None}
_CACHE_TTL_SECONDS = 30 * 60

# How far back to also fetch, so already-reported earnings (yesterday's AMC,
# today's BMO once market opens) appear with their actuals.
_LOOKBACK_DAYS = 2


def _today() -> date:
    return datetime.now().date()


def _load_watchlist_symbols() -> list[str]:
    """All symbols on the consolidated watchlist.

    Reuses the watchlists module's accessor (which also migrates legacy
    formats); falls back to reading the file directly if the import fails.
    """
    try:
        from watchlists import load_symbols
        return [s.upper() for s in load_symbols()]
    except Exception:
        pass
    if not os.path.exists(_WATCHLISTS_PATH):
        return []
    try:
        with open(_WATCHLISTS_PATH, "r") as f:
            raw = json.load(f)
    except Exception:
        return []
    entries = raw.get("entries", []) if isinstance(raw, dict) else []
    return [e.get("symbol", "").upper() for e in entries if e.get("symbol")]


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


def _dedupe_rows(rows: list[dict]) -> list[dict]:
    """Collapse duplicate (symbol, date) earnings rows.

    Providers (notably Finnhub) sometimes emit two rows for the same company
    on the same day with different fiscal-period labels — e.g. DXLG as both
    `Q1 2027` and `Q1 2026`, or VSCO with two slightly different estimates.
    These are duplicate forecasts for one actual report, not two events, so
    showing both is misleading (and produces duplicate React keys downstream).

    Keep the single most informative row per (symbol, date): prefer one with
    an actual EPS, then an estimate, then the most recent fiscal year, then
    higher importance.
    """
    def rank(r: dict) -> tuple:
        try:
            fy = int(r.get("fiscal_year") or 0)
        except (TypeError, ValueError):
            fy = 0
        imp = r.get("importance")
        return (
            r.get("eps_actual") is not None,
            r.get("eps_estimate") is not None,
            fy,
            imp if isinstance(imp, (int, float)) else -1,
        )

    best: dict[tuple, dict] = {}
    for r in rows:
        key = (r.get("symbol"), r.get("date"))
        cur = best.get(key)
        if cur is None or rank(r) > rank(cur):
            best[key] = r
    return list(best.values())


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
    today = _today()
    start = today - timedelta(days=_LOOKBACK_DAYS)
    end = today + timedelta(days=max(1, days))
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

    # Collapse provider-side duplicates (same company, same day) before any
    # grouping or watchlist matching so a name never renders twice.
    rows = _dedupe_rows(rows)

    # --- Watchlist filtering ------------------------------------------------
    # `wl_id` is now a simple boolean flag (any truthy value) — there's a
    # single consolidated watchlist, so there's nothing to select between.
    watchlist_meta = None
    watchlist_symbols: set[str] = set()
    if wl_id:
        symbols = _load_watchlist_symbols()
        watchlist_symbols = set(symbols)
        watchlist_meta = {"id": "watchlist", "name": "Watchlist", "symbols": sorted(symbols)}

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
        "window": {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "days": days,
            "today": today.isoformat(),
        },
        "by_date": by_date,
        "watchlist_hits": [{**r, "in_watchlist": True} for r in watchlist_hits],
        "total": len(rows),
        "watchlist": watchlist_meta,
        "provider": provider,
        "provider_errors": errors or None,
        "from_cache": from_cache,
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


# --- Post-earnings reaction (AH for AMC, PM for BMO) ------------------------

_reactions_cache_lock = threading.Lock()
_reactions_cache: dict = {}  # key=(symbol, date, time) -> {"data": dict, "ts": float}
_REACTIONS_TTL_SECONDS = 6 * 60 * 60  # results are pinned to a date; refresh occasionally


def _prev_trading_day(d: date) -> date:
    """Roll back from `d` by one calendar day, skipping Sat/Sun. Doesn't
    account for holidays — close enough for a reaction-move calculation since
    the prior daily bar will simply be empty on a holiday and we'll surface
    that as a missing reaction (front-end shows '—')."""
    out = d - timedelta(days=1)
    while out.weekday() >= 5:
        out -= timedelta(days=1)
    return out


async def _fetch_open_close(client: httpx.AsyncClient, symbol: str, dt: str, api_key: str) -> Optional[dict]:
    """Single open-close call. Returns parsed payload or None on any error."""
    try:
        r = await client.get(
            f"https://api.massive.com/v1/open-close/{symbol.upper()}/{dt}",
            params={"adjusted": "true", "apiKey": api_key},
            timeout=12,
        )
        if r.status_code != 200:
            return None
        body = r.json() or {}
        # On a non-trading day the API returns {"status": "NOT_FOUND", ...}
        if body.get("status") and body.get("status") != "OK":
            return None
        return body
    except Exception:
        return None


async def _reaction_for(client: httpx.AsyncClient, item: dict, api_key: str) -> dict:
    """Compute the extended-hours move for a single earnings event.

    AMC: ref = regular close on report date, ext = afterHours on report date.
    BMO: ref = prior trading day close, ext = preMarket on report date.
    """
    symbol = (item.get("symbol") or "").upper()
    rep_date = item.get("date")
    bucket = (item.get("time") or "").lower()
    out: dict = {
        "symbol": symbol,
        "date": rep_date,
        "time": bucket,
        "session": None,
        "ref_price": None,
        "ext_price": None,
        "pct": None,
    }
    if not symbol or not rep_date or bucket not in ("amc", "bmo"):
        return out

    if bucket == "amc":
        body = await _fetch_open_close(client, symbol, rep_date, api_key)
        if not body:
            return out
        close = body.get("close")
        ah = body.get("afterHours")
        if close is None or ah is None or close == 0:
            return out
        out["session"] = "amc"
        out["ref_price"] = float(close)
        out["ext_price"] = float(ah)
        out["pct"] = (float(ah) - float(close)) / float(close) * 100.0
        return out

    # BMO: need prior close + report-date preMarket. Fire both in parallel.
    try:
        rd = date.fromisoformat(rep_date)
    except Exception:
        return out
    prev = _prev_trading_day(rd).isoformat()
    today_body, prev_body = await asyncio.gather(
        _fetch_open_close(client, symbol, rep_date, api_key),
        _fetch_open_close(client, symbol, prev, api_key),
    )
    if not today_body or not prev_body:
        return out
    pm = today_body.get("preMarket")
    prev_close = prev_body.get("close")
    if pm is None or prev_close is None or prev_close == 0:
        return out
    out["session"] = "bmo"
    out["ref_price"] = float(prev_close)
    out["ext_price"] = float(pm)
    out["pct"] = (float(pm) - float(prev_close)) / float(prev_close) * 100.0
    return out


@router.post("/reactions")
async def get_reactions(payload: dict = Body(...)) -> dict:
    """Compute the post-earnings extended-hours move for a list of events.

    Body: {"items": [{"symbol": "AAPL", "date": "2026-05-30", "time": "amc"}, ...]}

    Each item returns its session (amc/bmo), reference price (regular close
    or prior close), the extended-hours print, and the percent move. Items
    are cached for 6 hours so repeated calendar loads don't re-hit Massive.
    """
    api_key = os.getenv("MASSIVE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="MASSIVE_API_KEY not configured")

    items = payload.get("items") or []
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="`items` must be a list")
    # Dedupe identical (symbol, date, time) requests in this batch
    seen: dict[tuple, dict] = {}
    for it in items:
        key = ((it.get("symbol") or "").upper(), it.get("date"), (it.get("time") or "").lower())
        if key[0] and key[1] and key[2] in ("amc", "bmo"):
            seen[key] = it

    out: dict[str, dict] = {}
    to_fetch: list[tuple[tuple, dict]] = []
    now = time.time()
    with _reactions_cache_lock:
        for key, it in seen.items():
            entry = _reactions_cache.get(key)
            if entry and (now - entry["ts"]) < _REACTIONS_TTL_SECONDS:
                out[f"{key[0]}|{key[1]}"] = entry["data"]
            else:
                to_fetch.append((key, it))

    if to_fetch:
        async with httpx.AsyncClient() as client:
            sem = asyncio.Semaphore(8)

            async def worker(key, it):
                async with sem:
                    return key, await _reaction_for(client, it, api_key)

            results = await asyncio.gather(*(worker(k, i) for k, i in to_fetch))
            now2 = time.time()
            with _reactions_cache_lock:
                for key, data in results:
                    _reactions_cache[key] = {"data": data, "ts": now2}
                    out[f"{key[0]}|{key[1]}"] = data

    return {"reactions": out, "count": len(out), "as_of": datetime.now().isoformat(timespec="seconds")}
