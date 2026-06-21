"""Market-regime read for AI Trader.

Breakout/momentum strategies make their money in healthy, broad tapes and bleed
in chop and downtrends. Before surfacing long ideas we pull the breadth snapshot
and classify the regime, so we can (a) tell the model to raise its bar in hostile
conditions and (b) warn the user. Best-effort: if the breadth cache is cold this
degrades to a neutral read rather than failing the whole request.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# How favorable each regime is for fresh long breakouts. Scales the suggested
# portfolio risk and signals how selective the model should be.
_RISK_POSTURE = {
    "bullish": {"factor": 1.0, "stance": "favorable", "selectivity": "normal"},
    "overheated": {"factor": 0.6, "stance": "extended", "selectivity": "raised"},
    "neutral": {"factor": 0.7, "stance": "mixed", "selectivity": "raised"},
    "bearish": {"factor": 0.35, "stance": "hostile", "selectivity": "strict"},
    "capitulation": {"factor": 0.2, "stance": "hostile", "selectivity": "strict"},
}


def get_regime() -> dict:
    """Return a compact regime block for the response and the prompt.

    Shape: {level, summary, posture, stance, risk_factor, selectivity,
            warnings[], as_of, available}."""
    try:
        from breadth.calculator import compute_snapshot
        snap = compute_snapshot()
        metrics = snap.get("metrics")
    except Exception as e:  # cold cache, import guard, etc.
        logger.warning("ai_trader regime read failed: %s", e)
        return _unavailable()
    return classify_metrics(metrics, as_of=snap.get("as_of"))


def _unavailable() -> dict:
    return {
        "level": "unknown", "summary": "Breadth data unavailable",
        "posture": "No regime read — trade with extra care.",
        "stance": "unknown", "risk_factor": 0.7, "selectivity": "raised",
        "warnings": [], "reasons": [], "as_of": None, "available": False,
    }


def classify_metrics(metrics: dict | None, as_of: str | None = None) -> dict:
    """Compact regime block from a raw breadth metric dict. Shared by the live
    snapshot and the historical (backtest) path so both read identically."""
    if not metrics:
        return _unavailable()
    try:
        from breadth.regime import classify
        read = classify(metrics)
    except Exception as e:
        logger.warning("ai_trader classify failed: %s", e)
        return _unavailable()
    level = read.get("level", "neutral")
    posture = _RISK_POSTURE.get(level, _RISK_POSTURE["neutral"])
    return {
        "level": level,
        "summary": read.get("summary"),
        "posture": read.get("posture"),
        "stance": posture["stance"],
        "risk_factor": posture["factor"],
        "selectivity": posture["selectivity"],
        "warnings": read.get("warnings", []),
        "reasons": read.get("reasons", [])[:4],
        "as_of": as_of,
        "available": True,
    }


def regime_rows() -> list[dict]:
    """All historical breadth metric rows (date-stamped), newest data last.
    Used to read the regime as-of a past date for backtesting. Best-effort."""
    try:
        from breadth.calculator import compute_history
        hist = compute_history(days=400)
        return hist.get("rows", []) or []
    except Exception as e:
        logger.warning("ai_trader regime_rows failed: %s", e)
        return []


_METRIC_KEYS = ("up_4", "down_4", "ratio_5d", "ratio_10d", "qtr_up_25",
                "qtr_down_25", "mo_up_25", "mo_down_25", "mo_up_50", "t2108")


def regime_as_of(as_of: str, rows: list[dict] | None = None) -> dict:
    """Regime read as it stood on `as_of` (latest breadth row on/before that
    date). Returns the unavailable block when the date isn't covered."""
    rows = rows if rows is not None else regime_rows()
    prior = [r for r in rows if r.get("date") and r["date"] <= as_of]
    if not prior:
        return _unavailable()
    row = prior[-1]
    metrics = {k: row.get(k) for k in _METRIC_KEYS}
    return classify_metrics(metrics, as_of=row.get("date"))


def prompt_line(regime: dict) -> str:
    """One paragraph telling the model how to treat today's tape."""
    if not regime or not regime.get("available"):
        return ("Market regime: UNKNOWN (no breadth data). Be extra selective and "
                "favor only the cleanest setups.")
    sel = {
        "strict": "Be EXTREMELY selective — in a hostile tape most breakouts fail, "
                  "so return only A+ setups or an empty list.",
        "raised": "Raise your bar — the tape is mixed, so demand clean, leading setups.",
        "normal": "The tape is constructive — quality breakouts have tailwind.",
    }.get(regime.get("selectivity"), "")
    warn = (" Overheated markers: " + "; ".join(regime["warnings"][:2])) if regime.get("warnings") else ""
    return (f"Market regime: {regime.get('level', 'neutral').upper()} "
            f"({regime.get('summary')}). {sel}{warn}")
