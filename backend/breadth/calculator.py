"""Stockbee-style breadth metrics computed from the cached grouped-daily frames.

The cache stores one DataFrame per trading day, indexed by ticker. To
compute breadth we pivot the close column across days into a wide frame
(rows=date, cols=ticker) and run vectorized comparisons.

Metric definitions (per Stockbee's published rules):
- 4% up today          : (close / prev_close - 1) >= 0.04
- 4% down today        : <= -0.04
- 5d ratio             : sum(4%up over last 5 sessions) / sum(4%down)
- 10d ratio            : same, 10 sessions
- 25% qtr up / down    : (close / close_~63d_ago - 1) >= ±0.25
- 25% mo up / down     : same, ~21 sessions
- 50% mo up            : same, +0.50 over ~21 sessions
- T2108 local          : % of universe symbols above their SMA40
- Coverage             : symbols_with_enough_history / |universe|
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from .cache import list_cached_days, load_cached_day
from .universe import load_universe

logger = logging.getLogger(__name__)

# Trading-day lookbacks. Stockbee defines "month" and "quarter" loosely;
# 21 / 63 are the standard US-session approximations.
LOOKBACK_MONTH = 21
LOOKBACK_QUARTER = 63
SMA_WINDOW = 40
RATIO_SHORT = 5
RATIO_LONG = 10
PCT_UP_THRESH = 0.04
PCT_DOWN_THRESH = -0.04
PCT_MOVE_QTR = 0.25
PCT_MOVE_MO = 0.25
PCT_MOVE_50 = 0.50


def _build_close_panel(
    universe: list[str],
    days_needed: int,
) -> tuple[pd.DataFrame, list[date]]:
    """Load the most recent `days_needed` cached days and pivot into a wide
    close-price panel. Rows = date (asc), cols = ticker (restricted to the
    intersection with the universe). Empty-day sentinels are skipped.
    """
    all_days = list_cached_days()
    if not all_days:
        return pd.DataFrame(), []

    # Walk newest→oldest until we've collected enough *non-empty* days.
    chosen: list[tuple[date, pd.DataFrame]] = []
    for d in reversed(all_days):
        df = load_cached_day(d)
        if df is None or df.empty:
            continue
        chosen.append((d, df))
        if len(chosen) >= days_needed:
            break
    chosen.reverse()
    if not chosen:
        return pd.DataFrame(), []

    universe_set = set(universe)
    frames = []
    dates: list[date] = []
    for d, df in chosen:
        # restrict to universe membership at panel-build time
        keep = df.index.intersection(universe_set)
        row = df.loc[keep, "close"].rename(d)
        frames.append(row)
        dates.append(d)
    panel = pd.concat(frames, axis=1).T.sort_index()  # date rows
    return panel, dates


def _row_metrics(panel: pd.DataFrame, universe_size: int) -> list[dict]:
    """Compute one metric dict per row of the panel. Newest row last.

    Older rows have shallower lookbacks available — metrics that require
    more history than is in the panel return None for those rows.
    """
    if panel.empty:
        return []

    rows: list[dict] = []
    closes = panel  # rows=date asc, cols=ticker
    # Pre-compute the SMA40 panel (NaN until 40 obs are available).
    sma40 = closes.rolling(window=SMA_WINDOW, min_periods=SMA_WINDOW).mean()

    # 1-day pct change for the 4% rules. `fill_method=None` keeps NaN holes
    # as NaN rather than forward-filling — important so a symbol that didn't
    # trade for a day isn't credited with a 0% move.
    pct_1d = closes.pct_change(periods=1, fill_method=None)
    # ~21 / ~63 day pct change (uses the calendar-of-cached-days, not strict
    # market calendar — good enough since holidays drop out and only
    # non-empty days are in the panel).
    pct_21 = closes.pct_change(periods=LOOKBACK_MONTH, fill_method=None)
    pct_63 = closes.pct_change(periods=LOOKBACK_QUARTER, fill_method=None)

    # Above-SMA40 boolean panel
    above40 = closes > sma40

    # 4% up / down booleans — used both for today's count and rolling ratios
    up_4 = pct_1d >= PCT_UP_THRESH
    dn_4 = pct_1d <= PCT_DOWN_THRESH

    up_4_count = up_4.sum(axis=1)
    dn_4_count = dn_4.sum(axis=1)

    def _ratio(window: int) -> pd.Series:
        u = up_4_count.rolling(window=window, min_periods=window).sum()
        d = dn_4_count.rolling(window=window, min_periods=window).sum()
        # avoid div-by-zero — a window with zero downs is treated as a very
        # bullish but bounded ratio (cap at 99.9 to keep UI sane).
        out = u / d.replace(0, np.nan)
        return out.fillna(99.9).where(d > 0, np.where(u > 0, 99.9, 0.0))

    ratio_5 = _ratio(RATIO_SHORT)
    ratio_10 = _ratio(RATIO_LONG)

    qtr_up = (pct_63 >= PCT_MOVE_QTR).sum(axis=1)
    qtr_dn = (pct_63 <= -PCT_MOVE_QTR).sum(axis=1)
    mo_up = (pct_21 >= PCT_MOVE_MO).sum(axis=1)
    mo_dn = (pct_21 <= -PCT_MOVE_MO).sum(axis=1)
    mo_up_50 = (pct_21 >= PCT_MOVE_50).sum(axis=1)

    # T2108: % of universe symbols above SMA40 today. We use the symbols
    # that *have* an SMA40 (i.e. enough history) as the denominator so it's
    # comparable across days even when new listings appear mid-window.
    # Guard against the oldest rows in the panel where no symbol has 40
    # bars of history yet — denom is 0 there, so T2108 is undefined.
    sma_valid = sma40.notna()
    valid_count = sma_valid.sum(axis=1)
    t2108 = (above40.where(sma_valid).sum(axis=1) / valid_count.replace(0, np.nan)) * 100

    # Coverage: how many universe symbols had a print this day. We pick the
    # latest row as the headline coverage but include it per-row for the
    # history table.
    per_row_coverage = closes.notna().sum(axis=1)

    for d in closes.index:
        rows.append({
            "date": d.isoformat() if hasattr(d, "isoformat") else str(d),
            "up_4": int(up_4_count.loc[d]) if not pd.isna(up_4_count.loc[d]) else None,
            "down_4": int(dn_4_count.loc[d]) if not pd.isna(dn_4_count.loc[d]) else None,
            "ratio_5d": round(float(ratio_5.loc[d]), 2) if not pd.isna(ratio_5.loc[d]) else None,
            "ratio_10d": round(float(ratio_10.loc[d]), 2) if not pd.isna(ratio_10.loc[d]) else None,
            "qtr_up_25": int(qtr_up.loc[d]) if not pd.isna(qtr_up.loc[d]) else None,
            "qtr_down_25": int(qtr_dn.loc[d]) if not pd.isna(qtr_dn.loc[d]) else None,
            "mo_up_25": int(mo_up.loc[d]) if not pd.isna(mo_up.loc[d]) else None,
            "mo_down_25": int(mo_dn.loc[d]) if not pd.isna(mo_dn.loc[d]) else None,
            "mo_up_50": int(mo_up_50.loc[d]) if not pd.isna(mo_up_50.loc[d]) else None,
            "t2108": round(float(t2108.loc[d]), 2) if not pd.isna(t2108.loc[d]) else None,
            "coverage_count": int(per_row_coverage.loc[d]),
            "universe_size": universe_size,
        })
    return rows


def compute_history(days: int = 15) -> dict:
    """Return the latest `days` rows of breadth metrics, oldest→newest.

    The panel must include enough lookback for quarterly comparisons; we
    pad the load by LOOKBACK_QUARTER + 5 so even the oldest displayed row
    has its qtr metric. Rows are then trimmed to the requested tail.
    """
    universe_payload = load_universe()
    universe = universe_payload.get("symbols", [])
    if not universe:
        return {"rows": [], "universe_size": 0, "universe_as_of": universe_payload.get("as_of")}

    panel, dates_loaded = _build_close_panel(
        universe=universe,
        days_needed=days + LOOKBACK_QUARTER + 5,
    )
    if panel.empty:
        return {"rows": [], "universe_size": len(universe), "universe_as_of": universe_payload.get("as_of")}

    rows = _row_metrics(panel, universe_size=len(universe))
    tail = rows[-days:]
    return {
        "rows": tail,
        "universe_size": len(universe),
        "universe_as_of": universe_payload.get("as_of"),
        "panel_days_loaded": len(dates_loaded),
    }


def compute_snapshot() -> dict:
    """Compute the latest single-day breadth snapshot.

    Returns the headline metric block plus coverage + meta. The regime
    label is *not* attached here — callers should pipe this through
    `regime.classify(...)` to add the read.
    """
    hist = compute_history(days=1)
    rows = hist.get("rows", [])
    if not rows:
        return {
            "as_of": None,
            "metrics": None,
            "coverage": {"count": 0, "universe_size": hist.get("universe_size", 0)},
            "source": "local-cache",
        }
    latest = rows[-1]
    return {
        "as_of": latest["date"],
        "metrics": {
            k: latest[k]
            for k in (
                "up_4", "down_4", "ratio_5d", "ratio_10d",
                "qtr_up_25", "qtr_down_25",
                "mo_up_25", "mo_down_25", "mo_up_50",
                "t2108",
            )
        },
        "coverage": {
            "count": latest["coverage_count"],
            "universe_size": latest["universe_size"],
            "pct": round(latest["coverage_count"] / max(latest["universe_size"], 1) * 100, 1),
        },
        "source": "local-cache",
        "universe_as_of": hist.get("universe_as_of"),
    }
