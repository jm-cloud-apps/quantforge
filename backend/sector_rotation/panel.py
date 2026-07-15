"""Wide OHLCV panels built from the breadth grouped-daily cache.

The breadth engine persists one DataFrame per trading day (index=ticker,
columns=open/high/low/close/volume). For sector math we need the transpose:
one DataFrame per field with index=date, columns=ticker. Building this is
pure local I/O — no API calls.
"""

from __future__ import annotations

import logging

import pandas as pd

from breadth.cache import list_cached_days, load_cached_day

logger = logging.getLogger(__name__)


def build_panels(days: int = 70, fields: tuple[str, ...] = ("close", "volume")) -> dict[str, pd.DataFrame]:
    """Load the most recent `days` cached sessions and pivot into wide panels.

    Returns {field: DataFrame(index=date ascending, columns=ticker)}. Tickers
    missing on a given day are NaN for that row — callers should require a
    minimum bar count per symbol before trusting a series.
    """
    cached = list_cached_days()
    take = cached[-days:] if len(cached) > days else cached
    if not take:
        return {f: pd.DataFrame() for f in fields}

    per_field: dict[str, dict] = {f: {} for f in fields}
    for d in take:
        df = load_cached_day(d)
        if df is None or df.empty:
            continue
        for f in fields:
            if f in df.columns:
                per_field[f][d] = df[f]

    panels: dict[str, pd.DataFrame] = {}
    for f in fields:
        # dict of {date: Series(index=ticker)} → columns=dates → transpose
        p = pd.DataFrame(per_field[f]).T
        p.index = pd.to_datetime(p.index)
        panels[f] = p.sort_index()
    logger.info(
        "sector_rotation: built %s panels — %d sessions × %d symbols",
        "/".join(fields), len(panels[fields[0]]), panels[fields[0]].shape[1] if not panels[fields[0]].empty else 0,
    )
    return panels
