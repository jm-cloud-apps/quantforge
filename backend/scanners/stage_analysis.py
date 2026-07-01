"""Stan Weinstein Stage Analysis scanner.

Weinstein's *Secrets for Profiting in Bull and Bear Markets* frames every stock as
cycling through four stages, read off the **weekly chart** relative to its
**30-week simple moving average** (the "30-week MA"):

  • Stage 1 — Basing / Accumulation.  After a decline, price stops falling and
    chops sideways. The 30-week MA loses its downward slope and goes flat. Price
    oscillates back and forth across a now-flat MA. Smart money accumulates.

  • Stage 2 — Advancing / Markup.  Price breaks up out of the base on expanding
    volume, clears the 30-week MA, and the MA itself turns up. This is the only
    stage Weinstein buys — you want to own a stock that is *above a rising
    30-week MA*, ideally right as it breaks out of Stage 1.

  • Stage 3 — Top / Distribution.  The advance loses momentum. Price goes
    sideways again but now up near the highs; the 30-week MA flattens after
    having risen. Distribution — time to be leaving, not entering.

  • Stage 4 — Declining / Markdown.  Price breaks down below the trading range
    and below the 30-week MA, and the MA rolls over to the downside. The bear
    phase — avoid / short.

Weinstein's two extra confirmations, both implemented here:

  • **Relative strength** — the stock should outperform the market (Mansfield RS:
    the stock/SPY ratio relative to its own moving average). Stage 2 leaders have
    RS crossing/holding above the zero line and rising.
  • **Volume** — the Stage 1→2 breakout should come on a clear volume expansion.

This module is a *systematic approximation* of what is, in the book, a
discretionary chart read. Two deliberate modelling choices:

  1. **30 weeks ≈ 150 trading days.**  We work off the daily grouped-cache (same
     panel the breadth/reversal/9M scanners use — zero extra API calls) and use a
     150-day SMA as the 30-week-MA proxy. If the cache holds fewer than 150 days
     we transparently fall back to the longest MA that fits (never below
     MIN_MA_DAYS) and flag the result `ma_approx`.
  2. **Slope over ~4 weeks.**  "MA rising / flat / falling" is decided from the
     MA's change over the last ~20 trading days, normalised to %-per-week so the
     thresholds are stable even when the effective MA window is shortened.

The scan is tuned for what the user actually wants off this page: **Stage 1
bases about to break into Stage 2, and freshly-minted Stage 2 advancers** — so
those float to the top, each tagged with an explicit signal label.
"""

from __future__ import annotations

import logging
from datetime import datetime

import numpy as np
import pandas as pd

from breadth.cache import list_cached_days, load_cached_day

logger = logging.getLogger(__name__)

# --- Weinstein MA + slope windows ------------------------------------------
MA_DAYS = 150            # 30 weeks × 5 sessions — the 30-week-MA proxy on daily bars
SLOPE_LOOKBACK = 20      # ~4 weeks — window over which we measure the MA's slope
MIN_MA_DAYS = 100        # never shrink the MA proxy below ~20 weeks
MIN_SLOPE_LB = 10        # never shrink the slope window below ~2 weeks

# --- Slope classification (normalised to %-of-MA per week) -----------------
# A 30-week MA "rising" ≈ climbing faster than ~0.10%/week (~5%/yr); "falling"
# the mirror. The dead-band between is what we read as a genuinely flat MA — the
# signature of a Stage 1 base or a Stage 3 top.
RISE_PER_WEEK = 0.10
FALL_PER_WEEK = -0.10

# --- Range/position thresholds (percent) -----------------------------------
NEAR_HIGH_PCT = -6.0     # within 6% of the window high = "up near the highs"
SHALLOW_PULLBACK_PCT = -10.0  # price under a rising MA but this close to highs = still Stage 2
BASE_NEAR_LOW_PCT = 15.0      # within 15% of the window low = basing down near the lows
EXTENDED_PCT = 20.0      # >20% above the 30-week MA = too extended to call a *fresh* entry
COILING_TO_PIVOT_PCT = -8.0   # Stage 1 within 8% under its pivot high = breakout-watch

# --- Liquidity floor (defaults; overridable per request) -------------------
MIN_PRICE = 5.0
MIN_DOLLAR_VOLUME = 5_000_000   # $5M/day traded — keeps the scan on real, tradable names

# Recent-structure windows
PIVOT_LOOKBACK = 40      # ~8 weeks: the base's pivot high (Stage 1 breakout trigger)
VOL_AVG_LOOKBACK = 20    # ~4 weeks: average volume for the breakout volume-expansion read
PERF_1M = 21
PERF_3M = 63

# R:R reliability floors. The measured-move R:R is only meaningful when the base
# has real depth and the stop sits a real distance away. On ultra-tight, low-vol
# names (preferreds, bond-like ETFs) the base is a few cents, so both risk and
# reward are tiny and their ratio inflates into noise — suppress R:R there.
MIN_BASE_DEPTH_FOR_RR = 4.0   # base must span ≥ 4% high→low to project a move off it
MIN_RISK_ATR_FOR_RR = 0.5     # stop must be ≥ 0.5 ATR away, else it's inside the noise

# Cap collection so we never load more than one full window even if the cache is
# deeper than we need.
_MAX_NEED = MA_DAYS + SLOPE_LOOKBACK

# The whole market classifies to thousands of names; cap the returned table to
# the strongest N per stage so the JSON payload stays light (counts stay full).
PER_STAGE_LIMIT = 200

STAGE_NAMES = {1: "Basing", 2: "Advancing", 3: "Topping", 4: "Declining"}


def run(
    min_price: float = MIN_PRICE,
    min_dollar_volume: float = MIN_DOLLAR_VOLUME,
    per_stage_limit: int = PER_STAGE_LIMIT,
) -> dict:
    """Classify every liquid US name into a Weinstein stage off the breadth cache.

    Returns a payload with per-symbol stage classifications (all four stages),
    sorted so Stage 1→2 breakout-watch and fresh Stage 2 advancers come first,
    plus a per-stage count distribution and the effective MA window used.

    The whole market classifies to thousands of names, so the returned table is
    capped to the strongest `per_stage_limit` per stage (by the same priority
    sort) to keep the payload light — `counts` always reflects the true totals.
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

    # --- Walk back collecting the last N non-empty sessions for candidates --
    closes: dict = {}
    highs: dict = {}
    lows: dict = {}
    vols: dict = {}
    for d in reversed(all_days):
        df = load_cached_day(d)
        if df is None or df.empty:
            continue
        closes[d] = df["close"].reindex(candidate_symbols)
        highs[d] = df["high"].reindex(candidate_symbols)
        lows[d] = df["low"].reindex(candidate_symbols)
        vols[d] = df["volume"].reindex(candidate_symbols)
        if len(closes) >= _MAX_NEED:
            break

    available = len(closes)
    ma_days, slope_lb, ma_approx = _fit_windows(available)
    if ma_days is None:
        need = MIN_MA_DAYS + MIN_SLOPE_LB
        return _empty(
            today.isoformat(), min_price, min_dollar_volume, universe_size, passed_liquidity,
            error=(
                f"Not enough breadth history for a stage read — need ≥ {need} trading "
                f"days, have {available}. In Market Monitor → Refresh, backfill a bigger "
                f"lookback (e.g. 260 days) so the 30-week MA can form."
            ),
        )

    # Ascending-by-date matrices, sliced to exactly the window we can use.
    close_mat = pd.DataFrame(closes).sort_index(axis=1)
    high_mat = pd.DataFrame(highs).sort_index(axis=1)
    low_mat = pd.DataFrame(lows).sort_index(axis=1)
    vol_mat = pd.DataFrame(vols).sort_index(axis=1)
    window = ma_days + slope_lb
    close_mat = close_mat.iloc[:, -window:]
    high_mat = high_mat.iloc[:, -window:]
    low_mat = low_mat.iloc[:, -window:]
    vol_mat = vol_mat.iloc[:, -window:]

    # Only keep names with full coverage across the MA+slope window — a partial
    # series makes the 30-week MA a lie (fresh IPOs can't have a base anyway).
    valid = close_mat.notna().all(axis=1) & high_mat.notna().all(axis=1) & low_mat.notna().all(axis=1)
    close_mat = close_mat[valid]
    high_mat = high_mat[valid]
    low_mat = low_mat[valid]
    vol_mat = vol_mat[valid]
    if close_mat.empty:
        return _empty(today.isoformat(), min_price, min_dollar_volume, universe_size,
                      passed_liquidity)

    feats = _compute_features(close_mat, high_mat, low_mat, vol_mat, ma_days, slope_lb)

    candidates: list[dict] = []
    for sym, row in feats.iterrows():
        stage = _classify(row["pct_vs_ma"], row["slope_per_week"],
                           row["pct_from_high"], row["pct_from_low"])
        rec = _build_record(sym, row, stage, ma_days)
        candidates.append(rec)

    # Sort by our priority bucket, then by a within-bucket quality score.
    candidates.sort(key=lambda c: (c["_sort_bucket"], -c["_score"]))

    # True per-stage distribution (over everything classified, before the cap).
    counts = {"universe": universe_size, "passed_liquidity": passed_liquidity,
              "classified": len(candidates)}
    for n in range(1, 5):
        counts[f"stage{n}"] = sum(1 for c in candidates if c["stage"] == n)
    counts["entering_stage2"] = sum(1 for c in candidates if c["entering_stage2"])
    counts["breakout_watch"] = sum(1 for c in candidates if c["breakout_watch"])

    # Cap to the strongest N per stage (list is already priority-sorted) so the
    # payload stays light while every stage filter still has content.
    kept: list[dict] = []
    per_stage_seen: dict[int, int] = {1: 0, 2: 0, 3: 0, 4: 0}
    for c in candidates:
        st = c["stage"]
        if per_stage_seen[st] >= per_stage_limit:
            continue
        per_stage_seen[st] += 1
        c.pop("_sort_bucket", None)
        c.pop("_score", None)
        kept.append(c)
    candidates = kept
    counts["returned"] = len(candidates)

    return {
        "as_of": today.isoformat(),
        "thresholds": {
            "min_price": float(min_price),
            "min_dollar_volume": float(min_dollar_volume),
            "ma_days": ma_days,
            "ma_weeks": round(ma_days / 5.0, 1),
            "ma_approx": ma_approx,
            "slope_lookback": slope_lb,
            "days_available": available,
            "rise_per_week": RISE_PER_WEEK,
            "extended_pct": EXTENDED_PCT,
        },
        "regime": _regime(counts),
        "candidates": candidates,
        "counts": counts,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


def _regime(counts: dict) -> dict:
    """One-line market-regime read from the stage distribution: what share of
    liquid names sit above a rising 30-wk MA (Stage 2) vs below a falling one
    (Stage 4). Broad participation in Stage 2 is a risk-on tape; a heavy Stage 4
    share is risk-off. This is Weinstein's own "trade with the tape" context."""
    total = counts.get("classified", 0) or 1
    pct2 = counts.get("stage2", 0) / total * 100.0
    pct4 = counts.get("stage4", 0) / total * 100.0
    if pct2 >= 45 and pct2 > pct4 * 1.5:
        label, tone = "Risk-on", "bull"
    elif pct4 >= 40 and pct4 >= pct2:
        label, tone = "Risk-off", "bear"
    else:
        label, tone = "Mixed", "neutral"
    return {
        "label": label,
        "tone": tone,
        "pct_stage2": round(pct2, 1),
        "pct_stage4": round(pct4, 1),
        "note": (
            f"{pct2:.0f}% of liquid names are in Stage 2 (above a rising 30-wk MA) "
            f"vs {pct4:.0f}% in Stage 4 (below a falling one)."
        ),
    }


def _fit_windows(available: int) -> tuple[int | None, int | None, bool]:
    """Pick the MA and slope windows that fit the cached history.

    Prefer the full 30-week (150d) MA with a 4-week slope window. When the cache
    is shorter, keep as long an MA as possible (down to MIN_MA_DAYS) and shrink
    the slope window only as much as needed, flagging the result approximate.
    Returns (ma_days, slope_lb, ma_approx) or (None, None, False) if too short.
    """
    if available >= MA_DAYS + SLOPE_LOOKBACK:
        return MA_DAYS, SLOPE_LOOKBACK, False
    if available < MIN_MA_DAYS + MIN_SLOPE_LB:
        return None, None, False
    slope_lb = min(SLOPE_LOOKBACK, max(MIN_SLOPE_LB, available - MIN_MA_DAYS))
    ma_days = min(MA_DAYS, available - slope_lb)
    return ma_days, slope_lb, True


def _compute_features(
    close_mat: pd.DataFrame,
    high_mat: pd.DataFrame,
    low_mat: pd.DataFrame,
    vol_mat: pd.DataFrame,
    ma_days: int,
    slope_lb: int,
) -> pd.DataFrame:
    """Vectorised per-symbol Weinstein features across the whole candidate panel."""
    price = close_mat.iloc[:, -1]
    ma_now = close_mat.iloc[:, -ma_days:].mean(axis=1)
    ma_prev = close_mat.iloc[:, -(ma_days + slope_lb):-slope_lb].mean(axis=1)
    price_prev = close_mat.iloc[:, -(slope_lb + 1)]

    pct_vs_ma = (price / ma_now - 1.0) * 100.0
    ma_slope_pct = (ma_now / ma_prev - 1.0) * 100.0
    slope_per_week = ma_slope_pct / (slope_lb / 5.0)

    # Window high/low (≈6-month range) for range-position reads.
    win_high = close_mat.max(axis=1)
    win_low = close_mat.min(axis=1)
    pct_from_high = (price / win_high - 1.0) * 100.0
    pct_from_low = (price / win_low - 1.0) * 100.0

    # Recent pivot high / base low (breakout trigger + stop) off the base window.
    pivot_high = high_mat.iloc[:, -PIVOT_LOOKBACK:].max(axis=1)
    base_low = low_mat.iloc[:, -PIVOT_LOOKBACK:].min(axis=1)
    pct_to_pivot = (price / pivot_high - 1.0) * 100.0

    # --- ATR(14): volatility unit for extension + risk, in price terms --------
    H = high_mat.to_numpy(); L = low_mat.to_numpy(); C = close_mat.to_numpy()
    prev_c, cur_h, cur_l = C[:, :-1], H[:, 1:], L[:, 1:]
    tr = np.maximum(cur_h - cur_l, np.maximum(np.abs(cur_h - prev_c), np.abs(cur_l - prev_c)))
    atr_n = min(14, tr.shape[1])
    atr = pd.Series(tr[:, -atr_n:].mean(axis=1), index=close_mat.index)
    atr_safe = atr.replace(0, np.nan)
    atr_ext = (price - ma_now) / atr_safe          # ATRs above (─)/below the 30-wk MA
    atr_pct = atr / price * 100.0

    # --- Base quality (Stage 1 selection) ------------------------------------
    base_depth_pct = (pivot_high - base_low) / pivot_high * 100.0   # shallower = tighter
    base_range_atr = (pivot_high - base_low) / atr_safe             # range in vol units
    recent_vol = vol_mat.iloc[:, -10:].mean(axis=1)
    base_vol = vol_mat.iloc[:, -PIVOT_LOOKBACK:].mean(axis=1).replace(0, np.nan)
    vol_dryup = recent_vol / base_vol                               # <1 = drying up in the base
    base_length_bars = _trailing_in_band_run(C, base_low.to_numpy(), pivot_high.to_numpy())
    base_length_weeks = pd.Series(base_length_bars / 5.0, index=close_mat.index)

    # Volume expansion: latest session vs its ~4-week average.
    vol_now = vol_mat.iloc[:, -1]
    vol_avg = vol_mat.iloc[:, -VOL_AVG_LOOKBACK:].mean(axis=1)
    vol_ratio = vol_now / vol_avg.replace(0, np.nan)

    # Recent price cross of the MA (for the fresh-Stage-2 detection).
    crossed_up = (price >= ma_now) & (price_prev < ma_prev)

    # Trailing performance for context.
    n = close_mat.shape[1]
    perf_1m = (price / close_mat.iloc[:, -min(PERF_1M + 1, n)] - 1.0) * 100.0
    perf_3m = (price / close_mat.iloc[:, -min(PERF_3M + 1, n)] - 1.0) * 100.0

    # Mansfield relative strength vs SPY: the stock/SPY ratio relative to its own
    # MA of that ratio. >0 and rising = leading the market (Weinstein's RS test).
    if "SPY" in close_mat.index:
        spy = close_mat.loc["SPY"]
        ratio = close_mat.div(spy, axis=1)
        ratio_now = ratio.iloc[:, -1]
        ratio_ma = ratio.iloc[:, -ma_days:].mean(axis=1)
        ratio_prev = ratio.iloc[:, -(slope_lb + 1)]
        rs_mansfield = (ratio_now / ratio_ma - 1.0) * 100.0
        rs_rising = ratio_now > ratio_prev
    else:
        rs_mansfield = pd.Series(np.nan, index=close_mat.index)
        rs_rising = pd.Series(False, index=close_mat.index)
    # Cross-sectional RS percentile rank (1-99, IBD-style) over the whole panel.
    rs_rank = rs_mansfield.rank(pct=True) * 100.0

    return pd.DataFrame({
        "price": price,
        "ma_now": ma_now,
        "pct_vs_ma": pct_vs_ma,
        "slope_per_week": slope_per_week,
        "pct_from_high": pct_from_high,
        "pct_from_low": pct_from_low,
        "pct_to_pivot": pct_to_pivot,
        "pivot_high": pivot_high,
        "base_low": base_low,
        "atr": atr,
        "atr_pct": atr_pct,
        "atr_ext": atr_ext,
        "base_depth_pct": base_depth_pct,
        "base_range_atr": base_range_atr,
        "base_length_weeks": base_length_weeks,
        "vol_dryup": vol_dryup,
        "vol_now": vol_now,
        "vol_ratio": vol_ratio,
        "crossed_up": crossed_up,
        "perf_1m": perf_1m,
        "perf_3m": perf_3m,
        "rs_mansfield": rs_mansfield,
        "rs_rank": rs_rank,
        "rs_rising": rs_rising,
    })


def _trailing_in_band_run(closes: np.ndarray, band_low: np.ndarray, band_high: np.ndarray) -> np.ndarray:
    """Length of the trailing run (ending at the latest bar) whose close stays
    within [band_low, band_high] — how many sessions price has been contained in
    its current base. Vectorised over all symbols at once.
    """
    inband = (closes >= band_low[:, None]) & (closes <= band_high[:, None])
    out_rev = ~inband[:, ::-1]                 # True where OUT of band, newest-first
    first_out = np.argmax(out_rev, axis=1)     # index of first out-of-band from the end
    has_out = out_rev.any(axis=1)
    return np.where(has_out, first_out, inband.shape[1]).astype(float)


def _classify(pct_vs_ma: float, slope_per_week: float,
              pct_from_high: float, pct_from_low: float) -> int:
    """Map (price-vs-MA, MA slope, range position) → Weinstein stage 1-4.

    Rising MA → Stage 2 above it (Stage 1 with a rising MA but price still under
    is a base about to break, unless it's a shallow pullback near highs = Stage 2).
    Falling MA → Stage 4 below it, late Stage 3 above it. Flat MA is the
    ambiguous case: near the highs it's a Stage 3 top, otherwise a Stage 1 base.
    """
    above = pct_vs_ma >= 0
    if slope_per_week > RISE_PER_WEEK:                 # MA rising
        if above:
            return 2
        return 2 if pct_from_high > SHALLOW_PULLBACK_PCT else 1
    if slope_per_week < FALL_PER_WEEK:                 # MA falling
        return 3 if above else 4
    # Flat MA (dead-band): base vs top decided by where price sits in its range.
    if above:
        return 3 if pct_from_high > NEAR_HIGH_PCT else 1
    return 1 if pct_from_low < BASE_NEAR_LOW_PCT else 4


def _build_record(sym: str, row: pd.Series, stage: int, ma_days: int) -> dict:
    """Assemble the per-symbol output row, its signal label, and sort keys."""
    pct_vs_ma = float(row["pct_vs_ma"])
    slope = float(row["slope_per_week"])
    rs = None if pd.isna(row["rs_mansfield"]) else float(row["rs_mansfield"])
    rs_rising = bool(row["rs_rising"])
    vol_ratio = None if pd.isna(row["vol_ratio"]) else float(row["vol_ratio"])
    pct_to_pivot = float(row["pct_to_pivot"])

    # Fresh Stage 2: in Stage 2, transition is recent (price crossed above the MA
    # in the last slope window), and not yet extended above the MA.
    entering_stage2 = bool(
        stage == 2 and row["crossed_up"] and pct_vs_ma <= EXTENDED_PCT
    )
    # Stage 1 coiling right under its pivot — the pre-breakout watch list.
    breakout_watch = bool(
        stage == 1 and slope >= FALL_PER_WEEK and pct_to_pivot >= COILING_TO_PIVOT_PCT
    )

    if entering_stage2:
        signal, bucket = "Stage 1→2 breakout", 0
    elif stage == 2:
        signal, bucket = "Stage 2 advancing", 1
    elif breakout_watch:
        signal, bucket = "Stage 1 breakout-watch", 2
    elif stage == 1:
        signal, bucket = "Stage 1 basing", 3
    elif stage == 3:
        signal, bucket = "Stage 3 topping", 4
    else:
        signal, bucket = "Stage 4 declining", 5

    close = float(row["price"])
    rs_rank = None if pd.isna(row["rs_rank"]) else float(row["rs_rank"])
    atr = None if pd.isna(row["atr"]) else float(row["atr"])
    atr_ext = None if pd.isna(row["atr_ext"]) else float(row["atr_ext"])
    base_low = None if pd.isna(row["base_low"]) else float(row["base_low"])
    pivot_high = None if pd.isna(row["pivot_high"]) else float(row["pivot_high"])

    # --- Risk model: stop below the base, measured-move target off base height -
    stop = base_low
    risk = (close - stop) if (stop is not None and close > stop) else None
    risk_pct = (risk / close * 100.0) if risk else None
    risk_atr = (risk / atr) if (risk and atr) else None
    target = (pivot_high + (pivot_high - base_low)) if (pivot_high and base_low) else None
    reward = (target - close) if target is not None else None
    base_depth = None if pd.isna(row["base_depth_pct"]) else float(row["base_depth_pct"])
    # Only report R:R when the base has real depth and the stop is a meaningful
    # distance in ATR terms — otherwise the ratio is noise on tight, low-vol names.
    rr_reliable = (
        risk and reward and reward > 0
        and risk_atr is not None and risk_atr >= MIN_RISK_ATR_FOR_RR
        and base_depth is not None and base_depth >= MIN_BASE_DEPTH_FOR_RR
    )
    rr = (reward / risk) if rr_reliable else None

    # --- Composite quality 0-100 (transparent weights) -----------------------
    # 35% trend strength (MA slope), 35% relative-strength rank, 15% volume
    # expansion, 15% not-over-extended (ATRs above the MA). A single sortable
    # number that says "how clean is this as a Stage 2 leader right now."
    trend_c = _clamp(slope / 1.0, 0.0, 1.0)
    rs_c = (rs_rank / 100.0) if rs_rank is not None else 0.5
    vol_c = _clamp(((vol_ratio or 1.0) - 1.0) / 1.0, 0.0, 1.0)
    prox_c = 0.5 if atr_ext is None else _clamp(1.0 - max(0.0, atr_ext - 4.0) / 6.0, 0.0, 1.0)
    quality = round(100.0 * (0.35 * trend_c + 0.35 * rs_c + 0.15 * vol_c + 0.15 * prox_c), 1)

    # Borderline flag: MA slope sits within the flat/rising or flat/falling
    # dead-band edge, so the stage label is fragile — surface the uncertainty.
    borderline = bool(min(abs(slope - RISE_PER_WEEK), abs(slope - FALL_PER_WEEK)) < 0.05)

    # Default within-bucket ordering is the quality score; breakout buckets also
    # reward being close to the trigger.
    score = quality
    if bucket in (0, 2):
        score -= abs(pct_to_pivot if bucket == 2 else pct_vs_ma) * 0.3

    return {
        "symbol": sym,
        "stage": stage,
        "stage_name": STAGE_NAMES[stage],
        "signal": signal,
        "entering_stage2": entering_stage2,
        "breakout_watch": breakout_watch,
        "borderline": borderline,
        "quality": quality,
        "close": _f(close),
        "ma": _f(row["ma_now"]),
        "pct_vs_ma": round(pct_vs_ma, 1),
        "atr": _f(atr),
        "atr_pct": round(float(row["atr_pct"]), 2) if not pd.isna(row["atr_pct"]) else None,
        "atr_ext": round(atr_ext, 2) if atr_ext is not None else None,
        "ma_slope_per_week": round(slope, 2),
        "ma_rising": bool(slope > RISE_PER_WEEK),
        "ma_falling": bool(slope < FALL_PER_WEEK),
        "pct_from_high": round(float(row["pct_from_high"]), 1),
        "pct_from_low": round(float(row["pct_from_low"]), 1),
        "pct_to_pivot": round(pct_to_pivot, 1),
        "pivot_high": _f(pivot_high),
        "stop": _f(stop),
        "risk_pct": round(risk_pct, 2) if risk_pct is not None else None,
        "risk_atr": round(risk_atr, 2) if risk_atr is not None else None,
        "target": _f(target),
        "rr": round(rr, 2) if rr is not None else None,
        "base_depth_pct": round(float(row["base_depth_pct"]), 1) if not pd.isna(row["base_depth_pct"]) else None,
        "base_range_atr": round(float(row["base_range_atr"]), 1) if not pd.isna(row["base_range_atr"]) else None,
        "base_length_weeks": round(float(row["base_length_weeks"]), 1) if not pd.isna(row["base_length_weeks"]) else None,
        "vol_dryup": round(float(row["vol_dryup"]), 2) if not pd.isna(row["vol_dryup"]) else None,
        "rs_mansfield": round(rs, 1) if rs is not None else None,
        "rs_rank": round(rs_rank) if rs_rank is not None else None,
        "rs_rising": rs_rising,
        "vol_ratio": round(vol_ratio, 2) if vol_ratio is not None else None,
        "volume": int(row["vol_now"]) if not pd.isna(row["vol_now"]) else None,
        "perf_1m": round(float(row["perf_1m"]), 1),
        "perf_3m": round(float(row["perf_3m"]), 1),
        "_sort_bucket": bucket,
        "_score": score,
    }


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _empty(as_of, min_price, min_dollar_volume, universe, passed_liquidity,
           error: str | None = None) -> dict:
    out = {
        "as_of": as_of,
        "thresholds": {
            "min_price": float(min_price),
            "min_dollar_volume": float(min_dollar_volume),
            "ma_days": MA_DAYS,
            "ma_weeks": round(MA_DAYS / 5.0, 1),
            "ma_approx": False,
            "slope_lookback": SLOPE_LOOKBACK,
        },
        "candidates": [],
        "counts": {"universe": universe, "passed_liquidity": passed_liquidity,
                   "classified": 0},
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
