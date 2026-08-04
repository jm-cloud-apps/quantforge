"""Map a breadth metric block to a regime read — a *description* of the tape.

The level is derived from the same 0–100 exposure score the Trade Today gauge
shows (`situational.exposure_score`), not from an independent vote tally. It
used to be its own ±1/±2 heuristic over four inputs, and the two surfaces
drifted apart: on 2026-07-31 this module returned "Neutral / mixed — trade
selectively" while the exposure model scored the same row 35/100 Defensive
("no new longs"). The tally missed it because a 10-day ratio of 0.74 fell into
a gap between its ≥1.5 and ≤0.7 rungs and cast no vote at all, and because it
never looked at monthly leadership or froth.

Deriving from the score fixes that by construction. The label still adds
something the score can't: it re-reads the two *ends* by context — a high score
with stretched positioning is "overheated" (a warning, not a green light), and
a low score with washed-out positioning is "capitulation" (oversold, where
reversals live) rather than plain "bearish". That non-monotonicity is exactly
why this ladder describes the tape and the gauge does the sizing.

The reasons/warnings below still follow Stockbee's published rules of thumb:

  Primary breadth (1-day 4% movers)
    up_4   >= 500  : strong buying / thrust
    up_4   >= 300  : notable buying
    up_4   <= 150  : weak tape
    down_4 >= 500  : panic / capitulation selling
    down_4 >= 300  : meaningful distribution

  10-day 4% ratio
    >= 2.0  : strong bullish thrust
    >= 1.5  : bullish
    <= 0.5  : bearish thrust
    <= 0.7  : weak

  Secondary breadth (longer-term leadership)
    qtr_up_25 > qtr_down_25 + 200 : bullish skew
    qtr_down_25 > qtr_up_25 + 200 : bearish skew

  Overheated markers
    mo_up_50 > 50  : very overheated, pullback risk high
    mo_up_50 > 20  : warming, watch for shakeouts

  T2108 (% above SMA40 within universe)
    >= 80 : overbought
    <= 20 : oversold

The output classifies into one of five regime levels and bundles
human-readable reasons + warnings the UI can render directly.
"""

from __future__ import annotations

from .situational import exposure_score

LEVELS = (
    "capitulation",   # extreme selling, deeply oversold
    "bearish",        # distribution + weak breadth
    "neutral",        # mixed / consolidation
    "bullish",        # constructive breadth
    "overheated",     # bullish but stretched, pullback risk
)

# Score cuts, aligned to the exposure bands so the two ladders can't disagree:
# constructive/aggressive (60+) reads bullish, selective (45–59) neutral, and
# defensive/cash (≤44) bearish.
BULLISH_SCORE = 60
BEARISH_SCORE = 44

# Context markers that re-label the two ends (see the module docstring).
STRETCHED_T2108 = 80
STRETCHED_MO_UP_50 = 50
WASHED_T2108 = 20
WASHED_DOWN_4 = 500


def classify(metrics: dict | None) -> dict:
    """Return {level, score, summary, posture, reasons[], warnings[]}.

    `metrics` is the headline block from calculator.compute_snapshot().
    Tolerates missing fields gracefully — anything that's None just doesn't
    contribute a reason.
    """
    if not metrics:
        return {
            "level": "neutral",
            "score": None,
            "summary": "No breadth data available",
            "posture": "Refresh the cache to compute a read.",
            "reasons": [],
            "warnings": [],
        }

    reasons: list[str] = []
    warnings: list[str] = []

    up_4 = metrics.get("up_4")
    down_4 = metrics.get("down_4")
    r10 = metrics.get("ratio_10d")
    r5 = metrics.get("ratio_5d")
    qtr_up = metrics.get("qtr_up_25")
    qtr_dn = metrics.get("qtr_down_25")
    mo_up = metrics.get("mo_up_25")
    mo_dn = metrics.get("mo_down_25")
    mo_up_50 = metrics.get("mo_up_50")
    t2108 = metrics.get("t2108")

    # --- Primary (1-day) breadth ---
    if up_4 is not None and down_4 is not None:
        if up_4 >= 500:
            reasons.append(f"Powerful thrust: {up_4} stocks up 4%+ today.")
        elif up_4 >= 300:
            reasons.append(f"Notable buying: {up_4} stocks up 4%+ today.")
        if down_4 >= 500:
            reasons.append(f"Capitulation pressure: {down_4} stocks down 4%+ today.")
        elif down_4 >= 300:
            reasons.append(f"Meaningful distribution: {down_4} stocks down 4%+ today.")
        if up_4 < 150 and down_4 < 150:
            reasons.append("Quiet tape — no strong directional breadth today.")

    # --- 10-day ratio. Every rung is described; the old version left 0.7–0.9
    # and 1.1–1.5 unnamed, which is how a 0.74 tape read as "neutral". ---
    if r10 is not None:
        if r10 >= 2.0:
            reasons.append(f"10-day 4% breadth ratio is {r10:.2f} — strong bullish thrust.")
        elif r10 >= 1.5:
            reasons.append(f"10-day 4% breadth ratio is {r10:.2f} — bullish.")
        elif r10 >= 1.1:
            reasons.append(f"10-day 4% breadth ratio is {r10:.2f} — mildly positive.")
        elif r10 <= 0.5:
            reasons.append(f"10-day 4% breadth ratio is {r10:.2f} — bearish thrust.")
        elif r10 <= 0.7:
            reasons.append(f"10-day 4% breadth ratio is {r10:.2f} — weak / distribution.")
        elif r10 < 0.9:
            reasons.append(f"10-day 4% breadth ratio is {r10:.2f} — soft.")
        else:
            reasons.append(f"10-day 4% breadth ratio is {r10:.2f} — balanced.")

    if r5 is not None and r10 is not None and abs(r5 - r10) >= 0.3:
        reasons.append(
            f"Short-term is {'leading' if r5 > r10 else 'lagging'}: 5-day ratio {r5:.2f} vs 10-day {r10:.2f}."
        )

    # --- Secondary breadth (leadership) ---
    if qtr_up is not None and qtr_dn is not None:
        diff = qtr_up - qtr_dn
        if diff >= 200:
            reasons.append(
                f"Primary breadth is bullish: {qtr_up} quarter-up stocks vs {qtr_dn} quarter-down."
            )
        elif diff <= -200:
            reasons.append(
                f"Primary breadth is bearish: {qtr_dn} quarter-down stocks vs {qtr_up} quarter-up."
            )

    # --- Overheated markers ---
    if mo_up_50 is not None:
        if mo_up_50 > STRETCHED_MO_UP_50:
            warnings.append(
                f"50% one-month upside count is hot at {mo_up_50}; pullback risk is elevated."
            )
        elif mo_up_50 > 20:
            warnings.append(
                f"50% one-month upside count is warming at {mo_up_50}; expect shakeouts."
            )

    if mo_up is not None and mo_dn is not None and mo_dn >= mo_up * 2 and mo_dn >= 100:
        warnings.append(
            f"Monthly downside skew: {mo_dn} stocks down 25%+ vs {mo_up} up — watch leadership."
        )

    # --- T2108 oversold/overbought ---
    if t2108 is not None:
        if t2108 >= STRETCHED_T2108:
            warnings.append(f"T2108 at {t2108:.1f}% — overbought; chase risk elevated.")
        elif t2108 <= WASHED_T2108:
            reasons.append(f"T2108 at {t2108:.1f}% — broadly oversold, mean-reversion setup.")
        elif t2108 <= 35:
            reasons.append(f"T2108 at {t2108:.1f}% — washed out.")

    # --- Classify off the shared exposure score ---
    score = exposure_score(metrics)
    stretched = (
        (t2108 is not None and t2108 >= STRETCHED_T2108)
        or (mo_up_50 is not None and mo_up_50 > STRETCHED_MO_UP_50)
    )
    washed_out = (
        (t2108 is not None and t2108 <= WASHED_T2108)
        or (down_4 is not None and down_4 >= WASHED_DOWN_4)
    )

    if score >= BULLISH_SCORE:
        level = "overheated" if stretched else "bullish"
    elif score <= BEARISH_SCORE:
        level = "capitulation" if washed_out else "bearish"
    else:
        level = "neutral"

    summary, posture = _read_for(level)
    return {
        "score": score,
        "level": level,
        "summary": summary,
        "posture": posture,
        "reasons": reasons,
        "warnings": warnings,
    }


def _read_for(level: str) -> tuple[str, str]:
    """Headline + posture copy for each regime level."""
    if level == "capitulation":
        return (
            "Capitulation / washed out",
            "Aggressive selling pressure with deeply oversold breadth — high-quality reversal setups can work, but size small.",
        )
    if level == "bearish":
        return (
            "Bearish / distribution",
            "Reduce exposure, raise stops, avoid fresh long breakouts.",
        )
    if level == "neutral":
        return (
            "Neutral / mixed",
            "Trade selectively from the long side, demand A+ setups, keep size moderate.",
        )
    if level == "bullish":
        return (
            "Bullish / constructive",
            "Press winners, normal sizing on quality breakouts.",
        )
    if level == "overheated":
        return (
            "Overheated / pullback risk",
            "Trail winners and expect shakeouts. Breakouts may still work, but chase risk is elevated.",
        )
    return ("Unknown", "—")
