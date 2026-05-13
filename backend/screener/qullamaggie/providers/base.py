"""Provider abstraction for OHLCV data sources.

Each provider implements fetch(symbol, lookback_days) -> DataFrame indexed by
date with columns [open, high, low, close, volume]. Return None on failure
so the caller can fall back.

To add a new provider: create a sibling module with a Provider subclass and
register it in providers/__init__.py REGISTRY.
"""

from __future__ import annotations

from typing import Protocol

import pandas as pd

OHLCV_COLS = ["open", "high", "low", "close", "volume"]


class Provider(Protocol):
    name: str

    def fetch(self, symbol: str, lookback_days: int) -> pd.DataFrame | None:
        """Return a DateTimeIndex'd OHLCV DataFrame, or None on failure."""
        ...
