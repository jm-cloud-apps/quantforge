"""Relative-strength leaders over 6M / 3M / 1M — the weekend research scan.

This is the Qullamaggie prep scan, run the way a swing trader actually runs it:
three separate rankings of the liquid universe by return over the last ~6 months,
~3 months and ~1 month. Each window answers a different question:

  6M (126 sessions) — the established leaders. Names that have been under
                      accumulation for two quarters. Deepest bases, biggest
                      institutional sponsorship, slowest to break.
  3M ( 63 sessions) — the current cycle's leaders. The names that took over
                      leadership *this* quarter, usually off an earnings gap.
  1M ( 21 sessions) — the fresh movers. Where episodic pivots and new themes
                      show up first, and where most of the junk lives too.

A name appearing in **two or three** lists is the signal the three-scan routine
exists to produce: sustained *and* accelerating strength. One list alone is a
lead, not a conclusion — a 1M-only name is often a single news pop that will
give it all back, and a 6M-only name is often a leader that has already stopped
going up.

Ranking alone would just hand back a list of the most extended stocks in the
market, which is the opposite of actionable — by the time something is #1 over
six months it is usually 40% above any sane entry. So every candidate is also
triaged by *where it is in its cycle* (`setup_state`):

  extended  — far above the 20-day rail. It's a leader, but there is no entry
              here. Watch for it to stop and build.
  basing    — off its high, still holding the rails, range contracting. This is
              the state you want to find things in on a Sunday.
  at_pivot  — back near the highs with a quiet range. Actionable this week.
  broken    — below the rails and well off the high. Leadership has rolled over;
              it belongs on the short/avoid list, not the buy watchlist.

That triage is the difference between a scan and a plan. The point of the
weekend is to find names in `basing`/`at_pivot`, not to admire the `extended`
ones at the top of the return column.

Like the other scanners this reads the shared breadth grouped-daily cache — zero
extra API calls per run. That cache is **unadjusted**, so a reverse split shows
up as a huge one-day "gain" on collapsed volume; `_is_probable_split` drops those
before they can top the 6M list.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from breadth.cache import list_cached_days, load_cached_day
from breadth.universe import load_universe

logger = logging.getLogger(__name__)

# Horizon key → trading sessions. 21/63/126 are the standard US-session
# approximations of one / three / six months.
HORIZONS: dict[str, int] = {"1M": 21, "3M": 63, "6M": 126}
HORIZON_LABEL = {"1M": "1 month", "3M": "3 months", "6M": "6 months"}
HORIZON_BLURB = {
    "6M": "Established leaders — two quarters of accumulation.",
    "3M": "This cycle's leaders — usually took over off an earnings gap.",
    "1M": "Fresh movers — new themes and EPs show up here first.",
}

# Liquidity / tradability gates. A leader you can't get size in, or that moves
# 1% a day, can't pay for the risk.
MIN_PRICE = 5.0
MIN_DOLLAR_VOLUME = 5_000_000.0
MIN_ADR_PCT = 3.0
# Above this, a name is a day-trading vehicle rather than a swing candidate: a
# 30%-ADR stock gaps through any stop you can justify, so it can't be sized.
# It is also the practical junk filter — the pumps that top a raw return
# ranking almost all live above it.
MAX_ADR_PCT = 20.0

TOP_N = 25              # names kept per horizon
ADR_WINDOW = 20         # sessions for the ADR% average
QUIET_WINDOW = 10       # recent sessions tested for range contraction
SMA_FAST, SMA_SLOW = 10, 20

# --- RS leadership lane -----------------------------------------------------
# The three horizon scans above rank by RAW RETURN, and that quietly encodes a
# bias: over any window the top 25 by percentage are dominated by low-priced,
# violent names. A heavy liquid leader compounding against the market never
# appears, however strong it is.
#
# SNDK is the worked example. It sat at RS rank 99-100 for eight straight
# months — top 1% of the market — while it went from $219 to $2,100, and it is
# in none of the 6M / 3M / 1M lists, because +9% over a month does not compete
# with +171%. The scan that was meant to find leadership could not see the
# clearest leader on the board.
#
# So this lane ranks by *sustained* relative strength instead. Mansfield RS is
# computed with the same formula stage_analysis uses (the stock/SPY ratio
# against its own moving average of that ratio) so the two surfaces cannot
# drift; test_rs_leaders_lane.py pins them together. What is new here is the
# persistence count — how many of the recent sessions the name has held the top
# decile — because one day at RS 95 is noise and forty is sponsorship.
RS_MA_DAYS = 150        # 30 weeks, matching stage_analysis.MA_DAYS
RS_MIN_MA_DAYS = 60     # shorter cache → shorter MA, flagged approximate
RS_PERSIST_WINDOW = 63  # ~3 months of sessions scored for persistence
RS_TOP_PCT = 90.0       # "leading" = top decile of the cross-section that day
RS_MIN_DAYS_TOP = 20    # ~1 month in the top decile to qualify at all
RS_TOP_N = 25
# Persistence and current standing are blended rather than applied in
# sequence. Sorting on days-in-the-top-decile first looks reasonable and is
# not: with a hard cap, any name at 63/63 outranks every name at 62/63
# whatever its RS today, which quietly selects for the *least volatile*
# leaders. SNDK — 52/63 days top-decile, RS 92 and rising — was cut by exactly
# that, which is the same failure this lane exists to fix, one level down.
RS_PERSIST_WEIGHT = 0.6
SPARK_SESSIONS = 60     # closes attached per row for the inline sparkline

# setup_state cuts
EXTENDED_ATR_MULT = 4.0     # >4 ADRs above the 20-day rail = no entry here
PIVOT_FROM_HIGH_PCT = -6.0  # within 6% of the window high counts as "at the highs"
BROKEN_FROM_HIGH_PCT = -25.0
CONTRACTION_RATIO = 0.85    # recent range < 85% of prior range = quiet

# A >90% one-day jump on collapsed volume is a reverse split, not a move.
SPLIT_JUMP_PCT = 90.0
SPLIT_VOL_RATIO = 0.5


def _is_probable_split(day_returns: np.ndarray, volume: np.ndarray) -> bool:
    """True when the window's biggest one-day jump looks like a reverse split.

    A reverse split gaps price by the split ratio on COLLAPSED share volume
    (fewer shares outstanding); a real move gaps on a volume SURGE.
    """
    if not np.isfinite(day_returns).any():
        return False
    j = int(np.nanargmax(day_returns))
    if not np.isfinite(day_returns[j]) or day_returns[j] <= SPLIT_JUMP_PCT:
        return False
    others = np.delete(volume, j)
    med = np.nanmedian(others) if np.isfinite(others).any() else np.nan
    if not np.isfinite(med) or med <= 0:
        return False
    return float(volume[j]) < SPLIT_VOL_RATIO * float(med)


def _trailing_sma(row: np.ndarray, window: int) -> float | None:
    """SMA of the last `window` closes, or None when history is short."""
    if row.size < window:
        return None
    tail = row[-window:]
    if not np.isfinite(tail).all():
        return None
    return float(np.mean(tail))


def _setup_state(from_high_pct: float, ext_adrs: float | None,
                 above_slow: bool, contracting: bool) -> tuple[str, str]:
    """Triage one leader into where it sits in its cycle → (state, why).

    Order matters: `broken` is checked first because a name can be both far off
    its high AND quiet, and "quiet while broken" is a downtrend resting, not a
    base. `extended` outranks `at_pivot` for the same reason in reverse — near
    the highs *and* stretched is a chase, not a pivot.
    """
    if from_high_pct <= BROKEN_FROM_HIGH_PCT and not above_slow:
        return "broken", f"{from_high_pct:.0f}% off its high and below the {SMA_SLOW}-day rail — leadership has rolled over."
    if ext_adrs is not None and ext_adrs >= EXTENDED_ATR_MULT:
        return "extended", f"{ext_adrs:.1f} ADRs above the {SMA_SLOW}-day rail — a leader, but there is no entry here."
    if from_high_pct >= PIVOT_FROM_HIGH_PCT and contracting:
        return "at_pivot", "Back at the highs with a contracting range — actionable this week."
    if above_slow and contracting:
        return "basing", "Holding the rails with a contracting range — building the next base."
    if above_slow:
        return "basing", f"Still above the {SMA_SLOW}-day rail but the range hasn't tightened yet."
    return "watch", "Between states — no clean read yet."


def _empty(as_of, universe: int, passed: int, error: str | None = None) -> dict:
    return {
        "as_of": as_of,
        "horizons": [],
        "confluence": [],
        "universe": universe,
        "passed_liquidity": passed,
        "thresholds": _thresholds(),
        "error": error,
    }


def _thresholds() -> dict:
    return {
        "min_price": MIN_PRICE,
        "min_dollar_volume": MIN_DOLLAR_VOLUME,
        "min_adr_pct": MIN_ADR_PCT,
        "max_adr_pct": MAX_ADR_PCT,
        "top_n": TOP_N,
        "sessions": dict(HORIZONS),
    }


def run(
    min_price: float = MIN_PRICE,
    min_dollar_volume: float = MIN_DOLLAR_VOLUME,
    min_adr_pct: float = MIN_ADR_PCT,
    max_adr_pct: float = MAX_ADR_PCT,
    top_n: int = TOP_N,
) -> dict:
    """Rank the liquid universe by return over each horizon and triage the tops.

    Returns one ranked list per horizon plus a `confluence` list of names that
    appear in two or more — the names the three-scan routine is actually for.
    """
    all_days = list_cached_days()
    if not all_days:
        return _empty(None, 0, 0, error="Breadth cache is empty. Run Market Monitor → Refresh first.")

    # --- Latest non-empty session → liquidity gate → candidate universe ----
    today = today_df = None
    for d in reversed(all_days):
        df = load_cached_day(d)
        if df is not None and not df.empty:
            today, today_df = d, df
            break
    if today_df is None:
        return _empty(None, 0, 0, error="No non-empty day in the breadth cache yet.")

    today_df = today_df.dropna(subset=["open", "high", "low", "close", "volume"])
    # Restrict to the active US COMMON-STOCK universe. The grouped cache holds
    # every symbol that printed, so without this the leveraged/inverse ETFs
    # (SOXS, TQQQ …) rank straight to the top of a return scan — they're
    # derivatives that decay, not leadership.
    common = load_universe().get("symbols") or []
    if common:
        today_df = today_df[today_df.index.isin(set(common))]
    universe_size = len(today_df)
    if today_df.empty:
        return _empty(today.isoformat(), 0, 0,
                      error="No universe symbols in the latest cached session.")
    # Cheap prefilter on today's tape purely to keep the panel small. The real
    # liquidity gate is the 20-day AVERAGE below: a name that pumped today can
    # clear a single-day dollar-volume bar while being untradable the rest of
    # the month, and those are exactly the names that top a raw return ranking.
    dollar_vol_today = today_df["close"] * today_df["volume"]
    gated = today_df[(today_df["close"] >= min_price) & (dollar_vol_today >= min_dollar_volume * 0.5)]
    if gated.empty:
        return _empty(today.isoformat(), universe_size, 0)
    symbols = list(gated.index)

    # --- Walk back for the deepest window we need (+1 bar for the return) ---
    # The RS lane needs its MA window *plus* the persistence window behind it,
    # which is deeper than any return horizon; the extra sessions are read once
    # and the whole response is ScanCache'd.
    need = max(max(HORIZONS.values()) + 1, RS_MA_DAYS + RS_PERSIST_WINDOW)
    closes: dict = {}
    highs: dict = {}
    lows: dict = {}
    vols: dict = {}
    spy_close: dict = {}
    for d in reversed(all_days):
        df = load_cached_day(d)
        if df is None or df.empty:
            continue
        closes[d] = df["close"].reindex(symbols)
        highs[d] = df["high"].reindex(symbols)
        lows[d] = df["low"].reindex(symbols)
        vols[d] = df["volume"].reindex(symbols)
        # SPY is the RS benchmark and is filtered out of `symbols` by the
        # common-stock universe gate, so it's carried separately.
        try:
            spy_close[d] = float(df["close"].get("SPY", np.nan))
        except (TypeError, ValueError):
            spy_close[d] = np.nan
        if len(closes) >= need:
            break

    available = len(closes)
    if available < HORIZONS["1M"] + 1:
        return _empty(
            today.isoformat(), universe_size, len(symbols),
            error=(
                f"Not enough breadth history for the leader scans — need ≥ {HORIZONS['1M'] + 1} "
                f"trading days, have {available}. Backfill a bigger lookback in Market Monitor → Refresh."
            ),
        )

    C = pd.DataFrame(closes).sort_index(axis=1).to_numpy(dtype=float)
    H = pd.DataFrame(highs).sort_index(axis=1).to_numpy(dtype=float)
    L = pd.DataFrame(lows).sort_index(axis=1).to_numpy(dtype=float)
    V = pd.DataFrame(vols).sort_index(axis=1).to_numpy(dtype=float)

    # Horizons the cache can actually support. A shallow cache silently drops
    # the 6M scan rather than reporting a 6M number computed over 90 days.
    usable = {k: n for k, n in HORIZONS.items() if available >= n + 1}
    dropped = [k for k in HORIZONS if k not in usable]

    with np.errstate(invalid="ignore", divide="ignore"):
        day_returns = (C[:, 1:] / C[:, :-1] - 1.0) * 100.0
        # 20-day average dollar volume — the liquidity gate that matters.
        adv = np.nanmean((C * V)[:, -ADR_WINDOW:], axis=1)

    # Sustained relative strength across the whole panel, indexed like C.
    spy_row = pd.Series(spy_close).sort_index().to_numpy(dtype=float)
    rs = rs_persistence(C, spy_row) if np.isfinite(spy_row).any() else None
    rs_index = {sym: i for i, sym in enumerate(symbols)} if rs else {}

    records: dict[str, dict] = {}
    passed_liquidity = 0
    for i, sym in enumerate(symbols):
        close = C[i]
        if not np.isfinite(close[-1]) or close[-1] <= 0:
            continue
        if not np.isfinite(adv[i]) or adv[i] < min_dollar_volume:
            continue
        passed_liquidity += 1
        # Reverse-split guard over the deepest window we hold.
        if _is_probable_split(day_returns[i], V[i, 1:]):
            continue

        px = float(close[-1])
        rets: dict[str, float | None] = {}
        for key, n in usable.items():
            base = close[-(n + 1)]
            rets[key] = (px / float(base) - 1.0) * 100.0 if np.isfinite(base) and base > 0 else None

        # ADR% — the average daily range, the position-sizing input.
        hi, lo = H[i, -ADR_WINDOW:], L[i, -ADR_WINDOW:]
        with np.errstate(invalid="ignore", divide="ignore"):
            rng = (hi - lo) / np.where(close[-ADR_WINDOW:] > 0, close[-ADR_WINDOW:], np.nan) * 100.0
        adr = float(np.nanmean(rng)) if np.isfinite(rng).any() else None
        if adr is None or adr < min_adr_pct or adr > max_adr_pct:
            continue

        sma_fast = _trailing_sma(close, SMA_FAST)
        sma_slow = _trailing_sma(close, SMA_SLOW)

        # Distance from the high of the deepest window we hold — "has it stopped
        # going up, and by how much".
        window = min(available, max(usable.values()))
        win_high = float(np.nanmax(H[i, -window:])) if np.isfinite(H[i, -window:]).any() else None
        from_high = (px / win_high - 1.0) * 100.0 if win_high and win_high > 0 else 0.0
        since_high = int(window - 1 - int(np.nanargmax(H[i, -window:]))) if win_high else None

        # Range contraction: is the recent range quieter than the run that made
        # it? A leader that has stopped swinging is building, not dying.
        recent_rng = H[i, -QUIET_WINDOW:] - L[i, -QUIET_WINDOW:]
        prior_rng = H[i, -(QUIET_WINDOW * 3):-QUIET_WINDOW] - L[i, -(QUIET_WINDOW * 3):-QUIET_WINDOW]
        # nanmean warns (and returns NaN) on an all-NaN slice, which is normal
        # here for names that listed mid-window — check before asking.
        recent = float(np.nanmean(recent_rng)) if np.isfinite(recent_rng).any() else np.nan
        prior = float(np.nanmean(prior_rng)) if np.isfinite(prior_rng).any() else np.nan
        contracting = bool(
            np.isfinite(recent) and np.isfinite(prior) and prior > 0
            and recent / prior <= CONTRACTION_RATIO
        )

        ext_adrs = None
        if sma_slow and sma_slow > 0 and adr > 0:
            ext_adrs = ((px / sma_slow - 1.0) * 100.0) / adr

        state, why = _setup_state(
            from_high_pct=from_high,
            ext_adrs=ext_adrs,
            above_slow=bool(sma_slow and px >= sma_slow),
            contracting=contracting,
        )

        # Reference stop: under the low of the recent quiet stretch. This is the
        # consolidation you'd be buying out of, so its low is where the idea is
        # wrong — and risk_pct is what turns ADR into a position size.
        base_low = float(np.nanmin(L[i, -QUIET_WINDOW:])) if np.isfinite(L[i, -QUIET_WINDOW:]).any() else None
        risk_pct = ((px - base_low) / px * 100.0) if base_low and px > 0 and base_low < px else None

        # A short close series so the row can show its own shape. "Is this
        # basing?" is a question about a picture; a state label alone asks you
        # to take the classifier's word for it.
        spark_raw = C[i, -SPARK_SESSIONS:]
        spark = [round(float(v), 4) for v in spark_raw if np.isfinite(v)]

        records[sym] = {
            "symbol": sym,
            "price": round(px, 2),
            "stop": round(base_low, 2) if base_low else None,
            "risk_pct": round(risk_pct, 1) if risk_pct is not None else None,
            "spark": spark,
            "ret_1m": _r(rets.get("1M")),
            "ret_3m": _r(rets.get("3M")),
            "ret_6m": _r(rets.get("6M")),
            "adr_pct": round(adr, 2),
            "dollar_vol": int(float(dollar_vol_today.get(sym, 0.0))),
            "from_high_pct": round(from_high, 1),
            "days_since_high": since_high,
            "above_10ma": bool(sma_fast and px >= sma_fast),
            "above_20ma": bool(sma_slow and px >= sma_slow),
            "ext_adrs": round(ext_adrs, 1) if ext_adrs is not None else None,
            "contracting": contracting,
            "setup_state": state,
            "state_why": why,
            "horizons": [],
        }

        if rs is not None:
            j = rs_index.get(sym)
            if j is not None:
                rank_v = rs["rank"][j]
                mans_v = rs["mansfield"][j]
                records[sym].update({
                    "rs_rank": round(float(rank_v)) if np.isfinite(rank_v) else None,
                    "rs_mansfield": round(float(mans_v), 1) if np.isfinite(mans_v) else None,
                    "rs_days_top": int(rs["days_top"][j]),
                    "rs_window": rs["window"],
                    "rs_rising": bool(rs["rising"][j]),
                })

    # --- Rank each horizon independently — that IS the three-scan routine ---
    horizon_out = []
    for key in ("6M", "3M", "1M"):
        if key not in usable:
            continue
        field = {"1M": "ret_1m", "3M": "ret_3m", "6M": "ret_6m"}[key]
        ranked = sorted(
            (r for r in records.values() if r[field] is not None),
            key=lambda r: r[field], reverse=True,
        )[:top_n]
        for rank, r in enumerate(ranked, 1):
            r["horizons"].append(key)
        horizon_out.append({
            "key": key,
            "label": HORIZON_LABEL[key],
            "blurb": HORIZON_BLURB[key],
            "sessions": HORIZONS[key],
            "rows": [{**r, "rank": n} for n, r in enumerate(ranked, 1)],
        })

    # --- RS leadership: sustained, not fastest -------------------------------
    # Deliberately NOT tagged into r["horizons"]: that field drives `confluence`,
    # which means "in two or more *return* windows". Folding a different kind of
    # measure into it would quietly change what confluence claims.
    if rs is not None:
        qualified = []
        for r in records.values():
            if r.get("rs_days_top") is None or r.get("rs_rank") is None:
                continue
            if r["rs_days_top"] < RS_MIN_DAYS_TOP:
                continue
            persist = r["rs_days_top"] / max(1, r["rs_window"]) * 100.0
            r["rs_score"] = round(
                RS_PERSIST_WEIGHT * persist + (1 - RS_PERSIST_WEIGHT) * r["rs_rank"], 1
            )
            qualified.append(r)
        ranked_rs = sorted(qualified, key=lambda r: -r["rs_score"])[:RS_TOP_N]
        horizon_out.append({
            "key": "RS",
            "label": "RS leadership",
            "blurb": (
                "Sustained outperformance, not the biggest move — ranked by how many of the "
                f"last {rs['window']} sessions the name held the top decile of relative strength. "
                "This is where a heavy, liquid leader compounding against the market shows up; "
                "the return scans structurally can't see it."
            ),
            "sessions": rs["window"],
            "rows": [{**r, "rank": n} for n, r in enumerate(ranked_rs, 1)],
        })

    # --- Confluence: in two or more lists = sustained AND accelerating -------
    confluence = sorted(
        (r for r in records.values() if len(r["horizons"]) >= 2),
        key=lambda r: (-len(r["horizons"]), -(r["ret_3m"] or r["ret_1m"] or 0.0)),
    )

    return {
        "as_of": today.isoformat(),
        "horizons": horizon_out,
        "confluence": confluence,
        "universe": universe_size,
        "passed_liquidity": passed_liquidity,
        "sessions_available": available,
        "dropped_horizons": dropped,
        "thresholds": _thresholds(),
        "error": None,
    }


def _r(v: float | None) -> float | None:
    return None if v is None else round(float(v), 1)


def rs_persistence(closes: np.ndarray, spy: np.ndarray,
                   ma_days: int = RS_MA_DAYS,
                   window: int = RS_PERSIST_WINDOW,
                   top_pct: float = RS_TOP_PCT) -> dict | None:
    """Sustained relative strength for a whole panel at once.

    `closes` is symbols × sessions, `spy` the matching benchmark row. Mansfield
    RS is the stock/benchmark ratio measured against its own `ma_days` mean of
    that ratio — the same expression stage_analysis uses, so a name's RS reads
    the same on the Prep lane and the Stage page.

    Ranking is cross-sectional *per session*, then persistence counts how many
    of the last `window` sessions each name spent in the top decile. That count
    is the point of the lane: a single day at RS 95 is a good week, forty of
    them is institutional accumulation, and raw return can't tell them apart.

    Returns None when the panel is too short to form even the minimum MA.
    """
    n_days = closes.shape[1]
    if n_days < 2:
        return None
    # The MA must leave sessions behind it to score, or "persistence" would be
    # measured over a single day. Reserve a slice of the panel for scoring and
    # shorten the MA to fit — the same trade stage_analysis._fit_windows makes.
    reserve = max(2, min(window, 10))
    ma = min(ma_days, n_days - reserve + 1)
    if ma < RS_MIN_MA_DAYS:
        return None

    with np.errstate(invalid="ignore", divide="ignore"):
        safe_spy = np.where(spy > 0, spy, np.nan)
        ratio = closes / safe_spy                              # symbols × sessions

        # Trailing mean of the ratio, per session, over the MA window. Only the
        # sessions that have a full window behind them are scorable.
        scorable = n_days - ma + 1
        if scorable < 2:
            return None
        cum = np.nancumsum(np.nan_to_num(ratio, nan=0.0), axis=1)
        counts = np.nancumsum(np.isfinite(ratio), axis=1)
        # rolling sum/count over `ma` columns ending at each scorable session
        head_sum = np.concatenate([np.zeros((ratio.shape[0], 1)), cum[:, :-1]], axis=1)
        head_cnt = np.concatenate([np.zeros((ratio.shape[0], 1)), counts[:, :-1]], axis=1)
        roll_sum = cum[:, ma - 1:] - head_sum[:, : n_days - ma + 1]
        roll_cnt = counts[:, ma - 1:] - head_cnt[:, : n_days - ma + 1]
        ratio_ma = np.where(roll_cnt > 0, roll_sum / np.where(roll_cnt > 0, roll_cnt, 1), np.nan)

        ratio_now = ratio[:, ma - 1:]
        mansfield = (ratio_now / np.where(ratio_ma != 0, ratio_ma, np.nan) - 1.0) * 100.0

    # Cross-sectional percentile per session (a column at a time), NaNs excluded.
    ranks = np.full(mansfield.shape, np.nan)
    for j in range(mansfield.shape[1]):
        col = mansfield[:, j]
        ok = np.isfinite(col)
        if ok.sum() < 2:
            continue
        order = col[ok].argsort().argsort().astype(float)
        ranks[ok, j] = (order + 1) / ok.sum() * 100.0

    tail = ranks[:, -min(window, ranks.shape[1]):]
    with np.errstate(invalid="ignore"):
        days_top = np.nansum(tail >= top_pct, axis=1)
        # Rising = today's RS above where it was a fifth of the window ago.
        back = max(1, tail.shape[1] // 5)
        rising = ranks[:, -1] > ranks[:, -1 - back] if ranks.shape[1] > back else np.zeros(len(ranks), bool)

    return {
        "mansfield": mansfield[:, -1],
        "rank": ranks[:, -1],
        "days_top": days_top.astype(int),
        "window": int(tail.shape[1]),
        "rising": np.asarray(rising, dtype=bool),
        "ma_days": int(ma),
        "approx": ma < ma_days,
    }
