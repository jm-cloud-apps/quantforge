"""Combine per-symbol criteria into a 0-100 score, status, and tag set.

Modes:
  breakout — full Qullamaggie playbook (ADR gate + thrust + base + pivot)
  leaders  — rank purely by trailing-return percentile
  emerging — has thrust, base just starting (the "on the come up" filter)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, asdict
from typing import Optional

import numpy as np
import pandas as pd

from . import criteria as C

logger = logging.getLogger(__name__)

W_LEADER, W_THRUST, W_BASE, W_PIVOT = 25, 25, 30, 20

# Qulla's ADR gate. Names below this are filtered out of breakout/emerging
# modes entirely (they just don't move enough to be tradeable for him).
DEFAULT_MIN_ADR = 0.05  # 5%


@dataclass
class Candidate:
    symbol: str
    score: float
    status: str
    mode: str

    leader_score: float
    thrust_score: float
    base_score: float
    pivot_score: float

    last_close: float
    pivot: Optional[float]
    distance_pct: Optional[float]
    adr_pct: Optional[float]
    rvol: Optional[float]

    base_length: Optional[int]
    base_top: Optional[float]
    base_bottom: Optional[float]
    range_pct: Optional[float]
    pullback_pct: Optional[float]
    thrust_pct: Optional[float]
    days_since_peak: Optional[int]

    ret_1m: Optional[float]
    ret_3m: Optional[float]
    ret_6m: Optional[float]

    tags: list[str]
    ohlcv_tail: list[dict]


def _status_from_score(score: float, breaking: bool, emerging: bool) -> str:
    if emerging:
        return "EMERGING"
    if breaking and score >= 70:
        return "READY"
    if score >= 75:
        return "GOOD"
    if score >= 60:
        return "DEVELOPING"
    return "WATCH"


def _tags(thrust, base, pivot, breaking, extended, emerging, adr) -> list[str]:
    tags: list[str] = []
    if breaking:
        tags.append("Breaking out")
    if extended:
        tags.append("Extended")
    if thrust.get("thrust"):
        if thrust["thrust_pct"] >= 0.6:
            tags.append("Wide parent")
        else:
            tags.append("Parent move")
    if base.get("base"):
        bl = base.get("base_length", 0)
        if bl >= 15:
            tags.append("Wide base")
        else:
            tags.append("Tight base")
    if pivot.get("near_pivot"):
        tags.append("Near pivot")
    if emerging:
        tags.append("On the come up")
    if adr and adr >= 0.08:
        tags.append("High ADR")
    if not tags:
        tags.append("Still drifting")
    return tags


def _ohlcv_tail(df: pd.DataFrame, n: int = 120) -> list[dict]:
    tail = df.tail(n)
    return [
        {
            "time": idx.strftime("%Y-%m-%d"),
            "open": float(r["open"]), "high": float(r["high"]),
            "low": float(r["low"]), "close": float(r["close"]),
            "volume": float(r["volume"]),
        }
        for idx, r in tail.iterrows()
    ]


def rank_candidates(
    frames: dict[str, pd.DataFrame],
    mode: str = "breakout",
    min_dollar_vol: float = 5_000_000,
    min_adr: float = DEFAULT_MIN_ADR,
) -> list[dict]:
    """Score every symbol; return list sorted descending by score."""
    # Pass 1: liquidity + ADR gate + trailing returns
    rows = []
    for sym, df in frames.items():
        if df is None or df.empty:
            continue
        if not C.liquidity_ok(df, min_dollar_vol=min_dollar_vol):
            continue
        adr = C.adr_pct(df)
        if mode in ("breakout", "emerging") and (adr is None or adr < min_adr):
            continue
        rets = C.trailing_returns(df)
        if rets["ret_3m"] is None:
            continue
        avg_ret = float(np.mean([v for v in rets.values() if v is not None]))
        rows.append({"symbol": sym, "df": df, "adr": adr, "avg_ret": avg_ret, **rets})

    if not rows:
        return []

    ranks = pd.Series([r["avg_ret"] for r in rows]).rank(pct=True).values
    for i, r in enumerate(rows):
        r["leader_score"] = float(ranks[i])

    candidates: list[Candidate] = []
    for r in rows:
        df = r["df"]
        thrust = C.prior_thrust(df)
        base = C.detect_base(df)
        pivot = C.near_pivot(df, base)
        bo = C.breaking_out(df, base)
        extended = C.is_extended(df, base)
        emerging = C.is_emerging(df, thrust, base)

        leader = r["leader_score"]
        if mode == "leaders":
            score = round(leader * 100, 1)
        elif mode == "emerging":
            # Reward strong thrusts that are early in the basing process.
            score = round(
                60 * thrust["score"] + 30 * leader + 10 * (1.0 if emerging else 0.0),
                1,
            )
        else:  # breakout
            score = round(
                W_LEADER * leader + W_THRUST * thrust["score"]
                + W_BASE * base["score"] + W_PIVOT * pivot["score"],
                1,
            )

        # In emerging mode, only show actually-emerging names.
        if mode == "emerging" and not emerging:
            continue

        candidates.append(Candidate(
            symbol=r["symbol"],
            score=float(score),
            status=_status_from_score(score, bo["breaking_out"], emerging),
            mode=mode,
            leader_score=round(leader, 3),
            thrust_score=round(float(thrust["score"]), 3),
            base_score=round(float(base.get("score", 0)), 3),
            pivot_score=round(float(pivot["score"]), 3),
            last_close=round(C._last_close(df), 2),
            pivot=round(pivot["pivot"], 2) if pivot.get("pivot") else None,
            distance_pct=pivot.get("distance_pct"),
            adr_pct=r["adr"],
            rvol=bo.get("rvol"),
            base_length=base.get("base_length"),
            base_top=round(base["base_top"], 2) if base.get("base_top") else None,
            base_bottom=round(base["base_bottom"], 2) if base.get("base_bottom") else None,
            range_pct=base.get("range_pct"),
            pullback_pct=base.get("pullback_pct"),
            thrust_pct=thrust.get("thrust_pct"),
            days_since_peak=thrust.get("days_since_peak"),
            ret_1m=r["ret_1m"], ret_3m=r["ret_3m"], ret_6m=r["ret_6m"],
            tags=_tags(thrust, base, pivot, bo["breaking_out"], extended, emerging, r["adr"]),
            ohlcv_tail=_ohlcv_tail(df),
        ))

    candidates.sort(key=lambda c: c.score, reverse=True)
    return [asdict(c) for c in candidates]
