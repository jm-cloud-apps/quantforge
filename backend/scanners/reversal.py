"""Reversal setup scanner — Stockbee's "Reversal Bullish" intraday-exhaustion scan.

Source rules (stockbee.blogspot.com/2019/11/how-to-use-reversal-setup-to-make-money.html):

The idea is to buy *selling exhaustion*: a stock that sold off to a fresh short-term
low intraday, then recovered to close near the high of the day, printing a long lower
tail ("the candle tail is 3 to 5 times the body"). Because you enter near the close
with a stop just under the signal-day low, the per-trade risk is small (Stockbee:
"less than 2.5% risk if bought near low on signal day"), which is what makes the
asymmetry work — a string of small stops paid for by occasional multi-R winners.

Stockbee's literal scan formula (TC2000/Worden syntax):

    l = minl5
    and (o - l) > (c - o)
    and (c - l) / (h - l) >= .6
    and v >= 290000
    and c >= 5
    and minv3.1 >= 100000

Decoded into the hard filters this module applies on the setup day:

  1. Universe : US common stocks / ADRs / ETFs (cached grouped-daily panel, ~3000).
  2. Price    : close >= $5.00            (c >= 5).
  3. Volume   : volume >= 290,000 shares  (v >= 290000).
  4. 5-day low: today's low is the lowest low of the last 5 sessions (l = minl5) —
                the stock made a fresh short-term low intraday, i.e. it sold off.
  5. Recovery : (close - low) / (high - low) >= 0.60 — closed in the upper 40% of
                the day's range, so buyers took control back into the close.
  6. Lower tail dominant : (open - low) > (close - open) — the move down from the
                open is bigger than the move up to the close, the long-lower-tail
                signature of an intraday washout-and-recover.
  7. Liquidity floor : minimum volume over the prior 3 sessions >= 100,000
                (minv3.1) — the name traded every day, not a one-print fluke.

Soft signals (computed and surfaced as columns; gated only when requested):

  • strong tail — lower tail >= 3x the body (Stockbee's "3 to 5 times the body").
  • green close — close > open. The hard scan admits red hammers too; this lets a
                  trader who only wants green reversals tighten it.

Surfaced metrics that don't gate but help the trader pick "1 to 3 ideas" and size:

  • recovery_pct       — (close - low)/(high - low), how cleanly it closed near high.
  • tail_body_ratio    — lower-tail / body, the 3-5x candle quality.
  • risk_pct           — (close - low)/close, the stop-under-signal-low risk if you
                         enter at the close via MOC (Stockbee's <2.5% framing).
  • decline_5d_pct     — drop from the prior-5-session high into today's low; how much
                         selling is being reversed.
  • down_days_prior    — trailing run of lower-closing days into the low (exhaustion).

The original writeup is informal about exact tail/green thresholds, so they're left
off by default — the trader applies discretion against the chart while still seeing
the metric.

One addition beyond the literal formula: a minimum intraday range (MIN_RANGE_PCT,
% of close). The bare scan admits flat low-volatility bars (a 1-cent-range bond ETF
satisfies `l=minl5 and (c-l)/(h-l)>=.6`), but with no intraday washout there is no
reversal to trade. Requiring a real range keeps the scan honest to the setup's intent.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

from breadth.cache import list_cached_days, load_cached_day

logger = logging.getLogger(__name__)

# --- Rule thresholds --------------------------------------------------------
MIN_PRICE = 5.00                 # c >= 5
MIN_VOLUME = 290_000             # v >= 290000
FIVE_DAY_LOW_LOOKBACK = 5        # l = minl5 (today low is lowest of last 5 sessions)
RECOVERY_MIN = 0.60             # (c-l)/(h-l) >= 0.6
# Beyond the literal scan: a minimum intraday range (as % of close). A 1-cent-range
# bar on a sleepy bond ETF mechanically satisfies "l=minl5 and recovery>=.6", but
# there was no intraday washout to recover from — it's the opposite of the setup.
# Requiring a real intraday range keeps the scan on names that actually moved.
MIN_RANGE_PCT = 1.0             # (high - low) / close, in percent
MIN_PRIOR_VOL = 100_000          # minv3.1 >= 100000 (min vol over prior 3 sessions)
PRIOR_VOL_LOOKBACK = 3           # the ".1"-offset window for the liquidity floor

# Soft-signal thresholds
STRONG_TAIL_MULT = 3.0           # lower tail >= 3x body ("3 to 5 times the body")
DECLINE_LOOKBACK = 5             # prior-session high used for the decline-into-low %

# How many prior sessions we must load to compute every historical filter. The
# 5-day-low check needs the 4 sessions before today; the liquidity floor needs 3;
# the decline context wants up to 5. Load the max so one panel covers them all.
PRIOR_LOOKBACK = max(FIVE_DAY_LOW_LOOKBACK - 1, PRIOR_VOL_LOOKBACK, DECLINE_LOOKBACK)


def run(
    min_volume: int = MIN_VOLUME,
    min_price: float = MIN_PRICE,
    require_strong_tail: bool = False,
    require_green: bool = False,
) -> dict:
    """Run the reversal-bullish scan against the latest cached grouped-daily panel.

    Hard filters (always applied): price, volume, fresh 5-day low, recovery >= 60%,
    lower-tail-dominant candle, and the prior-3-session liquidity floor.

    Soft gates (off by default): `require_strong_tail` keeps only tails >= 3x body;
    `require_green` keeps only close > open.
    """
    days = list_cached_days()
    need = PRIOR_LOOKBACK + 1
    if len(days) < need:
        return _empty(
            as_of=None,
            min_volume=min_volume,
            min_price=min_price,
            universe=0,
            passed_volume=0,
            error=(
                f"Not enough breadth-cache history yet — need {need} trading days, "
                f"have {len(days)}. Run Market Monitor → Refresh first."
            ),
        )

    today = days[-1]
    today_df = load_cached_day(today)
    if today_df is None or today_df.empty:
        return _empty(today.isoformat(), min_volume, min_price, 0, 0,
                      error="Latest cached day has no data.")

    # --- Stage 1: cheap volume + price gate (sheds most of the universe) ----
    today_df = today_df.dropna(subset=["open", "high", "low", "close", "volume"])
    universe_size = len(today_df)
    gated = today_df[(today_df["volume"] >= min_volume) & (today_df["close"] >= min_price)].copy()
    passed_volume = len(gated)
    if gated.empty:
        return _empty(today.isoformat(), min_volume, min_price, universe_size, 0)

    # --- Stage 2: per-bar candle geometry (recovery + lower-tail dominant) ---
    gated["range_today"] = gated["high"] - gated["low"]
    gated = gated[gated["range_today"] > 0]
    # Hygiene floor: the bar must have a real intraday range, not a flat print.
    gated["range_pct"] = gated["range_today"] / gated["close"] * 100
    gated = gated[gated["range_pct"] >= MIN_RANGE_PCT]
    gated["recovery"] = (gated["close"] - gated["low"]) / gated["range_today"]
    # (o - l) > (c - o): the washout below the open exceeds the push up to the close.
    gated["tail_dominant"] = (gated["open"] - gated["low"]) > (gated["close"] - gated["open"])
    gated = gated[(gated["recovery"] >= RECOVERY_MIN) & gated["tail_dominant"]]
    if gated.empty:
        return _empty(today.isoformat(), min_volume, min_price, universe_size, passed_volume)

    candidate_symbols = list(gated.index)

    # --- Stage 3: historical-context filters need per-symbol prior series ----
    prior_days = days[-(PRIOR_LOOKBACK + 1):-1]  # PRIOR_LOOKBACK sessions before today
    panels: list[pd.DataFrame] = []
    for d in prior_days:
        df = load_cached_day(d)
        if df is None or df.empty:
            continue
        sub = df.loc[df.index.intersection(candidate_symbols), ["high", "low", "close", "volume"]].copy()
        sub["date"] = d.isoformat()
        panels.append(sub)
    if not panels:
        return _empty(today.isoformat(), min_volume, min_price, universe_size, passed_volume,
                      error="Prior-day frames missing for candidates.")
    prior_stack = pd.concat(panels).sort_values("date")

    # Date sub-windows: the 4 sessions before today (5-day-low denominator excludes
    # today itself) and the prior 3 sessions (liquidity floor).
    low_window = {d.isoformat() for d in prior_days[-(FIVE_DAY_LOW_LOOKBACK - 1):]}
    vol_window = {d.isoformat() for d in prior_days[-PRIOR_VOL_LOOKBACK:]}

    min_low_prior = prior_stack[prior_stack["date"].isin(low_window)].groupby(level=0)["low"].min()
    min_vol_prior = prior_stack[prior_stack["date"].isin(vol_window)].groupby(level=0)["volume"].min()
    high_prior = prior_stack.groupby(level=0)["high"].max()

    candidates: list[dict] = []
    for symbol, row in gated.iterrows():
        low_t = float(row["low"])
        close_t = float(row["close"])
        open_t = float(row["open"])
        high_t = float(row["high"])
        rng = float(row["range_today"])

        # HARD: today's low is the lowest of the last 5 sessions (l = minl5).
        prior_min_low = min_low_prior.get(symbol, np.nan)
        if np.isnan(prior_min_low):
            continue
        if low_t > float(prior_min_low) + 1e-9:  # a prior session dipped lower → not a fresh 5-day low
            continue

        # HARD: liquidity floor — every one of the prior 3 sessions traded >= 100k.
        prior_min_vol = min_vol_prior.get(symbol, np.nan)
        if np.isnan(prior_min_vol) or float(prior_min_vol) < MIN_PRIOR_VOL:
            continue

        # Candle anatomy.
        lower_tail = min(open_t, close_t) - low_t
        body = abs(close_t - open_t)
        is_doji = body <= 1e-9 or body < 0.001 * close_t
        tail_body_ratio = None if is_doji else (lower_tail / body)
        is_strong_tail = (
            (tail_body_ratio is None and lower_tail >= RECOVERY_MIN * rng)
            or (tail_body_ratio is not None and tail_body_ratio >= STRONG_TAIL_MULT)
        )
        green = close_t > open_t

        # SOFT gates.
        if require_strong_tail and not is_strong_tail:
            continue
        if require_green and not green:
            continue

        # Risk if you enter at the close (MOC) with a stop just under the signal low.
        risk_pct = (close_t - low_t) / close_t * 100 if close_t else None

        # How much selling is being reversed: prior-5 high down to today's low.
        ph = float(high_prior.get(symbol, np.nan))
        decline_5d_pct = ((ph - low_t) / ph * 100) if (not np.isnan(ph) and ph > 0) else None

        candidates.append({
            "symbol": symbol,
            "open": _f(open_t),
            "high": _f(high_t),
            "low": _f(low_t),
            "close": _f(close_t),
            "volume": int(row["volume"]),
            "dollar_volume": _f(row["volume"] * close_t),
            "range_today": _f(rng),
            "range_pct": round(float(row["range_pct"]), 2),
            "recovery_pct": round(float(row["recovery"]) * 100, 1),
            "lower_tail": _f(lower_tail),
            "body": _f(body),
            "tail_body_ratio": round(tail_body_ratio, 2) if tail_body_ratio is not None else None,
            "is_strong_tail": bool(is_strong_tail),
            "green": bool(green),
            "risk_pct": round(risk_pct, 2) if risk_pct is not None else None,
            "stop": _f(low_t),  # reference stop just under the signal-day low
            "decline_5d_pct": round(decline_5d_pct, 1) if decline_5d_pct is not None else None,
            "down_days_prior": _down_streak(prior_stack, symbol, close_t),
            "prior_min_vol": int(prior_min_vol),
        })

    # Sort: strongest reversal candles first (strong tail, then tail quality, then
    # how cleanly they closed near the high), so the top of the list is the cleanest.
    candidates.sort(key=lambda c: (
        0 if c["is_strong_tail"] else 1,
        -min(c["tail_body_ratio"] or 10.0, 10.0),
        -(c["recovery_pct"] or 0),
    ))

    return {
        "as_of": today.isoformat(),
        "thresholds": _thresholds_payload(min_volume, min_price),
        "gates": {
            "require_strong_tail": bool(require_strong_tail),
            "require_green": bool(require_green),
        },
        "candidates": candidates,
        "counts": {
            "universe": universe_size,
            "passed_volume": passed_volume,
            "passed_all": len(candidates),
        },
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


def _down_streak(prior_stack: pd.DataFrame, symbol: str, close_today: float) -> int:
    """Trailing run of lower-closing sessions leading into the signal day.

    Counts, from the most recent prior session backward, how many sessions closed
    below the one before them — a proxy for the selling-exhaustion run the reversal
    is fading. The setup day's own close (above the prior close) is the break of it.
    """
    if symbol not in prior_stack.index:
        return 0
    rows = prior_stack.loc[[symbol]]
    closes = rows["close"].tolist()  # already date-ascending (prior_stack is sorted)
    if not closes:
        return 0
    streak = 0
    # Did the setup day itself close down vs. the last prior close? If not, the run
    # ended today — we still report the prior down-run for context.
    seq = closes  # oldest -> newest prior close
    for i in range(len(seq) - 1, 0, -1):
        if seq[i] < seq[i - 1]:
            streak += 1
        else:
            break
    return streak


def _empty(as_of, min_volume, min_price, universe, passed_volume, error: str | None = None) -> dict:
    out = {
        "as_of": as_of,
        "thresholds": _thresholds_payload(min_volume, min_price),
        "candidates": [],
        "counts": {"universe": universe, "passed_volume": passed_volume, "passed_all": 0},
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


def _thresholds_payload(min_volume: int, min_price: float) -> dict:
    return {
        "min_price": float(min_price),
        "min_volume": int(min_volume),
        "five_day_low_lookback": FIVE_DAY_LOW_LOOKBACK,
        "recovery_min": RECOVERY_MIN,
        "min_range_pct": MIN_RANGE_PCT,
        "min_prior_vol": MIN_PRIOR_VOL,
        "prior_vol_lookback": PRIOR_VOL_LOOKBACK,
        "strong_tail_mult": STRONG_TAIL_MULT,
        "decline_lookback": DECLINE_LOOKBACK,
    }
