"""Signal scorecard — does each Trade Today signal actually precede anything?

`regime_backtest` measures the stance levels and the setup lights. This does the
same job for everything added since: the day verdict, the turn-watch reads, and
the divergence calls. Same method, same forward-return series, so the numbers are
comparable across both.

Method: replay each signal over the SA ledger, join to the forward return of the
equal-weight universe index (the average stock — the natural benchmark for a
breakout trader), and report the bucket against the UNCONDITIONAL base rate. The
number that matters is `lift`: how much better than "any random day" the signal
was. A signal with a great average return in a tape where every day was great has
no lift and tells you nothing.

Two honesty features, because at this sample size the easy mistake is fake
precision:

  · EPISODES, not just rows. Regime days are heavily autocorrelated — a signal
    that fires for nine consecutive sessions is roughly ONE observation, not
    nine. Every bucket reports the number of distinct runs alongside n, and
    reliability is judged on episodes. This is the difference between a scorecard
    and a scorecard-shaped random number generator.

  · An explicit `reliable` verdict per signal, so a 3-episode result is labelled
    insufficient rather than quietly rendered next to a 40-episode one.

Nothing here is a model. With ~1 observation per trading day and heavy
autocorrelation, conditional base rates are the correct tool and a fitted
classifier would just memorise noise.
"""

from __future__ import annotations

import logging

from . import sa_history
from .regime_backtest import HORIZONS, _bucket, _forward_returns
from .turn import (
    load_bars, posture_at, follow_through, index_divergence,
    UPTURN_LOOKBACK, UPTURN_MIN_RISE, BOTTOM_PCTL, SHALLOW_OFF_HIGH_PCT,
    FTD_MIN_DAY, FTD_MAX_DAY,
)

logger = logging.getLogger(__name__)

# Episodes needed before a bucket is treated as measured rather than anecdotal.
MIN_EPISODES_RELIABLE = 12
MIN_EPISODES_TENTATIVE = 5

# Human labels for the signal keys the replay emits.
LABELS = {
    "verdict:press_long": "Verdict · Press longs",
    "verdict:hunt_long": "Verdict · Hunt longs",
    "verdict:selective_long": "Verdict · Selective (A+ only)",
    "verdict:chop": "Verdict · Chop (stand down)",
    "verdict:defend": "Verdict · Defend",
    "verdict:short_on": "Verdict · Shorts in season",
    "verdict:washed_out": "Verdict · Washed out",
    "verdict:avoid": "Any no-trade day",
    "turn:breadth_upturn": "Turn · Breadth lifting off its floor",
    "turn:washed_out_holding": "Turn · Washed out but price holding",
    "turn:follow_through": "Turn · Follow-through day",
    "turn:rally_attempt": "Turn · Rally attempt, no follow-through",
    "div:price_not_confirming": "Divergence · Price isn't confirming",
    "div:narrow_tape": "Divergence · Narrow, megacap-led",
    "div:rotating": "Divergence · Leadership rotating",
    "div:intact_structure": "Divergence · Weak breadth, intact structure",
}

_DIV_KEYS = {
    "Price isn't confirming": "div:price_not_confirming",
    "Narrow, megacap-led tape": "div:narrow_tape",
    "Leadership is rotating": "div:rotating",
    "Weak breadth, intact structure": "div:intact_structure",
}


def _percentile(scores: list[int], upto: int) -> float | None:
    """Rank of scores[upto] within the history available at that point."""
    window = [s for s in scores[: upto + 1] if s is not None]
    if len(window) < 30:
        return None
    cur = scores[upto]
    if cur is None:
        return None
    below = sum(1 for s in window if s < cur)
    return round(below / len(window) * 100.0, 1)


def _signals_for(i: int, ledger: list[dict], scores: list[int], bars, bar_pos: dict) -> set[str]:
    """Every signal key that would have fired on ledger row `i`.

    Reconstructed from data available AT THAT POINT only — no lookahead.
    """
    keys: set[str] = set()
    rec = ledger[i]

    # --- verdict (persisted on the record) ---------------------------------
    v = rec.get("verdict") or {}
    if v.get("code"):
        keys.add(f"verdict:{v['code']}")
    if v.get("avoid"):
        keys.add("verdict:avoid")

    score = rec.get("score")
    date = rec.get("date")

    # --- turn: breadth lifting off its floor -------------------------------
    if score is not None and i >= UPTURN_LOOKBACK:
        recent = [s for s in scores[i - UPTURN_LOOKBACK + 1: i + 1] if s is not None]
        if recent:
            floor = min(recent)
            if score - floor >= UPTURN_MIN_RISE and recent.index(floor) < len(recent) - 1:
                keys.add("turn:breadth_upturn")

    # --- index-derived reads (need the bar index for that date) -------------
    pos = bar_pos.get(date)
    if pos is None or not bars:
        return keys
    indices = posture_at(bars, pos)
    avail = [x for x in indices if x.get("available")]
    if not avail:
        return keys

    # washed out but holding
    pctl = _percentile(scores, i)
    if pctl is not None and pctl <= BOTTOM_PCTL:
        offs = [abs((x.get("pct_from_high") or 0) * 100.0) for x in avail]
        rising = [x for x in avail if x.get("sma50_rising")]
        if offs and max(offs) <= SHALLOW_OFF_HIGH_PCT and len(rising) >= 2:
            keys.add("turn:washed_out_holding")

    # follow-through / rally attempt
    found, attempt = False, False
    for sym, frame in bars.items():
        r = follow_through(frame.iloc[: pos + 1])
        if not r:
            continue
        if r.get("found"):
            found = True
        elif FTD_MIN_DAY <= (r.get("days_since_low") or 0) <= FTD_MAX_DAY:
            attempt = True
    if found:
        keys.add("turn:follow_through")
    elif attempt:
        keys.add("turn:rally_attempt")

    # divergence
    d = index_divergence(score, indices)
    if d and d.get("label") in _DIV_KEYS:
        keys.add(_DIV_KEYS[d["label"]])
    return keys


def _episodes(flags: list[bool]) -> int:
    """Count runs of consecutive True — the honest sample size."""
    return sum(1 for j, f in enumerate(flags) if f and (j == 0 or not flags[j - 1]))


def run() -> dict:
    """Replay every signal over the ledger and score it against the base rate."""
    fwd, fwd_as_of = _forward_returns()
    ledger = sa_history.load(days=800)
    ledger = [r for r in ledger if r.get("date")]
    ledger.sort(key=lambda r: r["date"])
    if not ledger:
        return {"available": False, "reason": "SA ledger is empty", "signals": []}

    scores = [r.get("score") for r in ledger]
    try:
        bars = load_bars(800)
    except Exception as e:
        logger.warning("scorecard: index bars unavailable: %s", e)
        bars = {}
    # date → position within the bar frames (they share an index).
    bar_pos: dict = {}
    if bars:
        any_frame = next(iter(bars.values()))
        for p, d in enumerate(any_frame.index):
            bar_pos[d.isoformat() if hasattr(d, "isoformat") else str(d)] = p

    fired: dict[str, list[bool]] = {}
    for i in range(len(ledger)):
        keys = _signals_for(i, ledger, scores, bars, bar_pos)
        for k in set(list(LABELS.keys())) | keys:
            fired.setdefault(k, [False] * len(ledger))
        for k in keys:
            fired[k][i] = True

    # Unconditional base rate — what "any day" was worth.
    base = {h: _bucket([fwd[r["date"]][h] for r in ledger if r["date"] in fwd]) for h in HORIZONS}

    out = []
    for key, flags in fired.items():
        eps = _episodes(flags)
        n_days = sum(flags)
        if n_days == 0:
            continue
        by_h = {}
        for h in HORIZONS:
            vals = [fwd[r["date"]][h] for r, f in zip(ledger, flags)
                    if f and r["date"] in fwd and fwd[r["date"]][h] is not None]
            b = _bucket(vals)
            b["lift"] = (round(b["avg"] - base[h]["avg"], 5)
                         if b["avg"] is not None and base[h]["avg"] is not None else None)
            by_h[h] = b
        out.append({
            "key": key,
            "label": LABELS.get(key, key),
            "days": n_days,
            "episodes": eps,
            "reliability": ("measured" if eps >= MIN_EPISODES_RELIABLE
                            else "tentative" if eps >= MIN_EPISODES_TENTATIVE
                            else "insufficient"),
            "by_horizon": by_h,
        })

    # Best lift at the 10-day horizon first — the swing-relevant window.
    def _sort_key(s):
        b = s["by_horizon"].get(10) or {}
        return -(b.get("lift") if b.get("lift") is not None else -99)
    out.sort(key=_sort_key)

    return {
        "available": True,
        "as_of": ledger[-1]["date"],
        "forward_as_of": fwd_as_of,
        "ledger_days": len(ledger),
        "horizons": list(HORIZONS),
        "base_rate": base,
        "signals": out,
        "thresholds": {
            "min_episodes_reliable": MIN_EPISODES_RELIABLE,
            "min_episodes_tentative": MIN_EPISODES_TENTATIVE,
        },
    }
