"""Extended-hours & gap-and-go movers.

Two endpoints power the dashboard widgets:

  GET /api/movers/extended  — top gainers + losers from Massive's
    /v2/snapshot/locale/us/markets/stocks/{direction}. During pre-market the
    snapshot reflects 4:00 AM ET onwards; during after-hours it reflects
    trades through ~8 PM. The session label comes from /v1/marketstatus/now
    so the UI can title the card appropriately.

  GET /api/movers/gap — full-market snapshot filtered to large positive
    % moves with non-trivial volume. Tickers that report earnings today
    (BMO) are flagged so the user can quickly spot earnings-driven gappers.
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

from market_clock import effective_cache_ttl

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/movers", tags=["movers"])

_BASE = "https://api.massive.com"

# In-memory caches. Each has its own short TTL to balance freshness vs API hits.
_cache_lock = threading.Lock()
_movers_cache: dict = {"data": None, "ts": 0.0}
_gap_cache: dict = {"data": None, "ts": 0.0}
_status_cache: dict = {"data": None, "ts": 0.0}

# Active-session TTLs. During trading these stay short (pre/post-market moves
# fast). Once the market is closed, market_clock.effective_cache_ttl stretches
# them to 4h — the data is frozen overnight/weekends, so the full-market gap
# snapshot (a ~3s fetch) shouldn't be re-pulled every minute. See
# effective_cache_ttl() call sites below.
_MOVERS_TTL_SECONDS = 60
_GAP_TTL_SECONDS = 60
_STATUS_TTL_SECONDS = 60


def _get_market_status(api_key: str) -> dict:
    """Resolve current US session: pre-market / regular / after-hours / closed.

    Result is cached for a minute to avoid hammering /marketstatus/now during
    a polling UI.
    """
    with _cache_lock:
        if _status_cache["data"] is not None and (time.time() - _status_cache["ts"]) < effective_cache_ttl(_STATUS_TTL_SECONDS):
            return _status_cache["data"]
    try:
        r = httpx.get(f"{_BASE}/v1/marketstatus/now", params={"apiKey": api_key}, timeout=8)
        if r.status_code != 200:
            data = {"session": "unknown", "raw": None}
        else:
            body = r.json() or {}
            # Massive returns e.g. {"market": "open", "earlyHours": false,
            # "afterHours": true, "serverTime": "..."}
            market = (body.get("market") or "").lower()
            session = "closed"
            if body.get("earlyHours"):
                session = "premarket"
            elif body.get("afterHours"):
                session = "afterhours"
            elif market == "open":
                session = "regular"
            data = {"session": session, "raw": body}
    except Exception as e:
        logger.debug("market status fetch failed: %s", e)
        data = {"session": "unknown", "raw": None}
    with _cache_lock:
        _status_cache["data"] = data
        _status_cache["ts"] = time.time()
    return data


def _normalize_snapshot_row(t: dict) -> dict:
    """Pull the fields we render from a Massive snapshot ticker object."""
    day = t.get("day") or {}
    prev = t.get("prevDay") or {}
    last_trade = t.get("lastTrade") or {}
    min_bar = t.get("min") or {}
    # During premarket the day_* fields aren't populated; fall back to lastTrade.
    last_px = (last_trade.get("p")
               or day.get("c") or min_bar.get("c")
               or prev.get("c"))
    vol = day.get("v") or min_bar.get("av") or 0
    return {
        "symbol": (t.get("ticker") or "").upper(),
        "price": last_px,
        "prev_close": prev.get("c"),
        "change": t.get("todaysChange"),
        "change_pct": t.get("todaysChangePerc"),
        "volume": vol,
        "day_open": day.get("o"),
        "day_high": day.get("h"),
        "day_low": day.get("l"),
        "day_close": day.get("c"),
    }


# --- /api/movers/extended ----------------------------------------------------

@router.get("/extended")
def get_extended_movers(limit: int = Query(5, ge=1, le=20)) -> dict:
    """Top gainers + losers for the current session.

    During pre-market the snapshot reflects 4 AM ET onwards, so the
    "gainers" list IS the pre-market gainers. Same during after-hours.
    During regular hours it's the standard day's gainers/losers.
    """
    api_key = os.getenv("MASSIVE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="MASSIVE_API_KEY not configured")

    with _cache_lock:
        cached_valid = (
            _movers_cache["data"] is not None
            and (time.time() - _movers_cache["ts"]) < effective_cache_ttl(_MOVERS_TTL_SECONDS)
        )
        if cached_valid:
            cached = _movers_cache["data"]
            return {
                "gainers": cached["gainers"][:limit],
                "losers": cached["losers"][:limit],
                "session": cached["session"],
                "from_cache": True,
                "as_of": cached["as_of"],
            }

    status = _get_market_status(api_key)

    def fetch(direction: str) -> list[dict]:
        try:
            r = httpx.get(
                f"{_BASE}/v2/snapshot/locale/us/markets/stocks/{direction}",
                params={"apiKey": api_key},
                timeout=12,
            )
            if r.status_code != 200:
                return []
            tickers = (r.json() or {}).get("tickers") or []
            return [_normalize_snapshot_row(t) for t in tickers]
        except Exception as e:
            logger.warning("snapshot %s fetch failed: %s", direction, e)
            return []

    gainers = fetch("gainers")
    losers = fetch("losers")

    payload = {
        "gainers": gainers,
        "losers": losers,
        "session": status["session"],
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }
    with _cache_lock:
        _movers_cache["data"] = payload
        _movers_cache["ts"] = time.time()

    return {
        "gainers": gainers[:limit],
        "losers": losers[:limit],
        "session": status["session"],
        "from_cache": False,
        "as_of": payload["as_of"],
    }


# --- /api/movers/gap ---------------------------------------------------------

_WATCHLISTS_PATH = os.path.join(os.path.dirname(__file__), "data", "watchlists.json")


def _todays_bmo_symbols() -> set[str]:
    """Return symbols of companies reporting before market open today.

    We share the calendar router's cache by re-fetching through Finnhub for
    today's window only — cheaper than reading Massive Benzinga again. If
    Finnhub isn't configured, return empty set (the gap card just won't
    flag earnings overlap).
    """
    api_key = os.getenv("FINNHUB_API_KEY")
    if not api_key:
        return set()
    today = datetime.now().date().isoformat()
    try:
        r = httpx.get(
            "https://finnhub.io/api/v1/calendar/earnings",
            params={"from": today, "to": today, "token": api_key},
            timeout=8,
        )
        if r.status_code != 200:
            return set()
        arr = (r.json() or {}).get("earningsCalendar") or []
        return {
            (row.get("symbol") or "").upper()
            for row in arr
            if (row.get("hour") or "").lower() == "bmo" and row.get("symbol")
        }
    except Exception:
        return set()


@router.get("/gap")
def get_gap_movers(
    min_pct: float = Query(3.0, ge=0.5, le=50.0),
    min_volume: int = Query(50_000, ge=1_000),
    limit: int = Query(15, ge=1, le=50),
) -> dict:
    """Top gap-up names from the full US snapshot.

    Filters: |change_pct| >= min_pct AND day volume >= min_volume. Excludes
    tickers with non-letter prefixes (warrants, units). Earnings-this-morning
    names are flagged.
    """
    api_key = os.getenv("MASSIVE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="MASSIVE_API_KEY not configured")

    with _cache_lock:
        cached_valid = (
            _gap_cache["data"] is not None
            and (time.time() - _gap_cache["ts"]) < effective_cache_ttl(_GAP_TTL_SECONDS)
        )
        if cached_valid:
            cached = _gap_cache["data"]
            return {
                **cached,
                "gainers": [r for r in cached["gainers"] if abs(r["change_pct"] or 0) >= min_pct and (r["volume"] or 0) >= min_volume][:limit],
                "losers": [r for r in cached["losers"] if abs(r["change_pct"] or 0) >= min_pct and (r["volume"] or 0) >= min_volume][:limit],
                "from_cache": True,
            }

    status = _get_market_status(api_key)
    bmo_set = _todays_bmo_symbols()

    try:
        r = httpx.get(
            f"{_BASE}/v2/snapshot/locale/us/markets/stocks/tickers",
            params={"apiKey": api_key},
            timeout=25,
        )
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Massive snapshot HTTP {r.status_code}")
        tickers = (r.json() or {}).get("tickers") or []
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Massive snapshot error: {e}")

    rows: list[dict] = []
    for t in tickers:
        row = _normalize_snapshot_row(t)
        sym = row["symbol"]
        # Skip tickers with embedded dots (preferred / warrants / etc.) and
        # anything missing the essentials.
        if not sym or "." in sym or row["change_pct"] is None or row["volume"] is None:
            continue
        if row["volume"] < min_volume:
            continue
        if abs(row["change_pct"]) < min_pct:
            continue
        row["earnings_today_bmo"] = sym in bmo_set
        rows.append(row)

    rows.sort(key=lambda r: r["change_pct"] or 0, reverse=True)
    gainers = [r for r in rows if (r["change_pct"] or 0) > 0]
    losers = sorted([r for r in rows if (r["change_pct"] or 0) < 0], key=lambda r: r["change_pct"] or 0)

    payload = {
        "gainers": gainers,
        "losers": losers,
        "session": status["session"],
        "bmo_count": len(bmo_set),
        "thresholds": {"min_pct": min_pct, "min_volume": min_volume},
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }
    with _cache_lock:
        _gap_cache["data"] = payload
        _gap_cache["ts"] = time.time()

    return {
        **payload,
        "gainers": gainers[:limit],
        "losers": losers[:limit],
        "from_cache": False,
    }
