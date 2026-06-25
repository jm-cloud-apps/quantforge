"""Theme Radar engine — cross-references structural theme strength with the
immediate tape to surface near-term velocity-expansion setups.

Flow (mirrors ai_trader): fetch every theme constituent + lead ETF once →
compute each theme's multi-horizon strength, rank shift, breadth and intraday
velocity → deterministically flag the three patterns the desk cares about
(velocity sweet-spot / high-breadth pipeline / distribution-trap) → hand the
compact metrics to Claude acting as an institutional macro analyst to write the
Near-Term Velocity Matrix and commentary. Degrades to a rule-based read when the
model is unavailable.
"""

import json
import logging
import os
import re
import statistics
from datetime import datetime

import anthropic

from market_clock import is_market_active_now
from screener.qullamaggie.cache import refresh_universe
from .themes import THEMES, all_tickers

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"
TEMPERATURE = 0.0


# ── per-ticker / per-theme metrics ───────────────────────────────────────────
def _ret(closes, n):
    return round((closes[-1] / closes[-1 - n] - 1) * 100, 1) if len(closes) > n else None


def _ticker_metrics(df):
    if df is None or len(df) < 6:
        return None
    closes = [float(c) for c in df["close"].tolist()]
    last_open = float(df["open"].iloc[-1])
    sma20 = statistics.fmean(closes[-20:]) if len(closes) >= 20 else None
    return {
        "ret_5d": _ret(closes, 5),
        "ret_1m": _ret(closes, 21),
        "ret_3m": _ret(closes, 63),
        "intraday": round((closes[-1] / last_open - 1) * 100, 1) if last_open else None,
        "up_today": closes[-1] > closes[-2],
        "above_20ma": (sma20 is not None and closes[-1] > sma20),
        "last": round(closes[-1], 2),
    }


def _median(vals):
    vals = [v for v in vals if v is not None]
    return round(statistics.median(vals), 1) if vals else None


def _pct(flags):
    flags = [f for f in flags if f is not None]
    return round(100 * sum(1 for f in flags if f) / len(flags)) if flags else None


def compute_themes(frames: dict) -> list[dict]:
    """One metrics row per theme: median constituent strength across horizons,
    breadth, intraday velocity, lead-ETF tape, and the leaders."""
    rows = []
    for name, spec in THEMES.items():
        cons = {t: _ticker_metrics(frames.get(t)) for t in spec["tickers"]}
        cons = {t: m for t, m in cons.items() if m}
        if not cons:
            continue
        leaders = sorted(cons.items(), key=lambda kv: (kv[1]["ret_1m"] or -999), reverse=True)[:3]
        etf = _ticker_metrics(frames.get(spec.get("lead_etf"))) if spec.get("lead_etf") else None
        rows.append({
            "name": name,
            "narrative": spec["narrative"],
            "lead_etf": spec.get("lead_etf"),
            "constituents": len(cons),
            "ret_5d": _median([m["ret_5d"] for m in cons.values()]),
            "ret_1m": _median([m["ret_1m"] for m in cons.values()]),
            "ret_3m": _median([m["ret_3m"] for m in cons.values()]),
            "intraday_med": _median([m["intraday"] for m in cons.values()]),
            "breadth_up_today": _pct([m["up_today"] for m in cons.values()]),
            "breadth_above_20ma": _pct([m["above_20ma"] for m in cons.values()]),
            "etf_intraday": etf["intraday"] if etf else None,
            "etf_5d": etf["ret_5d"] if etf else None,
            "leaders": [{"ticker": t, "ret_1m": m["ret_1m"], "ret_5d": m["ret_5d"],
                         "intraday": m["intraday"]} for t, m in leaders],
        })
    _rank_and_flag(rows)
    return rows


def _rank_and_flag(rows: list[dict]) -> None:
    """Assign per-horizon ranks (1 = strongest) and tag each theme's posture."""
    def rank_by(key):
        order = sorted([r for r in rows if r.get(key) is not None], key=lambda r: r[key], reverse=True)
        for i, r in enumerate(order, 1):
            r[f"rank_{key}"] = i

    for key in ("ret_5d", "ret_1m", "ret_3m"):
        rank_by(key)

    n = len(rows)
    for r in rows:
        r3, r1, r5 = r.get("rank_ret_3m"), r.get("rank_ret_1m"), r.get("rank_ret_5d")
        # rank shift: structural anchor vs immediate tape (+ = immediate cooler)
        r["rank_shift_3m_5d"] = (r5 - r3) if (r3 and r5) else None
        elite_anchor = r3 is not None and r3 <= max(3, n // 3)        # top third on 3M
        cooling = (r.get("ret_5d") is not None and r["ret_5d"] < (r.get("ret_1m") or 0)) \
            or (r5 is not None and r3 is not None and r5 > r3)
        reaccum = ((r.get("etf_intraday") or r.get("intraday_med") or 0) > 0) \
            and (r.get("breadth_up_today") or 0) >= 50
        deteriorating = (r1 is not None and r3 is not None and r1 > r3)   # 1M rank worse than 3M
        fading_tape = ((r.get("etf_5d") if r.get("etf_5d") is not None else r.get("ret_5d")) or 0) < 0 \
            and (r.get("intraday_med") or 0) <= 0

        if elite_anchor and cooling and reaccum:
            r["posture"] = "sweet_spot"      # institutions absorbing a dip; tape turning up
        elif elite_anchor and not cooling and reaccum:
            r["posture"] = "expanding"       # already in motion
        elif elite_anchor and deteriorating and fading_tape:
            r["posture"] = "trap"            # anchor holds but rolling distribution
        elif deteriorating and fading_tape:
            r["posture"] = "distribution"
        else:
            r["posture"] = "neutral"


# ── LLM synthesis ────────────────────────────────────────────────────────────
SYSTEM = (
    "You are an institutional-grade macro research analyst. You cross-reference structural "
    "industry-group / theme strength with real-time narrative velocity to isolate high-conviction "
    "swing setups. The themes provided are custom narrative baskets, NOT GICS sectors. Treat the "
    "'AI Data Center Infrastructure' theme as a synthetic physical-AI-compute pipeline (GPUs, power, "
    "HPC hosting incl. the miners) accumulating for power/compute capacity, not crypto beta. "
    "Cross-reference each theme's 1-week/1-month/3-month rank against its immediate intraday "
    "(% from open) and 5-day ETF tape to find exactly when a structural setup is expanding. Filter "
    "out broad macro noise. Be sharp, dense and completely fluff-free — no textbook definitions. "
    "Only use the themes and numbers provided."
)


def _compact(rows):
    keep = ("name", "lead_etf", "narrative", "constituents", "ret_5d", "ret_1m", "ret_3m",
            "rank_ret_5d", "rank_ret_1m", "rank_ret_3m", "rank_shift_3m_5d", "intraday_med",
            "breadth_up_today", "breadth_above_20ma", "etf_intraday", "etf_5d", "posture", "leaders")
    return [{k: r.get(k) for k in keep} for r in rows]


def _extract_json(raw):
    if not raw:
        return None
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    try:
        return json.loads(m.group(0)) if m else None
    except Exception:
        return None


def build_analysis() -> dict:
    as_of = datetime.now().isoformat(timespec="seconds")
    active = is_market_active_now()
    api_key = os.getenv("ANTHROPIC_API_KEY", "")

    frames = refresh_universe(all_tickers())
    rows = compute_themes(frames)
    compact = _compact(rows)
    base = {
        "as_of": as_of, "market_active": active, "themes": rows,
        "themes_considered": len(rows), "model": MODEL, "temperature": TEMPERATURE,
    }
    if not rows:
        return {**base, "ai_available": bool(api_key),
                "no_data_reason": "No theme constituent data available from the provider."}

    ai_error, parsed, raw = None, None, None
    if not api_key:
        ai_error = "ANTHROPIC_API_KEY not configured — showing the rule-based read."
    else:
        user = (
            f"Date/time: {as_of}. Market is {'OPEN' if active else 'CLOSED'}.\n"
            "Themes with metrics (returns & intraday are %, ranks are 1=strongest across themes; "
            "rank_shift_3m_5d>0 means the immediate tape is cooler than the 3-month anchor; posture "
            "is a precomputed hint):\n"
            f"{json.dumps(compact, default=str)}\n\n"
            "Execute in two steps. Reply with ONLY this JSON (no prose, no markdown):\n"
            '{"matrix":[{"name":"","lead_etf":"","theme":"","tape_profile":""}],'
            '"sweet_spots":[{"name":"","why":""}],"pipelines":[{"name":"","why":""}],'
            '"traps":[{"name":"","why":""}],"market_note":""}\n'
            "Field guide:\n"
            "- matrix: ONLY themes with a real narrative tailwind AND immediate velocity potential "
            "(skip the noise). `theme` = the pure narrative / institutional-focus angle. "
            "`tape_profile` = one dense sentence on how the 1W/1M/3M ranks interact with the "
            "intraday/5-day ETF tape to create a low-risk pullback entry or an explosive turn.\n"
            "- sweet_spots: the 2-3 themes where elite monthly/quarterly anchors are absorbing "
            "short-term selling and the tape confirms money flowing back — cleanest R:R for rotation.\n"
            "- pipelines: themes with broad participation moving in tandem with their ETF (broad "
            "sponsorship, not single-stock anomalies) — emphasise the AI Data Center footprint.\n"
            "- traps: spaces where quarterly ranks hold but monthly/5-day tape shows rolling "
            "distribution — what to avoid.\n"
            "- why / tape_profile: dense, specific, reference the actual numbers."
        )
        try:
            client = anthropic.Anthropic(api_key=api_key)
            msg = client.messages.create(model=MODEL, max_tokens=2600, temperature=TEMPERATURE,
                                         system=SYSTEM, messages=[{"role": "user", "content": user}])
            raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
            parsed = _extract_json(raw)
            if parsed is None:
                ai_error = "Model returned no parseable output."
        except anthropic.AuthenticationError:
            ai_error = "Invalid ANTHROPIC_API_KEY."
        except Exception as e:
            logger.warning("theme_radar model call failed: %s", e)
            mt = str(e)
            ai_error = ("Anthropic credit balance too low — showing the rule-based read."
                        if "credit balance" in mt.lower() else f"AI request failed: {mt}")

    by_name = {r["name"]: r for r in rows}
    if parsed is not None:
        # stitch the computed metrics back onto each matrix row for display
        matrix = []
        for it in (parsed.get("matrix") or []):
            r = by_name.get(it.get("name"))
            matrix.append({**it, "metrics": r})
        return {**base, "ai_available": True, "matrix": matrix,
                "sweet_spots": parsed.get("sweet_spots") or [],
                "pipelines": parsed.get("pipelines") or [],
                "traps": parsed.get("traps") or [],
                "market_note": parsed.get("market_note")}

    return {**base, "ai_available": False, "error": ai_error, **_fallback(rows)}


def _fallback(rows: list[dict]) -> dict:
    """Deterministic read when the model is unavailable — built straight from the
    postures and ranks."""
    def why(r):
        bits = []
        if r.get("rank_ret_3m"):
            bits.append(f"#{r['rank_ret_3m']} on 3M ({r.get('ret_3m')}%)")
        if r.get("ret_5d") is not None:
            bits.append(f"5D {r['ret_5d']:+}%")
        if r.get("etf_intraday") is not None:
            bits.append(f"{r['lead_etf']} {r['etf_intraday']:+}% from open")
        if r.get("breadth_above_20ma") is not None:
            bits.append(f"{r['breadth_above_20ma']}% > 20MA")
        return " · ".join(bits)

    movers = [r for r in rows if r.get("posture") in ("sweet_spot", "expanding")]
    movers.sort(key=lambda r: (r.get("rank_ret_3m") or 99))
    matrix = [{
        "name": r["name"], "lead_etf": r["lead_etf"], "theme": r["narrative"],
        "tape_profile": (("Elite 3M anchor absorbing a short-term cooldown; tape turning up — pullback entry."
                          if r["posture"] == "sweet_spot" else
                          "Strong across horizons with the ETF bid intraday — expansion in motion.")),
        "metrics": r,
    } for r in movers]
    sweet = [{"name": r["name"], "why": why(r)} for r in rows if r.get("posture") == "sweet_spot"][:3]
    pipes = [{"name": r["name"], "why": why(r)} for r in
             sorted(rows, key=lambda r: -(r.get("breadth_above_20ma") or 0))
             if (r.get("breadth_above_20ma") or 0) >= 60][:3]
    traps = [{"name": r["name"], "why": why(r)} for r in rows if r.get("posture") in ("trap", "distribution")][:3]
    return {"matrix": matrix, "sweet_spots": sweet, "pipelines": pipes, "traps": traps,
            "market_note": "Rule-based read — add Anthropic credits for the full analyst synthesis."}
