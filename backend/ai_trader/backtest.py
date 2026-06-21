"""Point-in-time backtester for the AI Trader strategy.

The whole value of a backtest is that it must not cheat. `simulate(as_of)` runs
the *same* deterministic, rule-based engine the live product falls back to, but
sees only data on/before `as_of`:

- **Prices** are each ticker's cached frame truncated to `df.index <= as_of`, so
  the scorer treats `as_of` as "today" — every ADR/RVOL/return/pivot is as-of.
- **No movers** (`include_movers=False`) — today's gainers list is look-ahead.
- **No news/earnings enrichment** — there's no point-in-time feed.
- **No LLM** — the rule-based path is deterministic and has zero future knowledge.

Outcomes are then scored by replaying the *full* (un-truncated) frame forward
from `as_of` with the same stop/target/R-multiple logic the live ledger uses, so
backtest and live track records are directly comparable.

See STRATEGY.md §9 for the residual biases (survivorship, daily-bar resolution).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime

import pandas as pd

from screener.qullamaggie.cache import refresh_universe
from screener.qullamaggie.scorer import rank_candidates
from screener.qullamaggie.universe import get_universe

from . import regime as regime_mod
from .engine import (DEFAULT_ACCOUNT, DEFAULT_RISK_PCT, SCAN_LIMIT,
                     _compact, _fallback_ideas)
from .history import _benchmark_change, _evaluate, _expectancy
from .ranking import rank_ideas

logger = logging.getLogger(__name__)

MIN_BARS = 150            # bars required before as_of (≈ 6mo history for ret_6m/base)
MAX_WALKFORWARD_DATES = 60
_BENCHMARK = "SPY"
_CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "ai_trader_backtest")


# ── single date ──────────────────────────────────────────────────────────────
def _truncate(frames: dict, as_of: str) -> dict:
    """Frames cut to bars on/before as_of, keeping only names with enough history."""
    out = {}
    for sym, df in frames.items():
        if df is None or not len(df):
            continue
        sub = df[df.index <= as_of]
        if len(sub) >= MIN_BARS:
            out[sym] = sub
    return out


def simulate(as_of: str, *, frames: dict, spy, regime_rows: list | None,
             budget: float, account: float, risk_pct: float, min_adr: float) -> dict:
    """Run the rule-based engine as it would have on `as_of` and score the picks
    forward to the latest available bar. `frames` are the full (un-truncated)
    cached frames, reused across dates by the walk-forward."""
    trunc = _truncate(frames, as_of)
    candidates = rank_candidates(
        trunc, mode="breakout", min_dollar_vol=5_000_000,
        min_adr=min_adr, min_rvol=1.5,
    )[:SCAN_LIMIT]
    compact = [_compact(c) for c in candidates]

    ideas = rank_ideas(_fallback_ideas(compact, budget, account, risk_pct))
    reg = regime_mod.regime_as_of(as_of, regime_rows)

    evals = []
    for idea in ideas:
        idea["suggested_price"] = (idea.get("stats") or {}).get("price") or idea.get("entry")
        ev = _evaluate(frames.get(idea["ticker"]), idea, as_of)
        idea.update(ev)
        evals.append(ev)

    changes = [e["change_pct"] for e in evals if e.get("change_pct") is not None]
    avg = round(sum(changes) / len(changes), 1) if changes else None
    bench = _benchmark_change(spy, as_of)
    return {
        "as_of": as_of,
        "regime": reg,
        "candidates_considered": len(compact),
        "ideas": ideas,
        "avg_change_pct": avg,
        "benchmark_change_pct": bench,
        "alpha_pct": round(avg - bench, 1) if (avg is not None and bench is not None) else None,
        "stats": _expectancy(evals),
    }


_FRAMES_CACHE: dict = {"ts": 0.0, "frames": None}
_FRAMES_TTL = 900  # 15 min — frame fetch/validation is the ~25s cost; reuse it


def _load_frames():
    """Fetch the static universe (no movers) + benchmark once, cached in-process
    so the inspector and walk-forward don't re-pay the ~25s fetch each call."""
    import time
    hit = _FRAMES_CACHE.get("frames")
    if hit is not None and (time.time() - _FRAMES_CACHE["ts"]) < _FRAMES_TTL:
        return hit, hit.get(_BENCHMARK)
    symbols = get_universe(include_movers=False)
    frames = refresh_universe(symbols + [_BENCHMARK]) or {}
    _FRAMES_CACHE.update(ts=time.time(), frames=frames)
    return frames, frames.get(_BENCHMARK)


def run_single(as_of: str, *, budget: float, account: float,
               risk_pct: float, min_adr: float) -> dict:
    frames, spy = _load_frames()
    rows = regime_mod.regime_rows()
    result = simulate(as_of, frames=frames, spy=spy, regime_rows=rows,
                      budget=budget, account=account, risk_pct=risk_pct, min_adr=min_adr)
    result["data_window"] = _window(frames)
    return result


# ── walk-forward ─────────────────────────────────────────────────────────────
def _window(frames: dict) -> dict:
    """Earliest usable as_of (needs MIN_BARS history) and latest bar across frames."""
    starts, ends = [], []
    for df in frames.values():
        if df is not None and len(df) > MIN_BARS:
            starts.append(df.index[MIN_BARS])
            ends.append(df.index[-1])
    if not starts:
        return {"earliest": None, "latest": None}
    return {
        "earliest": min(starts).strftime("%Y-%m-%d"),
        "latest": max(ends).strftime("%Y-%m-%d"),
    }


def _cache_path(params: dict) -> str:
    key = hashlib.md5(json.dumps(params, sort_keys=True).encode()).hexdigest()[:16]
    return os.path.join(_CACHE_DIR, f"{key}.json")


def run_walkforward(*, start: str | None, end: str | None, step_days: int,
                    budget: float, account: float, risk_pct: float,
                    min_adr: float, fresh: bool = False) -> dict:
    """Run `simulate` across stepped dates and aggregate the results into the
    strategy's realized expectancy, an equity curve (cumulative R), and a
    by-regime breakdown. Disk-cached by parameters."""
    frames, spy = _load_frames()
    window = _window(frames)
    start = start or window["earliest"]
    end = end or window["latest"]
    if not start or not end:
        return {"error": "No price history available to backtest.", "dates": [], "window": window}

    params = {"start": start, "end": end, "step_days": step_days, "budget": budget,
              "account": account, "risk_pct": risk_pct, "min_adr": min_adr}
    path = _cache_path(params)
    if not fresh and os.path.exists(path):
        try:
            with open(path) as f:
                return {**json.load(f), "cached": True}
        except Exception:
            pass

    date_range = pd.date_range(start=start, end=end, freq=f"{max(step_days, 1)}D")
    dates = [d.strftime("%Y-%m-%d") for d in date_range][:MAX_WALKFORWARD_DATES]
    rows = regime_mod.regime_rows()

    per_date, all_evals, equity, by_regime = [], [], [], {}
    cum_r = 0.0
    for d in dates:
        res = simulate(d, frames=frames, spy=spy, regime_rows=rows,
                       budget=budget, account=account, risk_pct=risk_pct, min_adr=min_adr)
        ideas = res["ideas"]
        if not ideas:
            continue
        day_r = sum(i["r_multiple"] for i in ideas if i.get("r_multiple") is not None)
        cum_r = round(cum_r + day_r, 2)
        equity.append({"date": d, "cum_r": cum_r, "day_r": round(day_r, 2)})
        per_date.append({
            "as_of": d, "regime": res["regime"]["level"],
            "avg_change_pct": res["avg_change_pct"], "alpha_pct": res["alpha_pct"],
            "ideas": [{
                "ticker": i.get("ticker"), "setup": i.get("setup"),
                "composite_score": i.get("composite_score"),
                "entry": i.get("entry"), "stop": i.get("stop"), "target": i.get("target"),
                "outcome": i.get("outcome"), "r_multiple": i.get("r_multiple"),
                "change_pct": i.get("change_pct"),
            } for i in ideas],
        })
        all_evals.extend(ideas)
        lvl = res["regime"]["level"]
        by_regime.setdefault(lvl, []).extend(ideas)

    aggregate = _expectancy(all_evals)
    aggregate["total_ideas"] = len(all_evals)
    aggregate["dates_run"] = len(per_date)
    regime_stats = {lvl: {**_expectancy(evs), "ideas": len(evs)} for lvl, evs in by_regime.items()}

    out = {
        "params": params, "window": window,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "dates": per_date, "equity_curve": equity,
        "aggregate": aggregate, "by_regime": regime_stats, "cached": False,
    }
    try:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        with open(path, "w") as f:
            json.dump(out, f)
    except Exception as e:
        logger.warning("backtest cache write failed: %s", e)
    return out
