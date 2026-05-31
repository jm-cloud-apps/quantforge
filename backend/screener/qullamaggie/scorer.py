"""Combine per-symbol criteria into a 0-100 score, status, and tag set.

Modes:
  breakout        — full Qullamaggie playbook (ADR gate + thrust + base + pivot)
  leaders         — rank purely by trailing-return percentile
  emerging        — has thrust, base just starting (the "on the come up" filter)
  volume          — single-day RVOL snapshot (today vs 50d avg)
  unusual_volume  — Day-1/Day-2/Day-3+ of a sustained RVOL streak (Unusual
                    Whales-style). Detects names where today's volume *and* at
                    least one prior day broke ≥ the threshold, distinguishing a
                    fresh pop (Day 1) from confirmed follow-through (Day 2/3+).
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
    score_breakdown: list[dict]

    # unusual_volume mode only: which day of the RVOL streak this is
    # (1 = first day, 2 = second consecutive day, etc.). None for other modes.
    rvol_streak_day: Optional[int] = None

    # Tier-A accumulation read (0-100). Surfaced on volume modes.
    # Distinguishes institutional buying from selling on heavy-volume days.
    accumulation_score: Optional[float] = None
    clv: Optional[float] = None                  # close location value (0-1)
    up_down_vol_ratio: Optional[float] = None    # >1 = up-day volume dominates
    above_vwap_pct: Optional[float] = None       # fraction of streak closing ≥ VWAP
    accumulation_breakdown: Optional[list[dict]] = None

    # Pure-OHLCV indicators (no API cost):
    # CMF = 21-day Chaikin Money Flow (-1..+1). >= 0.10 = sustained accumulation.
    # OBV slope = normalized 20-day on-balance-volume trend. >0 = accumulation.
    cmf: Optional[float] = None
    obv_slope: Optional[float] = None


def _build_breakdown(mode: str, leader: float, thrust: float, base: float,
                     pivot: float, emerging: bool, rvol: float | None = None,
                     streak_day: int | None = None,
                     acc_score: float | None = None) -> list[dict]:
    """Return [{component, weight, value (0-1), points}] explaining the score."""
    def row(name, weight, value):
        return {
            "component": name,
            "weight": weight,
            "value": round(float(value), 3),
            "points": round(weight * float(value), 1),
        }

    if mode == "leaders":
        return [row("Relative strength", 100, leader)]
    if mode == "emerging":
        return [
            row("Parent thrust", 60, thrust),
            row("Relative strength", 30, leader),
            row("Early base", 10, 1.0 if emerging else 0.0),
        ]
    if mode == "volume":
        # rvol of 5× ⇒ full 100; below that scales linearly. Capped at 1.0.
        norm = min(float(rvol or 0) / 5.0, 1.0)
        return [row(f"Volume vs 50d avg ({(rvol or 0):.1f}×)", 100, norm)]
    if mode == "unusual_volume":
        rv = float(rvol or 0)
        rvol_norm = min(rv / 5.0, 1.0)
        # Day 1 = 1.0, Day 2 = 0.66, Day 3+ = 0.33 — fresher pops rank above
        # stale follow-throughs at equal RVOL.
        sd = int(streak_day or 1)
        freshness = {1: 1.0, 2: 0.66}.get(sd, 0.33)
        acc_norm = (float(acc_score) / 100.0) if acc_score is not None else 0.5
        return [
            row(f"Volume vs 50d avg ({rv:.1f}×)", 50, rvol_norm),
            row(f"Streak freshness (Day {sd})", 20, freshness),
            row(f"Accumulation ({int(acc_score or 0)}/100)", 30, acc_norm),
        ]
    return [
        row("Relative strength", W_LEADER, leader),
        row("Parent thrust", W_THRUST, thrust),
        row("Base quality", W_BASE, base),
        row("Near pivot", W_PIVOT, pivot),
    ]


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


def _rvol(df: pd.DataFrame, window: int = 50) -> float | None:
    """Latest volume relative to the prior `window`-day average."""
    if df is None or len(df) < window + 1:
        return None
    vols = df["volume"].tail(window + 1).tolist()
    avg = float(np.mean(vols[:-1]))
    if avg <= 0:
        return None
    return float(vols[-1]) / avg


def _rvol_streak(
    df: pd.DataFrame, window: int = 50, threshold: float = 2.0, max_streak: int = 10,
) -> tuple[int, float | None]:
    """Count consecutive days (ending today) with RVOL ≥ threshold.

    Each day's RVOL is computed against its own trailing `window`-day average
    (excluding that day), so the streak is anchored in per-day context — not in
    a single static baseline. Returns (streak_days, today_rvol). A streak of 0
    means today itself failed the threshold.
    """
    if df is None or len(df) < window + 1:
        return 0, None
    vols = df["volume"].to_numpy(dtype=float)
    streak = 0
    today_rvol: float | None = None
    # Walk backward from the most recent bar.
    for offset in range(max_streak):
        idx = len(vols) - 1 - offset
        if idx - window < 0:
            break
        avg = float(np.mean(vols[idx - window : idx]))
        if avg <= 0:
            break
        rv = float(vols[idx]) / avg
        if offset == 0:
            today_rvol = rv
        if rv >= threshold:
            streak += 1
        else:
            break
    return streak, today_rvol


def rank_candidates(
    frames: dict[str, pd.DataFrame],
    mode: str = "breakout",
    min_dollar_vol: float = 5_000_000,
    min_adr: float = DEFAULT_MIN_ADR,
    min_rvol: float = 1.5,
    day_filter: int = 0,
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
        # Volume-flavored modes don't require 3M history — we just need today's
        # bar relative to its own 50d average.
        vol_modes = ("volume", "unusual_volume")
        if mode not in vol_modes and rets["ret_3m"] is None:
            continue
        avg_ret = float(np.mean([v for v in rets.values() if v is not None])) if any(v is not None for v in rets.values()) else 0.0

        if mode == "volume":
            rvol_today = _rvol(df, window=50)
            if rvol_today is None or rvol_today < min_rvol:
                continue
            rows.append({"symbol": sym, "df": df, "adr": adr, "avg_ret": avg_ret,
                         "rvol_today": rvol_today, **rets})
        elif mode == "unusual_volume":
            streak, rvol_today = _rvol_streak(df, window=50, threshold=min_rvol)
            if streak < 1 or rvol_today is None:
                continue
            # day_filter: 0=all, 1=Day 1 only, 2=Day 2 only, 3=Day 3+.
            if day_filter == 1 and streak != 1:
                continue
            if day_filter == 2 and streak != 2:
                continue
            if day_filter == 3 and streak < 3:
                continue
            rows.append({"symbol": sym, "df": df, "adr": adr, "avg_ret": avg_ret,
                         "rvol_today": rvol_today, "rvol_streak_day": streak, **rets})
        else:
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
        # Tier-A accumulation score — only computed for the volume-flavored
        # modes (where directionality of the RVOL surge actually matters).
        acc = (
            C.accumulation_score(df, streak_days=int(r.get("rvol_streak_day") or 1))
            if mode in ("volume", "unusual_volume") else None
        )
        # Pure-OHLCV money-flow indicators. Cheap, so always compute on volume modes.
        cmf_val = C.chaikin_money_flow(df) if mode in ("volume", "unusual_volume") else None
        obv_slope_val = C.obv_slope(df) if mode in ("volume", "unusual_volume") else None

        leader = r["leader_score"]
        if mode == "leaders":
            score = round(leader * 100, 1)
        elif mode == "emerging":
            # Reward strong thrusts that are early in the basing process.
            score = round(
                60 * thrust["score"] + 30 * leader + 10 * (1.0 if emerging else 0.0),
                1,
            )
        elif mode == "volume":
            # Score scales with relative volume — 5× avg ⇒ 100 points.
            rv = r.get("rvol_today") or 1.0
            score = round(min(rv * 20.0, 100.0), 1)
        elif mode == "unusual_volume":
            # 50% RVOL magnitude + 20% streak-freshness + 30% accumulation tilt.
            # Accumulation score (Tier-A) directly filters out distribution
            # days: a 5× RVOL day that closed at the LOW now ranks below a
            # 3× RVOL day that closed at the HIGH with up-vol dominance.
            rv = r.get("rvol_today") or 1.0
            sd = int(r.get("rvol_streak_day") or 1)
            freshness = {1: 1.0, 2: 0.66}.get(sd, 0.33)
            acc_norm = (acc["score"] / 100.0) if acc else 0.5
            score = round(
                50 * min(rv / 5.0, 1.0) + 20 * freshness + 30 * acc_norm, 1,
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
            rvol=r.get("rvol_today") if mode in ("volume", "unusual_volume") else bo.get("rvol"),
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
            score_breakdown=_build_breakdown(
                mode, leader, float(thrust["score"]), float(base.get("score", 0)),
                float(pivot["score"]), emerging,
                rvol=r.get("rvol_today"),
                streak_day=r.get("rvol_streak_day"),
                acc_score=acc["score"] if acc else None,
            ),
            rvol_streak_day=r.get("rvol_streak_day"),
            accumulation_score=acc["score"] if acc else None,
            clv=acc["clv"] if acc else None,
            up_down_vol_ratio=acc["up_down_vol_ratio"] if acc else None,
            above_vwap_pct=acc["above_vwap_pct"] if acc else None,
            accumulation_breakdown=acc["components"] if acc else None,
            cmf=cmf_val,
            obv_slope=obv_slope_val,
        ))

    candidates.sort(key=lambda c: c.score, reverse=True)
    return [asdict(c) for c in candidates]
