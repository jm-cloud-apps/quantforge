"""Deterministic composite ranking for AI Trader ideas.

The LLM is good at *selecting* and *explaining* setups but is a non-deterministic
sort key. So we keep the model for selection/thesis, then re-rank the surviving
ideas with a transparent, reproducible score built from the scan's hard numbers.
Every idea carries its `composite_score` (0-100) and a `score_breakdown` so the
ordering is auditable and back-testable on its own.
"""

from __future__ import annotations


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def _adr_quality(adr_pct: float | None) -> float:
    """Sweet-spot curve: enough range to reach targets, not a low-float pump.
    Full credit ~5-12% ADR, tapering to 0 below 2% and above ~25%."""
    if adr_pct is None:
        return 0.4  # unknown ⇒ neutral-ish
    if adr_pct <= 0:
        return 0.0
    if adr_pct < 5:
        return _clamp((adr_pct - 1.5) / 3.5)      # ramp 1.5%→5%
    if adr_pct <= 12:
        return 1.0                                 # ideal band
    if adr_pct <= 25:
        return _clamp(1 - (adr_pct - 12) / 13)     # taper 12%→25%
    return 0.0                                      # junk-volatile


# factor → weight (sums to 1.0). qs_score is the backbone; the rest shade it.
_WEIGHTS = {
    "qs_score": 0.40,   # the screener's own breakout score
    "rr": 0.20,         # reward:risk to first target
    "adr": 0.15,        # tradeable volatility (sweet-spot)
    "rvol": 0.15,       # in-play today
    "proximity": 0.10,  # close to the pivot ⇒ less chase risk
}


def composite_score(idea: dict, stats: dict | None) -> dict:
    """Return {score: 0-100, breakdown: [{factor, weight, value, points}]}.

    `idea` carries entry/stop/target/rr_to_target; `stats` is the compact scan row.
    Pure function of the numbers — no randomness, no model call."""
    s = stats or {}

    qs = _clamp((s.get("qs_score") or 0) / 100.0)
    rr = idea.get("rr_to_target")
    rr_norm = _clamp((rr or 0) / 3.0)              # 3R+ ⇒ full credit
    adr_norm = _adr_quality(s.get("adr_pct"))
    rvol = s.get("rvol")
    rvol_norm = _clamp((rvol or 0) / 3.0)          # 3x+ RVOL ⇒ full credit

    dist = s.get("dist_to_pivot_pct")
    # Best when within a few % of the pivot (above or below); fades by ~15% away.
    prox_norm = _clamp(1 - abs(dist) / 15.0) if dist is not None else 0.5

    values = {
        "qs_score": qs, "rr": rr_norm, "adr": adr_norm,
        "rvol": rvol_norm, "proximity": prox_norm,
    }
    breakdown = []
    total = 0.0
    for factor, weight in _WEIGHTS.items():
        val = values[factor]
        pts = round(weight * val * 100, 1)
        total += pts
        breakdown.append({"factor": factor, "weight": weight,
                          "value": round(val, 3), "points": pts})
    return {"score": round(total, 1), "breakdown": breakdown}


def rank_ideas(ideas: list[dict]) -> list[dict]:
    """Annotate each idea with composite_score/score_breakdown and return them
    sorted by that score (desc) — a stable, reproducible final ordering."""
    for idea in ideas:
        cs = composite_score(idea, idea.get("stats"))
        idea["composite_score"] = cs["score"]
        idea["score_breakdown"] = cs["breakdown"]
    ideas.sort(key=lambda i: (i.get("composite_score") or 0), reverse=True)
    return ideas
