"""Grouped-daily OHLCV cache for the breadth scanner.

We use Polygon/Massive's `/v2/aggs/grouped/locale/us/market/stocks/{date}`
endpoint which returns the full day's OHLCV for *every* US stock in a single
HTTP call. For breadth math this is the killer endpoint — refreshing 3000+
symbols costs one API call per missing trading day, not per ticker.

Each day's payload is persisted as a parquet-style pickle at
`data/breadth/grouped/YYYY-MM-DD.pkl`. The calculator loads N days from this
cache and pivots into per-symbol series at compute time.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx
import pandas as pd

logger = logging.getLogger(__name__)

BASE_URL = "https://api.massive.com"
ENDPOINT = "/v2/aggs/grouped/locale/us/market/stocks/{date}"

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("QF_BREADTH_DATA_DIR", str(BACKEND_DIR / "data" / "breadth")))
GROUPED_DIR = DATA_DIR / "grouped"
GROUPED_DIR.mkdir(parents=True, exist_ok=True)

# Approx ~6 calendar months of trading days. Covers SMA40 (40d), quarterly
# 25%-mover comparisons (~63 trading days), and the 10-day breadth ratio
# with comfortable headroom for missing-data days.
DEFAULT_LOOKBACK_DAYS = 130


def _path_for(d: date) -> Path:
    return GROUPED_DIR / f"{d.isoformat()}.pkl"


def list_cached_days() -> list[date]:
    """Return cached trading days (file mtime ignored), oldest first."""
    out: list[date] = []
    for p in GROUPED_DIR.glob("*.pkl"):
        try:
            out.append(date.fromisoformat(p.stem))
        except ValueError:
            continue
    return sorted(out)


def load_cached_day(d: date) -> pd.DataFrame | None:
    p = _path_for(d)
    if not p.exists():
        return None
    try:
        return pd.read_pickle(p)
    except Exception as e:
        logger.warning("breadth: failed reading cached day %s: %s", d, e)
        return None


def load_cached_window(start: date, end: date) -> dict[date, pd.DataFrame]:
    """Load every cached day within [start, end] inclusive."""
    out: dict[date, pd.DataFrame] = {}
    for d in list_cached_days():
        if d < start or d > end:
            continue
        df = load_cached_day(d)
        if df is not None and not df.empty:
            out[d] = df
    return out


def _save_day(d: date, df: pd.DataFrame) -> None:
    if df is None or df.empty:
        return
    tmp = _path_for(d).with_suffix(".pkl.tmp")
    df.to_pickle(tmp)
    tmp.replace(_path_for(d))


def _previous_business_day(d: date) -> date:
    """Walk back to the most recent Mon-Fri. We don't have an exchange
    calendar here so US market holidays land on the closest weekday; the
    grouped-daily endpoint will simply return an empty payload for those
    and we'll record a sentinel-empty file so we don't re-fetch them.
    """
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _latest_target_day(today: date | None = None) -> date:
    """Most-recent trading day to attempt. Before US market close we still
    try today — Polygon returns the EOD bar once data is available; on a
    pre-market request we'll get an empty payload and tag the file accordingly
    so we'll retry it on the next refresh."""
    today = today or datetime.now().date()
    return _previous_business_day(today)


def _fetch_one_day(client: httpx.Client, d: date, api_key: str) -> pd.DataFrame | None:
    """One HTTP call → DataFrame indexed by ticker with columns:
    open, high, low, close, volume. Returns None on transport failure;
    returns an empty DataFrame for market-closed days (so callers can
    record the empty file and stop retrying)."""
    url = BASE_URL + ENDPOINT.format(date=d.isoformat())
    params = {"adjusted": "true", "apiKey": api_key}

    for attempt in range(1, 4):
        try:
            r = client.get(url, params=params)
        except httpx.RequestError as e:
            logger.warning("breadth: transport error on %s (attempt %d): %s", d, attempt, e)
            time.sleep(0.5 * attempt)
            continue

        if r.status_code == 429:
            logger.warning("breadth: 429 on %s, backing off", d)
            time.sleep(1.5 * attempt)
            continue
        if r.status_code != 200:
            logger.debug("breadth: HTTP %d on %s — %s", r.status_code, d, r.text[:200])
            return None

        data = r.json() or {}
        # status=OK with empty results is the holiday/closed case.
        if data.get("status") not in ("OK", "DELAYED"):
            logger.debug("breadth: non-OK status %s on %s", data.get("status"), d)
            return None

        results = data.get("results") or []
        if not results:
            # Return an empty frame so the caller persists a sentinel.
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

        rows = [
            {
                "ticker": (row.get("T") or "").upper(),
                "open": row.get("o"),
                "high": row.get("h"),
                "low": row.get("l"),
                "close": row.get("c"),
                "volume": row.get("v"),
            }
            for row in results
            if row.get("T")
        ]
        df = pd.DataFrame(rows).set_index("ticker")
        df = df[~df.index.duplicated(keep="last")].sort_index()
        return df
    return None


def refresh_grouped_cache(
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    target_day: date | None = None,
    api_key: str | None = None,
    timeout: float = 30.0,
) -> dict:
    """Fill in any missing grouped-daily payloads up through `target_day`.

    Returns a summary {fetched, skipped, empty, failed, days_total, latest_day}.
    Each day costs one API call. Cached days are skipped. Holiday/closed
    days persist as an empty DataFrame so they aren't retried.
    """
    key = api_key or os.getenv("MASSIVE_API_KEY")
    if not key:
        raise RuntimeError(
            "MASSIVE_API_KEY is not set — required to refresh the breadth cache."
        )

    end = _latest_target_day(target_day)
    # Walk back lookback_days *calendar* days; weekends are filtered when we
    # iterate. Trading days ≈ calendar * 5/7, so a 130-cal window gives ~93
    # trading days, comfortable for SMA40 + quarterly comparisons.
    start = end - timedelta(days=lookback_days)

    fetched = skipped = empty = failed = 0
    cached = {d for d in list_cached_days()}
    days_in_window: list[date] = []

    cursor = start
    while cursor <= end:
        if cursor.weekday() < 5:  # Mon-Fri only
            days_in_window.append(cursor)
        cursor += timedelta(days=1)

    with httpx.Client(timeout=timeout) as client:
        for d in days_in_window:
            if d in cached:
                skipped += 1
                continue
            df = _fetch_one_day(client, d, key)
            if df is None:
                failed += 1
                continue
            if df.empty:
                # Persist sentinel so we don't retry holidays forever.
                _save_day(d, df)
                empty += 1
                continue
            _save_day(d, df)
            fetched += 1

    summary = {
        "fetched": fetched,
        "skipped": skipped,
        "empty": empty,
        "failed": failed,
        "days_total": len(days_in_window),
        "latest_day": end.isoformat(),
        "window_start": start.isoformat(),
    }
    logger.info("breadth: grouped cache refresh %s", summary)
    return summary
