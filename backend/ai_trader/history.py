"""365-day suggestion ledger + realized track record for AI Trader.

One entry per calendar day (the first generation of the day wins, so the
recorded "suggested price" is fixed at the moment of suggestion). The history
endpoint then does two things a quant cares about:

1. **Re-prices** each idea against the latest close (raw % change since suggested).
2. **Replays the OHLC path** from the day after suggestion to classify the actual
   outcome — did price trigger the entry, then hit the target or the stop first —
   and scores it in **R-multiples** (target = +planned R, stop = -1R). Aggregated
   across the ledger this yields hit rate, avg win/loss, expectancy and profit
   factor, plus an SPY benchmark so we measure *alpha*, not just direction.
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
_BENCHMARK = "SPY"


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
            "regime": (result.get("regime") or {}).get("level"),
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


# ── outcome replay ───────────────────────────────────────────────────────────
def _planned_r(entry, stop, target) -> float | None:
    """Reward:risk of the plan in R units (target distance / stop distance)."""
    if entry and stop and target and entry > stop and target > entry:
        return round((target - entry) / (entry - stop), 2)
    return None


def _evaluate(df, idea: dict, suggested_on: str) -> dict:
    """Replay the trade plan over bars AFTER the suggestion date.

    Models the Qullamaggie plan: the entry is a *stop-buy* at `entry`; it only
    becomes a live trade once a bar trades up through it. From there, whichever
    of stop/target the price reaches first decides the outcome (ties within a
    single bar resolve to the stop — the conservative assumption). Returns
    current_price, raw change_pct, outcome, and r_multiple (realized or, while
    open, marked-to-market)."""
    entry, stop, target = idea.get("entry"), idea.get("stop"), idea.get("target")
    sp = idea.get("suggested_price")
    planned_r = _planned_r(entry, stop, target)

    cur = None
    try:
        if df is not None and len(df):
            cur = round(float(df["close"].iloc[-1]), 2)
    except Exception:
        cur = None
    change = round((cur / sp - 1) * 100, 1) if (cur and sp) else None

    base = {"current_price": cur, "change_pct": change,
            "planned_r": planned_r, "outcome": "open", "r_multiple": None,
            "realized": False, "triggered": False}

    # Need a stop and a forward path to score R; otherwise just report the move.
    if df is None or not len(df) or not (entry and stop and entry > stop):
        return {**base, "outcome": "untracked"}

    try:
        fwd = df[df.index > suggested_on]
    except Exception:
        fwd = None
    if fwd is None or not len(fwd):
        return base  # suggested today / no forward bars yet → still open, untriggered

    risk = entry - stop
    triggered = False
    for _, bar in fwd.iterrows():
        hi, lo = float(bar["high"]), float(bar["low"])
        if not triggered:
            if hi >= entry:
                triggered = True   # entry filled this bar; evaluate stop/target same bar
            else:
                continue
        hit_stop = lo <= stop
        hit_target = bool(target) and hi >= target
        if hit_stop:               # conservative: stop checked first on ties
            return {**base, "triggered": True, "outcome": "stop",
                    "r_multiple": -1.0, "realized": True}
        if hit_target:
            return {**base, "triggered": True, "outcome": "target",
                    "r_multiple": planned_r, "realized": True}

    if not triggered:
        return {**base, "outcome": "no_entry"}
    # Open trade: mark to market in R from the entry.
    open_r = round((cur - entry) / risk, 2) if cur else None
    return {**base, "triggered": True, "outcome": "open", "r_multiple": open_r}


def _expectancy(evaluated: list[dict]) -> dict:
    """Aggregate realized R-multiples into the headline track-record stats."""
    realized = [e for e in evaluated if e.get("realized")]
    wins = [e for e in realized if e["r_multiple"] is not None and e["r_multiple"] > 0]
    losses = [e for e in realized if e["r_multiple"] is not None and e["r_multiple"] <= 0]
    n = len(realized)
    open_n = sum(1 for e in evaluated if e.get("outcome") == "open" and e.get("triggered"))
    no_entry = sum(1 for e in evaluated if e.get("outcome") == "no_entry")

    win_r = sum(e["r_multiple"] for e in wins)
    loss_r = sum(e["r_multiple"] for e in losses)  # negative
    gross_loss = abs(loss_r)

    def avg(xs):
        return round(sum(x["r_multiple"] for x in xs) / len(xs), 2) if xs else None

    return {
        "resolved": n,
        "wins": len(wins),
        "losses": len(losses),
        "open": open_n,
        "no_entry": no_entry,
        "hit_rate_pct": round(len(wins) / n * 100, 1) if n else None,
        "avg_win_r": avg(wins),
        "avg_loss_r": avg(losses),
        "expectancy_r": round((win_r + loss_r) / n, 2) if n else None,
        # None when undefined (no losses yet); `all_wins` flags a clean record so
        # the UI can show ∞ without emitting a non-finite float.
        "profit_factor": round(win_r / gross_loss, 2) if gross_loss > 0 else None,
        "all_wins": bool(wins) and gross_loss == 0,
        "total_r": round(win_r + loss_r, 2) if n else None,
    }


def load_history_priced() -> dict:
    """Return {records, stats}.

    `records` is the ledger (newest first) with every idea re-priced and scored
    (outcome + R-multiple), plus a per-day benchmark and alpha. `stats` is the
    aggregate expectancy/track-record block across the whole ledger."""
    records = _load()
    if not records:
        return {"records": [], "stats": _expectancy([])}

    tickers = sorted({
        i["ticker"] for r in records for i in r.get("ideas", []) if i.get("ticker")
    })
    frames = _frames(tickers + [_BENCHMARK])
    bench = frames.get(_BENCHMARK)

    out = []
    all_evaluated = []
    for r in records:
        suggested_on = r.get("date")
        ideas = []
        for i in r.get("ideas", []):
            ev = _evaluate(frames.get(i.get("ticker")), i, suggested_on)
            ideas.append({**i, **ev})
            all_evaluated.append(ev)
        changes = [x["change_pct"] for x in ideas if x.get("change_pct") is not None]
        avg = round(sum(changes) / len(changes), 1) if changes else None
        bench_change = _benchmark_change(bench, suggested_on)
        out.append({
            **r, "ideas": ideas, "avg_change_pct": avg,
            "benchmark_change_pct": bench_change,
            "alpha_pct": round(avg - bench_change, 1) if (avg is not None and bench_change is not None) else None,
            "stats": _expectancy([x for x in ideas]),
        })

    return {"records": out, "stats": _expectancy(all_evaluated)}


def _benchmark_change(df, suggested_on: str) -> float | None:
    """SPY % change from the close on/just before the suggestion date to latest."""
    if df is None or not len(df):
        return None
    try:
        prior = df[df.index <= suggested_on]
        base = float(prior["close"].iloc[-1]) if len(prior) else float(df["close"].iloc[0])
        cur = float(df["close"].iloc[-1])
        return round((cur / base - 1) * 100, 1) if base else None
    except Exception:
        return None


def _frames(tickers: list[str]) -> dict:
    """Full cached OHLCV frames per ticker (for re-pricing + path replay)."""
    if not tickers:
        return {}
    try:
        from screener.qullamaggie.cache import refresh_universe
        return refresh_universe(tickers) or {}
    except Exception as e:
        logger.warning("history re-pricing failed: %s", e)
        return {}
