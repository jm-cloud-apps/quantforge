"""Parabolic Short scanner — Qullamaggie's over-extension / snap-back setup.

Source: https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/

    "Think of stocks as rubber bands, if they get really stretched short term,
    they can have powerful snapbacks. This is by far the riskiest setup if done
    wrong or if you have issues with not obeying your stops."

Qullamaggie's two criteria for the parabolic:

  1. A stock up 50-100%+ in a few days or weeks (if larger cap) or 300-1000%+
     (if smaller cap).
  2. The stock should be up 3-5+ days in a row. Many times a stock trends higher
     for weeks/months and then starts speeding up; some just explode from nowhere.

The playbook is a SHORT (occasionally a long) — you fade the exhaustion of a
parabolic move once it cracks, with a hard stop above the high, because the
snap-back off an over-stretched "rubber band" is fast. This scanner finds the
*candidates* (the over-extended runners); the trader still waits for the crack
(a first red day / loss of the low of the day) before shorting. It never auto-
enters — it's a where-to-look list.

Hard filters this module applies on the setup day:

  1. Universe  : US common stocks / ADRs / ETFs (cached grouped-daily panel).
  2. Liquidity : close >= min_price AND close*volume >= min_dollar_volume — the
                 name has to be tradable/shortable, not a $0.30 no-borrow.
  3. Run-up    : gain from the run-window low into today clears a cap-tiered bar —
                 >= min_gain_large_pct for higher-priced (large-cap-proxy) names,
                 >= min_gain_small_pct for lower-priced (small-cap-proxy) names.
  4. Up streak : today caps a run of >= min_up_days consecutive higher closes.

Cap tier is a **price proxy**: the grouped daily cache carries only OHLCV (no
market cap / shares outstanding), so price stands in for size — cheap names run
300-1000% where large caps top out at 50-100%. `large_cap_price` is the cutoff,
and the source's true micro-cap figure (300-1000%) is the default small-cap bar's
spirit, dialled to min_gain_small_pct so the scan returns something on a normal
day. Both bars are adjustable.

Soft signals (computed, surfaced as columns; gated only when requested):

  • extended    — close is >= EXT_MIN_PCT above the 10-day MA (the classic
                  "20%+ above the 10-day" rubber-band stretch). `require_extended`.
  • accelerating— today's 1-day % gain is the largest of the whole run — the
                  "starts speeding up / explodes" tell of a parabola steepening.
                  `require_accelerating`.

Surfaced metrics that don't gate but help pick/size the short:

  • gain_pct       — run-window low → today's close, the size of the move to fade.
  • gain_5d_pct    — 5-session close-to-close move (the "up 50-100% in a few days").
  • up_days        — consecutive higher-closing sessions into today.
  • ext_pct        — % above the 10-day MA (how stretched the rubber band is).
  • ext_pct_20     — % above the 20-day MA (the slower stretch).
  • from_high_pct  — how far the close sits below today's high (an intraday fade
                    already starting = the crack you're waiting for).
  • cap_tier       — 'large' / 'small' (price proxy) and the bar it had to clear.
  • stop           — reference stop for the short: today's high (a close/print back
                    above it says the parabola isn't done — get out).
  • risk_pct       — (stop - close)/close, the distance to that stop from the close.
"""

from __future__ import annotations

import logging
from datetime import datetime

import numpy as np
import pandas as pd

from breadth.cache import list_cached_days, load_cached_day

logger = logging.getLogger(__name__)

# --- Rule thresholds --------------------------------------------------------
MIN_PRICE = 3.00                 # tradable floor (parabolic runners can be cheap)
MIN_DOLLAR_VOLUME = 3_000_000    # close*volume — must be liquid enough to short
RUN_LOOKBACK = 20                # ~a month of sessions ("a few days or weeks")
MIN_UP_DAYS = 3                  # "up 3-5+ days in a row"
# Cap tier is a price proxy (no market-cap in the OHLCV cache): higher-priced
# names get the large-cap bar, cheaper names the (much higher) small-cap bar.
LARGE_CAP_PRICE = 20.00
MIN_GAIN_LARGE_PCT = 50.0        # large-cap-proxy: "up 50-100%+"
MIN_GAIN_SMALL_PCT = 100.0       # small-cap-proxy: source says 300-1000%; dialled
                                 # down so the scan isn't empty on a normal day

# Moving-average rails the move is stretched from.
MA_SHORT = 10                    # the 10-day — the rubber band a parabola leaves
MA_MED = 20                      # the 20-day — the slower stretch, for context
FIVE_DAY = 5                     # the "few days" window for gain_5d_pct

# Soft-signal threshold: "20%+ above the 10-day" is the classic parabolic stretch
# (matches the Candles×Rails "stretched above the rail" tell on the Rules page).
EXT_MIN_PCT = 20.0

# Reverse-split guard. The grouped daily cache is UNADJUSTED, so a reverse split
# (e.g. 1-for-10) prints as a huge one-day price jump — a fake "+900%" parabola.
# The fingerprint that separates a split from a real news gap: a split's share
# volume COLLAPSES (fewer shares exist), while a genuine explosive move (FDA,
# earnings, squeeze) comes with a volume SURGE. So a >SPLIT_JUMP_PCT single-day
# jump on volume below SPLIT_VOL_RATIO× the window median is treated as a split
# and dropped; a real gap keeps its volume and stays in.
SPLIT_JUMP_PCT = 90.0
SPLIT_VOL_RATIO = 0.5

RESULT_LIMIT = 100

# Sessions of history to load: enough for the 20-day MA and the run lookback.
NEED = max(RUN_LOOKBACK, MA_MED) + 2


def run(
    min_price: float = MIN_PRICE,
    min_dollar_volume: float = MIN_DOLLAR_VOLUME,
    min_gain_large_pct: float = MIN_GAIN_LARGE_PCT,
    min_gain_small_pct: float = MIN_GAIN_SMALL_PCT,
    large_cap_price: float = LARGE_CAP_PRICE,
    min_up_days: int = MIN_UP_DAYS,
    run_lookback: int = RUN_LOOKBACK,
    require_extended: bool = False,
    require_accelerating: bool = False,
    limit: int = RESULT_LIMIT,
) -> dict:
    """Run the parabolic-short scan against the latest cached grouped-daily panel.

    Hard filters (always applied): liquidity (price + dollar volume), a cap-tiered
    run-up gain, and a >= min_up_days consecutive-up-close streak.

    Soft gates (off by default): `require_extended` keeps only names >= EXT_MIN_PCT
    above the 10-day MA; `require_accelerating` keeps only names whose biggest 1-day
    gain of the run is today (the parabola steepening).
    """
    run_lookback = max(2, int(run_lookback))
    need = max(run_lookback, MA_MED) + 2

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

    # --- Walk back collecting the last `need` non-empty sessions ------------
    highs: dict = {}
    lows: dict = {}
    closes: dict = {}
    vols: dict = {}
    for d in reversed(all_days):
        df = load_cached_day(d)
        if df is None or df.empty:
            continue
        highs[d] = df["high"].reindex(candidate_symbols)
        lows[d] = df["low"].reindex(candidate_symbols)
        closes[d] = df["close"].reindex(candidate_symbols)
        vols[d] = df["volume"].reindex(candidate_symbols)
        if len(closes) >= need:
            break

    available = len(closes)
    if available < max(min_up_days + 1, FIVE_DAY + 1, 3):
        return _empty(
            today.isoformat(), min_price, min_dollar_volume, universe_size, passed_liquidity,
            error=(
                f"Not enough breadth history for a parabolic read — have {available} "
                f"trading days. Run Market Monitor → Refresh to backfill more."
            ),
        )

    # Effective windows shrink gracefully to the history we actually have.
    eff_run = min(run_lookback, available)
    eff_ma_short = min(MA_SHORT, available)
    eff_ma_med = min(MA_MED, available)
    eff_5d = min(FIVE_DAY, available - 1)

    # Ascending-by-date matrices (S, available).
    close_mat = pd.DataFrame(closes).sort_index(axis=1)
    high_mat = pd.DataFrame(highs).sort_index(axis=1).reindex(close_mat.index)
    low_mat = pd.DataFrame(lows).sort_index(axis=1).reindex(close_mat.index)
    vol_mat = pd.DataFrame(vols).sort_index(axis=1).reindex(close_mat.index)

    # Only score names with a full close series over the windows we use — a partial
    # series makes the gain and MA reads a lie (recent IPOs can't be parabolic yet).
    valid = close_mat.notna().all(axis=1)
    close_mat = close_mat[valid]
    high_mat = high_mat.reindex(close_mat.index)
    low_mat = low_mat.reindex(close_mat.index)
    vol_mat = vol_mat.reindex(close_mat.index)
    passed_coverage = len(close_mat)
    if close_mat.empty:
        return _empty(today.isoformat(), min_price, min_dollar_volume, universe_size,
                      passed_liquidity, passed_coverage=0)

    C = close_mat.to_numpy(dtype=float)          # (S, available)
    H = high_mat.to_numpy(dtype=float)
    L = low_mat.to_numpy(dtype=float)
    V = vol_mat.to_numpy(dtype=float)
    symbols = list(close_mat.index)

    price = C[:, -1]
    high_t = H[:, -1]

    # Run-up: lowest low of the run window → today's close. The move to fade.
    run_low = np.nanmin(L[:, -eff_run:], axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        gain_pct = np.where(run_low > 0, (price / run_low - 1.0) * 100.0, np.nan)
        # 5-session close-to-close move ("up 50-100% in a few days").
        close_5ago = C[:, -1 - eff_5d]
        gain_5d_pct = np.where(close_5ago > 0, (price / close_5ago - 1.0) * 100.0, np.nan)
        ma_short = np.nanmean(C[:, -eff_ma_short:], axis=1)
        ma_med = np.nanmean(C[:, -eff_ma_med:], axis=1)
        ext_pct = np.where(ma_short > 0, (price / ma_short - 1.0) * 100.0, np.nan)
        ext_pct_20 = np.where(ma_med > 0, (price / ma_med - 1.0) * 100.0, np.nan)
        # How far the close sits below today's high (intraday fade already starting).
        from_high_pct = np.where(high_t > 0, (high_t - price) / high_t * 100.0, np.nan)

    # Daily % changes across the whole series (for streak + acceleration).
    with np.errstate(invalid="ignore", divide="ignore"):
        day_chg = np.full_like(C, np.nan)
        day_chg[:, 1:] = (C[:, 1:] / C[:, :-1] - 1.0) * 100.0

    candidates: list[dict] = []
    split_filtered = 0
    for i, sym in enumerate(symbols):
        g = float(gain_pct[i]) if not np.isnan(gain_pct[i]) else None
        if g is None:
            continue

        # HARD: drop reverse-split artifacts (huge one-day jump on collapsed volume)
        # before they masquerade as parabolas. Real news gaps keep their volume.
        if _is_probable_split(day_chg[i, -eff_run:], V[i, -eff_run:]):
            split_filtered += 1
            continue

        close_px = float(price[i])
        cap_tier = "large" if close_px >= large_cap_price else "small"
        required_gain = float(min_gain_large_pct if cap_tier == "large" else min_gain_small_pct)

        # HARD: cap-tiered run-up.
        if g < required_gain:
            continue

        # HARD: consecutive higher-closes streak ending today.
        up_days = _up_streak(C[i])
        if up_days < min_up_days:
            continue

        ext = float(ext_pct[i]) if not np.isnan(ext_pct[i]) else None
        extended = ext is not None and ext >= EXT_MIN_PCT

        # Acceleration: is today's 1-day gain the biggest of the run window?
        run_chg = day_chg[i, -eff_run:]
        today_chg = float(day_chg[i, -1]) if not np.isnan(day_chg[i, -1]) else None
        accelerating = bool(
            today_chg is not None
            and np.isfinite(run_chg).any()
            and today_chg >= np.nanmax(run_chg) - 1e-9
        )

        # --- Soft gates -------------------------------------------------------
        if require_extended and not extended:
            continue
        if require_accelerating and not accelerating:
            continue

        stop_px = float(high_t[i])  # short stop: a print back above today's high
        risk_pct = ((stop_px - close_px) / close_px * 100.0) if close_px else None
        vol_t = V[i, -1]

        candidates.append({
            "symbol": sym,
            "close": _f(close_px),
            "high": _f(stop_px),
            "volume": int(vol_t) if not np.isnan(vol_t) else None,
            "dollar_volume": _f(vol_t * close_px) if not np.isnan(vol_t) else None,
            "gain_pct": round(g, 1),
            "gain_5d_pct": round(float(gain_5d_pct[i]), 1) if not np.isnan(gain_5d_pct[i]) else None,
            "up_days": int(up_days),
            "ext_pct": round(ext, 1) if ext is not None else None,
            "ext_pct_20": round(float(ext_pct_20[i]), 1) if not np.isnan(ext_pct_20[i]) else None,
            "from_high_pct": round(float(from_high_pct[i]), 1) if not np.isnan(from_high_pct[i]) else None,
            "cap_tier": cap_tier,
            "required_gain_pct": round(required_gain, 0),
            "extended": bool(extended),
            "accelerating": bool(accelerating),
            "today_chg_pct": round(today_chg, 1) if today_chg is not None else None,
            "stop": _f(stop_px),
            "risk_pct": round(risk_pct, 2) if risk_pct is not None else None,
            "_score": _score(g, ext, up_days, extended, accelerating),
        })

    # Sort most-stretched / most-parabolic first — the biggest rubber bands.
    candidates.sort(key=lambda c: -c["_score"])
    for c in candidates:
        c.pop("_score", None)
    candidates = candidates[: max(1, int(limit))]

    return {
        "as_of": today.isoformat(),
        "thresholds": _thresholds_payload(
            min_price, min_dollar_volume, min_gain_large_pct, min_gain_small_pct,
            large_cap_price, min_up_days, run_lookback,
        ),
        "gates": {
            "require_extended": bool(require_extended),
            "require_accelerating": bool(require_accelerating),
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


def _is_probable_split(run_returns: np.ndarray, run_volume: np.ndarray) -> bool:
    """True when the window's biggest one-day jump looks like a reverse split.

    A reverse split gaps price up by the split ratio on COLLAPSED share volume
    (fewer shares outstanding). A genuine explosive move gaps up on a volume
    SURGE — so we only flag a >SPLIT_JUMP_PCT jump whose volume that day fell
    below SPLIT_VOL_RATIO× the median volume of the rest of the window.
    """
    if not np.isfinite(run_returns).any():
        return False
    j = int(np.nanargmax(run_returns))
    if not np.isfinite(run_returns[j]) or run_returns[j] <= SPLIT_JUMP_PCT:
        return False
    others = np.delete(run_volume, j)
    if not np.isfinite(others).any():
        return False
    ref = np.nanmedian(others)
    vj = run_volume[j]
    return bool(np.isfinite(ref) and ref > 0 and np.isfinite(vj) and vj < SPLIT_VOL_RATIO * ref)


def _up_streak(closes: np.ndarray) -> int:
    """Consecutive higher-closing sessions ending at the last bar.

    Counts back from today while each close is above the one before it. Today
    itself must be an up-close to start the streak (a parabola prints new highs
    day after day — the first down-close is the crack).
    """
    n = len(closes)
    streak = 0
    for i in range(n - 1, 0, -1):
        a, b = closes[i], closes[i - 1]
        if np.isnan(a) or np.isnan(b):
            break
        if a > b:
            streak += 1
        else:
            break
    return streak


def _score(gain: float, ext: float | None, up_days: int,
           extended: bool, accelerating: bool) -> float:
    """Rank the most-stretched rubber bands first.

    A blend of run-up size, distance above the 10-day, streak length, and the two
    soft tells — bounded so no single term dominates the ordering.
    """
    g = min(gain / 100.0, 5.0)                      # cap runaway micro-caps
    e = min((ext or 0.0) / 100.0, 3.0)
    u = min(up_days / 5.0, 2.0)
    return g * 2.0 + e * 1.5 + u + (0.5 if extended else 0.0) + (0.5 if accelerating else 0.0)


def _empty(as_of, min_price, min_dollar_volume, universe, passed_liquidity,
           passed_coverage: int = 0, error: str | None = None) -> dict:
    out = {
        "as_of": as_of,
        "thresholds": _thresholds_payload(
            min_price, min_dollar_volume, MIN_GAIN_LARGE_PCT, MIN_GAIN_SMALL_PCT,
            LARGE_CAP_PRICE, MIN_UP_DAYS, RUN_LOOKBACK,
        ),
        "candidates": [],
        "counts": {
            "universe": universe,
            "passed_liquidity": passed_liquidity,
            "passed_coverage": passed_coverage,
            "passed_all": 0,
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


def _thresholds_payload(min_price, min_dollar_volume, min_gain_large_pct,
                        min_gain_small_pct, large_cap_price, min_up_days,
                        run_lookback) -> dict:
    return {
        "min_price": float(min_price),
        "min_dollar_volume": float(min_dollar_volume),
        "min_gain_large_pct": float(min_gain_large_pct),
        "min_gain_small_pct": float(min_gain_small_pct),
        "large_cap_price": float(large_cap_price),
        "min_up_days": int(min_up_days),
        "run_lookback": int(run_lookback),
        "ma_short": MA_SHORT,
        "ma_med": MA_MED,
        "ext_min_pct": EXT_MIN_PCT,
    }
