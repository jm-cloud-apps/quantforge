"""Stockbee-style market-breadth scanner.

Computes 4% up/down, 25% qtr/mo +/-, 50% mo+, T2108, and 5d/10d ratios
across the active US common-stock universe. Data is pulled from the
Polygon-shaped Massive API via a one-call-per-day grouped daily aggregate,
cached on disk per trading day, then fanned out into per-symbol time series
in memory at compute time.

Public surface lives in `routes` for FastAPI registration. Everything else
is internal.
"""

from .calculator import compute_snapshot, compute_history
from .cache import refresh_grouped_cache, list_cached_days
from .regime import classify
from . import sa_history
from .regime_backtest import run as run_regime_backtest
from .situational import assess as assess_situational, compact_record as sa_compact_record
from .verify import recount_4pct
from .universe import load_universe, load_or_refresh_universe, refresh_universe

__all__ = [
    "compute_snapshot",
    "compute_history",
    "refresh_grouped_cache",
    "list_cached_days",
    "classify",
    "assess_situational",
    "sa_compact_record",
    "sa_history",
    "run_regime_backtest",
    "recount_4pct",
    "load_universe",
    "load_or_refresh_universe",
    "refresh_universe",
]
