"""AI Trader — turns the Qullamaggie scan into the day's top-5 actionable LONG
trade ideas via Claude, each sized for a fixed daily budget.

Flow: run the existing Qullamaggie breakout scan (ADR-gated, liquidity-gated,
today's movers merged) → compact each candidate to the few numbers that matter
→ ask Claude to act as a disciplined Qullamaggie trader and pick the best 0-5
setups with entry/stop/target → size each idea in Python for the budget.

The model never invents tickers or prices: it only ranks/annotates the scanned
candidates, and all position sizing is computed deterministically here.
"""

import json
import logging
import os
import re
from datetime import datetime

import anthropic

from market_clock import is_market_active_now
from screener.qullamaggie.cache import refresh_universe
from screener.qullamaggie.enrich import enrich_with_calendar, enrich_with_news
from screener.qullamaggie.scorer import rank_candidates
from screener.qullamaggie.universe import get_universe

from . import regime as regime_mod
from .audit import record_run
from .portfolio import correlation_flags, portfolio_summary, size_idea
from .ranking import rank_ideas

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"
TEMPERATURE = 0.0  # deterministic ranking so the track record is auditable
SCAN_LIMIT = 20  # candidates handed to the model
MAX_IDEAS = 5  # most actionable ideas surfaced per day
DEFAULT_ACCOUNT = 25_000.0  # account size for risk-based sizing
DEFAULT_RISK_PCT = 1.0  # % of account risked per idea (fixed-fractional)


# ── small helpers ────────────────────────────────────────────────────────────
def _pct(v, nd=1):
    return round(v * 100, nd) if isinstance(v, (int, float)) else None


def _r(v, nd=2):
    return round(v, nd) if isinstance(v, (int, float)) else None


def _num(v):
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


def _today_change(c):
    tail = c.get("ohlcv_tail") or []
    if len(tail) >= 2 and tail[-2].get("close"):
        return tail[-1]["close"] / tail[-2]["close"] - 1
    return None


def _dollar_vol_m(c):
    tail = c.get("ohlcv_tail") or []
    if tail and tail[-1].get("close") and tail[-1].get("volume"):
        return tail[-1]["close"] * tail[-1]["volume"] / 1e6
    return None


def _news(c):
    n = c.get("news")
    if isinstance(n, dict):
        s = n.get("sentiment")
        senti = s.get("label") if isinstance(s, dict) else s
        return {"title": n.get("title"), "sentiment": senti,
                "site": n.get("site"), "url": n.get("url"), "date": n.get("publishedDate")}
    return None


def _compact(c):
    """The few numbers the model actually needs to judge a Qullamaggie setup."""
    return {
        "ticker": c.get("symbol"),
        "price": _r(c.get("last_close")),
        "today_change_pct": _pct(_today_change(c)),
        "adr_pct": _pct(c.get("adr_pct")),
        "rvol": _r(c.get("rvol"), 1),
        "dollar_vol_m": _r(_dollar_vol_m(c), 1),
        "ret_1m_pct": _pct(c.get("ret_1m")),
        "ret_3m_pct": _pct(c.get("ret_3m")),
        "ret_6m_pct": _pct(c.get("ret_6m")),
        "status": c.get("status"),
        "tags": c.get("tags"),
        "qs_score": _r(c.get("score"), 0),
        "pivot": _r(c.get("pivot")),
        "dist_to_pivot_pct": _pct(c.get("distance_pct")),
        "base_len_days": c.get("base_length"),
        "base_top": _r(c.get("base_top")),
        "base_bottom": _r(c.get("base_bottom")),
        "news": _news(c),
        "earnings_date": c.get("earnings_date"),
    }


def _extract_json(raw):
    if not raw:
        return None
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


# ── scan + model ─────────────────────────────────────────────────────────────
def scan(min_adr: float) -> list[dict]:
    """Run the Qullamaggie breakout scan (today's movers merged) and enrich the
    top slice with news + earnings dates."""
    symbols = get_universe(include_movers=True)
    frames = refresh_universe(symbols)
    candidates = rank_candidates(
        frames, mode="breakout", min_dollar_vol=5_000_000,
        min_adr=min_adr, min_rvol=1.5,
    )
    top = candidates[:SCAN_LIMIT]
    for fn in (enrich_with_news, enrich_with_calendar):
        try:
            fn(top, top_n=SCAN_LIMIT)
        except Exception as e:  # enrichment is best-effort
            logger.warning("ai_trader enrich %s failed: %s", fn.__name__, e)
    return top


SYSTEM = (
    "You are a disciplined momentum trader who follows Kristjan 'Qullamaggie' "
    "Kullamagi's playbook precisely. You only take two LONG setups:\n"
    "1) BREAKOUT (continuation): a liquid, high-ADR momentum leader that already made a "
    "big move, then consolidated in a tight flag/range, and is now breaking out on rising "
    "volume. Entry on the break of the range high; hard stop just under the consolidation low "
    "or the low of the day.\n"
    "2) EPISODIC PIVOT (EP): a stock gapping up on a fresh, surprising catalyst (earnings, "
    "guidance, FDA, big contract). Entry on a break of the opening-range high; hard stop below "
    "the opening range or low of day.\n\n"
    "Hard rules: ADR must be >= the stated minimum. Demand real liquidity. Require clear prior "
    "momentum and/or a real catalyst. Always set a hard stop and a realistic first profit target "
    "(you sell into strength and trail the rest, so risk:reward to first target should be sound). "
    "Be extremely selective: most days have only a handful of clean setups. NEVER force trades — if nothing "
    "qualifies, return an empty list and explain why. Only use the candidates and data provided; "
    "never invent tickers or numbers."
)


def build_ideas(budget: float, min_adr: float,
                account: float = DEFAULT_ACCOUNT, risk_pct: float = DEFAULT_RISK_PCT) -> dict:
    """Scan, read the regime, ask the model for the day's best 0-5 ideas, then
    size/rank/aggregate them deterministically."""
    as_of = datetime.now().isoformat(timespec="seconds")
    active = is_market_active_now()
    api_key = os.getenv("ANTHROPIC_API_KEY", "")

    regime = regime_mod.get_regime()
    candidates = scan(min_adr)
    compact = [_compact(c) for c in candidates]
    tail_by_ticker = {c.get("symbol"): c.get("ohlcv_tail") for c in candidates}

    base = {
        "as_of": as_of,
        "market_active": active,
        "budget": budget,
        "account": account,
        "risk_pct": risk_pct,
        "min_adr": min_adr,
        "regime": regime,
        "candidates_considered": len(compact),
        "scanned_candidates": compact,
        "model": MODEL,
        "temperature": TEMPERATURE,
    }

    if not compact:
        return _finalize(base, [], account, tail_by_ticker, ai_available=bool(api_key),
                         candidates=compact, model_output=None,
                         no_setups_reason="No liquid candidates cleared the ADR/liquidity gate in today's scan.")

    # ── Ask the model to rank/annotate, with graceful degradation ────────────
    ai_error = None
    parsed = None
    raw = None
    if not api_key:
        ai_error = "ANTHROPIC_API_KEY not configured — add it to backend/.env to enable AI ranking."
    else:
        user = (
            f"Date/time: {as_of}. Market is currently {'OPEN' if active else 'CLOSED'}.\n"
            f"{regime_mod.prompt_line(regime)}\n"
            f"Daily budget per idea: ${int(budget)}. Minimum ADR: {min_adr * 100:.0f}%.\n\n"
            "Today's scanned Qullamaggie candidates (all percent fields are already in %):\n"
            f"{json.dumps(compact, default=str)}\n\n"
            "Pick the TOP 5 actionable LONG setups for today, best first. Return FEWER than 5 — "
            "or an empty list — if there aren't that many clean setups. Do not pad the list.\n"
            "Reply with ONLY a JSON object of exactly this shape (no prose, no markdown):\n"
            '{"ideas":[{"ticker":"","setup":"Breakout|Episodic Pivot","conviction":"high|medium|low",'
            '"entry":0,"stop":0,"target":0,"rationale":"","thesis":"","key_points":["",""],'
            '"risk_note":""}],"market_note":"","no_setups_reason":null}\n'
            "Field guide:\n"
            "- entry/stop/target: absolute share prices.\n"
            "- rationale: ONE punchy sentence — the headline reason to take it.\n"
            "- thesis: 3-5 sentences explaining WHY this is a high-quality opportunity RIGHT NOW. "
            "Cover the relevant points: the prior trend / leadership (returns), what the current "
            "consolidation or gap looks like, the catalyst or news if any, relative strength vs the "
            "market, liquidity/ADR giving it room to move, and why the timing is good today.\n"
            "- key_points: 3-4 short scannable bullet phrases (the strongest individual facts).\n"
            "- risk_note: what invalidates the idea / what to watch.\n"
            "If ideas is empty, put a short explanation in no_setups_reason."
        )
        try:
            client = anthropic.Anthropic(api_key=api_key)
            msg = client.messages.create(
                model=MODEL, max_tokens=2600, temperature=TEMPERATURE, system=SYSTEM,
                messages=[{"role": "user", "content": user}],
            )
            raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
            parsed = _extract_json(raw)
            if parsed is None:
                ai_error = "Model returned no parseable output."
        except anthropic.AuthenticationError:
            ai_error = "Invalid ANTHROPIC_API_KEY."
        except Exception as e:
            logger.warning("ai_trader model call failed: %s", e)
            msg_txt = str(e)
            if "credit balance" in msg_txt.lower():
                ai_error = "Anthropic credit balance too low — add credits to enable AI ranking."
            else:
                ai_error = f"AI request failed: {msg_txt}"

    by_ticker = {c["ticker"]: c for c in compact}

    if parsed is not None:
        ideas = []
        for it in (parsed.get("ideas") or [])[:MAX_IDEAS]:
            ticker = (it.get("ticker") or "").upper()
            entry, stop, target = _num(it.get("entry")), _num(it.get("stop")), _num(it.get("target"))
            ideas.append(_assemble_idea(
                ticker=ticker, setup=it.get("setup"), conviction=(it.get("conviction") or "").lower(),
                entry=entry, stop=stop, target=target, rationale=it.get("rationale"),
                thesis=it.get("thesis"), key_points=it.get("key_points"),
                risk_note=it.get("risk_note"), stats=by_ticker.get(ticker),
                budget=budget, account=account, risk_pct=risk_pct, source="ai",
            ))
        return _finalize(
            base, ideas, account, tail_by_ticker, ai_available=True,
            candidates=compact, model_output=raw,
            market_note=parsed.get("market_note"),
            no_setups_reason=parsed.get("no_setups_reason") if not ideas else None,
        )

    # ── Fallback: rule-based ideas straight from the scan ────────────────────
    ideas = _fallback_ideas(compact, budget, account, risk_pct)
    return _finalize(
        base, ideas, account, tail_by_ticker, ai_available=False, error=ai_error,
        candidates=compact, model_output=raw,
        market_note="AI ranking unavailable — showing the scan's top rule-based setups." if ideas else None,
        no_setups_reason=None if ideas else "No breakout-ready setups in today's scan.",
    )


def _finalize(base, ideas, account, tail_by_ticker, *, ai_available, candidates,
              model_output, error=None, market_note=None, no_setups_reason=None):
    """Shared tail for every code path: rank ideas by the deterministic composite
    score, aggregate portfolio-level risk + correlation, write the audit trail,
    and assemble the response."""
    ideas = rank_ideas(ideas)
    portfolio = portfolio_summary(ideas, account) if ideas else None
    correlations = correlation_flags(ideas, tail_by_ticker) if len(ideas) > 1 else []
    if portfolio is not None:
        portfolio["correlated_pairs"] = correlations
        # How much total heat the regime suggests carrying: full per-idea risk on
        # every name in a healthy tape, scaled down (risk_factor < 1) in a weak one.
        rf = (base.get("regime") or {}).get("risk_factor")
        if rf is not None:
            portfolio["regime_suggested_heat_pct"] = round((base.get("risk_pct") or 0) * len(ideas) * rf, 2)

    record_run(
        inputs={k: base.get(k) for k in ("budget", "account", "risk_pct", "min_adr", "model", "temperature")},
        candidates=candidates, model_output=model_output, ideas=ideas,
        regime=base.get("regime"),
    )
    out = {**base, "ai_available": ai_available, "ideas": ideas, "portfolio": portfolio,
           "market_note": market_note, "no_setups_reason": no_setups_reason}
    if error:
        out["error"] = error
    return out


def _assemble_idea(ticker, setup, conviction, entry, stop, target, rationale,
                   risk_note, stats, budget, account, risk_pct, source,
                   thesis=None, key_points=None):
    rr = None
    if entry and stop and target and entry > stop and target > entry:
        rr = round((target - entry) / (entry - stop), 2)
    return {
        "ticker": ticker, "setup": setup, "conviction": conviction,
        "entry": entry, "stop": stop, "target": target, "rr_to_target": rr,
        "rationale": rationale, "thesis": thesis,
        "key_points": [str(p) for p in key_points] if isinstance(key_points, list) else None,
        "risk_note": risk_note, "source": source,
        **size_idea(entry, stop, budget, account, risk_pct), "stats": stats,
    }


def _fallback_passes(c, budget):
    """Sane guards so the degraded mode doesn't surface junk: must be affordable
    for the budget, an actual momentum leader (not down hard), and not so volatile
    it's a low-float pump."""
    price = c.get("price")
    if not price or price > budget:           # need at least 1 share
        return False
    adr = c.get("adr_pct")
    if adr is not None and adr > 25:          # > 25% ADR ⇒ junk-volatile
        return False
    r3, r1 = c.get("ret_3m_pct"), c.get("ret_1m_pct")
    if (r3 is not None and r3 < 0) and (r1 is not None and r1 < 0):
        return False                          # not a leader — down on every horizon
    return True


def _fallback_ideas(compact, budget, account=DEFAULT_ACCOUNT, risk_pct=DEFAULT_RISK_PCT, top_n=MAX_IDEAS):
    """Build rule-based ideas from the scan when the model is unavailable:
    entry at the pivot, stop under the consolidation low (risk bounded to ~ADR),
    first target at 2R."""
    eligible = [c for c in compact if _fallback_passes(c, budget)]
    eligible.sort(key=lambda x: (x.get("qs_score") or 0), reverse=True)
    ideas = []
    for c in eligible:
        if len(ideas) >= top_n:
            break
        price, pivot, bb = c.get("price"), c.get("pivot"), c.get("base_bottom")
        adr_frac = (c.get("adr_pct") or 3) / 100
        entry = pivot if (pivot and price and abs(pivot - price) / price < 0.15) else price
        if not entry or entry > budget:       # must afford ≥1 share at the entry
            continue
        # Tighter of (consolidation low, entry - ~1 ADR) so risk stays bounded.
        stop_adr = round(entry * (1 - max(adr_frac, 0.03)), 2)
        stop = max(bb, stop_adr) if (bb and 0 < bb < entry) else stop_adr
        risk = entry - stop
        target = round(entry + 2 * risk, 2) if risk > 0 else None
        score = c.get("qs_score") or 0
        conviction = "high" if score >= 75 else "medium" if score >= 60 else "low"
        key_points = []
        if c.get("ret_3m_pct") is not None:
            key_points.append(f"{c['ret_3m_pct']:+.1f}% over 3 months — momentum leadership")
        if c.get("base_len_days"):
            key_points.append(f"{c['base_len_days']}-day consolidation near the pivot")
        if c.get("adr_pct"):
            key_points.append(f"ADR {c['adr_pct']}% — volatility to reach target")
        if c.get("rvol"):
            key_points.append(f"{c['rvol']}× relative volume — in play")
        if c.get("dist_to_pivot_pct") is not None:
            key_points.append(f"{c['dist_to_pivot_pct']:+.1f}% from the breakout pivot")
        for t in (c.get("tags") or []):
            key_points.append(t)
        rationale = (
            f"{c.get('status', 'Momentum')} setup"
            + (f", up {c['ret_3m_pct']:.0f}% in 3M" if c.get("ret_3m_pct") else "")
            + (f", {c['adr_pct']}% ADR" if c.get("adr_pct") else "")
            + "."
        )
        ideas.append(_assemble_idea(
            ticker=c["ticker"], setup="Breakout", conviction=conviction,
            entry=round(entry, 2), stop=round(stop, 2), target=target,
            rationale=rationale, thesis=_fallback_thesis(c, round(entry, 2), round(stop, 2), target),
            key_points=key_points[:5],
            risk_note="Rule-based read from the scan — add Anthropic credits for a full AI thesis.",
            stats=c, budget=budget, account=account, risk_pct=risk_pct, source="scan",
        ))
    return ideas


def _fallback_thesis(c, entry, stop, target):
    """Plain-English explanation assembled from the scan data (no LLM)."""
    t = c.get("ticker")
    ret3, ret1 = c.get("ret_3m_pct"), c.get("ret_1m_pct")
    if ret3 is not None and ret3 > 0:
        lead = f"{t} is a momentum leader, up {ret3:.0f}% over the past three months"
    elif ret1 is not None and ret1 > 0:
        lead = f"{t} is showing fresh momentum, up {ret1:.0f}% in the past month"
    else:
        lead = f"{t} screened as a relative-strength name"
    s1 = lead + (
        f", and has spent the last {c['base_len_days']} days consolidating in a tight range"
        if c.get("base_len_days") else ", consolidating after its move"
    ) + "."
    extras = []
    if c.get("adr_pct"):
        extras.append(f"its {c['adr_pct']}% average daily range gives the move room to run")
    if c.get("rvol") and c["rvol"] >= 1.0:
        extras.append(f"{c['rvol']}× relative volume shows it's in play")
    s2 = ""
    if extras:
        joined = ", and ".join(extras)
        s2 = joined[0].upper() + joined[1:] + "."
    s3 = (f"Plan: buy a breakout near ${entry}, stop under ${stop}, first target ${target} — "
          "sell into strength and trail the rest.") if (entry and stop and target) else ""
    return " ".join(x for x in [s1, s2, s3] if x)
