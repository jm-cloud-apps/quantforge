"""Map a breadth metric block to a regime read.

Thresholds follow Stockbee's published rules of thumb:

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

LEVELS = (
    "capitulation",   # extreme selling, deeply oversold
    "bearish",        # distribution + weak breadth
    "neutral",        # mixed / consolidation
    "bullish",        # constructive breadth
    "overheated",     # bullish but stretched, pullback risk
)


def classify(metrics: dict | None) -> dict:
    """Return {level, summary, posture, reasons[], warnings[]}.

    `metrics` is the headline block from calculator.compute_snapshot().
    Tolerates missing fields gracefully — anything that's None just doesn't
    contribute a reason.
    """
    if not metrics:
        return {
            "level": "neutral",
            "summary": "No breadth data available",
            "posture": "Refresh the cache to compute a read.",
            "reasons": [],
            "warnings": [],
        }

    reasons: list[str] = []
    warnings: list[str] = []
    bull_score = 0
    bear_score = 0

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
            bull_score += 2
        elif up_4 >= 300:
            reasons.append(f"Notable buying: {up_4} stocks up 4%+ today.")
            bull_score += 1
        if down_4 >= 500:
            reasons.append(f"Capitulation pressure: {down_4} stocks down 4%+ today.")
            bear_score += 2
        elif down_4 >= 300:
            reasons.append(f"Meaningful distribution: {down_4} stocks down 4%+ today.")
            bear_score += 1
        if up_4 < 150 and down_4 < 150:
            reasons.append("Quiet tape — no strong directional breadth today.")

    # --- 10-day ratio ---
    if r10 is not None:
        if r10 >= 2.0:
            reasons.append(f"10-day 4% breadth ratio is {r10:.2f} — strong bullish thrust.")
            bull_score += 2
        elif r10 >= 1.5:
            reasons.append(f"10-day 4% breadth ratio is {r10:.2f} — bullish.")
            bull_score += 1
        elif r10 <= 0.5:
            reasons.append(f"10-day 4% breadth ratio is {r10:.2f} — bearish thrust.")
            bear_score += 2
        elif r10 <= 0.7:
            reasons.append(f"10-day 4% breadth ratio is {r10:.2f} — weak.")
            bear_score += 1
        else:
            reasons.append(f"10-day 4% breadth ratio is {r10:.2f}.")

    # --- Secondary breadth (leadership) ---
    if qtr_up is not None and qtr_dn is not None:
        diff = qtr_up - qtr_dn
        if diff >= 200:
            reasons.append(
                f"Primary breadth is bullish: {qtr_up} quarter-up stocks vs {qtr_dn} quarter-down."
            )
            bull_score += 1
        elif diff <= -200:
            reasons.append(
                f"Primary breadth is bearish: {qtr_dn} quarter-down stocks vs {qtr_up} quarter-up."
            )
            bear_score += 1

    # --- Overheated markers (warnings, not regime votes) ---
    if mo_up_50 is not None:
        if mo_up_50 > 50:
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
        if t2108 >= 80:
            warnings.append(f"T2108 at {t2108:.1f}% — overbought; chase risk elevated.")
            # Don't count as bear; just temper the bull read into 'overheated'.
        elif t2108 <= 20:
            reasons.append(f"T2108 at {t2108:.1f}% — broadly oversold, mean-reversion setup.")
            bear_score = max(0, bear_score - 1)  # oversold contradicts pure-bear
        elif t2108 <= 35:
            reasons.append(f"T2108 at {t2108:.1f}% — washed out.")

    # --- Classify ---
    net = bull_score - bear_score
    if bear_score >= 4 and (t2108 is not None and t2108 <= 20):
        level = "capitulation"
    elif net <= -2:
        level = "bearish"
    elif net >= 2 and (
        (mo_up_50 is not None and mo_up_50 > 50)
        or (t2108 is not None and t2108 >= 80)
    ):
        level = "overheated"
    elif net >= 2:
        level = "bullish"
    else:
        level = "neutral"

    summary, posture = _read_for(level)
    return {
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
