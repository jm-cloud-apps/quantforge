"""365-day suggestion ledger for AI Trader.

One entry per calendar day (the first generation of the day wins, so the
recorded "suggested price" is fixed at the moment of suggestion). The history
endpoint re-prices each ticker against the latest close so you can see how each
idea has performed since it was suggested.
"""

import json
import logging
import os
import threading
from datetime import datetime

logger = logging.getLogger(__name__)

_HISTORY_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "ai_trader_history.json")
_MAX_DAYS = 365
_LOCK = threading.Lock()


def _load() -> list:
    try:
        with open(_HISTORY_FILE) as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _save(records: list) -> None:
    os.makedirs(os.path.dirname(_HISTORY_FILE), exist_ok=True)
    tmp = _HISTORY_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(records, f, indent=2)
    os.replace(tmp, _HISTORY_FILE)


def record_today(result: dict) -> None:
    """Write one ledger entry for today if ideas were produced and we haven't
    already recorded today. Captures each idea's price at suggestion time."""
    ideas = result.get("ideas") or []
    if not ideas:
        return
    today = datetime.now().strftime("%Y-%m-%d")
    with _LOCK:
        records = _load()
        if any(r.get("date") == today for r in records):
            return  # already logged today — keep the original suggested prices
        entry = {
            "date": today,
            "as_of": result.get("as_of"),
            "ai_available": bool(result.get("ai_available")),
            "ideas": [
                {
                    "ticker": i.get("ticker"),
                    "setup": i.get("setup"),
                    "conviction": i.get("conviction"),
                    # price at the moment it was suggested (fall back to entry)
                    "suggested_price": (i.get("stats") or {}).get("price") or i.get("entry"),
                    "entry": i.get("entry"),
                    "stop": i.get("stop"),
                    "target": i.get("target"),
                }
                for i in ideas
            ],
        }
        records.insert(0, entry)  # newest first
        _save(records[:_MAX_DAYS])


def load_history_priced() -> list:
    """Return the ledger, newest first, with each idea re-priced to the latest
    close (current_price) and the % change since it was suggested."""
    records = _load()
    if not records:
        return []

    tickers = sorted({
        i["ticker"] for r in records for i in r.get("ideas", []) if i.get("ticker")
    })
    prices = _current_prices(tickers)

    out = []
    for r in records:
        ideas = []
        for i in r.get("ideas", []):
            cur = prices.get(i.get("ticker"))
            sp = i.get("suggested_price")
            change = round((cur / sp - 1) * 100, 1) if (cur and sp) else None
            ideas.append({**i, "current_price": cur, "change_pct": change})
        # per-day average performance across its ideas
        changes = [x["change_pct"] for x in ideas if x["change_pct"] is not None]
        avg = round(sum(changes) / len(changes), 1) if changes else None
        out.append({**r, "ideas": ideas, "avg_change_pct": avg})
    return out


def _current_prices(tickers: list[str]) -> dict:
    """Latest close per ticker via the screener's cached OHLCV. Best-effort."""
    if not tickers:
        return {}
    try:
        from screener.qullamaggie.cache import refresh_universe
        frames = refresh_universe(tickers)
    except Exception as e:
        logger.warning("history re-pricing failed: %s", e)
        return {}
    prices = {}
    for t, df in (frames or {}).items():
        try:
            if df is not None and len(df):
                prices[t] = round(float(df["close"].iloc[-1]), 2)
        except Exception:
            continue
    return prices
