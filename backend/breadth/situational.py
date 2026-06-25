"""Situational Awareness — turn raw Stockbee breadth into setup-specific posture.

The Market Monitor page shows the breadth *numbers* (4% movers, 5/10-day
ratios, T2108, quarterly/monthly leadership). This module answers the trader's
real question: **given this tape, how aggressive should I be, and which setups
are in season right now?**

It follows Stockbee's idea that situational awareness is *setup-specific* — a
breakout filter and a mean-reversion filter read the very same breadth in
opposite directions — so instead of a single regime label it emits an exposure
score + stance, a light per setup family, the drivers behind the score, and the
exposure trend across recent sessions.

Design note — **rules as data.** The scoring factors and the per-setup
conditions are declared as tables (`FACTORS`, `SETUPS`) and evaluated by a tiny
engine. The same evaluation produces (a) the score/lights used for the read and
(b) the `criteria` payload the UI renders, so what's displayed can never drift
from what's computed. Everything is derived from the local breadth cache rows
produced by `calculator.compute_history()`; this module never hits the network.
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# Tiny comparison engine
# ---------------------------------------------------------------------------

_CMP_SYM = {">=": "≥", "<=": "≤", ">": ">", "<": "<"}


def _cmp(val: float, op: str, t: float) -> bool:
    if op == ">=":
        return val >= t
    if op == "<=":
        return val <= t
    if op == ">":
        return val > t
    if op == "<":
        return val < t
    return False


def _fmt2(v):
    return f"{v:.2f}"


def _fmt_int(v):
    return f"{int(v)}"


def _fmt_signed(v):
    return f"{'+' if v >= 0 else ''}{int(v)}"


def _fmt_pct0(v):
    return f"{v:.0f}%"


# --- composite value getters (None-safe) ---

def _v_net4(r):
    a, b = r.get("up_4"), r.get("down_4")
    return None if a is None or b is None else a - b


def _v_qdiff(r):
    a, b = r.get("qtr_up_25"), r.get("qtr_down_25")
    return None if a is None or b is None else a - b


def _v_mdiff(r):
    a, b = r.get("mo_up_25"), r.get("mo_down_25")
    return None if a is None or b is None else a - b


# ---------------------------------------------------------------------------
# Scoring factors
#
# Each factor reads one (possibly composite) breadth value and maps it to a
# point contribution off the neutral 50 baseline via the FIRST matching tier.
# Weights mirror how much each signal matters to a swing-breakout trader: the
# 10-day 4% thrust (Stockbee's primary signal) carries the most, quarterly
# leadership next, with shorter-term and positioning signals as modifiers.
#
# Tier tuple: (op, threshold, points, tone, description).
# ---------------------------------------------------------------------------

FACTORS = [
    {
        "key": "ratio_10d", "label": "10-day thrust", "noun": "10-day 4% ratio",
        "value": lambda r: r.get("ratio_10d"), "fmt": _fmt2, "neutral": "balanced (0.9–1.1)",
        "tiers": [
            (">=", 2.0, 20, "bull", "powerful thrust"),
            (">=", 1.5, 12, "bull", "bullish"),
            (">=", 1.1, 5, "bull", "mildly positive"),
            ("<=", 0.5, -20, "bear", "bearish thrust"),
            ("<=", 0.7, -12, "bear", "weak / distribution"),
            ("<", 0.9, -5, "bear", "soft"),
        ],
    },
    {
        "key": "ratio_5d", "label": "5-day thrust", "noun": "5-day 4% ratio",
        "value": lambda r: r.get("ratio_5d"), "fmt": _fmt2, "neutral": "flat short-term",
        "tiers": [
            (">=", 1.7, 8, "bull", "strong short-term push"),
            (">=", 1.2, 4, "bull", "positive short-term"),
            ("<=", 0.5, -8, "bear", "short-term selling"),
            ("<=", 0.8, -4, "bear", "soft short-term"),
        ],
    },
    {
        "key": "net_4", "label": "Primary breadth", "value": _v_net4, "fmt": _fmt_signed,
        "context": lambda r: f"{r.get('up_4')} up 4% vs {r.get('down_4')} down", "neutral": "balanced tape",
        "tiers": [
            (">=", 300, 8, "bull", "strong buying day"),
            (">=", 100, 4, "bull", "net buying"),
            ("<=", -300, -8, "bear", "heavy selling day"),
            ("<=", -100, -4, "bear", "net selling"),
        ],
    },
    {
        "key": "qtr_diff", "label": "Leadership (Qtr ±25%)", "value": _v_qdiff, "fmt": _fmt_signed,
        "context": lambda r: f"{r.get('qtr_up_25')} up 25%+ this quarter vs {r.get('qtr_down_25')} down",
        "neutral": "mixed leadership",
        "tiers": [
            (">=", 400, 15, "bull", "broad leadership"),
            (">=", 150, 9, "bull", "positive leadership"),
            ("<=", -400, -15, "bear", "broad damage"),
            ("<=", -150, -9, "bear", "negative leadership"),
        ],
    },
    {
        "key": "mo_diff", "label": "Monthly leadership", "value": _v_mdiff, "fmt": _fmt_signed,
        "context": lambda r: f"{r.get('mo_up_25')} up 25% in a month vs {r.get('mo_down_25')} down",
        "neutral": "no monthly skew",
        "tiers": [
            (">=", 150, 6, "bull", "monthly buyers in control"),
            ("<=", -150, -6, "bear", "monthly sellers in control"),
        ],
    },
    {
        "key": "t2108", "label": "Positioning (T2108)", "noun": "T2108",
        "value": lambda r: r.get("t2108"), "fmt": _fmt_pct0, "neutral": "healthy mid-range",
        "tiers": [
            (">=", 80, -6, "warn", "overbought, chase risk"),
            ("<=", 20, -6, "warn", "washed out / oversold"),
            ("<=", 35, -2, "warn", "below the midline"),
        ],
    },
    {
        "key": "mo_up_50", "label": "Froth (Mo +50%)",
        "value": lambda r: r.get("mo_up_50"), "fmt": _fmt_int, "neutral": "no froth",
        "context": lambda r: f"{r.get('mo_up_50')} stocks up 50% in a month",
        "tiers": [
            (">", 50, -4, "warn", "frothy"),
        ],
    },
]


def _evaluate_factor(factor: dict, row: dict) -> dict:
    """Evaluate one factor against a row → {points, tone, detail, tier ladder}."""
    val = factor["value"](row)
    tiers_view = []
    matched = None
    if val is not None:
        for tier in factor["tiers"]:
            op, t, pts, tone, desc = tier
            if matched is None and _cmp(val, op, t):
                matched = tier
    for tier in factor["tiers"]:
        op, t, pts, tone, desc = tier
        tiers_view.append({
            "label": f"{_CMP_SYM[op]} {t}", "points": pts, "tone": tone, "desc": desc,
            "active": matched is tier,
        })

    if val is None:
        return {
            "key": factor["key"], "label": factor["label"], "available": False,
            "value": None, "raw": None, "points": 0, "tone": "neutral",
            "active_desc": "no data", "detail": None,
            "neutral": factor.get("neutral"), "tiers": tiers_view,
        }

    valstr = factor["fmt"](val)
    if matched is not None:
        op, t, pts, tone, desc = matched
        if factor.get("context"):
            detail = f"{factor['context'](row)} — {desc}"
        elif factor.get("noun"):
            detail = f"{factor['noun']} {valstr} — {desc}"
        else:
            detail = f"{factor['label']} {valstr} — {desc}"
        return {
            "key": factor["key"], "label": factor["label"], "available": True,
            "value": valstr, "raw": val, "points": pts, "tone": tone,
            "active_desc": desc, "detail": detail,
            "neutral": factor.get("neutral"), "tiers": tiers_view,
        }

    # No tier matched → neutral, 0 points.
    return {
        "key": factor["key"], "label": factor["label"], "available": True,
        "value": valstr, "raw": val, "points": 0, "tone": "neutral",
        "active_desc": factor.get("neutral"), "detail": None,
        "neutral": factor.get("neutral"), "tiers": tiers_view,
    }


def evaluate_factors(row: dict) -> list[dict]:
    return [_evaluate_factor(f, row) for f in FACTORS]


def _score_from_factors(evs: list[dict]) -> float:
    return max(0.0, min(100.0, 50.0 + sum(e["points"] for e in evs)))


def _drivers_from_factors(evs: list[dict]) -> list[dict]:
    ds = [
        {"label": e["label"], "points": e["points"], "detail": e["detail"], "tone": e["tone"]}
        for e in evs if e["available"] and e["points"] != 0
    ]
    return sorted(ds, key=lambda d: -abs(d["points"]))


# ---------------------------------------------------------------------------
# Overall stance
# ---------------------------------------------------------------------------

_STANCE = {
    "aggressive": {
        "label": "Aggressive", "headline": "Press exposure",
        "exposure": "75–100% long · full size on A+ setups",
        "action": "Thrust is on. Add aggressively on quality breakouts, let winners run, only trim into froth.",
    },
    "constructive": {
        "label": "Constructive", "headline": "Lean long",
        "exposure": "50–75% long · normal size",
        "action": "Constructive tape. Take quality breakouts at normal size and add on confirmation; keep stops honest.",
    },
    "selective": {
        "label": "Selective", "headline": "Be picky",
        "exposure": "25–50% long · A+ only, reduced size",
        "action": "Mixed tape. Demand A+ setups only, cut size, take partials quickly and don't chase extensions.",
    },
    "defensive": {
        "label": "Defensive", "headline": "Protect capital",
        "exposure": "0–25% long · trim & raise stops",
        "action": "Distribution underway. Avoid fresh long breakouts, raise stops, bank gains and sit on hands.",
    },
    "cash": {
        "label": "Risk-off", "headline": "Mostly cash",
        "exposure": "Cash-heavy · capital preservation",
        "action": "Washed-out / heavy selling. Stand aside; only small oversold mean-reversion probes, no trend longs.",
    },
}

# (level, min, max) — inclusive score bands, highest first.
_BANDS = [
    ("aggressive", 75, 100),
    ("constructive", 60, 74),
    ("selective", 45, 59),
    ("defensive", 30, 44),
    ("cash", 0, 29),
]


def _stance_level(score: float) -> str:
    for level, lo, _hi in _BANDS:
        if score >= lo:
            return level
    return "cash"


def _stance_bands(active_level: str) -> list[dict]:
    return [
        {
            "level": lv, "min": lo, "max": hi,
            "label": _STANCE[lv]["label"], "headline": _STANCE[lv]["headline"],
            "exposure": _STANCE[lv]["exposure"], "active": lv == active_level,
        }
        for lv, lo, hi in _BANDS
    ]


# ---------------------------------------------------------------------------
# Setup-specific conditions
#
# The heart of "SA is setup-specific": each family reads the same breadth block
# through its own lens. A setup is GREEN when *all* of its green conditions hold,
# RED when *any* red condition holds (green wins ties), else AMBER. Every
# condition is (label, test(row)->bool, show(row)->str) so the UI can render the
# live ✓/✗ checklist straight from the same rules that decide the light.
# ---------------------------------------------------------------------------

def _t_show(r):
    t = r.get("t2108")
    return f"{t:.0f}%" if t is not None else "n/a"


SETUPS = [
    {
        "key": "breakout", "name": "Momentum Breakouts",
        "blurb": "Continuation breakouts from tight bases (Qullamaggie / $9M).",
        "requires": ("ratio_10d", "up_4", "down_4"),
        "green": [
            ("10-day ratio ≥ 1.5", lambda r: r["ratio_10d"] >= 1.5, lambda r: f"{r['ratio_10d']:.2f}"),
            ("≥ 200 stocks up 4%", lambda r: r["up_4"] >= 200, lambda r: f"{r['up_4']}"),
            ("< 300 stocks down 4%", lambda r: r["down_4"] < 300, lambda r: f"{r['down_4']}"),
            ("T2108 < 80 (not overbought)", lambda r: r.get("t2108") is None or r["t2108"] < 80, _t_show),
        ],
        "red": [
            ("10-day ratio ≤ 0.7", lambda r: r["ratio_10d"] <= 0.7, lambda r: f"{r['ratio_10d']:.2f}"),
            ("≥ 350 down 4% with downs ≈ ups", lambda r: r["down_4"] >= 350 and r["down_4"] >= r["up_4"] * 0.9,
             lambda r: f"{r['down_4']} dn / {r['up_4']} up"),
            ("T2108 ≤ 20 (washed out)", lambda r: r.get("t2108") is not None and r["t2108"] <= 20, _t_show),
        ],
    },
    {
        "key": "ep", "name": "Episodic Pivots / Gaps",
        "blurb": "Earnings & news gap-ups, momentum pivots.",
        "requires": ("ratio_10d", "up_4", "down_4"),
        "green": [
            ("≥ 150 stocks up 4%", lambda r: r["up_4"] >= 150, lambda r: f"{r['up_4']}"),
            ("10-day ratio ≥ 1.0", lambda r: r["ratio_10d"] >= 1.0, lambda r: f"{r['ratio_10d']:.2f}"),
            ("monthly leadership ≥ 0", lambda r: _v_mdiff(r) is None or _v_mdiff(r) >= 0,
             lambda r: _fmt_signed(_v_mdiff(r)) if _v_mdiff(r) is not None else "n/a"),
        ],
        "red": [
            ("≥ 400 stocks down 4%", lambda r: r["down_4"] >= 400, lambda r: f"{r['down_4']}"),
            ("10-day ratio ≤ 0.6", lambda r: r["ratio_10d"] <= 0.6, lambda r: f"{r['ratio_10d']:.2f}"),
        ],
    },
    {
        "key": "pullback", "name": "Pullbacks in Uptrend",
        "blurb": "Buying orderly dips in leading stocks.",
        "requires": ("qtr_up_25", "qtr_down_25"),
        "green": [
            ("Qtr leadership ≥ +150", lambda r: _v_qdiff(r) >= 150, lambda r: _fmt_signed(_v_qdiff(r))),
            ("T2108 in 35–70 (cooled, not broken)",
             lambda r: r.get("t2108") is not None and 35 <= r["t2108"] <= 70, _t_show),
            ("10-day ratio ≥ 0.9", lambda r: r.get("ratio_10d") is None or r["ratio_10d"] >= 0.9,
             lambda r: f"{r['ratio_10d']:.2f}" if r.get("ratio_10d") is not None else "n/a"),
        ],
        "red": [
            ("Qtr leadership ≤ -150", lambda r: _v_qdiff(r) <= -150, lambda r: _fmt_signed(_v_qdiff(r))),
            ("10-day ratio ≤ 0.7", lambda r: r.get("ratio_10d") is not None and r["ratio_10d"] <= 0.7,
             lambda r: f"{r['ratio_10d']:.2f}" if r.get("ratio_10d") is not None else "n/a"),
        ],
    },
    {
        "key": "mean_reversion", "name": "Mean-Reversion Bounce",
        "blurb": "Oversold snap-backs from capitulation.",
        "requires": (),
        "green": [
            ("T2108 ≤ 25 (washed out)", lambda r: r.get("t2108") is not None and r["t2108"] <= 25, _t_show),
            ("OR ≥ 400 down 4% with selling dominant",
             lambda r: r.get("down_4") is not None and r["down_4"] >= 400
             and (r.get("up_4") is None or r["down_4"] >= r["up_4"] * 1.3),
             lambda r: f"{r.get('down_4')} dn / {r.get('up_4')} up"),
        ],
        "green_any": True,  # capitulation OR a dominant down-day
        "red": [
            ("T2108 ≥ 70 (overbought, no edge)", lambda r: r.get("t2108") is not None and r["t2108"] >= 70, _t_show),
        ],
    },
    {
        "key": "short", "name": "Shorts / Hedges",
        "blurb": "Breakdown shorts and portfolio hedges.",
        "requires": ("ratio_10d",),
        "green": [
            ("10-day ratio ≤ 0.7", lambda r: r["ratio_10d"] <= 0.7, lambda r: f"{r['ratio_10d']:.2f}"),
            ("≥ 250 down 4% or Qtr leadership ≤ -150",
             lambda r: (r.get("down_4") is not None and r["down_4"] >= 250)
             or (_v_qdiff(r) is not None and _v_qdiff(r) <= -150),
             lambda r: f"{r.get('down_4')} dn"),
        ],
        "red": [
            ("10-day ratio ≥ 1.5 (don't fight a thrust)", lambda r: r["ratio_10d"] >= 1.5,
             lambda r: f"{r['ratio_10d']:.2f}"),
        ],
    },
]


def _why(key: str, light: str, r: dict) -> str:
    r10 = r.get("ratio_10d")
    up4, dn4 = r.get("up_4"), r.get("down_4")
    qup, qdn = r.get("qtr_up_25"), r.get("qtr_down_25")
    t = r.get("t2108")
    if key == "breakout":
        if light == "green":
            return f"10-day ratio {r10:.2f} with {up4} stocks up 4% — buyers are paying up, breakouts follow through."
        if light == "red":
            return f"10-day ratio {r10:.2f}, {dn4} down 4% — breakouts are failing into supply. Step back."
        return f"10-day ratio {r10:.2f} — no clean thrust. Take only the best, expect more failures."
    if key == "ep":
        if light == "green":
            return f"{up4} fresh 4% movers and a {r10:.2f} thrust — gap-ups have follow-through fuel."
        if light == "red":
            return "Selling pressure is broad — even good catalysts get sold. Size down hard."
        return "Catalysts can still work, but breadth isn't helping — react, don't anticipate."
    if key == "pullback":
        if light == "green":
            return f"Leadership intact ({qup} qtr-up vs {qdn} down) and T2108 {t:.0f}% — leaders are catching their breath."
        if light == "red":
            return "Trend is broken — 'dips' keep getting deeper. Not a dip-buying tape."
        return "Trend is okay but stretched or soft — wait for leaders to set up tighter."
    if key == "mean_reversion":
        if light == "green":
            note = f"T2108 {t:.0f}%" if t is not None else f"{dn4} down 4%"
            return f"{note} — washed out. High-quality oversold names can snap back; size small, quick targets."
        if light == "red":
            return f"T2108 {t:.0f}% — overbought, no oversold edge here. Reversion shorts, not longs."
        return "Not stretched enough for a reliable bounce — no edge yet."
    if key == "short":
        if light == "green":
            return f"10-day ratio {r10:.2f} with broad damage — the path of least resistance is down."
        if light == "red":
            return f"10-day ratio {r10:.2f} — don't short into an up-thrust. Hedges only."
        return "No clear downtrend — shorting is a coin-flip. Stay patient."
    return ""


_VERDICT = {"green": "In season", "amber": "Mixed", "red": "Out of season"}


def _eval_setup(spec: dict, row: dict) -> dict | None:
    if any(row.get(k) is None for k in spec["requires"]):
        return None
    greens = [{"label": l, "value": show(row), "met": bool(test(row))} for (l, test, show) in spec["green"]]
    reds = [{"label": l, "value": show(row), "met": bool(test(row))} for (l, test, show) in spec["red"]]
    # Most setups need *all* green conditions; mean-reversion is an OR (either
    # a washed-out T2108 or a dominant down-day signals a bounce window).
    green_ok = any(g["met"] for g in greens) if spec.get("green_any") else all(g["met"] for g in greens)
    red_ok = any(x["met"] for x in reds)
    light = "green" if green_ok else "red" if red_ok else "amber"
    return {
        "key": spec["key"], "name": spec["name"], "blurb": spec["blurb"],
        "light": light, "verdict": _VERDICT[light], "why": _why(spec["key"], light, row),
        "criteria": {"green": greens, "red": reds, "green_mode": "any" if spec.get("green_any") else "all"},
    }


def evaluate_setups(row: dict) -> list[dict]:
    out = []
    for spec in SETUPS:
        ev = _eval_setup(spec, row)
        if ev is not None:
            out.append(ev)
    return out


# ---------------------------------------------------------------------------
# Compact ledger record (used by sa_history for the persistent daily history)
# ---------------------------------------------------------------------------

_RECORD_METRICS = (
    "ratio_10d", "ratio_5d", "up_4", "down_4",
    "qtr_up_25", "qtr_down_25", "mo_up_25", "mo_down_25", "mo_up_50", "t2108",
)


def compact_record(row: dict) -> dict:
    """One persistable day: score, stance level, per-setup lights, key metrics."""
    evs = evaluate_factors(row)
    score = int(round(_score_from_factors(evs)))
    setups = evaluate_setups(row)
    return {
        "date": row["date"],
        "score": score,
        "level": _stance_level(score),
        "lights": {s["key"]: s["light"] for s in setups},
        "metrics": {k: row.get(k) for k in _RECORD_METRICS},
    }


# ---------------------------------------------------------------------------
# Explanation — the "how & why" narrative
# ---------------------------------------------------------------------------

def _explain(score: int, level: str, evs: list[dict]) -> dict:
    bull = sum(e["points"] for e in evs if e["points"] > 0)
    bear = -sum(e["points"] for e in evs if e["points"] < 0)
    positives = [e["label"] for e in sorted(evs, key=lambda e: -e["points"]) if e["points"] > 0][:3]
    negatives = [e["label"] for e in sorted(evs, key=lambda e: e["points"]) if e["points"] < 0][:2]

    band = next((b for b in _BANDS if b[0] == level), _BANDS[-1])
    _lv, lo, hi = band

    # Distance to the adjacent bands.
    idx = [b[0] for b in _BANDS].index(level)
    to_up = None
    if idx > 0:
        up_level, up_lo, _ = _BANDS[idx - 1]
        to_up = {"level": up_level, "label": _STANCE[up_level]["label"], "threshold": up_lo, "gain_needed": up_lo - score}
    to_down = None
    if idx < len(_BANDS) - 1:
        down_level = _BANDS[idx + 1][0]
        to_down = {"level": down_level, "label": _STANCE[down_level]["label"], "threshold": lo, "drop_to": lo}

    parts = [
        f"Exposure scores {score}/100 — the {_STANCE[level]['label']} band ({lo}–{hi})."
    ]
    if positives:
        lead = ", ".join(positives)
        parts.append(f"Bullish breadth adds +{bull} from the neutral 50 baseline" + (f", led by {lead}." if lead else "."))
    elif bull:
        parts.append(f"Bullish breadth adds +{bull} from the neutral 50 baseline.")
    if negatives:
        parts.append(f"Offsetting drag of -{bear} from {', '.join(negatives)}.")
    elif bear:
        parts.append(f"Offsetting drag of -{bear}.")
    if to_up and to_down:
        parts.append(
            f"A {to_up['gain_needed']}-point gain (≥ {to_up['threshold']}) would flip the stance to "
            f"{to_up['label']}; a drop below {to_down['threshold']} would turn it {to_down['label']}."
        )
    elif to_down:  # aggressive (top band)
        parts.append(f"A drop below {to_down['threshold']} would step the stance down to {to_down['label']}.")
    elif to_up:  # cash (bottom band)
        parts.append(f"A {to_up['gain_needed']}-point gain (≥ {to_up['threshold']}) would lift the stance to {to_up['label']}.")

    return {
        "summary": " ".join(parts),
        "bull_points": bull,
        "bear_points": bear,
        "baseline": 50,
        "positives": positives,
        "negatives": negatives,
        "to_up": to_up,
        "to_down": to_down,
    }


# ---------------------------------------------------------------------------
# Public surface
# ---------------------------------------------------------------------------

def _breakout_takeaway(setups: list[dict]) -> str:
    """One punchy, breakout-centric line for the dashboard snippet — mirrors
    the trader's actual decision: when to be aggressive vs. step back."""
    bo = next((s for s in setups if s["key"] == "breakout"), None)
    if not bo:
        return "No breadth read yet — refresh the cache."
    if bo["light"] == "green":
        return "Breakouts are in season — be aggressive."
    if bo["light"] == "red":
        return "Breakouts are struggling — step back."
    return "Mixed tape — be selective on breakouts."


def assess(rows: list[dict], universe_size: int = 0, universe_as_of: str | None = None) -> dict:
    """Build the full situational-awareness payload from breadth history rows.

    `rows` is oldest→newest, as returned by `calculator.compute_history()`.
    The newest row is the live read; earlier rows feed the exposure trend.
    """
    if not rows:
        return {
            "as_of": None,
            "score": None,
            "stance": {"level": "neutral", "label": "No data", "headline": "Refresh breadth",
                       "exposure": "—", "action": "Refresh the breadth cache on Market Monitor to compute a read."},
            "breakout_takeaway": "No breadth data cached yet.",
            "drivers": [],
            "setups": [],
            "criteria": {"factors": [], "stance_bands": _stance_bands("neutral")},
            "explanation": None,
            "trend": [],
            "score_delta_5d": None,
            "metrics": None,
            "coverage": {"count": 0, "universe_size": universe_size},
            "universe_as_of": universe_as_of,
        }

    latest = rows[-1]
    evs = evaluate_factors(latest)
    score = int(round(_score_from_factors(evs)))
    level = _stance_level(score)
    setups = evaluate_setups(latest)
    drivers = _drivers_from_factors(evs)

    # Exposure trend: score each row so the UI can chart improving/deteriorating.
    trend = [{"date": r["date"], "score": int(round(_score_from_factors(evaluate_factors(r))))} for r in rows]
    prev = trend[-6]["score"] if len(trend) >= 6 else trend[0]["score"]
    delta = score - prev

    metrics = {k: latest.get(k) for k in _RECORD_METRICS}

    return {
        "as_of": latest["date"],
        "score": score,
        "stance": {"level": level, **_STANCE[level]},
        "breakout_takeaway": _breakout_takeaway(setups),
        "drivers": drivers,
        "setups": setups,
        "criteria": {"factors": evs, "stance_bands": _stance_bands(level)},
        "explanation": _explain(score, level, evs),
        "trend": trend,
        "score_delta_5d": delta,
        "metrics": metrics,
        "coverage": {
            "count": latest.get("coverage_count"),
            "universe_size": latest.get("universe_size", universe_size),
        },
        "universe_as_of": universe_as_of,
    }
