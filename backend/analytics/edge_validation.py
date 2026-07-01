"""Edge-validation (event-study) engine — the anti-data-mining tool.

You run many screens. The cardinal quant sin is that if you try enough of them,
one looks great by pure luck. This module *replays* a family of entry signals over
the cached history, measures each one's forward-return edge over the tape, and then
corrects for the fact that several were tried at once.

For each signal it computes, per signal-day, the forward H-day return of the names
that fired minus the universe's average forward return that day (the **edge** over
the tape, not just market drift). From the per-day edge series it derives:

  • expectancy, win rate, payoff (avg win / avg loss), average edge;
  • a t-stat and a **bootstrap 95% CI** on the mean edge;
  • the signal's **Sharpe**, its **Probabilistic Sharpe Ratio** (PSR, vs 0), and —
    the headline — its **Deflated Sharpe Ratio** (Bailey & López de Prado), which
    discounts the Sharpe for how many signals were tried and for the returns'
    skew/kurtosis and sample length;
  • a **Benjamini-Hochberg FDR** decision across the whole family.

Verdict per signal: does the edge survive multiple testing, or is it likely noise?

Caveats surfaced in the UI: signals overlap (daily-sampled H-day returns are
autocorrelated, so t-stats are optimistic); the universe is survivorship-biased
(delisted names aren't in the cache); and the reversal signal is simplified because
the grouped cache has no open price. This is a discipline check, not a promise.
"""

from __future__ import annotations

import math
from datetime import datetime
from statistics import NormalDist

import numpy as np
import pandas as pd

from analytics.panel import load_panel

_N = NormalDist()
_GAMMA = 0.5772156649015329          # Euler-Mascheroni
DEFAULT_HORIZON = 10                  # forward trading days
BOOTSTRAP_N = 2000
MIN_DAYS_FOR_SIGNAL = 10              # need at least this many signal-days to judge
FDR_ALPHA = 0.10


# --- Signal registry --------------------------------------------------------
# Each signal is a compact, documented reimplementation of an entry condition,
# evaluated at day index t using only data up to and including t. All operate on
# the numpy close/high/low/volume arrays (symbols × dates).

def _sig_reversal(C, H, L, V, t):
    """Stockbee reversal (simplified — no open in the cache): fresh 5-day low that
    closed in the upper 40% of its range, on real volume."""
    lo5 = L[:, t - 4:t + 1].min(axis=1)
    rng = H[:, t] - L[:, t]
    with np.errstate(invalid="ignore", divide="ignore"):
        recovery = np.where(rng > 0, (C[:, t] - L[:, t]) / rng, np.nan)
    return (L[:, t] <= lo5 + 1e-9) & (recovery >= 0.60) & (V[:, t] >= 290_000) & (C[:, t] >= 5)


def _sig_breakout_50d(C, H, L, V, t):
    """New 50-day closing high on ≥1.5× average volume — a breakout entry."""
    hi50 = C[:, t - 49:t + 1].max(axis=1)
    volavg = V[:, t - 19:t].mean(axis=1)
    return (C[:, t] >= hi50 - 1e-9) & (V[:, t] >= 1.5 * volavg) & (C[:, t] >= 5)


def _sig_ma_cross_up(C, H, L, V, t):
    """Price crosses up through its rising 50-day MA — a trend-entry."""
    ma = C[:, t - 49:t + 1].mean(axis=1)
    ma_prev = C[:, t - 50:t].mean(axis=1)
    return (C[:, t] > ma) & (C[:, t - 1] <= ma_prev) & (ma > ma_prev) & (C[:, t] >= 5)


def _sig_rsi2_oversold(C, H, L, V, t):
    """Connors RSI(2) < 10 while above the 50-day MA — a pullback-in-uptrend
    mean-reversion entry."""
    d1 = C[:, t] - C[:, t - 1]
    d2 = C[:, t - 1] - C[:, t - 2]
    gain = (np.maximum(d1, 0) + np.maximum(d2, 0)) / 2.0
    loss = (np.maximum(-d1, 0) + np.maximum(-d2, 0)) / 2.0
    with np.errstate(invalid="ignore", divide="ignore"):
        rs = np.where(loss > 0, gain / loss, np.inf)
        rsi2 = 100.0 - 100.0 / (1.0 + rs)
    ma50 = C[:, t - 49:t + 1].mean(axis=1)
    return (rsi2 < 10.0) & (C[:, t] > ma50) & (C[:, t] >= 5)


SIGNALS = [
    {"key": "reversal", "label": "Reversal (5-day low bounce)", "kind": "Mean reversion",
     "min_lb": 5, "fn": _sig_reversal,
     "desc": "Fresh 5-day low closing in the upper 40% of its range on real volume."},
    {"key": "breakout_50d", "label": "50-day high breakout", "kind": "Momentum",
     "min_lb": 50, "fn": _sig_breakout_50d,
     "desc": "New 50-day closing high on ≥1.5× average volume."},
    {"key": "ma_cross_up", "label": "Cross above rising 50-day MA", "kind": "Trend",
     "min_lb": 51, "fn": _sig_ma_cross_up,
     "desc": "Price crosses up through a rising 50-day moving average."},
    {"key": "rsi2_oversold", "label": "RSI(2) < 10 in uptrend", "kind": "Mean reversion",
     "min_lb": 50, "fn": _sig_rsi2_oversold,
     "desc": "Connors RSI(2) below 10 while holding above the 50-day MA."},
]


def run(
    horizon: int = DEFAULT_HORIZON,
    min_price: float = 5.0,
    min_dollar_volume: float = 3_000_000.0,
) -> dict:
    """Replay every signal over the cache and score it against multiple testing."""
    panel = load_panel(max_days=400, min_price=min_price,
                       min_dollar_volume=min_dollar_volume, require_full_coverage=False)
    if panel is None:
        return _empty(error="Breadth cache is empty. Run Market Monitor → Refresh first.")

    C = panel.close.to_numpy()
    H = panel.high.to_numpy()
    L = panel.low.to_numpy()
    V = panel.volume.to_numpy()
    T = C.shape[1]
    horizon = max(1, int(horizon))
    if T < 60 + horizon:
        return _empty(as_of=panel.as_of.isoformat(),
                      error=(f"Not enough history to validate — need ≥ {60 + horizon} trading days, "
                             f"have {T}. Backfill a bigger lookback in Market Monitor → Refresh."))

    results = [_evaluate(sig, C, H, L, V, T, horizon) for sig in SIGNALS]
    results = [r for r in results if r is not None]

    _apply_multiple_testing(results)

    return {
        "as_of": panel.as_of.isoformat(),
        "horizon": horizon,
        "signals": results,
        "family": _family_summary(results),
        "counts": {"universe": panel.universe_size, "passed_liquidity": panel.passed_liquidity,
                   "days_available": T},
        "thresholds": {"min_price": min_price, "min_dollar_volume": min_dollar_volume,
                       "fdr_alpha": FDR_ALPHA, "bootstrap_n": BOOTSTRAP_N},
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


def _evaluate(sig, C, H, L, V, T, horizon) -> dict | None:
    lb = sig["min_lb"]
    per_day_edge: list[float] = []
    ev_returns: list[float] = []
    n_signals = 0
    for t in range(lb, T - horizon):
        mask = sig["fn"](C, H, L, V, t)
        mask = np.asarray(mask, dtype=bool) & ~np.isnan(C[:, t]) & ~np.isnan(C[:, t + horizon])
        if not mask.any():
            continue
        fwd = C[:, t + horizon] / C[:, t] - 1.0
        sig_fwd = fwd[mask]
        sig_fwd = sig_fwd[~np.isnan(sig_fwd)]
        if sig_fwd.size == 0:
            continue
        base = np.nanmean(fwd)
        if np.isnan(base):
            continue
        per_day_edge.append(float(sig_fwd.mean() - base))
        ev_returns.extend(sig_fwd.tolist())
        n_signals += int(sig_fwd.size)

    n_days = len(per_day_edge)
    base_rec = {"key": sig["key"], "label": sig["label"], "kind": sig["kind"],
                "desc": sig["desc"], "n_signals": n_signals, "n_days": n_days}
    if n_days < MIN_DAYS_FOR_SIGNAL:
        base_rec.update({"insufficient": True})
        return base_rec

    edge = np.array(per_day_edge)
    ev = np.array(ev_returns)
    wins = ev[ev > 0]
    losses = ev[ev < 0]
    win_rate = float((ev > 0).mean())
    avg_win = float(wins.mean()) if wins.size else 0.0
    avg_loss = float(losses.mean()) if losses.size else 0.0
    expectancy = win_rate * avg_win + (1 - win_rate) * avg_loss

    mean_edge = float(edge.mean())
    sd = float(edge.std(ddof=1)) if n_days > 1 else 0.0
    sr_period = (mean_edge / sd) if sd > 0 else 0.0            # per-period Sharpe of the edge
    sr_ann = sr_period * math.sqrt(252.0 / horizon)
    t_stat = (mean_edge / (sd / math.sqrt(n_days))) if sd > 0 else 0.0
    p_value = 2.0 * (1.0 - _N.cdf(abs(t_stat)))

    lo, hi = _bootstrap_ci(edge)
    es = pd.Series(edge)
    skew = float(es.skew()) if n_days > 2 else 0.0
    kurt_excess = float(es.kurt()) if n_days > 3 else 0.0

    base_rec.update({
        "insufficient": False,
        "avg_fwd_pct": round(float(ev.mean()) * 100, 3),
        "win_rate": round(win_rate * 100, 1),
        "avg_win_pct": round(avg_win * 100, 3),
        "avg_loss_pct": round(avg_loss * 100, 3),
        "payoff": round(avg_win / abs(avg_loss), 2) if avg_loss < 0 else None,
        "expectancy_pct": round(expectancy * 100, 3),
        "edge_pct": round(mean_edge * 100, 3),
        "edge_ci_lo_pct": round(lo * 100, 3),
        "edge_ci_hi_pct": round(hi * 100, 3),
        "sharpe": round(sr_ann, 2),
        "t_stat": round(t_stat, 2),
        "p_value": round(p_value, 4),
        "_sr_period": sr_period, "_skew": skew, "_kurt": kurt_excess,  # for DSR (stripped later)
    })
    return base_rec


def _bootstrap_ci(edge: np.ndarray, n: int = BOOTSTRAP_N, alpha: float = 0.05):
    if edge.size == 0:
        return 0.0, 0.0
    rng = np.random.default_rng(12345)
    idx = rng.integers(0, edge.size, size=(n, edge.size))
    means = edge[idx].mean(axis=1)
    return float(np.quantile(means, alpha / 2)), float(np.quantile(means, 1 - alpha / 2))


def _apply_multiple_testing(results: list[dict]) -> None:
    """Deflated Sharpe (accounting for the number of signals tried) + BH-FDR, then
    a plain-English verdict per signal. Mutates the records in place and strips the
    private helper fields."""
    scored = [r for r in results if not r.get("insufficient")]
    K = len(scored)
    if K == 0:
        return

    srs = [r["_sr_period"] for r in scored]
    var_sr = float(np.var(srs, ddof=1)) if K > 1 else 0.0
    if K > 1 and var_sr > 0:
        sr0 = math.sqrt(var_sr) * (
            (1 - _GAMMA) * _N.inv_cdf(1 - 1.0 / K) + _GAMMA * _N.inv_cdf(1 - 1.0 / (K * math.e))
        )
    else:
        sr0 = 0.0

    # BH-FDR across the family.
    ordered = sorted(scored, key=lambda r: r["p_value"])
    passed = set()
    for i, r in enumerate(ordered, start=1):
        if r["p_value"] <= (i / K) * FDR_ALPHA:
            passed = {id(x) for x in ordered[:i]}   # step-up: all up to the largest passing i
    for r in scored:
        n_days = r["n_days"]
        sr = r["_sr_period"]
        kurt_nonexcess = r["_kurt"] + 3.0
        psr0 = _psr(sr, 0.0, n_days, r["_skew"], kurt_nonexcess)
        dsr = _psr(sr, sr0, n_days, r["_skew"], kurt_nonexcess)
        pass_fdr = id(r) in passed
        if dsr >= 0.95 and pass_fdr and r["edge_pct"] > 0:
            verdict, tone = "Edge survives", "good"
        elif psr0 >= 0.95 and r["edge_pct"] > 0:
            verdict, tone = "Marginal (fails multiple-testing)", "warn"
        elif r["edge_pct"] < 0 and r["p_value"] < 0.05:
            verdict, tone = "Negative edge vs tape", "bad"
        else:
            verdict, tone = "Likely noise", "bad"
        r["psr"] = round(psr0, 3)
        r["dsr"] = round(dsr, 3)
        r["pass_fdr"] = pass_fdr
        r["verdict"] = verdict
        r["verdict_tone"] = tone
        r["sr0"] = round(sr0, 3)
        for k in ("_sr_period", "_skew", "_kurt"):
            r.pop(k, None)


def _psr(sr: float, sr_star: float, n: int, skew: float, kurt_nonexcess: float) -> float:
    """Probabilistic Sharpe Ratio: P(true Sharpe > sr_star) given the estimate's
    standard error, adjusted for non-normal returns (Bailey & López de Prado)."""
    denom = 1.0 - skew * sr + ((kurt_nonexcess - 1.0) / 4.0) * sr * sr
    denom = math.sqrt(denom) if denom > 1e-9 else 1e-9
    z = (sr - sr_star) * math.sqrt(max(n - 1, 1)) / denom
    return _N.cdf(z)


def _family_summary(results: list[dict]) -> dict:
    scored = [r for r in results if not r.get("insufficient")]
    survivors = [r for r in scored if r.get("verdict_tone") == "good"]
    sr0 = scored[0]["sr0"] if scored else 0.0
    return {
        "n_tested": len(scored),
        "n_survivors": len(survivors),
        "expected_false_positives": round(FDR_ALPHA * len(scored), 2),
        "sr0": sr0,
        "note": (
            f"{len(scored)} signals tested at once; at FDR {int(FDR_ALPHA*100)}% you'd expect "
            f"~{round(FDR_ALPHA * len(scored), 1)} false positives by chance. "
            f"Deflated-Sharpe benchmark to beat: {sr0:.2f} per-period Sharpe."
        ),
    }


def _empty(as_of: str | None = None, error: str | None = None) -> dict:
    out = {"as_of": as_of, "horizon": DEFAULT_HORIZON, "signals": [], "family": {},
           "counts": {"universe": 0, "passed_liquidity": 0, "days_available": 0}}
    if error:
        out["error"] = error
    return out
