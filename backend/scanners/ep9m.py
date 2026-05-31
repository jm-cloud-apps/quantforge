"""$9 Million Method (EP9M) scanner — Stockbee's volume-filtered breakout system.

Source rules (breakoutshappen.com/stock-news/ep9-million-method):

  1. Universe : US common stocks / ADRs / ETFs (we use the cached grouped-daily
                panel, ~3000 names).
  2. Vol      : ≥ 9,000,000 shares traded on the setup day.
  3. Price    : ≥ $3.00 (penny-stock pattern collapses below this).
  4. Range    : "Visibly wider" than recent average. We encode this as
                today's range ≥ 1.5 × mean range over the prior 20 sessions.
  5. DCR      : Daily Closing Range = (close − low) / (high − low) ≥ 0.70.
  6. Green    : Close > Open (Stockbee: "entry taken same-day when candle is
                green; no chasing lows").
  7. Compress : Bar "emerging from compression" — mean range of the prior 5
                sessions ≤ 0.70 × mean range of the prior 20 sessions. Filters
                out late continuation candles.
  8. Not late : Stock should NOT already be 3+ days into a move. We encode as
                the close 3 days ago being below today's session low (i.e. the
                expansion really started today).

Classification (CATS / DOGS / Liquid Lava) is a coarse approximation here —
the original method splits by catalyst quality + institutional ownership.
Without holders data we infer:

  • Liquid Lava : volume ≥ 20M AND price × volume ≥ $300M dollar-volume
                  (mega-cap-grade institutional footprint).
  • CATS        : earnings within ±5 trading days OR a fundamental gap.
  • DOGS        : everything else that passed the volume + candle filter.

The final classification is best done by the trader reading the chart and the
news; we surface enough metrics on the page that the call is easy to make.
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
MIN_VOLUME = 9_000_000          # The 9M in "9 Million Method".
MIN_PRICE = 3.00
LOOKBACK_PRIOR = 20              # days for the "recent average" range baseline
LOOKBACK_COMPRESSION = 5         # days immediately prior — should be tight
RANGE_EXPANSION_MULT = 1.5       # today vs. prior-20 average range
COMPRESSION_MAX_RATIO = 0.70     # prior-5 avg range / prior-20 avg range
DCR_MIN = 0.70                   # close in upper 30% of day's range
NOT_LATE_LOOKBACK = 3            # close N days ago < today's low ⇒ not late

# Classification thresholds
LIQUID_LAVA_MIN_VOLUME = 20_000_000
LIQUID_LAVA_MIN_DOLLAR_VOL = 300_000_000


def _safe_pct(num: float, denom: float) -> float | None:
    if denom is None or denom == 0:
        return None
    return float(num) / float(denom)


def _classify(symbol: str, row: dict[str, Any]) -> str:
    """Coarse CATS / DOGS / Liquid Lava bucket from price + volume only."""
    vol = row.get("volume") or 0
    price = row.get("close") or 0
    dollar_vol = vol * price
    if vol >= LIQUID_LAVA_MIN_VOLUME and dollar_vol >= LIQUID_LAVA_MIN_DOLLAR_VOL:
        return "liquid_lava"
    # Without catalyst metadata we can't reliably split CATS vs DOGS in code.
    # Mark as "review" so the UI prompts the trader to classify.
    return "review"


def run(
    min_volume: int = MIN_VOLUME,
    min_price: float = MIN_PRICE,
    require_compression: bool = False,
    require_not_late: bool = False,
) -> dict:
    """Run the 9M scan against the latest cached grouped-daily panel.

    Hard filters (always applied):
        volume, price, DCR ≥ 70%, green close, range expansion ≥ 1.5× prior-20.

    Soft signals (computed and surfaced as columns; gated only when requested):
        compression  — prior-5 avg range ÷ prior-20 avg range
        not_late     — close N days ago compared to today's low

    The original Stockbee writeup is informal about exact compression and
    "not late" thresholds — leaving them off by default lets the trader
    apply discretion against the chart while still seeing the metric.
    """
    days = list_cached_days()
    if len(days) < LOOKBACK_PRIOR + 1:
        return {
            "as_of": None,
            "thresholds": _thresholds_payload(min_volume, min_price),
            "candidates": [],
            "counts": {"universe": 0, "passed_volume": 0, "passed_all": 0},
            "error": (
                f"Not enough breadth-cache history yet — need {LOOKBACK_PRIOR + 1} "
                f"trading days, have {len(days)}. Run Market Monitor → Refresh first."
            ),
        }

    today = days[-1]
    today_df = load_cached_day(today)
    if today_df is None or today_df.empty:
        return {
            "as_of": today.isoformat(),
            "thresholds": _thresholds_payload(min_volume, min_price),
            "candidates": [],
            "counts": {"universe": 0, "passed_volume": 0, "passed_all": 0},
            "error": "Latest cached day has no data.",
        }

    # --- Stage 1: cheap volume + price gate (sheds 95%+ of names) ---------
    today_df = today_df.dropna(subset=["high", "low", "close", "open", "volume"])
    universe_size = len(today_df)
    gated = today_df[(today_df["volume"] >= min_volume) & (today_df["close"] >= min_price)].copy()
    passed_volume = len(gated)
    if gated.empty:
        return {
            "as_of": today.isoformat(),
            "thresholds": _thresholds_payload(min_volume, min_price),
            "candidates": [],
            "counts": {"universe": universe_size, "passed_volume": 0, "passed_all": 0},
        }

    # --- Stage 2: per-bar geometry (DCR, range, green) --------------------
    gated["range_today"] = gated["high"] - gated["low"]
    gated = gated[gated["range_today"] > 0]
    gated["dcr"] = (gated["close"] - gated["low"]) / gated["range_today"]
    gated["is_green"] = gated["close"] > gated["open"]
    gated = gated[(gated["dcr"] >= DCR_MIN) & gated["is_green"]]
    if gated.empty:
        return {
            "as_of": today.isoformat(),
            "thresholds": _thresholds_payload(min_volume, min_price),
            "candidates": [],
            "counts": {"universe": universe_size, "passed_volume": passed_volume, "passed_all": 0},
        }

    candidate_symbols = list(gated.index)

    # --- Stage 3: historical-context filters (range expansion + compression
    # + not-late) require per-symbol series across the prior 20 days.
    prior_days = days[-(LOOKBACK_PRIOR + 1):-1]  # 20 sessions before `today`
    if len(prior_days) < LOOKBACK_PRIOR:
        return {
            "as_of": today.isoformat(),
            "thresholds": _thresholds_payload(min_volume, min_price),
            "candidates": [],
            "counts": {"universe": universe_size, "passed_volume": passed_volume, "passed_all": 0},
            "error": "Not enough prior days for range/compression baseline.",
        }

    panels: list[pd.DataFrame] = []
    for d in prior_days:
        df = load_cached_day(d)
        if df is None or df.empty:
            continue
        sub = df.loc[df.index.intersection(candidate_symbols), ["open", "high", "low", "close"]].copy()
        sub["date"] = d.isoformat()
        panels.append(sub)
    if not panels:
        return {
            "as_of": today.isoformat(),
            "thresholds": _thresholds_payload(min_volume, min_price),
            "candidates": [],
            "counts": {"universe": universe_size, "passed_volume": passed_volume, "passed_all": 0},
            "error": "Prior-day frames missing for candidates.",
        }
    prior_stack = pd.concat(panels)
    prior_stack["range"] = prior_stack["high"] - prior_stack["low"]

    # Per-symbol prior stats
    prior_grouped = prior_stack.groupby(prior_stack.index)
    range_prior_20 = prior_grouped["range"].mean()

    # Prior-5 = the most-recent 5 of the 20-day window, per-symbol.
    last5_dates = {d.isoformat() for d in prior_days[-LOOKBACK_COMPRESSION:]}
    prior_5_stack = prior_stack[prior_stack["date"].isin(last5_dates)]
    range_prior_5 = prior_5_stack.groupby(prior_5_stack.index)["range"].mean()

    # "Not late" reference: close from N days before today.
    not_late_idx = -(NOT_LATE_LOOKBACK + 1) if len(days) >= NOT_LATE_LOOKBACK + 1 else 0
    not_late_day = days[not_late_idx]
    nl_df = load_cached_day(not_late_day)
    close_n_days_ago = (
        nl_df["close"] if nl_df is not None and not nl_df.empty else pd.Series(dtype=float)
    )

    candidates: list[dict] = []
    for symbol, row in gated.iterrows():
        r20 = range_prior_20.get(symbol)
        r5 = range_prior_5.get(symbol)
        if r20 is None or r20 == 0 or np.isnan(r20):
            continue

        # HARD: Range expansion vs prior-20 avg
        expansion_mult = row["range_today"] / r20
        if expansion_mult < RANGE_EXPANSION_MULT:
            continue

        # SOFT: Compression (prior-5 vs prior-20). Computed for display; only
        # gated when the caller asks for it.
        compression_ratio = (float(r5) / float(r20)) if (r5 is not None and not np.isnan(r5)) else None
        is_compressed = compression_ratio is not None and compression_ratio <= COMPRESSION_MAX_RATIO
        if require_compression and not is_compressed:
            continue

        # SOFT: Not late — was the close N days ago below today's low?
        prev_close = float(close_n_days_ago.get(symbol, np.nan))
        not_late = (not np.isnan(prev_close)) and (prev_close < float(row["low"]))
        if require_not_late and not not_late:
            continue

        bucket = _classify(symbol, row)
        candidates.append({
            "symbol": symbol,
            "open": _f(row["open"]),
            "high": _f(row["high"]),
            "low": _f(row["low"]),
            "close": _f(row["close"]),
            "volume": int(row["volume"]),
            "dollar_volume": _f(row["volume"] * row["close"]),
            "range_today": _f(row["range_today"]),
            "dcr_pct": round(float(row["dcr"]) * 100, 1),
            "expansion_mult": round(float(expansion_mult), 2),
            "compression_ratio": round(float(compression_ratio), 2) if compression_ratio is not None else None,
            "is_compressed": bool(is_compressed),
            "avg_range_20d": _f(r20),
            "prev_close_3d_ago": _f(prev_close) if not np.isnan(prev_close) else None,
            "not_late": bool(not_late),
            "bucket": bucket,
        })

    # Sort: liquid_lava first (cleanest setups), then by expansion strength.
    bucket_order = {"liquid_lava": 0, "review": 1}
    candidates.sort(key=lambda c: (bucket_order.get(c["bucket"], 9), -c["expansion_mult"]))

    return {
        "as_of": today.isoformat(),
        "thresholds": _thresholds_payload(min_volume, min_price),
        "gates": {
            "require_compression": bool(require_compression),
            "require_not_late": bool(require_not_late),
        },
        "candidates": candidates,
        "counts": {
            "universe": universe_size,
            "passed_volume": passed_volume,
            "passed_all": len(candidates),
        },
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


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
        "min_volume": int(min_volume),
        "min_price": float(min_price),
        "lookback_prior": LOOKBACK_PRIOR,
        "lookback_compression": LOOKBACK_COMPRESSION,
        "range_expansion_mult": RANGE_EXPANSION_MULT,
        "compression_max_ratio": COMPRESSION_MAX_RATIO,
        "dcr_min": DCR_MIN,
        "not_late_lookback": NOT_LATE_LOOKBACK,
        "liquid_lava_min_volume": LIQUID_LAVA_MIN_VOLUME,
        "liquid_lava_min_dollar_vol": LIQUID_LAVA_MIN_DOLLAR_VOL,
    }
