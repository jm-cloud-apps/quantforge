"""365-day suggestion ledger + realized track record for AI Trader.

One entry per calendar day (the first generation of the day wins, so the
recorded "suggested price" is fixed at the moment of suggestion). The history
endpoint then does two things a quant cares about:

1. **Re-prices** each idea against the latest close (raw % change since suggested).
2. **Replays the OHLC path** from the day after suggestion via the shared exit
   simulator (scale-out + MA trail, see exit_model) to score each idea in
   **R-multiples** — winners run to their real R, losers cap near -1R. Aggregated
   across the ledger this yields hit rate, avg win/loss, expectancy, profit
   factor, system quality (R Sharpe), MFE/MAE and an SPY benchmark.
"""

import json
import logging
import os
import statistics
import threading
from datetime import datetime

from .exit_model import simulate_exit

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
    """Score a suggested setup forward from `suggested_on` using the shared exit
    simulator (scale-out + MA trail, see exit_model). Adds two display-only
    fields the simulator doesn't need: `planned_r` (reward:risk of the original
    target) and `change_pct` (raw % to today from the suggested price)."""
    entry, stop, target = idea.get("entry"), idea.get("stop"), idea.get("target")
    sp = idea.get("suggested_price")

    res = simulate_exit(df, entry, stop, suggested_on)
    res["planned_r"] = _planned_r(entry, stop, target)
    cur = res.get("current_price")
    res["change_pct"] = round((cur / sp - 1) * 100, 1) if (cur and sp) else None
    return res


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
    rs = [e["r_multiple"] for e in realized if e["r_multiple"] is not None]
    expectancy = (win_r + loss_r) / n if n else None
    # System quality = expectancy / R-dispersion — a per-trade Sharpe-like read.
    r_std = statistics.pstdev(rs) if len(rs) > 1 else None
    sqn = round(expectancy / r_std, 2) if (expectancy is not None and r_std) else None

    def _avg(vals):
        vals = [v for v in vals if v is not None]
        return round(sum(vals) / len(vals), 2) if vals else None

    return {
        "resolved": n,
        "wins": len(wins),
        "losses": len(losses),
        "open": open_n,
        "no_entry": no_entry,
        "hit_rate_pct": round(len(wins) / n * 100, 1) if n else None,
        "avg_win_r": _avg([e["r_multiple"] for e in wins]),
        "avg_loss_r": _avg([e["r_multiple"] for e in losses]),
        "expectancy_r": round(expectancy, 2) if expectancy is not None else None,
        # None when undefined (no losses yet); `all_wins` flags a clean record so
        # the UI can show ∞ without emitting a non-finite float.
        "profit_factor": round(win_r / gross_loss, 2) if gross_loss > 0 else None,
        "all_wins": bool(wins) and gross_loss == 0,
        "total_r": round(win_r + loss_r, 2) if n else None,
        "r_std": round(r_std, 2) if r_std else None,
        "system_quality": sqn,  # expectancy / R std
        "avg_mfe_r": _avg([e.get("mfe_r") for e in evaluated if e.get("triggered")]),
        "avg_mae_r": _avg([e.get("mae_r") for e in evaluated if e.get("triggered")]),
        "avg_holding_bars": _avg([e.get("holding_bars") for e in realized]),
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
