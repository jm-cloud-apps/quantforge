"""Position sizing and portfolio-level risk for AI Trader.

Two ideas a quant cares about that the old "budget // entry" sizing ignored:

1. **Fixed-fractional risk.** Size each trade so that hitting its stop loses a
   constant fraction of the account (e.g. 1%), regardless of how wide the stop
   is. A tight-stop name and a wide-stop name should risk the *same dollars*,
   not get the same dollar position.

2. **Portfolio heat & correlation.** Five ideas sized in isolation can add up to
   a single concentrated bet. We aggregate total $-at-risk (heat) and flag pairs
   of ideas whose recent returns are highly correlated — five names from the same
   theme is one position, not five.
"""

from __future__ import annotations

import logging
import math

logger = logging.getLogger(__name__)

CORR_THRESHOLD = 0.7   # pairs at/above this are treated as the same bet
_CORR_LOOKBACK = 40    # trading days of returns used for the correlation read


def size_idea(entry, stop, budget: float, account: float, risk_pct: float) -> dict:
    """Risk-based share count, capped by per-idea buying power.

    shares = min( account*risk% / per-share-risk , budget / entry ).
    Reports which constraint bound so the UI can show when the budget cap (rather
    than risk) is the limiter."""
    if not entry or entry <= 0:
        return {"shares": 0, "position_cost": None, "risk_dollars": None,
                "risk_pct": None, "account_risk_pct": None, "sizing_basis": None,
                "risk_per_share": None, "risk_budget": None}

    risk_budget = round(account * risk_pct / 100.0, 2) if (account and risk_pct) else None
    per_share = round(entry - stop, 4) if (stop and 0 < stop < entry) else None

    shares_budget = int(budget // entry)
    if per_share and per_share > 0 and risk_budget:
        shares_risk = int(risk_budget // per_share)
        if shares_risk <= shares_budget:
            shares, basis = shares_risk, "risk"
        else:
            shares, basis = shares_budget, "budget"
    else:
        # No valid stop ⇒ can't risk-size; fall back to buying-power sizing.
        shares, basis = shares_budget, "budget"

    cost = round(shares * entry, 2)
    risk = round(shares * per_share, 2) if per_share else None
    return {
        "shares": shares,
        "position_cost": cost,
        "risk_dollars": risk,
        # risk as % of the per-idea budget (kept for backward-compat with old UI)
        "risk_pct": round(risk / budget * 100, 1) if (risk and budget) else None,
        # risk as % of the whole account — the number that actually matters
        "account_risk_pct": round(risk / account * 100, 2) if (risk and account) else None,
        "sizing_basis": basis,
        "risk_per_share": per_share,
        "risk_budget": risk_budget,
    }


def portfolio_summary(ideas: list[dict], account: float) -> dict:
    """Aggregate exposure across the day's ideas."""
    costs = [i.get("position_cost") or 0 for i in ideas]
    risks = [i.get("risk_dollars") or 0 for i in ideas]
    total_cost = round(sum(costs), 2)
    total_risk = round(sum(risks), 2)
    return {
        "ideas": len(ideas),
        "account": account,
        "total_cost": total_cost,
        "total_risk_dollars": total_risk,
        "heat_pct": round(total_risk / account * 100, 2) if account else None,
        "deployed_pct": round(total_cost / account * 100, 1) if account else None,
        "max_single_risk_pct": round(max(risks) / account * 100, 2) if (risks and account) else None,
    }


def _returns(tail: list[dict]) -> dict[str, float]:
    """date → daily % return from a candidate's ohlcv_tail close series."""
    rows = [r for r in (tail or []) if r.get("close")]
    rows = rows[-(_CORR_LOOKBACK + 1):]
    out = {}
    for prev, cur in zip(rows, rows[1:]):
        p = prev["close"]
        if p:
            out[cur["time"]] = cur["close"] / p - 1
    return out


def _pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 5:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx <= 0 or vy <= 0:
        return None
    return cov / math.sqrt(vx * vy)


def correlation_flags(ideas: list[dict], tail_by_ticker: dict[str, list]) -> list[dict]:
    """Pairwise return-correlation flags for ideas whose recent moves track each
    other closely (|corr| >= CORR_THRESHOLD) — i.e. not independent bets."""
    rets = {}
    for i in ideas:
        t = i.get("ticker")
        tail = tail_by_ticker.get(t)
        if tail:
            r = _returns(tail)
            if r:
                rets[t] = r
    flags = []
    tickers = list(rets.keys())
    for a_i in range(len(tickers)):
        for b_i in range(a_i + 1, len(tickers)):
            a, b = tickers[a_i], tickers[b_i]
            common = sorted(set(rets[a]) & set(rets[b]))
            if len(common) < 5:
                continue
            corr = _pearson([rets[a][d] for d in common], [rets[b][d] for d in common])
            if corr is not None and corr >= CORR_THRESHOLD:
                flags.append({"a": a, "b": b, "corr": round(corr, 2), "n": len(common)})
    flags.sort(key=lambda f: f["corr"], reverse=True)
    return flags
