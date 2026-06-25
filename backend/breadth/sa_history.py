"""Persistent daily ledger for Situational Awareness reads.

The breadth grouped-daily cache is a rolling window (it can be pruned), so to
keep a durable ~1-year history of the SA score/stance we append one compact
record per trading day here, keyed by date. The ledger is:

  * seeded/backfilled from whatever the breadth cache can currently compute
    (every day with enough history for the quarterly metric), and
  * extended forward each day the snapshot endpoint runs.

It also provides the statistical context a quant wants on top of the raw score
— percentile rank vs the trailing year, days in the current regime, and the
score distribution over the window.

Records are written by `breadth.situational.compact_record()` so the stored
shape stays in lockstep with the live read.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

# data/breadth/sa_history.json (sibling of the grouped cache + universe file)
_DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "breadth"
_HISTORY_PATH = _DATA_DIR / "sa_history.json"

# Keep a generous tail so >2y of context survives even though the API defaults
# to a 1-year lookback. Bounded so the file can't grow without limit.
_RETENTION = 800

_LOCK = threading.Lock()


def _load_raw() -> dict:
    if not _HISTORY_PATH.exists():
        return {}
    try:
        data = json.loads(_HISTORY_PATH.read_text())
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_raw(data: dict) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _HISTORY_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")))
    tmp.replace(_HISTORY_PATH)  # atomic on POSIX


def upsert(records: list[dict]) -> int:
    """Insert/overwrite records keyed by their `date`. Returns rows stored.

    Idempotent: re-recording the same trading day just refreshes that key, so
    hitting the endpoint repeatedly in a session is harmless.
    """
    clean = [r for r in records if r.get("date")]
    if not clean:
        return len(_load_raw())
    with _LOCK:
        data = _load_raw()
        for r in clean:
            data[r["date"]] = r
        if len(data) > _RETENTION:
            for stale in sorted(data.keys())[:-_RETENTION]:
                del data[stale]
        _save_raw(data)
        return len(data)


def load(days: int | None = 365) -> list[dict]:
    """Return ledger records oldest→newest, trimmed to the last `days` rows."""
    data = _load_raw()
    rows = [data[k] for k in sorted(data.keys())]
    if days:
        rows = rows[-days:]
    return rows


def stats(ledger: list[dict], today_score: int | None, today_level: str | None,
          window: int = 252) -> dict:
    """Statistical context for the live read against the recent ledger.

    `ledger` should already include today's record. `window` ~252 trading days
    ≈ one year for the percentile/distribution context.
    """
    recent = ledger[-window:] if window else ledger
    scores = [r["score"] for r in recent if r.get("score") is not None]

    out: dict = {"window": len(scores), "history_len": len(ledger)}

    if today_score is not None and scores:
        at_or_below = sum(1 for s in scores if s <= today_score)
        ordered = sorted(scores)
        out["percentile"] = round(100 * at_or_below / len(scores))
        out["median"] = ordered[len(ordered) // 2]
        out["min"] = ordered[0]
        out["max"] = ordered[-1]

    # Consecutive sessions (including today) at the current stance level.
    streak = 0
    if today_level:
        for r in reversed(ledger):
            if r.get("level") == today_level:
                streak += 1
            else:
                break
    out["days_in_regime"] = streak

    return out
