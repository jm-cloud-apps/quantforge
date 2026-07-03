"""FastAPI router for the Qullamaggie breakout screener."""

import logging
import time
from datetime import datetime

from fastapi import APIRouter, Query

from market_clock import effective_cache_ttl
from .cache import refresh_universe
from .enrich import (
    enrich_with_blocks,
    enrich_with_calendar,
    enrich_with_institutional_footprint,
    enrich_with_news,
    enrich_with_rsi,
    enrich_with_short_and_float,
)
from .providers import get_provider
from .providers.base import NotEntitled, RateLimited
from .scorer import rank_candidates, DEFAULT_MIN_ADR
from .snapshot import recent_developing, save_snapshot, snapshot_stats, symbol_history
from .universe import get_universe, wide_universe

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/screener/qullamaggie", tags=["screener-qullamaggie"])

# In-memory response cache, keyed by query signature. The full rank pipeline
# takes 10-30 seconds (universe-wide OHLCV refresh + scoring), so caching the
# response for ~10 minutes is a major UX win — repeat tab switches and reloads
# are instant. Set fresh=1 on the request to bypass.
#
# TTL is dynamic via market_clock.effective_cache_ttl:
#   • Active session (weekday, before 2pm PT, not a US holiday): 10 minutes
#   • Closed (weekend / holiday / after 2pm PT): 4 hours
# The underlying data doesn't change when the market isn't trading, so there's
# no UX benefit to a short cache TTL during off-hours.
_RESPONSE_CACHE: dict[str, tuple[float, dict]] = {}
_CACHE_TTL_SEC_ACTIVE = 600  # 10 minutes during regular session


@router.get("")
def get_breakouts(
    mode: str = Query("breakout", pattern="^(breakout|leaders|emerging|volume|unusual_volume)$"),
    limit: int = Query(20, ge=1, le=100),
    min_dollar_vol: float = Query(5_000_000, ge=0),
    min_adr: float = Query(DEFAULT_MIN_ADR, ge=0.0, le=1.0),
    min_rvol: float = Query(1.5, ge=1.0, le=20.0, description="Volume modes: minimum today/50d ratio"),
    day_filter: int = Query(0, ge=0, le=3, description="Unusual volume mode: 0=all, 1=Day 1, 2=Day 2, 3=Day 3+"),
    include_movers: bool = Query(False, description="Merge today's top gainers into universe"),
    enrich_news: bool = Query(True, description="Attach top headline + sentiment"),
    enrich_rsi: bool = Query(True, description="Attach 14-day RSI from Massive"),
    enrich_calendar: bool = Query(True, description="Attach upcoming earnings / ex-dividend dates"),
    enrich_blocks: bool = Query(False, description="Tier-C: tick-level block trades + dark-pool %. Expensive; cached 6h."),
    enrich_institutional: bool = Query(False, description="Tier-E: SEC Form 4 insider buys + 13-F institutional holdings."),
    wide: bool = Query(False, description="Wide universe (Unusual Volume only): every US stock with ≥$5M ADV instead of the curated ~250 list."),
    persist: bool = Query(True),
    fresh: bool = Query(False, description="Bypass the 10-minute response cache"),
):
    """Run the screener and return top `limit` ranked candidates."""
    cache_key = f"{mode}|{limit}|{min_dollar_vol}|{min_adr}|{min_rvol}|{day_filter}|{include_movers}|{enrich_news}|{enrich_rsi}|{enrich_calendar}|{enrich_blocks}|{enrich_institutional}|{wide}"
    ttl = effective_cache_ttl(_CACHE_TTL_SEC_ACTIVE)
    if not fresh:
        entry = _RESPONSE_CACHE.get(cache_key)
        if entry and (time.time() - entry[0]) < ttl:
            cached = dict(entry[1])
            cached["cached"] = True
            cached["cache_age_seconds"] = int(time.time() - entry[0])
            return cached

    started = datetime.now()
    universe_error = None
    use_wide = wide and mode == "unusual_volume"
    if use_wide:
        try:
            symbols = wide_universe(min_dollar_vol=min_dollar_vol)
            if not symbols:
                # Fall back if wide returned empty (e.g. provider unsupported)
                symbols = get_universe(include_movers=include_movers)
        except NotEntitled as e:
            universe_error = {
                "code": "grouped_not_entitled",
                "message": "Wide universe requires the Massive Daily Market Summary endpoint.",
                "hint": e.hint,
                "endpoint_name": e.endpoint_name,
            }
            symbols = get_universe(include_movers=include_movers)
        except RateLimited as e:
            universe_error = {"code": "rate_limited", "message": str(e), "hint": e.hint}
            symbols = get_universe(include_movers=include_movers)
    else:
        symbols = get_universe(include_movers=include_movers)
    logger.info(
        "Qullamaggie screener: %d symbols (wide=%s), mode=%s, min_adr=%.2f, movers=%s",
        len(symbols), use_wide, mode, min_adr, include_movers,
    )

    frames = refresh_universe(symbols)
    candidates = rank_candidates(
        frames, mode=mode, min_dollar_vol=min_dollar_vol, min_adr=min_adr,
        min_rvol=min_rvol, day_filter=day_filter,
    )

    top = candidates[:limit]

    # Per-candidate enrichments (only the slice returned).
    if enrich_news:
        try:
            enrich_with_news(top, top_n=limit)
        except Exception as e:
            logger.warning("news enrichment failed: %s", e)
    if enrich_rsi:
        try:
            enrich_with_rsi(top, top_n=limit)
        except Exception as e:
            logger.warning("rsi enrichment failed: %s", e)
    if enrich_calendar:
        try:
            enrich_with_calendar(top, top_n=limit)
        except Exception as e:
            logger.warning("calendar enrichment failed: %s", e)

    # Tier-B accumulation context (short volume + float) — only relevant for
    # volume-flavored modes where directionality of the surge matters.
    if mode in ("volume", "unusual_volume"):
        try:
            enrich_with_short_and_float(top, top_n=limit)
        except Exception as e:
            logger.warning("short/float enrichment failed: %s", e)

    # Tier-C block trades + dark-pool % (toggle, expensive even with cache).
    blocks_error = None
    if enrich_blocks and mode in ("volume", "unusual_volume"):
        try:
            blocks_error = enrich_with_blocks(top, top_n=min(limit, 8))
        except Exception as e:
            logger.warning("block-trades enrichment failed: %s", e)
            blocks_error = {
                "code": "upstream_error",
                "message": f"Smart Money fetch failed: {e}",
                "hint": "Check backend logs.",
            }

    # Tier-E SEC filings (Form 4 insider buys + 13-F institutional holdings).
    institutional_error = None
    if enrich_institutional and mode in ("volume", "unusual_volume"):
        try:
            institutional_error = enrich_with_institutional_footprint(top, top_n=min(limit, 8))
        except Exception as e:
            logger.warning("institutional enrichment failed: %s", e)
            institutional_error = {
                "code": "upstream_error",
                "message": f"Institutional footprint fetch failed: {e}",
                "hint": "Check backend logs.",
            }

    elapsed = (datetime.now() - started).total_seconds()
    logger.info(
        "Qullamaggie screener: %d candidates from %d symbols in %.1fs",
        len(candidates), len(symbols), elapsed,
    )

    if persist and top:
        try:
            save_snapshot(mode, top)
        except Exception as e:
            logger.warning("snapshot save failed: %s", e)

    response = {
        "mode": mode,
        "universe_size": len(symbols),
        "scored": len(candidates),
        "elapsed_seconds": round(elapsed, 1),
        "as_of": datetime.now().isoformat(timespec="seconds"),
        "min_adr": min_adr,
        "min_rvol": min_rvol,
        "day_filter": day_filter,
        "include_movers": include_movers,
        "blocks_error": blocks_error,
        "institutional_error": institutional_error,
        "wide": use_wide,
        "universe_error": universe_error,
        "results": top,
        "cached": False,
        "cache_age_seconds": 0,
    }
    _RESPONSE_CACHE[cache_key] = (time.time(), response)
    return response


@router.get("/universe")
def get_universe_endpoint(include_movers: bool = False):
    symbols = get_universe(include_movers=include_movers)
    return {"size": len(symbols), "symbols": symbols, "include_movers": include_movers}


@router.get("/history/recent-developing")
def history_recent_developing(days: int = Query(30, ge=1, le=180)):
    return {"days": days, "results": recent_developing(days)}


@router.get("/history/{symbol}")
def history_for_symbol(symbol: str, days: int = Query(60, ge=1, le=365)):
    return {"symbol": symbol.upper(), "days": days, "history": symbol_history(symbol, days)}


@router.get("/snapshot/stats")
def get_snapshot_stats():
    return snapshot_stats()


@router.get("/intraday/{symbol}")
def get_intraday(symbol: str, days_back: int = Query(2, ge=1, le=5)):
    """Pull 5-minute bars for entry-timing on READY candidates."""
    provider = get_provider()
    if not hasattr(provider, "fetch_intraday"):
        return {"symbol": symbol.upper(), "bars": [], "error": "Provider doesn't support intraday"}
    bars = provider.fetch_intraday(symbol, days_back=days_back)
    return {
        "symbol": symbol.upper(),
        "days_back": days_back,
        "bar_count": len(bars),
        "bars": bars,
    }
