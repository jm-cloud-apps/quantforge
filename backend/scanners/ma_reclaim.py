"""200-day MA Reclaim scanner — a long-term trend flip from bearish to bullish.

The 200-day simple moving average is the single most-watched long-term trend line
in the market: institutions treat "above the 200d" as the dividing line between a
stock that's in a bull phase and one that isn't. This scan hunts the *event* where
a name that has been **below** its 200-day MA for a sustained stretch (long-term
bearish, momentum down) **reclaims** it — closes back above the line — for the first
time in weeks. That reclaim is the earliest structural signal that the long-term
trend is turning up, which is exactly the "shift from bearish to bullish momentum"
a swing/position trader wants to catch near the pivot rather than chasing later.

It is deliberately *not* the same as Stage Analysis. Stage Analysis buckets the
whole market into Weinstein's four stages off a 30-week (150d) MA taxonomy. This is
a focused, single-event scan on the **200-day** line specifically, with the extra
requirement that the stock was genuinely *below* the line for a long time first — so
it surfaces regime *flips*, not names chopping back and forth across a flat MA.

What defines a reclaim here (hard gates):

  1. Liquidity  : close >= $5 and $-volume >= $5M/day — real, tradable names.
  2. Above now  : today's close is at/above the 200-day MA (it has reclaimed).
  3. Fresh cross: the below→above cross happened within the last RECLAIM_MAX_AGE
                  sessions — we want a *fresh* pivot, not a reclaim that already ran
                  20% weeks ago.
  4. Was bearish: price sat *below* the 200d for >= MIN_DAYS_BELOW sessions in a row
                  immediately before the cross. This is the filter that turns "wiggled
                  above a flat line" into "a genuine long-term-downtrend flip."

Soft signals (computed and surfaced as columns; gate only when requested):

  • MA turning  — the 200d itself has stopped falling / is curling up (slope >= 0).
                  A reclaim while the MA is still falling is weaker than one where the
                  line itself is flattening — the trend, not just price, is turning.
  • RS leading  — Mansfield relative strength vs SPY is positive (leading the market).
  • Not extended— price is still within EXTENDED_PCT of the 200d, i.e. you're early to
                  the reclaim rather than chasing a name that already ran off the line.

Context metrics that don't gate but help size / pick:

  • pct_above_ma  — how far above the 200d price closed (extension).
  • days_below    — how long it was below the line before reclaiming (bigger = bigger
                    base being resolved).
  • reclaim_age   — sessions since the cross (0 = crossed today, the freshest).
  • max_below_pct — the deepest the stock traded under its 200d during the decline
                    (how deep a hole it's climbing out of).
  • ma_slope_per_week — the 200d's own slope, normalised %-per-week.
  • vol_ratio     — volume since the cross vs the pre-cross average (demand confirming).
  • stop / risk   — a reference stop back below the reclaimed 200d line.

Like the reversal / 9M / stage scanners, this reads the daily grouped-cache the
breadth engine already maintains — **zero extra API calls per run**. A true 200-day
MA needs ~200 cached sessions; when the cache is shorter we transparently fall back
to the longest MA that fits (never below MIN_MA_DAYS) and flag the result `ma_approx`
so the UI can say so and prompt a deeper backfill.
"""

from __future__ import annotations

import logging
from datetime import datetime

import numpy as np
import pandas as pd

from breadth.cache import list_cached_days, load_cached_day

logger = logging.getLogger(__name__)

# --- Target MA + scan windows ----------------------------------------------
MA_DAYS = 200            # the 200-day SMA — the long-term trend line we watch
SCAN_H = 45              # trailing sessions we evaluate above/below flags over
SLOPE_LOOKBACK = 20      # ~4 weeks — window over which we measure the MA's slope

# Graceful-degradation floors when the cache is shallower than MA_DAYS + SCAN_H.
MIN_MA_DAYS = 100        # never shrink the MA proxy below ~20 weeks
MIN_SCAN_H = 15          # never shrink the reclaim-scan window below ~3 weeks

# --- Reclaim-event thresholds ----------------------------------------------
RECLAIM_MAX_AGE = 10     # cross must have happened within the last N sessions (fresh)
MIN_DAYS_BELOW = 25      # must have been below the line >= N sessions before the cross
EXTENDED_PCT = 8.0       # > this % above the 200d = the reclaim already ran (soft)

# Slope dead-band: a 200d "rising" ≈ climbing faster than ~0.10%/week; the mirror is
# "falling". Between the two the line is genuinely flat — the base is resolving.
RISE_PER_WEEK = 0.10
FALL_PER_WEEK = -0.10

# --- Liquidity floor (defaults; overridable per request) -------------------
MIN_PRICE = 5.0
MIN_DOLLAR_VOLUME = 5_000_000   # $5M/day traded

# Cross-sectional cap so the JSON payload stays light (counts stay full).
RESULT_LIMIT = 300


def run(
    min_price: float = MIN_PRICE,
    min_dollar_volume: float = MIN_DOLLAR_VOLUME,
    require_ma_turning: bool = False,
    require_rs: bool = False,
    exclude_extended: bool = False,
    limit: int = RESULT_LIMIT,
) -> dict:
    """Scan the breadth cache for fresh 200-day-MA reclaims.

    Hard filters (always applied): liquidity, above the 200d today, a fresh cross
    within RECLAIM_MAX_AGE sessions, and a sustained MIN_DAYS_BELOW stretch below
    the line before the cross.

    Soft gates (off by default): `require_ma_turning` keeps only names whose 200d
    has stopped falling; `require_rs` keeps only positive-RS leaders; `exclude_extended`
    drops names already more than EXTENDED_PCT above the line.
    """
    all_days = list_cached_days()
    if not all_days:
        return _empty(None, min_price, min_dollar_volume, 0, 0,
                      error="Breadth cache is empty. Run Market Monitor → Refresh first.")

    # --- Latest non-empty day → liquidity gate → candidate universe --------
    today = None
    today_df = None
    for d in reversed(all_days):
        df = load_cached_day(d)
        if df is not None and not df.empty:
            today, today_df = d, df
            break
    if today_df is None:
        return _empty(None, min_price, min_dollar_volume, 0, 0,
                      error="No non-empty day in the breadth cache yet.")

    today_df = today_df.dropna(subset=["open", "high", "low", "close", "volume"])
    universe_size = len(today_df)
    dollar_vol = today_df["close"] * today_df["volume"]
    gated = today_df[(today_df["close"] >= min_price) & (dollar_vol >= min_dollar_volume)]
    passed_liquidity = len(gated)
    if gated.empty:
        return _empty(today.isoformat(), min_price, min_dollar_volume, universe_size, 0)
    candidate_symbols = list(gated.index)
    # SPY is needed for the relative-strength read even if it's not a candidate.
    need_symbols = list(dict.fromkeys(candidate_symbols + ["SPY"]))

    # --- Walk back collecting the last N non-empty sessions for candidates --
    need = MA_DAYS + SCAN_H
    closes: dict = {}
    vols: dict = {}
    for d in reversed(all_days):
        df = load_cached_day(d)
        if df is None or df.empty:
            continue
        closes[d] = df["close"].reindex(need_symbols)
        vols[d] = df["volume"].reindex(need_symbols)
        if len(closes) >= need:
            break

    available = len(closes)
    ma_days, scan_h, ma_approx = _fit_windows(available)
    if ma_days is None:
        need_min = MIN_MA_DAYS + MIN_SCAN_H
        return _empty(
            today.isoformat(), min_price, min_dollar_volume, universe_size, passed_liquidity,
            error=(
                f"Not enough breadth history for a 200-day reclaim read — need ≥ {need_min} "
                f"trading days, have {available}. In Market Monitor → Refresh, backfill a "
                f"bigger lookback (e.g. 360 days) so the 200-day MA can form."
            ),
        )

    slope_lb = min(SLOPE_LOOKBACK, scan_h - 1)
    # In shallow-cache (approx) mode the below-streak we can *measure* is capped by
    # the scan window, so the "was bearish" gate can't ask for more than fits.
    min_days_below = min(MIN_DAYS_BELOW, max(1, scan_h - RECLAIM_MAX_AGE - 2))

    # Ascending-by-date close/volume matrices, sliced to exactly the window we use.
    close_mat = pd.DataFrame(closes).sort_index(axis=1)
    vol_mat = pd.DataFrame(vols).sort_index(axis=1)
    window = ma_days + scan_h
    close_mat = close_mat.iloc[:, -window:]
    vol_mat = vol_mat.iloc[:, -window:]

    # SPY series (for RS) is read off the full matrix before we drop it below.
    spy_close = close_mat.loc["SPY"].to_numpy(dtype=float) if "SPY" in close_mat.index else None

    # Only classify names with full coverage across the whole window — a partial
    # series makes the 200-day MA a lie (recent IPOs can't have a 200d anyway).
    close_mat = close_mat.loc[[s for s in candidate_symbols if s in close_mat.index]]
    vol_mat = vol_mat.reindex(close_mat.index)
    valid = close_mat.notna().all(axis=1) & vol_mat.notna().all(axis=1)
    close_mat = close_mat[valid]
    vol_mat = vol_mat[valid]
    passed_coverage = len(close_mat)
    if close_mat.empty:
        return _empty(today.isoformat(), min_price, min_dollar_volume, universe_size,
                      passed_liquidity, passed_coverage=0)

    C = close_mat.to_numpy(dtype=float)          # (S, window)
    V = vol_mat.to_numpy(dtype=float)
    symbols = list(close_mat.index)

    # --- Rolling 200-day SMA across every column, then the reclaim scan ------
    ma_full = _trailing_sma(C, ma_days)          # (S, window); NaN for first ma_days-1 cols
    close_scan = C[:, -scan_h:]                  # (S, scan_h)
    ma_scan = ma_full[:, -scan_h:]
    above = close_scan >= ma_scan                # (S, scan_h) bool — above the line?

    # Relative strength vs SPY (Mansfield): stock/SPY ratio vs its own MA of that
    # ratio. > 0 and rising = leading the market. Ranked cross-sectionally 1-99.
    rs_now, rs_rising, rs_rank = _relative_strength(C, spy_close, ma_days, slope_lb, symbols)

    # MA slope (normalised %-per-week) off the last SLOPE_LOOKBACK sessions.
    ma_last = ma_full[:, -1]
    ma_prev = ma_full[:, -1 - slope_lb]
    slope_pct = (ma_last / ma_prev - 1.0) * 100.0
    slope_per_week = slope_pct / (slope_lb / 5.0)

    price = C[:, -1]
    pct_above_ma = (price / ma_last - 1.0) * 100.0

    candidates: list[dict] = []
    currently_above = 0
    for i, sym in enumerate(symbols):
        ab = above[i]
        if not ab[-1]:
            continue  # must be above the 200d *today* to count as a reclaim
        currently_above += 1

        # Most-recent below→above transition inside the scan window. If the whole
        # window is already above, the reclaim happened before we can see it → not
        # fresh, skip. This also means "held above since the most recent cross".
        cross_idx = _last_cross_up(ab)
        if cross_idx is None:
            continue
        reclaim_age = (scan_h - 1) - cross_idx
        if reclaim_age > RECLAIM_MAX_AGE:
            continue

        # Sustained stretch below the line immediately before the cross.
        days_below = _below_run_before(ab, cross_idx)
        if days_below < min_days_below:
            continue

        # Deepest the name traded under its 200d during that below stretch — how big
        # a hole it's climbing out of.
        lo = max(0, cross_idx - days_below)
        below_slice_close = close_scan[i, lo:cross_idx]
        below_slice_ma = ma_scan[i, lo:cross_idx]
        with np.errstate(invalid="ignore", divide="ignore"):
            below_depths = (below_slice_ma - below_slice_close) / below_slice_ma * 100.0
        max_below_pct = float(np.nanmax(below_depths)) if below_depths.size else None

        # Volume expansion: average since the cross vs the ~pre-cross average.
        vol_since = V[i, -(scan_h - cross_idx):]
        pre_lo = max(0, cross_idx - slope_lb)
        vol_pre = V[i, pre_lo:cross_idx]
        vol_ratio = None
        if vol_pre.size and np.nanmean(vol_pre) > 0:
            vol_ratio = float(np.nanmean(vol_since) / np.nanmean(vol_pre))

        slope = float(slope_per_week[i])
        ma_turning = slope >= 0.0            # 200d has stopped falling / curling up
        ma_rising = slope > RISE_PER_WEEK
        ma_falling = slope < FALL_PER_WEEK
        pab = float(pct_above_ma[i])
        extended = pab > EXTENDED_PCT
        rs_val = None if (rs_now is None or np.isnan(rs_now[i])) else float(rs_now[i])
        rs_is_rising = bool(rs_rising[i]) if rs_rising is not None else False
        rs_pct = None if (rs_rank is None or np.isnan(rs_rank[i])) else float(rs_rank[i])

        # --- Soft gates -------------------------------------------------------
        if require_ma_turning and not ma_turning:
            continue
        if require_rs and not (rs_val is not None and rs_val > 0):
            continue
        if exclude_extended and extended:
            continue

        close_px = float(price[i])
        ma_px = float(ma_last[i])
        # Reference stop: a close back below the reclaimed 200d invalidates the flip.
        risk_pct = ((close_px - ma_px) / close_px * 100.0) if close_px else None

        signal, bucket = _label(reclaim_age, ma_turning, extended)
        quality = _quality(reclaim_age, days_below, slope, rs_pct, vol_ratio, pab)

        candidates.append({
            "symbol": sym,
            "close": _f(close_px),
            "ma": _f(ma_px),
            "pct_above_ma": round(pab, 2),
            "reclaim_age": int(reclaim_age),
            "days_below": int(days_below),
            "max_below_pct": round(max_below_pct, 1) if max_below_pct is not None else None,
            "ma_slope_per_week": round(slope, 2),
            "ma_turning": bool(ma_turning),
            "ma_rising": bool(ma_rising),
            "ma_falling": bool(ma_falling),
            "rs_mansfield": round(rs_val, 1) if rs_val is not None else None,
            "rs_rank": round(rs_pct) if rs_pct is not None else None,
            "rs_rising": rs_is_rising,
            "vol_ratio": round(vol_ratio, 2) if vol_ratio is not None else None,
            "volume": int(V[i, -1]) if not np.isnan(V[i, -1]) else None,
            "dollar_volume": _f(V[i, -1] * close_px),
            "extended": bool(extended),
            "stop": _f(ma_px),
            "risk_pct": round(risk_pct, 2) if risk_pct is not None else None,
            "signal": signal,
            "quality": quality,
            "_sort_bucket": bucket,
            "_score": quality,
        })

    # Freshest, highest-quality reclaims first.
    candidates.sort(key=lambda c: (c["_sort_bucket"], -c["_score"]))
    passed_all = len(candidates)

    kept = candidates[: max(0, int(limit))]
    for c in kept:
        c.pop("_sort_bucket", None)
        c.pop("_score", None)

    return {
        "as_of": today.isoformat(),
        "thresholds": _thresholds_payload(
            min_price, min_dollar_volume, ma_days, ma_approx, scan_h,
            slope_lb, min_days_below, available,
        ),
        "gates": {
            "require_ma_turning": bool(require_ma_turning),
            "require_rs": bool(require_rs),
            "exclude_extended": bool(exclude_extended),
        },
        "candidates": kept,
        "counts": {
            "universe": universe_size,
            "passed_liquidity": passed_liquidity,
            "passed_coverage": passed_coverage,
            "currently_above": currently_above,
            "passed_all": passed_all,
            "returned": len(kept),
        },
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


# ---------------------------------------------------------------------------
# Window fitting + vectorised helpers
# ---------------------------------------------------------------------------
def _fit_windows(available: int) -> tuple[int | None, int | None, bool]:
    """Pick the MA and reclaim-scan windows that fit the cached history.

    Prefer the true 200-day MA with a full 45-session scan window. When the cache
    is shorter, keep the MA as long as possible (down to MIN_MA_DAYS) and shrink
    the scan window only as much as needed, flagging the result approximate.
    Returns (ma_days, scan_h, ma_approx) or (None, None, False) if too short.
    """
    if available >= MA_DAYS + SCAN_H:
        return MA_DAYS, SCAN_H, False
    if available < MIN_MA_DAYS + MIN_SCAN_H:
        return None, None, False
    scan_h = min(SCAN_H, max(MIN_SCAN_H, available - MIN_MA_DAYS))
    ma_days = min(MA_DAYS, available - scan_h)
    return ma_days, scan_h, True


def _trailing_sma(C: np.ndarray, w: int) -> np.ndarray:
    """Trailing simple moving average of window `w` along axis 1, vectorised.

    Returns an array the same shape as C with NaN in the first w-1 columns (where
    a full window isn't available). MA[:, t] = mean(C[:, t-w+1 : t+1]).
    """
    S, D = C.shape
    out = np.full((S, D), np.nan)
    if D < w:
        return out
    csum = np.cumsum(C, axis=1)
    out[:, w - 1] = csum[:, w - 1] / w
    out[:, w:] = (csum[:, w:] - csum[:, :-w]) / w
    return out


def _last_cross_up(ab: np.ndarray) -> int | None:
    """Index of the most-recent below→above transition in a boolean run `ab`
    (ascending in time). Returns the index t where ab[t] is True and ab[t-1] is
    False (or t==0 and ab[0] True), or None if the whole run is already above.
    """
    n = len(ab)
    for t in range(n - 1, -1, -1):
        if not ab[t]:
            continue
        if t == 0 or not ab[t - 1]:
            return t
    return None


def _below_run_before(ab: np.ndarray, cross_idx: int) -> int:
    """Count consecutive below-the-line (False) sessions immediately before a cross."""
    streak = 0
    j = cross_idx - 1
    while j >= 0 and not ab[j]:
        streak += 1
        j -= 1
    return streak


def _relative_strength(C: np.ndarray, spy_close: np.ndarray | None, ma_days: int,
                       slope_lb: int, symbols: list[str]):
    """Mansfield RS vs SPY + a cross-sectional 1-99 percentile rank.

    Returns (rs_now, rs_rising, rs_rank) as arrays aligned to `symbols`, or
    (None, None, None) when SPY history isn't available.
    """
    if spy_close is None:
        return None, None, None
    spy = spy_close[-C.shape[1]:]
    with np.errstate(invalid="ignore", divide="ignore"):
        ratio = C / spy                                   # (S, window)
        ratio_now = ratio[:, -1]
        ratio_ma = ratio[:, -ma_days:].mean(axis=1)
        ratio_prev = ratio[:, -1 - slope_lb]
        rs_now = (ratio_now / ratio_ma - 1.0) * 100.0
    rs_rising = ratio_now > ratio_prev
    rs_series = pd.Series(rs_now, index=symbols)
    rs_rank = (rs_series.rank(pct=True) * 100.0).to_numpy()
    return rs_now, rs_rising, rs_rank


def _label(reclaim_age: int, ma_turning: bool, extended: bool) -> tuple[str, int]:
    """Signal label + sort bucket. Fresh reclaims where the 200d itself is turning
    up rank first; extended reclaims (already ran off the line) sink last."""
    if extended:
        return "Extended reclaim", 3
    if reclaim_age <= 3:
        return ("Fresh reclaim · MA turning", 0) if ma_turning else ("Fresh reclaim", 1)
    return ("Reclaim holding · MA turning", 1) if ma_turning else ("Reclaim holding", 2)


def _quality(reclaim_age: int, days_below: int, slope: float,
             rs_rank: float | None, vol_ratio: float | None, pct_above: float) -> float:
    """Composite 0-100: freshness, depth of the base reclaimed, the 200d's own
    slope, relative strength, volume confirmation, and not-yet-extended. A single
    sortable number for "how clean is this reclaim right now."""
    fresh_c = _clamp(1.0 - reclaim_age / max(1, RECLAIM_MAX_AGE), 0.0, 1.0)      # newer = better
    below_c = _clamp(days_below / 60.0, 0.0, 1.0)                                # longer base
    slope_c = _clamp((slope - FALL_PER_WEEK) / (2 * RISE_PER_WEEK + 0.5), 0.0, 1.0)  # turning up
    rs_c = (rs_rank / 100.0) if rs_rank is not None else 0.5
    vol_c = _clamp(((vol_ratio or 1.0) - 1.0) / 1.0, 0.0, 1.0)                   # demand
    prox_c = _clamp(1.0 - max(0.0, pct_above) / (2 * EXTENDED_PCT), 0.0, 1.0)    # not extended
    score = (0.28 * fresh_c + 0.18 * below_c + 0.20 * slope_c
             + 0.16 * rs_c + 0.10 * vol_c + 0.08 * prox_c)
    return round(100.0 * score, 1)


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _thresholds_payload(min_price, min_dollar_volume, ma_days, ma_approx, scan_h,
                        slope_lb, min_days_below, available) -> dict:
    return {
        "min_price": float(min_price),
        "min_dollar_volume": float(min_dollar_volume),
        "ma_days": int(ma_days),
        "ma_target": MA_DAYS,
        "ma_approx": bool(ma_approx),
        "scan_window": int(scan_h),
        "slope_lookback": int(slope_lb),
        "reclaim_max_age": RECLAIM_MAX_AGE,
        "min_days_below": int(min_days_below),
        "extended_pct": EXTENDED_PCT,
        "days_available": int(available),
    }


def _empty(as_of, min_price, min_dollar_volume, universe, passed_liquidity,
           passed_coverage: int = 0, error: str | None = None) -> dict:
    out = {
        "as_of": as_of,
        "thresholds": {
            "min_price": float(min_price),
            "min_dollar_volume": float(min_dollar_volume),
            "ma_days": MA_DAYS,
            "ma_target": MA_DAYS,
            "ma_approx": False,
            "scan_window": SCAN_H,
            "reclaim_max_age": RECLAIM_MAX_AGE,
            "min_days_below": MIN_DAYS_BELOW,
            "extended_pct": EXTENDED_PCT,
        },
        "candidates": [],
        "counts": {
            "universe": universe,
            "passed_liquidity": passed_liquidity,
            "passed_coverage": passed_coverage,
            "currently_above": 0,
            "passed_all": 0,
            "returned": 0,
        },
    }
    if error:
        out["error"] = error
    return out


def _f(v) -> float | None:
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    return round(float(v), 4)
