"""Per-symbol criteria for the Qullamaggie breakout screener.

Each function takes a daily OHLCV DataFrame (index = date, columns = ohlcv)
and returns a pure dict — no I/O, deterministic.

Qullamaggie playbook (verified against his public material):
  1. ADR ≥ 5%        — hard gate. He won't trade names without volatility.
  2. Strong leader   — top-decile trailing 1/3/6-month returns.
  3. Prior thrust    — recent expansionary move (the "parent move"), 30%+.
  4. Orderly base    — 5-25 days, range <8%, pullback <15%, volume drying up,
                        holding 10/21 EMA.
  5. Near pivot      — within 5% of the base high.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _last_close(df: pd.DataFrame) -> float:
    return float(df["close"].iloc[-1])


def _pct_return(df: pd.DataFrame, days: int) -> float | None:
    if len(df) < days + 1:
        return None
    return float(df["close"].iloc[-1] / df["close"].iloc[-days - 1] - 1)


def trailing_returns(df: pd.DataFrame) -> dict[str, float | None]:
    return {
        "ret_1m": _pct_return(df, 21),
        "ret_3m": _pct_return(df, 63),
        "ret_6m": _pct_return(df, 126),
    }


def adr_pct(df: pd.DataFrame, window: int = 20) -> float | None:
    """ADR = mean((H/L) - 1) over `window` days. Qulla's volatility filter."""
    if len(df) < window:
        return None
    recent = df.tail(window)
    return float((recent["high"] / recent["low"]).mean() - 1)


def liquidity_ok(df: pd.DataFrame, min_dollar_vol: float = 5_000_000) -> bool:
    if len(df) < 20:
        return False
    recent = df.tail(20)
    return float((recent["close"] * recent["volume"]).mean()) >= min_dollar_vol


def prior_thrust(df: pd.DataFrame, window: int = 90) -> dict:
    """Big expansionary move ending within the last 40 days."""
    if len(df) < window:
        return {"thrust": False, "thrust_pct": 0.0, "score": 0.0, "days_since_peak": None}
    recent = df.tail(window)
    closes = recent["close"].values
    peak_idx = int(np.argmax(closes))
    trough_idx = int(np.argmin(closes[: peak_idx + 1])) if peak_idx > 0 else 0
    rise = closes[peak_idx] / closes[trough_idx] - 1 if closes[trough_idx] > 0 else 0.0
    days_since_peak = len(recent) - 1 - peak_idx
    thrust = bool(rise >= 0.30 and days_since_peak <= 40)
    score = min(rise / 0.60, 1.0) if thrust else max(0.0, rise / 0.60) * 0.5
    return {
        "thrust": thrust,
        "thrust_pct": float(rise),
        "days_since_peak": int(days_since_peak),
        "score": float(score),
    }


def detect_base(df: pd.DataFrame, max_window: int = 30, min_days: int = 5) -> dict:
    """Find the most recent consolidation: the longest tail of bars whose
    high-low range stays within 12% of the highest close.

    Returns base metrics: length, top/bottom, range %, pullback depth %,
    holds-EMA, volume-drying flag, and a 0-1 quality score.
    """
    if len(df) < max_window + 20:
        return {"base": False, "score": 0.0}

    last_close = _last_close(df)
    ema10 = df["close"].ewm(span=10, adjust=False).mean().iloc[-1]
    ema20 = df["close"].ewm(span=20, adjust=False).mean().iloc[-1]
    above_emas = last_close >= float(ema10) and last_close >= float(ema20)

    # Greedy: extend the window from `min_days` back as long as the high-low
    # range stays under 12% of base-high. Stop when range explodes.
    best_len = 0
    best_high = best_low = None
    for length in range(min_days, max_window + 1):
        window = df.tail(length)
        hi = float(window["high"].max())
        lo = float(window["low"].min())
        if hi <= 0:
            break
        rng = (hi - lo) / hi
        if rng > 0.12:
            break
        best_len = length
        best_high = hi
        best_low = lo

    if best_len < min_days:
        return {"base": False, "score": 0.0, "above_emas": above_emas}

    range_pct = (best_high - best_low) / best_high if best_high else 0.0
    pullback_pct = (best_high - last_close) / best_high if best_high else 0.0

    base_window = df.tail(best_len)
    prior_window = df.tail(best_len * 2).head(best_len)
    vol_recent = float(base_window["volume"].mean())
    vol_prior = float(prior_window["volume"].mean()) if prior_window["volume"].mean() > 0 else 1.0
    drying = vol_recent < vol_prior
    vol_ratio = vol_recent / vol_prior if vol_prior > 0 else None

    # Quality components: tightness, drying, pullback (shallow good), uptrend.
    tightness = max(0.0, 1.0 - range_pct / 0.10)         # 0% range = 1.0, 10% = 0.0
    drying_score = max(0.0, (vol_prior - vol_recent) / vol_prior) if vol_prior > 0 else 0.0
    pullback_score = max(0.0, 1.0 - pullback_pct / 0.20) # <0% = 1, 20% = 0
    base_qual = 0.35 * tightness + 0.25 * drying_score + 0.25 * pullback_score + 0.15 * (1.0 if above_emas else 0.0)

    return {
        "base": bool(range_pct <= 0.08 and above_emas and drying and best_len >= min_days),
        "base_length": int(best_len),
        "base_top": float(best_high),
        "base_bottom": float(best_low),
        "range_pct": float(range_pct),
        "pullback_pct": float(pullback_pct),
        "vol_ratio": float(vol_ratio) if vol_ratio is not None else None,
        "drying": bool(drying),
        "above_emas": bool(above_emas),
        "score": float(min(base_qual, 1.0)),
    }


def near_pivot(df: pd.DataFrame, base: dict) -> dict:
    """Distance from the base high (the pivot). Negative = extended past it."""
    pivot = base.get("base_top")
    if not pivot:
        return {"near_pivot": False, "pivot": None, "distance_pct": None, "score": 0.0}
    last = _last_close(df)
    distance = (pivot - last) / pivot  # +ve = below pivot
    near = bool(-0.05 <= distance <= 0.05)
    if distance < -0.05:
        score = 0.0
    elif distance <= 0.03:
        score = 1.0
    elif distance <= 0.10:
        score = 1.0 - (distance - 0.03) / 0.07
    else:
        score = 0.0
    return {
        "near_pivot": near,
        "pivot": float(pivot),
        "distance_pct": float(distance),
        "score": float(max(0.0, min(score, 1.0))),
    }


def breaking_out(df: pd.DataFrame, base: dict) -> dict:
    """Closed above the base top on relative volume ≥1.3x the 20-day avg."""
    pivot = base.get("base_top")
    if not pivot or len(df) < 20:
        return {"breaking_out": False, "rvol": None}
    last = df.iloc[-1]
    avg_vol = float(df["volume"].tail(20).mean())
    rvol = float(last["volume"] / avg_vol) if avg_vol > 0 else None
    breaking = bool(last["close"] > pivot and rvol is not None and rvol >= 1.3)
    return {"breaking_out": breaking, "rvol": rvol}


def is_extended(df: pd.DataFrame, base: dict) -> bool:
    pivot = base.get("base_top")
    if not pivot:
        return False
    return _last_close(df) > pivot * 1.05


def is_emerging(df: pd.DataFrame, thrust: dict, base: dict) -> bool:
    """'On the come up': thrust occurred but base isn't fully formed yet.

    Conditions:
      - Has a valid thrust (>=30% in the last 40 days)
      - Either no base detected, or a base shorter than 5 days
      - Not extended >5% above the highest recent high
    """
    if not thrust.get("thrust"):
        return False
    base_len = base.get("base_length") or 0
    if base.get("base") and base_len >= 5:
        return False
    # Don't tag extended chasers as "emerging"
    recent_high = float(df["high"].tail(20).max())
    if recent_high > 0 and _last_close(df) > recent_high * 1.05:
        return False
    return True
