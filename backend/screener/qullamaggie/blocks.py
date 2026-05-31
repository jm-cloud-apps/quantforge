"""Tier-C: block trades + dark pool % analysis.

Block trades and off-exchange (dark pool) prints are the closest direct
measure of institutional activity available from a tick-level data feed.

  - **Block trade**: size ≥ 10,000 shares OR notional (size × price) ≥ $1M.
    Standard market-microstructure threshold for "institutional fill."
  - **Dark pool / off-exchange**: trades reported via FINRA TRF (Trade
    Reporting Facility) — `trf_id` is populated on the trade record. Funds
    route through ATSes and dark pools to hide their footprint from the lit
    tape; high dark-pool % during a green-day RVOL surge is a stealth-
    accumulation tell.

Because tick-level data is huge, we **sample** (max 100K trades per symbol
per day) and compute proportions, then cache the result on disk for 6 hours
keyed by (symbol, date). Same-session re-runs and next-day backfills are
both nearly free after the first call.
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import date as _date
from pathlib import Path

from market_clock import is_market_active_now
from .providers import get_provider

logger = logging.getLogger(__name__)

BLOCK_SIZE_THRESHOLD = 10_000      # shares
BLOCK_NOTIONAL_THRESHOLD = 1_000_000  # dollars

BACKEND_DIR = Path(__file__).resolve().parents[1]
CACHE_DIR = Path(os.getenv("QF_BLOCKS_CACHE_DIR", str(BACKEND_DIR / "data" / "blocks_cache")))
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_TTL_ACTIVE_SEC = 6 * 3600   # 6h during the trading day (today still settling)
CACHE_TTL_CLOSED_SEC = 36 * 3600  # 36h when market is closed — yesterday's trades are immutable


def _cache_path(symbol: str, date: str) -> Path:
    return CACHE_DIR / f"{symbol.upper()}_{date}.json"


def _read_cache(symbol: str, date: str) -> dict | None:
    p = _cache_path(symbol, date)
    if not p.exists():
        return None
    try:
        age = time.time() - p.stat().st_mtime
        ttl = CACHE_TTL_ACTIVE_SEC if is_market_active_now() else CACHE_TTL_CLOSED_SEC
        if age > ttl:
            return None
        return json.loads(p.read_text())
    except Exception:
        return None


def _write_cache(symbol: str, date: str, payload: dict) -> None:
    try:
        _cache_path(symbol, date).write_text(json.dumps(payload))
    except Exception:
        pass


def analyze_trades(trades: list[dict]) -> dict:
    """Compute block & dark-pool proportions from a trade sample.

    Returns:
      {
        "sample_size": int,            # trades inspected
        "total_volume": int,           # sum of size in sample
        "block_count": int,            # # of trades meeting block threshold
        "block_volume": int,           # sum of size in block trades
        "block_pct": float,            # block_volume / total_volume (0-1)
        "darkpool_volume": int,        # sum of size in off-exchange trades
        "darkpool_pct": float,         # darkpool_volume / total_volume (0-1)
        "darkpool_block_count": int,   # blocks AND off-exchange (gold signal)
        "darkpool_block_volume": int,
      }
    """
    if not trades:
        return {
            "sample_size": 0, "total_volume": 0,
            "block_count": 0, "block_volume": 0, "block_pct": 0.0,
            "darkpool_volume": 0, "darkpool_pct": 0.0,
            "darkpool_block_count": 0, "darkpool_block_volume": 0,
        }
    total_vol = 0
    block_count = 0
    block_vol = 0
    dark_vol = 0
    dark_block_count = 0
    dark_block_vol = 0
    for t in trades:
        size = int(t.get("size") or 0)
        if size <= 0:
            continue
        price = float(t.get("price") or 0)
        notional = size * price
        is_block = size >= BLOCK_SIZE_THRESHOLD or notional >= BLOCK_NOTIONAL_THRESHOLD
        is_dark = t.get("trf_id") is not None
        total_vol += size
        if is_block:
            block_count += 1
            block_vol += size
        if is_dark:
            dark_vol += size
        if is_block and is_dark:
            dark_block_count += 1
            dark_block_vol += size
    return {
        "sample_size": len(trades),
        "total_volume": total_vol,
        "block_count": block_count,
        "block_volume": block_vol,
        "block_pct": round(block_vol / total_vol, 4) if total_vol else 0.0,
        "darkpool_volume": dark_vol,
        "darkpool_pct": round(dark_vol / total_vol, 4) if total_vol else 0.0,
        "darkpool_block_count": dark_block_count,
        "darkpool_block_volume": dark_block_vol,
    }


def get_block_metrics(symbol: str, date: str | None = None) -> dict | None:
    """Fetch (with on-disk cache) the block/dark-pool metrics for a symbol.

    Returns analyze_trades(...) output, or None if the provider can't fetch.
    """
    d = date or _date.today().isoformat()
    cached = _read_cache(symbol, d)
    if cached:
        return cached

    provider = get_provider()
    if not hasattr(provider, "fetch_trades_sample"):
        return None
    # Let typed provider errors (NotEntitled, RateLimited) propagate — the
    # caller turns them into a single user-visible notice. Only swallow
    # transient/unknown failures.
    from .providers.base import NotEntitled, RateLimited
    try:
        trades = provider.fetch_trades_sample(symbol, date=d, max_pages=2, per_page=50000)
    except (NotEntitled, RateLimited):
        raise
    except Exception as e:
        logger.debug("trades sample failed for %s on %s: %s", symbol, d, e)
        return None
    metrics = analyze_trades(trades)
    metrics["date"] = d
    _write_cache(symbol, d, metrics)
    return metrics


def smart_money_label(metrics: dict) -> tuple[str, str]:
    """Classify the block/dark-pool signal into a human-readable badge.

    Returns (label, color_class) where label is short ('BLOCKS', 'DARK', etc.)
    and color_class is one of 'success' / 'warning' / 'neutral'.

    Heuristics (tuned for ~100K-trade sample):
      - 'BLOCKS': block_pct ≥ 20% (institutional accumulation visible)
      - 'DARK':   darkpool_pct ≥ 50% (heavy off-exchange routing)
      - 'STEALTH': dark_block_count ≥ 5 (large hidden fills — strongest tell)
      - else: None
    """
    if not metrics:
        return None, None
    if metrics.get("darkpool_block_count", 0) >= 5:
        return "STEALTH", "success"
    if metrics.get("darkpool_pct", 0) >= 0.50:
        return "DARK", "success"
    if metrics.get("block_pct", 0) >= 0.20:
        return "BLOCKS", "success"
    if metrics.get("block_pct", 0) >= 0.10:
        return "blocks", "warning"
    return None, None
