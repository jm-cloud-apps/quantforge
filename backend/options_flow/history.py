"""Historical premium baseline per underlying.

Persists a tiny JSON file per ticker that accumulates daily call/put premium
snapshots. Lets us compute a true "unusual" flag: today's premium as a
multiple of the rolling 20-day mean. Without this we can only say "this much
flow happened today" — not whether it's elevated for THIS name.

History is appended on each `/api/flow/{underlying}` call (server-side, in
get_flow). One row per (ticker, date). Reading is O(rows-in-file).
"""

from __future__ import annotations

import json
import logging
import os
import statistics
from datetime import date as _date
from pathlib import Path

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[1]
HISTORY_DIR = Path(os.getenv("QF_FLOW_HISTORY_DIR", str(BACKEND_DIR / "data" / "flow_history")))
HISTORY_DIR.mkdir(parents=True, exist_ok=True)

WINDOW_DAYS = 20


def _path(symbol: str) -> Path:
    return HISTORY_DIR / f"{symbol.upper()}.json"


def _load(symbol: str) -> list[dict]:
    p = _path(symbol)
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text()) or []
    except Exception as e:
        logger.debug("flow history load failed for %s: %s", symbol, e)
        return []


def _save(symbol: str, rows: list[dict]) -> None:
    try:
        _path(symbol).write_text(json.dumps(rows))
    except Exception as e:
        logger.debug("flow history save failed for %s: %s", symbol, e)


def record_snapshot(symbol: str, call_premium: float, put_premium: float) -> None:
    """Append today's snapshot if not already recorded for today."""
    today = _date.today().isoformat()
    rows = _load(symbol)
    # Idempotent — if today is already saved, replace it (later in the day the
    # numbers can grow as more trading happens).
    rows = [r for r in rows if r.get("date") != today]
    rows.append({
        "date": today,
        "call_premium": float(call_premium or 0),
        "put_premium": float(put_premium or 0),
        "total_premium": float((call_premium or 0) + (put_premium or 0)),
    })
    # Cap history at 60 entries — 3 months of trading days.
    rows = sorted(rows, key=lambda r: r["date"])[-60:]
    _save(symbol, rows)


def baseline(symbol: str, exclude_today: bool = True) -> dict:
    """Compute the rolling baseline. Returns:
      {
        "sample_days": int,                # how many days we have to average
        "avg_total_premium": float,        # mean total premium across window
        "median_total_premium": float,
        "history": [{date, call_premium, put_premium, total_premium}, ...],
      }
    """
    rows = _load(symbol)
    today = _date.today().isoformat()
    sample = [r for r in rows if not (exclude_today and r.get("date") == today)]
    sample = sample[-WINDOW_DAYS:]
    if not sample:
        return {
            "sample_days": 0,
            "avg_total_premium": None,
            "median_total_premium": None,
            "history": [],
        }
    totals = [r["total_premium"] for r in sample if r.get("total_premium") is not None]
    return {
        "sample_days": len(sample),
        "avg_total_premium": round(statistics.fmean(totals), 0) if totals else None,
        "median_total_premium": round(statistics.median(totals), 0) if totals else None,
        "history": sample,
    }
