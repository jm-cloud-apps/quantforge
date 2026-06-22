"""Persistent ledger of single-date backtests the user has inspected.

Mirrors the live Suggestion history: each inspected as-of date is saved once,
then re-priced to the latest close on read so you can see how that date's
rule-based picks have performed since — the % gain from the price back on the
backtest date to today. Reuses the live ledger's OHLC path-replay so outcomes
and R-multiples are scored identically.
"""

import json
import logging
import os
import threading
from datetime import datetime

from . import history

logger = logging.getLogger(__name__)

_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "ai_trader_backtest_history.json")
_MAX = 365
_LOCK = threading.Lock()


def _load() -> list:
    try:
        with open(_FILE) as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _save(records: list) -> None:
    os.makedirs(os.path.dirname(_FILE), exist_ok=True)
    tmp = _FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(records, f, indent=2)
    os.replace(tmp, _FILE)


def record_backtest(result: dict) -> None:
    """Persist one entry per inspected as-of date (latest run for that date wins).
    Freezes each pick's price as of the backtest date; performance is computed on
    read against the latest close."""
    ideas = result.get("ideas") or []
    as_of = result.get("as_of")
    if not ideas or not as_of:
        return
    with _LOCK:
        records = [r for r in _load() if r.get("date") != as_of]
        records.append({
            "date": as_of,
            "recorded_at": datetime.now().isoformat(timespec="seconds"),
            "regime": (result.get("regime") or {}).get("level"),
            "ideas": [
                {
                    "ticker": i.get("ticker"),
                    "setup": i.get("setup"),
                    "conviction": i.get("conviction"),
                    # price on the backtest date (the "back then" price)
                    "suggested_price": i.get("suggested_price")
                    or (i.get("stats") or {}).get("price") or i.get("entry"),
                    "entry": i.get("entry"), "stop": i.get("stop"), "target": i.get("target"),
                }
                for i in ideas
            ],
        })
        records.sort(key=lambda r: r.get("date", ""), reverse=True)  # newest date first
        _save(records[:_MAX])


def load_backtest_history() -> dict:
    """Return {records, stats}: each saved backtest date re-priced to the latest
    close (% gain to today + outcome/R), newest first, with aggregate expectancy.
    Shape matches the live ledger so the same UI renders both."""
    records = _load()
    if not records:
        return {"records": [], "stats": history._expectancy([])}

    tickers = sorted({
        i["ticker"] for r in records for i in r.get("ideas", []) if i.get("ticker")
    })
    frames = history._frames(tickers + [history._BENCHMARK])
    bench = frames.get(history._BENCHMARK)

    out, all_evaluated = [], []
    for r in records:
        as_of = r.get("date")
        ideas = []
        for i in r.get("ideas", []):
            ev = history._evaluate(frames.get(i.get("ticker")), i, as_of)
            ideas.append({**i, **ev})
            all_evaluated.append(ev)
        changes = [x["change_pct"] for x in ideas if x.get("change_pct") is not None]
        avg = round(sum(changes) / len(changes), 1) if changes else None
        bench_change = history._benchmark_change(bench, as_of)
        out.append({
            **r, "ideas": ideas, "avg_change_pct": avg,
            "benchmark_change_pct": bench_change,
            "alpha_pct": round(avg - bench_change, 1) if (avg is not None and bench_change is not None) else None,
            "stats": history._expectancy(ideas),
        })
    return {"records": out, "stats": history._expectancy(all_evaluated)}
