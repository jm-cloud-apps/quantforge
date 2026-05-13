"""Daily snapshot storage for the breakout screener.

SQLite at backend/data/screener_snapshots.db. Every screener run can persist
its top candidates so we can:
  - Track which names appeared as DEVELOPING / READY across days
  - Show a "last 30 developing setups" feed in the UI
  - Eventually backtest the screener's hit rate (did READY actually break out?)
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from datetime import datetime, date
from pathlib import Path

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]
DB_PATH = Path(os.getenv("QF_SCREENER_DB", str(BACKEND_DIR / "data" / "screener_snapshots.db")))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

SCHEMA = """
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date TEXT NOT NULL,         -- YYYY-MM-DD
    snapshot_ts TEXT NOT NULL,           -- ISO timestamp
    mode TEXT NOT NULL,                  -- breakout | leaders | emerging
    symbol TEXT NOT NULL,
    status TEXT NOT NULL,
    score REAL NOT NULL,
    payload TEXT NOT NULL                -- full candidate JSON
);
CREATE INDEX IF NOT EXISTS idx_snapshots_date ON snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_symbol ON snapshots(symbol);
CREATE INDEX IF NOT EXISTS idx_snapshots_status ON snapshots(status);
CREATE INDEX IF NOT EXISTS idx_snapshots_date_mode ON snapshots(snapshot_date, mode);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def save_snapshot(mode: str, candidates: list[dict]) -> int:
    """Persist a screener run. If we already saved for this date+mode, replace
    that day's rows (one canonical snapshot per trading day per mode)."""
    if not candidates:
        return 0
    today = date.today().isoformat()
    now = datetime.now().isoformat(timespec="seconds")
    with _connect() as conn:
        conn.execute(
            "DELETE FROM snapshots WHERE snapshot_date = ? AND mode = ?",
            (today, mode),
        )
        conn.executemany(
            """INSERT INTO snapshots
               (snapshot_date, snapshot_ts, mode, symbol, status, score, payload)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [
                (today, now, mode, c["symbol"], c["status"], c["score"], json.dumps(c))
                for c in candidates
            ],
        )
        conn.commit()
    logger.info("Saved %d candidates to snapshot %s/%s", len(candidates), today, mode)
    return len(candidates)


def recent_developing(days: int = 30, status_filter: tuple[str, ...] = ("DEVELOPING", "GOOD", "READY")) -> list[dict]:
    """Return the most recent rows for DEVELOPING+ candidates, distinct by symbol.

    For each symbol, keep the most recent snapshot. Returns the candidate
    payload plus a `last_seen_date` field. Limited to `days` lookback.
    """
    placeholders = ",".join("?" for _ in status_filter)
    sql = f"""
        SELECT symbol, MAX(snapshot_date) AS last_seen_date, status, score, payload
        FROM snapshots
        WHERE status IN ({placeholders})
          AND snapshot_date >= date('now', '-' || ? || ' days')
        GROUP BY symbol
        ORDER BY last_seen_date DESC, score DESC
        LIMIT 30
    """
    with _connect() as conn:
        rows = conn.execute(sql, (*status_filter, days)).fetchall()
    out = []
    for r in rows:
        payload = json.loads(r["payload"])
        payload["last_seen_date"] = r["last_seen_date"]
        out.append(payload)
    return out


def symbol_history(symbol: str, days: int = 60) -> list[dict]:
    sql = """
        SELECT snapshot_date, snapshot_ts, mode, status, score
        FROM snapshots
        WHERE symbol = ?
          AND snapshot_date >= date('now', '-' || ? || ' days')
        ORDER BY snapshot_date DESC, snapshot_ts DESC
    """
    with _connect() as conn:
        rows = conn.execute(sql, (symbol.upper(), days)).fetchall()
    return [dict(r) for r in rows]


def snapshot_stats() -> dict:
    with _connect() as conn:
        total = conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]
        dates = conn.execute("SELECT COUNT(DISTINCT snapshot_date) FROM snapshots").fetchone()[0]
        last = conn.execute("SELECT MAX(snapshot_date) FROM snapshots").fetchone()[0]
    return {"rows": total, "distinct_days": dates, "last_snapshot": last}
