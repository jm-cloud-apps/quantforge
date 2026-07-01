"""Shared OHLCV panel loader for the analytics tools.

Both the factor model and the edge-validation engine work off the same object:
a set of DataFrames indexed by ticker (rows) × trading date (columns, ascending)
built from the breadth grouped-daily cache. Loading it once, vectorised, keeps
whole-market cross-sectional math to well under a second and costs zero API
calls (the cache is already on disk).

Universe: names passing a liquidity gate on the latest cached day (price and
dollar-volume floors). This is a *survivorship-biased* universe — delisted names
have dropped out of the cache — which is fine for a live cross-section but worth
flagging anywhere forward-looking backtest stats are shown.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import pandas as pd

from breadth.cache import list_cached_days, load_cached_day


@dataclass
class Panel:
    close: pd.DataFrame          # ticker × date (ascending), adjusted close
    high: pd.DataFrame
    low: pd.DataFrame
    volume: pd.DataFrame
    dates: list[date]            # ascending, matches the column order
    as_of: date
    universe_size: int           # names on the latest day before the liquidity gate
    passed_liquidity: int        # names after the liquidity gate
    min_price: float
    min_dollar_volume: float

    @property
    def n_days(self) -> int:
        return self.close.shape[1]

    @property
    def n_symbols(self) -> int:
        return self.close.shape[0]

    def has_spy(self) -> bool:
        return "SPY" in self.close.index


def load_panel(
    max_days: int = 260,
    min_price: float = 5.0,
    min_dollar_volume: float = 3_000_000.0,
    require_full_coverage: bool = False,
) -> Panel | None:
    """Build a Panel from the last up-to-`max_days` non-empty cached sessions.

    Applies a liquidity gate (price + dollar volume) on the latest day. When
    `require_full_coverage` is set, also drops any name with a gap in the window
    (needed for the factor model, whose windows must be complete); the edge
    engine leaves it off and handles NaNs per signal-day instead. SPY is always
    kept if present (benchmark for relative strength / baselines).

    Returns None if the cache is empty.
    """
    all_days = list_cached_days()
    if not all_days:
        return None

    closes: dict = {}
    highs: dict = {}
    lows: dict = {}
    vols: dict = {}
    used: list[date] = []
    for d in reversed(all_days):
        df = load_cached_day(d)
        if df is None or df.empty:
            continue
        closes[d] = df["close"]
        highs[d] = df["high"]
        lows[d] = df["low"]
        vols[d] = df["volume"]
        used.append(d)
        if len(used) >= max_days:
            break
    if not used:
        return None

    close = pd.DataFrame(closes).sort_index(axis=1)
    high = pd.DataFrame(highs).sort_index(axis=1)
    low = pd.DataFrame(lows).sort_index(axis=1)
    volume = pd.DataFrame(vols).sort_index(axis=1)
    dates = list(close.columns)
    as_of = dates[-1]

    latest_close = close[as_of]
    latest_vol = volume[as_of]
    universe_size = int(latest_close.notna().sum())

    dollar_vol = latest_close * latest_vol
    keep = (latest_close >= min_price) & (dollar_vol >= min_dollar_volume)
    keep = keep.fillna(False)
    if "SPY" in close.index:
        keep.loc["SPY"] = True  # always retain the benchmark
    symbols = keep[keep].index

    close = close.loc[symbols]
    high = high.loc[symbols]
    low = low.loc[symbols]
    volume = volume.loc[symbols]

    if require_full_coverage:
        full = close.notna().all(axis=1) & high.notna().all(axis=1) & \
            low.notna().all(axis=1) & volume.notna().all(axis=1)
        if "SPY" in close.index:
            full.loc["SPY"] = bool(close.loc["SPY"].notna().all())
        close = close[full]
        high = high[full]
        low = low[full]
        volume = volume[full]

    passed = int(len(close)) - (1 if ("SPY" in close.index and not (
        (latest_close.get("SPY", float("nan")) >= min_price)
        and (dollar_vol.get("SPY", float("nan")) >= min_dollar_volume)
    )) else 0)

    return Panel(
        close=close, high=high, low=low, volume=volume,
        dates=dates, as_of=as_of,
        universe_size=universe_size,
        passed_liquidity=max(passed, 0),
        min_price=min_price, min_dollar_volume=min_dollar_volume,
    )
