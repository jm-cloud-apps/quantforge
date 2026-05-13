"""Incremental OHLCV cache for the Qullamaggie screener.

Data source is provider-abstracted (see providers/). Set QF_DATA_PROVIDER to
switch between 'massive' (paid, reliable) and 'yahoo' (free, flaky).

Cold cache for the full ~250-symbol universe takes a couple of minutes on
Massive's API. Once warm, daily refreshes only fetch incremental tail bars
and are quick.
"""

import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable

import pandas as pd

from .providers import get_provider
from .providers.base import OHLCV_COLS

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]
CACHE_DIR = Path(os.getenv("QF_OHLCV_CACHE_DIR", str(BACKEND_DIR / "data" / "ohlcv_cache")))
CACHE_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_LOOKBACK_DAYS = 430


def _cache_path(symbol: str) -> Path:
    return CACHE_DIR / f"{symbol.upper()}.pkl"


def load_cached(symbol: str) -> pd.DataFrame | None:
    p = _cache_path(symbol)
    if not p.exists():
        return None
    try:
        df = pd.read_pickle(p)
        df.index = pd.to_datetime(df.index)
        return df
    except Exception as e:
        logger.warning("Failed to read cache for %s: %s", symbol, e)
        return None


def save_cached(symbol: str, df: pd.DataFrame) -> None:
    if df is None or df.empty:
        return
    df = df[~df.index.duplicated(keep="last")].sort_index()
    df.to_pickle(_cache_path(symbol))


def fetch_one(symbol: str, lookback_days: int = DEFAULT_LOOKBACK_DAYS) -> pd.DataFrame | None:
    """Fetch OHLCV for one symbol via the configured provider."""
    provider = get_provider()
    return provider.fetch(symbol, lookback_days)


def refresh_universe(
    symbols: Iterable[str],
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    max_age_hours: float = 18.0,
) -> dict[str, pd.DataFrame]:
    """Refresh cached OHLCV per-symbol. Returns dict of merged frames.

    Skips re-fetching when the cache already contains a bar for the latest
    trading day AND the file is younger than `max_age_hours`. Saves the
    provider singleton across the loop so we reuse one HTTP session.
    """
    symbols = sorted({s.upper() for s in symbols})
    if not symbols:
        return {}

    provider = get_provider()
    today = datetime.now().date()
    target_day = today
    if today.weekday() == 5:
        target_day = today - timedelta(days=1)
    elif today.weekday() == 6:
        target_day = today - timedelta(days=2)

    fetched = skipped = failed = 0
    frames: dict[str, pd.DataFrame] = {}

    for i, sym in enumerate(symbols, 1):
        cached = load_cached(sym)
        if cached is not None and not cached.empty:
            last_bar = cached.index.max().date()
            age_h = (datetime.now() - datetime.fromtimestamp(_cache_path(sym).stat().st_mtime)).total_seconds() / 3600
            if last_bar >= target_day and age_h < max_age_hours:
                frames[sym] = cached
                skipped += 1
                continue

        fresh = provider.fetch(sym, lookback_days)
        if fresh is None or fresh.empty:
            failed += 1
            if cached is not None:
                frames[sym] = cached  # use stale rather than nothing
            continue
        if cached is not None and not cached.empty:
            merged = pd.concat([cached, fresh])
            merged = merged[~merged.index.duplicated(keep="last")].sort_index()
        else:
            merged = fresh
        save_cached(sym, merged)
        frames[sym] = merged
        fetched += 1

        if i % 25 == 0:
            logger.info(
                "refresh_universe progress: %d/%d (fetched=%d skipped=%d failed=%d)",
                i, len(symbols), fetched, skipped, failed,
            )

    try:
        provider.close()
    except Exception:
        pass

    logger.info(
        "refresh_universe done: fetched=%d skipped=%d failed=%d total=%d",
        fetched, skipped, failed, len(symbols),
    )
    return frames
