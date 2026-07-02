"""Incremental OHLCV cache for the Qullamaggie screener.

Data source is provider-abstracted (see providers/). Set QF_DATA_PROVIDER to
switch between 'massive' (paid, reliable) and 'yahoo' (free, flaky).

Cold cache for the full ~250-symbol universe takes a couple of minutes on
Massive's API. Once warm, daily refreshes only fetch incremental tail bars
and are quick.
"""

import logging
import os
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable

import pandas as pd

from market_clock import is_market_active_now
from .providers import get_provider
from .providers.base import OHLCV_COLS

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]
CACHE_DIR = Path(os.getenv("QF_OHLCV_CACHE_DIR", str(BACKEND_DIR / "data" / "ohlcv_cache")))
CACHE_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_LOOKBACK_DAYS = 430

# Short-lived in-process memo of built universe frames, keyed by the exact
# (symbols, lookback, freshness-window) request. Even when the on-disk OHLCV
# cache is warm, refresh_universe still re-reads ~250 pickles off disk on every
# call. The dashboard fires three screener modes (volume / breakout /
# unusual_volume) back-to-back against the *same* curated universe, so without
# this each one rebuilds the identical frames dict. Memoizing collapses that to
# a single build; the other two modes reuse it.
#
# TTL is deliberately short — it only needs to span a burst of sibling requests,
# not serve stale data. The returned dict is always a shallow copy so a caller
# reassigning frames[sym] can't corrupt the shared entry (the DataFrames
# themselves are treated read-only downstream).
_UNIVERSE_MEMO: dict[tuple, tuple[float, dict[str, pd.DataFrame]]] = {}
_UNIVERSE_MEMO_LOCK = threading.Lock()
_UNIVERSE_MEMO_TTL = 120.0  # seconds

# Single-flight build locks, one per memo key. The screener endpoints run in
# FastAPI's threadpool, so the dashboard's three modes arrive concurrently and
# would otherwise all miss a cold memo and each run the full (potentially
# minutes-long) build. With these locks, the first request builds while the
# rest block on the same key, then find the memo warm and return immediately.
_UNIVERSE_BUILD_LOCKS: dict[tuple, threading.Lock] = {}


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
    max_age_hours: float | None = None,
    use_memo: bool = True,
) -> dict[str, pd.DataFrame]:
    """Refresh cached OHLCV per-symbol. Returns dict of merged frames.

    Skips re-fetching when the cache already contains a bar for the latest
    trading day AND the file is younger than `max_age_hours`. Saves the
    provider singleton across the loop so we reuse one HTTP session.

    Identical calls within a short window return a memoized result (see
    `_UNIVERSE_MEMO`), and concurrent identical calls are single-flighted —
    so sibling requests like the dashboard's three screener modes over the
    same universe share one build instead of racing three. Pass
    `use_memo=False` to force a fresh, un-shared build.
    """
    symbols = sorted({s.upper() for s in symbols})
    if not symbols:
        return {}

    # When market is closed, OHLCV doesn't change — extend the freshness window
    # so weekend / holiday / overnight runs skip re-fetching entirely.
    if max_age_hours is None:
        max_age_hours = 18.0 if is_market_active_now() else 96.0

    if not use_memo:
        return _build_universe(symbols, lookback_days, max_age_hours)

    memo_key = (tuple(symbols), lookback_days, max_age_hours)

    # Fast path: fresh memo entry.
    with _UNIVERSE_MEMO_LOCK:
        hit = _UNIVERSE_MEMO.get(memo_key)
        if hit is not None and (time.monotonic() - hit[0]) < _UNIVERSE_MEMO_TTL:
            logger.info(
                "refresh_universe memo hit: %d symbols (age %.0fs)",
                len(symbols), time.monotonic() - hit[0],
            )
            return dict(hit[1])  # shallow copy — callers must not mutate the shared entry
        build_lock = _UNIVERSE_BUILD_LOCKS.setdefault(memo_key, threading.Lock())

    # Single-flight: first request in builds, the rest queue on the lock and
    # find the memo warm on re-check instead of duplicating the build.
    with build_lock:
        with _UNIVERSE_MEMO_LOCK:
            hit = _UNIVERSE_MEMO.get(memo_key)
            if hit is not None and (time.monotonic() - hit[0]) < _UNIVERSE_MEMO_TTL:
                logger.info(
                    "refresh_universe single-flight: reusing concurrent build (%d symbols)",
                    len(symbols),
                )
                return dict(hit[1])

        frames = _build_universe(symbols, lookback_days, max_age_hours)

        now = time.monotonic()
        with _UNIVERSE_MEMO_LOCK:
            # Drop expired entries so the memo can't accumulate stale universe
            # sets (each holds ~250 DataFrames) across differing symbol lists.
            # Pruning a build lock another thread still holds is harmless: the
            # worst case is one duplicate build, and the memo store is
            # lock-protected (last writer wins).
            for k in [k for k, (ts, _) in _UNIVERSE_MEMO.items() if (now - ts) >= _UNIVERSE_MEMO_TTL]:
                del _UNIVERSE_MEMO[k]
                _UNIVERSE_BUILD_LOCKS.pop(k, None)
            _UNIVERSE_MEMO[memo_key] = (now, frames)
        return dict(frames)  # shallow copy so the caller can't mutate the memoized dict


def _build_universe(
    symbols: list[str],
    lookback_days: int,
    max_age_hours: float,
) -> dict[str, pd.DataFrame]:
    """The actual per-symbol refresh loop. `symbols` must be pre-normalized."""
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
