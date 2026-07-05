"""Regime-conditioned backtest — does the situational-awareness filter work?

The Situational Awareness ledger records, per trading day, a stance level and a
light for each setup family. This module asks the empirical question that
validates the whole idea: *conditional on the regime / setup light, what did the
market actually do next?*

Method (fully local, no network):
  1. Build a daily-rebalanced **equal-weight universe index** from the same
     breadth close panel — the "average stock". Breadth is a statement about the
     average stock, so its forward return is the natural benchmark.
  2. Compute forward returns at several horizons (1/5/10/20 sessions).
  3. Inner-join to the SA ledger by date.
  4. Bucket forward returns by stance level and by each setup's light, and
     report the green-vs-red **edge** with sample sizes. Short setups are
     direction-adjusted (a green short in a falling tape is a *positive* edge).

This is data-limited until the breadth cache / ledger deepen (forward windows
consume recent days), so every bucket carries its `n` and the UI flags thin
samples. The framework strengthens automatically as history accumulates.
"""

from __future__ import annotations

import logging
import math

from .calculator import _build_close_panel
from .universe import load_universe
from . import sa_history

logger = logging.getLogger(__name__)

HORIZONS = (1, 5, 10, 20)
PRIMARY_HORIZON = 10

# Trade direction per setup family — long setups profit from a rising average
# stock; shorts/hedges profit from a falling one. Used to sign the forward
# return so "green = positive edge" reads consistently across all families.
_SETUP_DIR = {
    "breakout": 1,
    "ep": 1,
    "pullback": 1,
    "mean_reversion": 1,
    "short": -1,
}
_SETUP_NAMES = {
    "breakout": "Momentum Breakouts",
    "ep": "Episodic Pivots / Gaps",
    "pullback": "Pullbacks in Uptrend",
    "mean_reversion": "Mean-Reversion Bounce",
    "short": "Shorts / Hedges",
}

_LEVELS = ("aggressive", "constructive", "selective", "defensive", "cash")


def _forward_returns(max_days: int = 600) -> tuple[dict, str | None]:
    """date(iso) → {horizon: forward return} for the equal-weight universe index.

    Forward return at horizon h is index[t+h]/index[t] - 1, or None when the
    panel doesn't extend h sessions past t.
    """
    universe = load_universe().get("symbols", [])
    if not universe:
        return {}, None
    panel, _dates = _build_close_panel(universe, days_needed=max_days)
    if panel.empty or len(panel.index) < 2:
        return {}, None

    # Per-ticker daily returns → equal-weight (mean across available names) →
    # cumulative index level. fill_method=None keeps non-trading holes as NaN so
    # a name that didn't print isn't credited a 0% move.
    rets = panel.pct_change(periods=1, fill_method=None)
    ew = rets.mean(axis=1, skipna=True)          # equal-weight daily return
    level = (1.0 + ew.fillna(0.0)).cumprod()     # index level, starts at ~1.0

    idx = list(level.index)
    lv = level.values
    out: dict = {}
    for i, d in enumerate(idx):
        rec = {}
        for h in HORIZONS:
            j = i + h
            rec[h] = float(lv[j] / lv[i] - 1.0) if j < len(lv) else None
        key = d.isoformat() if hasattr(d, "isoformat") else str(d)
        out[key] = rec
    last = idx[-1]
    return out, (last.isoformat() if hasattr(last, "isoformat") else str(last))


def _bucket(vals: list[float]) -> dict:
    """Summary stats for one bucket of forward returns (decimals)."""
    xs = sorted(v for v in vals if v is not None)
    n = len(xs)
    if n == 0:
        return {"n": 0, "avg": None, "median": None, "hit_rate": None, "min": None, "max": None}
    avg = sum(xs) / n
    return {
        "n": n,
        "avg": round(avg, 5),
        "median": round(xs[n // 2], 5),
        "hit_rate": round(sum(1 for v in xs if v > 0) / n, 4),
        "min": round(xs[0], 5),
        "max": round(xs[-1], 5),
    }


def run() -> dict:
    """Build the full regime-edge payload by joining forward returns to the SA
    ledger. Returns buckets per horizon for stance levels and setup lights."""
    fwd, fwd_as_of = _forward_returns()
    ledger = sa_history.load(days=800)
    joined = [(r, fwd[r["date"]]) for r in ledger if r.get("date") in fwd]

    # Forward return by stance level (and overall) per horizon.
    by_level: dict = {}
    for h in HORIZONS:
        block = {lv: _bucket([f[h] for (r, f) in joined if r.get("level") == lv]) for lv in _LEVELS}
        block["all"] = _bucket([f[h] for (r, f) in joined])
        by_level[h] = block

    # Forward return by setup light per horizon (direction-adjusted) + edge.
    setups: dict = {}
    for key, dirn in _SETUP_DIR.items():
        per_h = {}
        for h in HORIZONS:
            lights = {
                lt: _bucket([
                    dirn * f[h] for (r, f) in joined
                    if (r.get("lights") or {}).get(key) == lt and f[h] is not None
                ])
                for lt in ("green", "amber", "red")
            }
            g, rd = lights["green"], lights["red"]
            edge = round(g["avg"] - rd["avg"], 5) if (g["avg"] is not None and rd["avg"] is not None) else None
            per_h[h] = {"lights": lights, "edge": edge}
        setups[key] = {
            "key": key,
            "name": _SETUP_NAMES[key],
            "direction": "long" if dirn > 0 else "short",
            "by_horizon": per_h,
        }

    return {
        "horizons": list(HORIZONS),
        "primary_horizon": PRIMARY_HORIZON,
        "sample_days": len(joined),
        "ledger_days": len(ledger),
        "fwd_as_of": fwd_as_of,
        "benchmark": "Equal-weight universe index (the average stock)",
        "by_level": by_level,
        "setups": setups,
    }


# ---------------------------------------------------------------------------
# Whole-system backtest — does the exposure dial beat buy-and-hold?
#
# The regime edge above validates each bucket in isolation. This asks the
# end-to-end question: if you had *sized* by the exposure stance every day and
# held the equal-weight universe index, would your equity curve have beaten
# simply staying 100% invested? A regime filter earns its keep by improving
# risk-adjusted return (higher Sharpe, shallower drawdown) — usually at some
# cost to raw return, since it sits out part of the upside.
# ---------------------------------------------------------------------------

# Stance level → target exposure weight. Midpoints of each band's published
# invested-% range, so the simulation matches what the page actually tells you.
_EXPOSURE_WEIGHT = {
    "aggressive": 1.0,
    "constructive": 0.65,
    "selective": 0.375,
    "defensive": 0.125,
    "cash": 0.0,
}


def _annualized(growth: float, n_days: int) -> float | None:
    if n_days <= 0 or growth <= 0:
        return None
    years = n_days / 252.0
    return growth ** (1.0 / years) - 1.0 if years > 0 else None


def _sharpe(daily: list[float]) -> float | None:
    if len(daily) < 5:
        return None
    m = sum(daily) / len(daily)
    sd = (sum((x - m) ** 2 for x in daily) / len(daily)) ** 0.5
    return (m / sd) * (252 ** 0.5) if sd else None


def _max_drawdown(curve: list[float]) -> float:
    peak, mdd = (curve[0] if curve else 1.0), 0.0
    for v in curve:
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1.0)
    return mdd


def run_system_backtest() -> dict:
    """Equity curve of sizing by the exposure stance vs. always-invested
    buy-and-hold of the same equal-weight universe index."""
    universe = load_universe().get("symbols", [])
    if not universe:
        return {"available": False, "reason": "no universe cached"}
    panel, _dates = _build_close_panel(universe, days_needed=800)
    if panel.empty or len(panel.index) < 30:
        return {"available": False, "reason": "insufficient price history"}

    rets = panel.pct_change(periods=1, fill_method=None)
    ew = list(rets.mean(axis=1, skipna=True).values)  # equal-weight daily return
    ledger = {r["date"]: r.get("level") for r in sa_history.load(days=800)}

    idx = list(panel.index)
    iso = lambda d: d.isoformat() if hasattr(d, "isoformat") else str(d)

    s_eq = b_eq = 1.0
    s_curve, b_curve, daily_s, daily_b, points = [], [], [], [], []
    invested = 0
    by_weight = {k: 0 for k in _EXPOSURE_WEIGHT}

    # Apply stance(t) to the return earned over the NEXT session — no lookahead.
    for i in range(len(idx) - 1):
        lvl = ledger.get(iso(idx[i]))
        if lvl is None:
            continue
        r_next = ew[i + 1]
        if r_next is None or (isinstance(r_next, float) and math.isnan(r_next)):
            continue
        w = _EXPOSURE_WEIGHT.get(lvl, 0.0)
        s_ret = w * r_next
        s_eq *= 1.0 + s_ret
        b_eq *= 1.0 + r_next
        daily_s.append(s_ret)
        daily_b.append(r_next)
        s_curve.append(s_eq)
        b_curve.append(b_eq)
        by_weight[lvl] = by_weight.get(lvl, 0) + 1
        invested += 1 if w > 0 else 0
        points.append({"date": iso(idx[i + 1]), "strategy": round(s_eq, 4), "benchmark": round(b_eq, 4)})

    n = len(points)
    if n < 20:
        return {"available": False, "reason": "ledger too thin for an equity curve", "sample_days": n}

    def _pack(eq, curve, daily):
        ann = _annualized(eq, n)
        shp = _sharpe(daily)
        return {
            "total_return": round(eq - 1.0, 4),
            "cagr": round(ann, 4) if ann is not None else None,
            "max_drawdown": round(_max_drawdown(curve), 4),
            "sharpe": round(shp, 2) if shp is not None else None,
        }

    return {
        "available": True,
        "sample_days": n,
        "invested_pct": round(invested / n, 4),
        "weights": _EXPOSURE_WEIGHT,
        "days_by_stance": by_weight,
        "benchmark_name": "Equal-weight universe index (the average stock)",
        "strategy": _pack(s_eq, s_curve, daily_s),
        "benchmark": _pack(b_eq, b_curve, daily_b),
        "curve": points,
    }
