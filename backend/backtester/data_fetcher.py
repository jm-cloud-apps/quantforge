"""Fetch historical OHLCV data from Yahoo Finance.

Uses yfinance with a retry loop and a `period=` fast path. Yahoo Finance
has gotten progressively more aggressive about rate-limiting / anti-bot
checks, and yfinance's `Ticker.history()` with explicit `start`/`end`
fails more often than the `period=` form. We try `period=` first (mapped
from the requested date range) and fall back to `start`/`end` if needed,
each with up to three attempts and a short backoff.
"""

import logging
import time
import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


def _range_to_period(start_date: str, end_date: str) -> str:
    """Map a (start, end) range to the nearest yfinance `period=` string.

    yfinance accepts: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max.
    We pick the smallest period that comfortably covers the requested span,
    since `period=` requests pull from a different code path that is far
    more reliable against Yahoo's rate-limiting than explicit date ranges.
    """
    try:
        s = datetime.strptime(start_date, "%Y-%m-%d")
        e = datetime.strptime(end_date, "%Y-%m-%d")
        days = max((e - s).days, 1)
    except Exception:
        return "1y"
    if days <= 5:    return "5d"
    if days <= 31:   return "1mo"
    if days <= 93:   return "3mo"
    if days <= 186:  return "6mo"
    if days <= 366:  return "1y"
    if days <= 732:  return "2y"
    return "5y"


def _normalize(df: pd.DataFrame) -> pd.DataFrame:
    """Reset index, lower-case OHLCV columns, expose `date` as YYYY-MM-DD."""
    df = df.reset_index()
    df.columns = [c.replace(' ', '_') for c in df.columns]
    column_map = {
        'Open': 'open', 'High': 'high', 'Low': 'low',
        'Close': 'close', 'Volume': 'volume',
    }
    df = df.rename(columns={k: v for k, v in column_map.items() if k in df.columns})
    if 'Date' in df.columns:
        df['date'] = pd.to_datetime(df['Date']).dt.strftime('%Y-%m-%d')
    elif 'Datetime' in df.columns:
        df['date'] = pd.to_datetime(df['Datetime']).dt.strftime('%Y-%m-%d')
    return df[['date', 'open', 'high', 'low', 'close', 'volume']].copy()


def fetch_ohlcv(symbol: str, start_date: str, end_date: str) -> pd.DataFrame | None:
    """Fetch OHLCV data for a symbol with retries.

    Args:
        symbol: Stock ticker (e.g., AAPL, MSFT)
        start_date: Start date (YYYY-MM-DD)
        end_date:   End date (YYYY-MM-DD)

    Returns:
        DataFrame with columns: date, open, high, low, close, volume.
        None if every attempt failed.
    """
    period = _range_to_period(start_date, end_date)
    ticker = yf.Ticker(symbol)

    attempts = [
        # Try the reliable form first.
        ("period", lambda: ticker.history(period=period, auto_adjust=True)),
        # Fall back to explicit dates (the original code path).
        ("range", lambda: ticker.history(start=start_date, end=end_date, auto_adjust=True)),
    ]

    last_error: Exception | None = None
    for mode, call in attempts:
        for attempt in range(1, 4):
            try:
                df = call()
                if df is not None and not df.empty and len(df) >= 2:
                    return _normalize(df)
                logger.warning(
                    "fetch_ohlcv(%s) %s attempt %d: empty/short (rows=%s)",
                    symbol, mode, attempt,
                    0 if df is None or df.empty else len(df),
                )
            except Exception as e:
                last_error = e
                logger.warning(
                    "fetch_ohlcv(%s) %s attempt %d: %s: %s",
                    symbol, mode, attempt, type(e).__name__, e,
                )
            # Small backoff between attempts to dodge rate-limit windows.
            time.sleep(0.4 * attempt)

    logger.error(
        "fetch_ohlcv(%s) exhausted: start=%s end=%s last_error=%s",
        symbol, start_date, end_date, last_error,
    )
    return None
