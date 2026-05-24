"""Universe loader for the market-breadth scanner.

Pulls the active US common-stock list from Polygon/Massive's
`/v3/reference/tickers` endpoint and caches it locally so the breadth
calculator can quickly know which symbols are eligible.

We only want primary-listed common stocks on the big three US venues
(NYSE / NASDAQ / NYSE Arca). Filtering out ETFs, ADRs, warrants, units,
preferred shares, and OTC names is what makes the breadth readings line
up with Stockbee's published thresholds — those rules assume the broad
US common-stock universe, not the union of every tradable symbol.
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timedelta
from pathlib import Path

import httpx
from urllib.parse import urlparse, parse_qs

logger = logging.getLogger(__name__)


def _extract_cursor(next_url: str) -> str | None:
    """Pull the `cursor` query param out of Polygon's next_url.

    next_url looks like:
      https://api.massive.com/v3/reference/tickers?cursor=YXBwbGUtZ...&...
    """
    try:
        qs = parse_qs(urlparse(next_url).query)
        vals = qs.get("cursor") or []
        return vals[0] if vals else None
    except Exception:
        return None

BASE_URL = "https://api.massive.com"
ENDPOINT = "/v3/reference/tickers"

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("QF_BREADTH_DATA_DIR", str(BACKEND_DIR / "data" / "breadth")))
DATA_DIR.mkdir(parents=True, exist_ok=True)
UNIVERSE_PATH = DATA_DIR / "universe.json"

# Primary exchanges we want. Polygon/Massive returns MIC codes:
#   XNYS = NYSE, XNAS = NASDAQ, ARCX = NYSE Arca, BATS = Cboe BZX, IEXG = IEX
# We include the big three for now; expand later if you want Cboe-listed names.
ALLOWED_EXCHANGES = {"XNYS", "XNAS", "ARCX"}

# Default TTL — refresh the universe at most once per day. Listings come and
# go but the population doesn't churn fast enough to need more.
DEFAULT_TTL_HOURS = 24.0


def _is_fresh(path: Path, ttl_hours: float) -> bool:
    if not path.exists():
        return False
    age_h = (datetime.now().timestamp() - path.stat().st_mtime) / 3600
    return age_h < ttl_hours


def load_universe(ttl_hours: float = DEFAULT_TTL_HOURS) -> dict:
    """Read-only: return the cached universe payload, or an empty stub if
    none has been built yet.

    `ttl_hours` is informational — staleness is reported to the caller but
    we never block this call on a network refresh. That's the refresh
    endpoint's job. Keeps GET routes O(disk-read).
    """
    if UNIVERSE_PATH.exists():
        try:
            with open(UNIVERSE_PATH, "r") as f:
                payload = json.load(f)
            payload["fresh"] = _is_fresh(UNIVERSE_PATH, ttl_hours)
            return payload
        except Exception as e:
            logger.warning("breadth: cached universe unreadable (%s)", e)
    return {
        "as_of": None,
        "count": 0,
        "symbols": [],
        "fresh": False,
        "filtered": {},
    }


def load_or_refresh_universe(ttl_hours: float = DEFAULT_TTL_HOURS) -> dict:
    """Caller wants a guaranteed-populated universe. Refreshes if missing
    or stale. Only safe inside the refresh endpoint (or CLI tools)."""
    payload = load_universe(ttl_hours)
    if payload.get("symbols") and payload.get("fresh"):
        return payload
    return refresh_universe()


def refresh_universe(
    api_key: str | None = None,
    timeout: float = 60.0,
    max_retries: int = 4,
) -> dict:
    """Force a fresh pull from /v3/reference/tickers, persist, and return.

    Walks Polygon's paginated cursor until exhausted. Typically returns
    3000–5000 active US common stocks across NYSE / NASDAQ / NYSE Arca.

    Pages that time out or hit transient errors are retried with exponential
    backoff (up to `max_retries` per page) so a single slow page doesn't
    discard everything fetched so far. If a page still fails after all
    retries we raise — partial-universe persistence isn't safe because the
    breadth math compares row-by-row and would silently drop legitimate
    symbols.
    """
    key = api_key or os.getenv("MASSIVE_API_KEY")
    if not key:
        raise RuntimeError(
            "MASSIVE_API_KEY is not set — required to refresh the breadth universe."
        )

    symbols: list[str] = []
    seen: set[str] = set()

    # Always pass the full filter set on every request. Polygon's `next_url`
    # is unreliable about preserving the original query filters — without
    # this we've observed the cursor walk degrade into thousands of tiny
    # empty pages. We extract just the cursor from next_url and re-issue.
    base_params: dict = {
        "market": "stocks",
        "type": "CS",            # common stock
        "active": "true",
        "limit": 1000,
        "apiKey": key,
    }
    cursor: str | None = None
    url = BASE_URL + ENDPOINT

    # Safety caps so a runaway cursor can't blast the API.
    MAX_PAGES = 50               # ~5000 CS at 1000/page leaves plenty of margin
    MAX_EMPTY_STREAK = 2         # bail if 2 consecutive pages yield 0 new symbols

    page = 0
    empty_streak = 0
    with httpx.Client(timeout=timeout) as client:
        while page < MAX_PAGES:
            page += 1
            params = dict(base_params)
            if cursor:
                params["cursor"] = cursor

            r = None
            last_err: Exception | None = None
            for attempt in range(1, max_retries + 1):
                try:
                    r = client.get(url, params=params)
                    if r.status_code == 429:
                        delay = 1.5 * attempt
                        logger.warning(
                            "breadth: 429 on universe page %d (attempt %d), sleeping %.1fs",
                            page, attempt, delay,
                        )
                        time.sleep(delay)
                        r = None
                        continue
                    break  # got a non-429 response — fall through to status check
                except (httpx.TimeoutException, httpx.TransportError) as e:
                    last_err = e
                    delay = 2.0 * attempt
                    logger.warning(
                        "breadth: %s on universe page %d (attempt %d/%d), retrying in %.1fs",
                        type(e).__name__, page, attempt, max_retries, delay,
                    )
                    time.sleep(delay)

            if r is None:
                raise RuntimeError(
                    f"breadth universe fetch failed on page {page} after {max_retries} attempts: {last_err}"
                )
            if r.status_code != 200:
                raise RuntimeError(
                    f"breadth universe HTTP {r.status_code} on page {page}: {r.text[:200]}"
                )

            data = r.json() or {}
            results = data.get("results") or []
            page_kept = 0
            for row in results:
                exch = (row.get("primary_exchange") or "").upper()
                if exch not in ALLOWED_EXCHANGES:
                    continue
                sym = (row.get("ticker") or "").upper()
                if not sym or sym in seen:
                    continue
                seen.add(sym)
                symbols.append(sym)
                page_kept += 1
            logger.info(
                "breadth: universe page %d returned %d rows, kept %d (total %d)",
                page, len(results), page_kept, len(symbols),
            )

            if page_kept == 0:
                empty_streak += 1
                if empty_streak >= MAX_EMPTY_STREAK:
                    logger.info("breadth: stopping universe walk after %d empty pages", empty_streak)
                    break
            else:
                empty_streak = 0

            # Extract the cursor from next_url and feed it into the next loop
            # iteration. We never re-use next_url itself because Polygon
            # sometimes returns it with truncated filters.
            nxt = data.get("next_url")
            if not nxt:
                break
            cursor = _extract_cursor(nxt)
            if not cursor:
                logger.warning("breadth: next_url present but cursor missing — stopping")
                break

        if page >= MAX_PAGES:
            logger.warning("breadth: hit MAX_PAGES=%d safety cap with %d symbols", MAX_PAGES, len(symbols))

    symbols.sort()
    payload = {
        "as_of": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "count": len(symbols),
        "symbols": symbols,
        "filtered": {
            "market": "stocks",
            "type": "CS",
            "active": True,
            "exchanges": sorted(ALLOWED_EXCHANGES),
        },
    }

    tmp = UNIVERSE_PATH.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(payload, f, indent=2)
    tmp.replace(UNIVERSE_PATH)

    logger.info("breadth: universe refreshed — %d symbols across %d pages", len(symbols), page)
    return payload
