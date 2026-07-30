"""Breakdown Short scanner — the stage-4 trend short.

The other short in the book. `parabolic.py` fades an *over-extension* (a rubber
band stretched too far, snapping back); this one shorts a *broken trend* — a
name that has lost every rail and whose rails have rolled over and inverted.
They're opposite trades: the parabolic short fades strength, the breakdown short
sells weakness that has already been confirmed.

The setup (Weinstein stage 4 / the mirror of the long playbook):

  1. Price below the 10, 20 and 50.
  2. Rails INVERTED and fanning down — 10 < 20 < 50 — the exact mirror of the
     stacked 10 > 20 > 50 the long side demands.
  3. Rails DECLINING — the 20 and 50 both sloping down. This is the part that
     separates a real markdown from a deep pullback in an uptrend: price can
     cross below a *rising* 50 and be fine; below a *falling* one, nothing is
     pulling it back up.

Timing — the part that decides whether the setup pays:

  The initial flush is the worst entry. Distance below the rails is the same
  exhaustion gauge the long side uses, mirrored: a name 25% under its 10-day has
  already made its move and is the one that squeezes. The high-expectancy entry
  is the RALLY BACK INTO A DECLINING RAIL ("the backside" in the Short Side
  framework) — you're selling to the bounce with the rail directly overhead as
  the stop. So `at_rail` is computed as a first-class signal and candidates in
  that zone sort to the top, rather than the ones that just gapped down.

Hard filters:
  1. Liquidity  : close >= min_price AND close*volume >= min_dollar_volume.
                  Shortability matters more than usual — a name you can't borrow
                  or exit is not a trade.
  2. Below all  : close < 10-day < 20-day < 50-day (inverted and beneath).
  3. Declining  : 20-day and 50-day slopes both negative (%/week).

Soft signals (surfaced; optionally gated):
  • at_rail     — price has rallied back to within AT_RAIL_PCT of the declining
                  10/20. `require_at_rail` keeps only these.
  • below_200   — also under the 200-day: full stage 4 rather than a deep
                  correction inside a longer uptrend. `require_below_200`.

Like every scanner here this reads the shared (unadjusted) breadth cache, so it
carries a FORWARD-split guard: a 2-for-1 halves the price overnight and would
otherwise look like the cleanest breakdown on the board. See `_is_probable_split`.
"""

from __future__ import annotations

import logging
from datetime import datetime

import numpy as np
import pandas as pd

from breadth.cache import list_cached_days, load_cached_day

logger = logging.getLogger(__name__)

# --- Rule thresholds --------------------------------------------------------
MIN_PRICE = 5.00                 # cheap names are hard to borrow / brutal to exit
MIN_DOLLAR_VOLUME = 5_000_000    # same shortability floor the rules use

MA_FAST, MA_MED, MA_SLOW = 10, 20, 50
MA_LONG = 200                    # stage filter, not a rail (soft signal only)
SLOPE_LOOKBACK = 20              # ~4 weeks, matching ma_reclaim's convention
FALL_PER_WEEK = 0.0              # slope < 0 %/week counts as declining

# The entry zone: price back within this % of a declining rail. The rail is
# above price in a downtrend, so this measures how far it has rallied back up.
AT_RAIL_PCT = 3.0

# Over-extension to the downside — the mirror of the parabolic stretch. Beyond
# this far under the 10-day the move is already made and squeeze risk dominates.
EXTENDED_BELOW_PCT = 20.0

RESULT_LIMIT = 100

# Forward-split fingerprint: a clean ~1/n price cut in a single session.
SPLIT_DROP_PCT = -40.0
SPLIT_RATIOS = (0.5, 1 / 3, 0.25, 0.2, 0.1)
SPLIT_TOL = 0.015


def run(
    min_price: float = MIN_PRICE,
    min_dollar_volume: float = MIN_DOLLAR_VOLUME,
    require_at_rail: bool = False,
    require_below_200: bool = False,
    limit: int = RESULT_LIMIT,
) -> dict:
    """Scan the breadth cache for stage-4 breakdown short candidates.

    Hard filters (always applied): liquidity, price below an inverted 10/20/50,
    and both the 20 and 50 declining.

    Soft gates (off by default): `require_at_rail` keeps only names that have
    rallied back to a declining rail (the preferred entry); `require_below_200`
    keeps only names also under their 200-day.
    """
    all_days = list_cached_days()
    if not all_days:
        return _empty(None, min_price, min_dollar_volume, 0, 0,
                      error="Breadth cache is empty. Run Market Monitor → Refresh first.")

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

    # Enough history for the 50-day plus its slope window; the 200 is optional.
    need = MA_SLOW + SLOPE_LOOKBACK + 2
    closes: dict = {}
    vols: dict = {}
    for d in reversed(all_days):
        df = load_cached_day(d)
        if df is None or df.empty:
            continue
        closes[d] = df["close"].reindex(candidate_symbols)
        vols[d] = df["volume"].reindex(candidate_symbols)
        if len(closes) >= MA_LONG + 2:      # take the 200 too when the cache has it
            break

    available = len(closes)
    if available < need:
        return _empty(
            today.isoformat(), min_price, min_dollar_volume, universe_size, passed_liquidity,
            error=(
                f"Not enough breadth history for a 50-day breakdown read — need "
                f"{need} trading days, have {available}. Run Market Monitor → Refresh."
            ),
        )

    close_mat = pd.DataFrame(closes).sort_index(axis=1)
    vol_mat = pd.DataFrame(vols).sort_index(axis=1).reindex(close_mat.index)
    valid = close_mat.notna().all(axis=1)
    close_mat, vol_mat = close_mat[valid], vol_mat[valid]
    passed_coverage = len(close_mat)
    if close_mat.empty:
        return _empty(today.isoformat(), min_price, min_dollar_volume, universe_size,
                      passed_liquidity, passed_coverage=0)

    C = close_mat.to_numpy(dtype=float)
    V = vol_mat.to_numpy(dtype=float)
    symbols = list(close_mat.index)
    has_200 = C.shape[1] >= MA_LONG

    price = C[:, -1]
    lb = SLOPE_LOOKBACK

    def sma(win, offset=0):
        """Trailing mean of `win` closes ending `offset` sessions back."""
        end = C.shape[1] - offset
        return np.nanmean(C[:, end - win:end], axis=1)

    ma10, ma20, ma50 = sma(MA_FAST), sma(MA_MED), sma(MA_SLOW)
    ma200 = sma(MA_LONG) if has_200 else None

    with np.errstate(invalid="ignore", divide="ignore"):
        slope20 = (ma20 / sma(MA_MED, lb) - 1.0) * 100.0 / (lb / 5.0)
        slope50 = (ma50 / sma(MA_SLOW, lb) - 1.0) * 100.0 / (lb / 5.0)
        # Rails sit ABOVE price in a downtrend: how far price must rally to reach them.
        to_ma10 = (ma10 / price - 1.0) * 100.0
        to_ma20 = (ma20 / price - 1.0) * 100.0
        below_50_pct = (ma50 / price - 1.0) * 100.0
        day_chg = np.full_like(C, np.nan)
        day_chg[:, 1:] = (C[:, 1:] / C[:, :-1] - 1.0) * 100.0

    candidates: list[dict] = []
    split_filtered = 0
    for i, sym in enumerate(symbols):
        px, m10, m20, m50 = price[i], ma10[i], ma20[i], ma50[i]
        if not np.isfinite([px, m10, m20, m50]).all():
            continue

        # HARD: below an inverted stack — the mirror of 10 > 20 > 50.
        if not (px < m10 < m20 < m50):
            continue
        # HARD: the rails are actually rolling over, not just briefly overtaken.
        s20, s50 = slope20[i], slope50[i]
        if not (np.isfinite(s20) and np.isfinite(s50) and s20 < FALL_PER_WEEK and s50 < FALL_PER_WEEK):
            continue
        # HARD: a forward split is not a breakdown.
        if _is_probable_split(day_chg[i, -MA_SLOW:]):
            split_filtered += 1
            continue

        d10, d20 = float(to_ma10[i]), float(to_ma20[i])
        at_rail = d10 <= AT_RAIL_PCT or d20 <= AT_RAIL_PCT
        extended = d10 >= EXTENDED_BELOW_PCT      # already flushed — squeeze risk
        below_200 = bool(ma200 is not None and np.isfinite(ma200[i]) and px < ma200[i])

        if require_at_rail and not at_rail:
            continue
        if require_below_200 and not below_200:
            continue

        # Reference stop for the short: just above the nearest declining rail.
        stop_px = float(m10 if d10 <= d20 else m20)
        risk_pct = (stop_px - px) / px * 100.0 if px else None
        vol_t = V[i, -1]

        candidates.append({
            "symbol": sym,
            "close": _f(px),
            "ma10": _f(m10), "ma20": _f(m20), "ma50": _f(m50),
            "ma200": _f(ma200[i]) if (ma200 is not None and np.isfinite(ma200[i])) else None,
            "to_ma10_pct": round(d10, 2),
            "to_ma20_pct": round(d20, 2),
            "below_50_pct": round(float(below_50_pct[i]), 1),
            "slope20_per_week": round(float(s20), 2),
            "slope50_per_week": round(float(s50), 2),
            "days_below_50": _days_below(C[i], MA_SLOW),
            "at_rail": bool(at_rail),
            "extended": bool(extended),
            "below_200": below_200,
            "volume": int(vol_t) if np.isfinite(vol_t) else None,
            "dollar_volume": _f(vol_t * px) if np.isfinite(vol_t) else None,
            "stop": _f(stop_px),
            "risk_pct": round(risk_pct, 2) if risk_pct is not None else None,
            "_score": _score(at_rail, extended, below_200, s20, s50, d10),
        })

    candidates.sort(key=lambda c: -c["_score"])
    for c in candidates:
        c.pop("_score", None)
    candidates = candidates[: max(1, int(limit))]

    return {
        "as_of": today.isoformat(),
        "thresholds": _thresholds_payload(min_price, min_dollar_volume, has_200),
        "gates": {
            "require_at_rail": bool(require_at_rail),
            "require_below_200": bool(require_below_200),
        },
        "candidates": candidates,
        "counts": {
            "universe": universe_size,
            "passed_liquidity": passed_liquidity,
            "passed_coverage": passed_coverage,
            "split_filtered": split_filtered,
            "passed_all": len(candidates),
        },
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


def _score(at_rail, extended, below_200, s20, s50, d10) -> float:
    """Rank the best ENTRIES first, not the biggest decliners.

    A name rallied back into a declining rail is the trade; one already 25% below
    its 10-day is the squeeze. So `at_rail` dominates and `extended` is penalised
    — steepness only breaks ties.
    """
    score = 0.0
    score += 3.0 if at_rail else 0.0
    score -= 2.0 if extended else 0.0
    score += 0.5 if below_200 else 0.0
    score += min(abs(float(s20)) / 2.0, 1.5) + min(abs(float(s50)) / 2.0, 1.5)
    score -= min(max(d10, 0.0) / 20.0, 1.0)     # nearer the rail is better
    return score


def _days_below(closes: np.ndarray, win: int) -> int:
    """Consecutive sessions the close has spent under its own trailing SMA."""
    n = len(closes)
    streak = 0
    for j in range(n, win, -1):
        ma = np.nanmean(closes[j - win:j])
        if np.isfinite(ma) and closes[j - 1] < ma:
            streak += 1
        else:
            break
    return streak


def _is_probable_split(run_returns: np.ndarray) -> bool:
    """True when the window's worst day looks like a forward split, not a crash.

    The cache is unadjusted, so a 2-for-1 prints as a clean −50% day. Real crashes
    rarely land within ~1.5% of an exact 1/n ratio, so that proximity is the tell.
    """
    if not np.isfinite(run_returns).any():
        return False
    j = int(np.nanargmin(run_returns))
    drop = run_returns[j]
    if not np.isfinite(drop) or drop > SPLIT_DROP_PCT:
        return False
    ratio = 1.0 + drop / 100.0                      # e.g. -50% → 0.5
    return any(abs(ratio - r) <= SPLIT_TOL for r in SPLIT_RATIOS)


def _empty(as_of, min_price, min_dollar_volume, universe, passed_liquidity,
           passed_coverage: int = 0, error: str | None = None) -> dict:
    out = {
        "as_of": as_of,
        "thresholds": _thresholds_payload(min_price, min_dollar_volume, False),
        "candidates": [],
        "counts": {
            "universe": universe, "passed_liquidity": passed_liquidity,
            "passed_coverage": passed_coverage, "split_filtered": 0, "passed_all": 0,
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


def _thresholds_payload(min_price, min_dollar_volume, has_200) -> dict:
    return {
        "min_price": float(min_price),
        "min_dollar_volume": float(min_dollar_volume),
        "ma_fast": MA_FAST, "ma_med": MA_MED, "ma_slow": MA_SLOW,
        "ma_long": MA_LONG, "has_200": bool(has_200),
        "slope_lookback": SLOPE_LOOKBACK,
        "at_rail_pct": AT_RAIL_PCT,
        "extended_below_pct": EXTENDED_BELOW_PCT,
    }
