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


def accumulation_score(df: pd.DataFrame, streak_days: int = 1) -> dict:
    """Directional read on RVOL surges: is this accumulation or distribution?

    Volume alone is direction-agnostic. This combines three independent tells
    that institutional buyers (vs. sellers) leave on daily bars:

      1. **Close Location Value (CLV)** — `(close - low) / (high - low)` for the
         most recent bar. Buyers force the close into the upper half of the
         range; sellers drop it into the lower half. Weighted 40%.
      2. **Up/down volume ratio** — over the streak window, sum volume on
         green days vs. red days. Accumulation = green volume dominates.
         Weighted 30%.
      3. **Close vs. VWAP** — closes above the day's volume-weighted average
         price (preferred from provider; falls back to typical-price proxy)
         over the streak. Weighted 30%.

    Returns:
      {
        "score": 0-100,
        "clv": 0-1,
        "up_down_vol_ratio": float (>1 = up-vol dominates),
        "above_vwap_pct": 0-1,
        "components": [{name, weight, value, points}],
      }
    """
    if df is None or len(df) < 2:
        return {"score": 0.0, "clv": None, "up_down_vol_ratio": None,
                "above_vwap_pct": None, "components": []}

    last = df.iloc[-1]
    rng = float(last["high"]) - float(last["low"])
    clv = float((last["close"] - last["low"]) / rng) if rng > 0 else 0.5

    # Streak window: at minimum 1 bar, capped by available history. We always
    # look at the LAST `window` bars regardless of streak (so even a Day-1
    # candidate gets context from the prior few sessions).
    window = max(int(streak_days), 3)
    window = min(window, len(df))
    tail = df.tail(window)

    up_vol = float(tail.loc[tail["close"] >= tail["open"], "volume"].sum())
    down_vol = float(tail.loc[tail["close"] < tail["open"], "volume"].sum())
    if up_vol + down_vol <= 0:
        up_down_ratio = 1.0
    elif down_vol <= 0:
        up_down_ratio = 5.0  # all up — cap to avoid div-by-zero infinity
    else:
        up_down_ratio = up_vol / down_vol
    # Map ratio → 0-1: 1.0 (balanced) = 0.5, 3.0 = 1.0, 0.33 = 0.0
    ud_norm = min(max((up_down_ratio - 0.33) / (3.0 - 0.33), 0.0), 1.0)

    # Close-vs-VWAP. Prefer the provider's VWAP column; fall back to typical
    # price (H+L+C)/3 if absent. Score = fraction of streak days closing above.
    if "vwap" in tail.columns and tail["vwap"].notna().any():
        vwap_series = tail["vwap"].astype(float)
    else:
        vwap_series = (tail["high"] + tail["low"] + tail["close"]) / 3.0
    above = (tail["close"] >= vwap_series).sum()
    above_vwap_pct = float(above) / float(len(tail))

    score = round(40 * clv + 30 * ud_norm + 30 * above_vwap_pct, 1)
    components = [
        {"component": f"Close-in-range (CLV {clv:.2f})", "weight": 40,
         "value": round(clv, 3), "points": round(40 * clv, 1)},
        {"component": f"Up/down vol ({up_down_ratio:.2f}×)", "weight": 30,
         "value": round(ud_norm, 3), "points": round(30 * ud_norm, 1)},
        {"component": f"Closes ≥ VWAP ({int(above)}/{len(tail)})", "weight": 30,
         "value": round(above_vwap_pct, 3), "points": round(30 * above_vwap_pct, 1)},
    ]
    return {
        "score": score,
        "clv": round(clv, 3),
        "up_down_vol_ratio": round(up_down_ratio, 3),
        "above_vwap_pct": round(above_vwap_pct, 3),
        "components": components,
    }


def chaikin_money_flow(df: pd.DataFrame, window: int = 21) -> float | None:
    """Chaikin Money Flow (CMF) over `window` days.

    CMF aggregates the "Money Flow Multiplier" weighted by volume — a single
    number summarizing whether buyers (CMF > 0) or sellers (CMF < 0) won the
    last N sessions. The traditional thresholds:
      ≥ +0.10 = sustained accumulation
      ≤ -0.10 = sustained distribution
      around 0 = balanced

    MFM = ((C - L) - (H - C)) / (H - L)   (close-in-range, range -1..+1)
    MFV = MFM × Volume
    CMF = Σ MFV / Σ Volume   (over `window` days)

    This is essentially a multi-day version of our Tier-A Accumulation Score's
    Close-Location-Value component, but volume-weighted. Together they're
    complementary: Accum Score = "today's bar", CMF = "the trend".
    """
    if df is None or len(df) < window:
        return None
    tail = df.tail(window)
    rng = (tail["high"] - tail["low"]).replace(0, np.nan)
    mfm = ((tail["close"] - tail["low"]) - (tail["high"] - tail["close"])) / rng
    mfv = mfm * tail["volume"]
    total_vol = float(tail["volume"].sum())
    if total_vol <= 0:
        return None
    return round(float(mfv.sum() / total_vol), 4)


def obv_slope(df: pd.DataFrame, window: int = 20) -> float | None:
    """On-Balance Volume slope over the last `window` bars (least-squares fit).

    OBV is a running cumulative volume that ADDS volume on up days and SUBTRACTS
    on down days. Its slope is the actionable signal:
      slope > 0 → up-volume dominates → accumulation
      slope < 0 → down-volume dominates → distribution

    We normalize by mean volume so the slope is comparable across tickers
    (otherwise NVDA's millions dwarf a small cap's hundreds of thousands).
    Returned value is "normalized slope per bar" — positive = accumulation.
    """
    if df is None or len(df) < window + 1:
        return None
    tail = df.tail(window + 1)
    close = tail["close"].to_numpy(dtype=float)
    vol = tail["volume"].to_numpy(dtype=float)
    # OBV[i] - OBV[i-1] = ±volume[i] based on close direction.
    signs = np.sign(close[1:] - close[:-1])  # +1 / 0 / -1
    obv_delta = signs * vol[1:]
    obv = np.cumsum(obv_delta)
    if len(obv) < 2:
        return None
    avg_vol = float(np.mean(vol[1:])) or 1.0
    x = np.arange(len(obv), dtype=float)
    # Least-squares slope of OBV vs index.
    sx, sy = x.sum(), obv.sum()
    sxx, sxy = (x * x).sum(), (x * obv).sum()
    denom = len(obv) * sxx - sx * sx
    if denom == 0:
        return None
    slope = (len(obv) * sxy - sx * sy) / denom
    return round(float(slope / avg_vol), 4)  # normalized: ~+0.5 = strong accum


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
