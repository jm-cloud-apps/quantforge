"""Are the exposure bands actually calibrated to what the tape paid?

The stance bands and their exposure weights were chosen by judgement: 75+ means
press to 100% long, 30–44 means trim to ~12%, and so on. Judgement is a fine
starting point, but once a ledger exists the bands can be checked against it —
and the first check was unflattering. Over the first 224 ledger days the
"aggressive" band did *not* beat "constructive" (n=18), and "cash" days were not
the worst days to be long. A dial whose top rung underperforms its second rung
isn't calibrated.

This module reports that comparison and derives a suggested weight per band. It
deliberately does NOT rewrite `_EXPOSURE_WEIGHT` on its own:

  * 18 days is not a mandate. Refitting the dial to it is exactly the
    overfitting `analytics/edge_validation` exists to catch.
  * Forward return is not the only thing a size dial is for. Sitting out a
    washed-out tape buys drawdown control that a mean forward return can't see,
    which is why per-band volatility is reported next to per-band return.

So the suggestion is shrunk toward the weight already in use, in proportion to
how much evidence there is:

    confidence = episodes / (episodes + K)
    suggested  = current + confidence * (implied - current)

`implied` scales each band's average forward return against the best band's
(floored at zero — no leverage, no shorting from this dial). With one episode
the suggestion barely moves off the current weight; with many it converges on
what the data says. Episodes, not days, drive confidence: regime days arrive in
runs, so 46 days can be five events.
"""

from __future__ import annotations

import logging

from .regime_backtest import (
    HORIZONS,
    PRIMARY_HORIZON,
    _EXPOSURE_WEIGHT,
    _LEVELS,
    _episodes,
    _forward_returns,
    _reliability,
)
from . import sa_history

logger = logging.getLogger(__name__)

# Shrinkage half-weight: at K episodes the suggestion sits halfway between the
# current weight and what the data implies. Matches MIN_EPISODES_RELIABLE, so a
# band only reaches the data's answer once it clears the reliability bar.
SHRINK_K = 12


def _stats(vals: list[float]) -> dict:
    xs = [v for v in vals if v is not None]
    n = len(xs)
    if n == 0:
        return {"n": 0, "avg": None, "stdev": None, "hit_rate": None}
    avg = sum(xs) / n
    var = sum((x - avg) ** 2 for x in xs) / n if n > 1 else 0.0
    return {
        "n": n,
        "avg": round(avg, 5),
        "stdev": round(var ** 0.5, 5),
        "hit_rate": round(sum(1 for v in xs if v > 0) / n, 4),
    }


def suggest_weight(current: float, implied: float, episodes: int) -> tuple[float, float]:
    """Shrink `implied` toward `current` by how many independent episodes back it.

    Returns (suggested, confidence). Zero episodes leaves the current weight
    untouched; confidence → 1 only in the limit, so the dial never fully hands
    itself over to a finite sample.
    """
    confidence = episodes / (episodes + SHRINK_K) if episodes > 0 else 0.0
    suggested = current + confidence * (implied - current)
    return max(0.0, min(1.0, suggested)), confidence


def _verdict(level: str, current: float, suggested: float, reliability: str, edge: float | None) -> str:
    if reliability == "insufficient":
        return "Not enough independent episodes to judge — weight held where it is."
    if edge is None:
        return "No forward returns joined for this band yet."
    delta = suggested - current
    direction = "more" if delta > 0 else "less"
    if abs(delta) < 0.05:
        return "Sized about right for what this band has paid."
    return (
        f"Paid {'above' if edge > 0 else 'below'} the base rate, so the data argues for "
        f"{direction} exposure here ({current:.0%} → {suggested:.0%})."
    )


def run(horizon: int = PRIMARY_HORIZON) -> dict:
    """Per-band forward stats, current weight, and an evidence-shrunk suggestion."""
    if horizon not in HORIZONS:
        horizon = PRIMARY_HORIZON

    fwd, fwd_as_of = _forward_returns()
    ledger = sorted(
        (r for r in sa_history.load(days=800) if r.get("date")),
        key=lambda r: r["date"],
    )
    joined = [(r, fwd[r["date"]]) for r in ledger if r.get("date") in fwd]
    if not joined:
        return {
            "available": False,
            "reason": "no ledger days joined to forward returns yet",
            "horizon": horizon,
            "bands": [],
        }

    rows = [r for (r, _f) in joined]
    base = _stats([f[horizon] for (_r, f) in joined])

    raw: dict[str, dict] = {}
    for lv in _LEVELS:
        flags = [r.get("level") == lv for r in rows]
        st = _stats([f[horizon] for (r, f) in joined if r.get("level") == lv])
        st["episodes"] = _episodes(flags)
        st["reliability"] = _reliability(st["episodes"])
        raw[lv] = st

    # `implied` is relative to the best-performing band, floored at zero: this
    # dial only scales long exposure, it never goes short or levers up.
    best = max((st["avg"] for st in raw.values() if st["avg"] is not None), default=None)

    bands = []
    for lv in _LEVELS:
        st = raw[lv]
        current = _EXPOSURE_WEIGHT.get(lv, 0.0)
        if st["avg"] is None or best is None or best <= 0:
            implied = None
            suggested, confidence = current, 0.0
        else:
            implied = max(0.0, st["avg"]) / best
            suggested, confidence = suggest_weight(current, implied, st["episodes"])
        edge = round(st["avg"] - base["avg"], 5) if (st["avg"] is not None and base["avg"] is not None) else None
        # Return per unit of risk, reported but deliberately NOT used to derive
        # the implied weight. Mean-variance sizing would hand the calmest band
        # the largest weight — defensible only if you can lever, which this dial
        # can't. Raw return keeps the suggestion transparent; the ratio is here
        # so a low-return-but-calm band isn't mistaken for a bad one.
        rpr = (
            round(st["avg"] / st["stdev"], 4)
            if st["avg"] is not None and st["stdev"] not in (None, 0)
            else None
        )
        bands.append({
            "level": lv,
            **st,
            "return_per_unit_risk": rpr,
            "edge_vs_base": edge,
            "current_weight": round(current, 4),
            "implied_weight": round(implied, 4) if implied is not None else None,
            "confidence": round(confidence, 4),
            "suggested_weight": round(suggested, 4),
            "verdict": _verdict(lv, current, suggested, st["reliability"], edge),
        })

    # Is the dial monotonic in what it actually paid? If a lower band paid more
    # than a higher one, the ladder is mis-ordered regardless of the weights.
    ordered = [b for b in bands if b["avg"] is not None]  # _LEVELS is high→low
    inversions = [
        {"higher": a["level"], "lower": b["level"], "gap": round(b["avg"] - a["avg"], 5)}
        for a, b in zip(ordered, ordered[1:])
        if b["avg"] > a["avg"]
    ]

    return {
        "available": True,
        "horizon": horizon,
        "as_of": ledger[-1]["date"],
        "fwd_as_of": fwd_as_of,
        "sample_days": len(joined),
        "base_rate": base,
        "shrink_k": SHRINK_K,
        "benchmark": "Equal-weight universe index (the average stock)",
        "bands": bands,
        "inversions": inversions,
        "monotonic": not inversions,
    }
