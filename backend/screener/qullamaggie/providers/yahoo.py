"""yfinance OHLCV provider — used as a free fallback when paid providers aren't available.

Yahoo aggressively rate-limits and bot-blocks; this is best-effort.
"""

from __future__ import annotations

import logging
import time

import pandas as pd
import yfinance as yf

from .base import OHLCV_COLS

logger = logging.getLogger(__name__)

_PERIOD_BY_DAYS = [
    (31, "1mo"), (93, "3mo"), (186, "6mo"),
    (366, "1y"), (732, "2y"), (1825, "5y"),
]


def _period_for(days: int) -> str:
    for threshold, name in _PERIOD_BY_DAYS:
        if days <= threshold:
            return name
    return "max"


class YahooProvider:
    name = "yahoo"

    def fetch(self, symbol: str, lookback_days: int) -> pd.DataFrame | None:
        period = _period_for(lookback_days)
        ticker = yf.Ticker(symbol)
        for attempt in range(1, 3):
            try:
                df = ticker.history(period=period, auto_adjust=True)
                if df is None or df.empty or len(df) < 5:
                    time.sleep(0.3 * attempt)
                    continue
                df = df.rename(columns={c: c.lower() for c in df.columns})
                cols = [c for c in OHLCV_COLS if c in df.columns]
                df = df[cols]
                df.index = pd.to_datetime(df.index)
                if df.index.tz is not None:
                    df.index = df.index.tz_localize(None)
                return df.dropna(how="all")
            except Exception as e:
                logger.debug("yahoo: error for %s: %s", symbol, e)
                time.sleep(0.3 * attempt)
        return None

    def close(self) -> None:
        pass
