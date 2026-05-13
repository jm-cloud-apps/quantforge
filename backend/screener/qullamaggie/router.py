"""FastAPI router for the Qullamaggie breakout screener."""

import logging
from datetime import datetime

from fastapi import APIRouter, Query

from .cache import refresh_universe
from .enrich import enrich_with_calendar, enrich_with_news, enrich_with_rsi
from .providers import get_provider
from .scorer import rank_candidates, DEFAULT_MIN_ADR
from .snapshot import recent_developing, save_snapshot, snapshot_stats, symbol_history
from .universe import get_universe

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/screener/qullamaggie", tags=["screener-qullamaggie"])


@router.get("")
async def get_breakouts(
    mode: str = Query("breakout", pattern="^(breakout|leaders|emerging)$"),
    limit: int = Query(20, ge=1, le=100),
    min_dollar_vol: float = Query(5_000_000, ge=0),
    min_adr: float = Query(DEFAULT_MIN_ADR, ge=0.0, le=1.0),
    include_movers: bool = Query(False, description="Merge today's top gainers into universe"),
    enrich_news: bool = Query(True, description="Attach top headline + sentiment"),
    enrich_rsi: bool = Query(True, description="Attach 14-day RSI from Massive"),
    enrich_calendar: bool = Query(True, description="Attach upcoming earnings / ex-dividend dates"),
    persist: bool = Query(True),
):
    """Run the screener and return top `limit` ranked candidates."""
    started = datetime.now()
    symbols = get_universe(include_movers=include_movers)
    logger.info(
        "Qullamaggie screener: %d symbols, mode=%s, min_adr=%.2f, movers=%s",
        len(symbols), mode, min_adr, include_movers,
    )

    frames = refresh_universe(symbols)
    candidates = rank_candidates(
        frames, mode=mode, min_dollar_vol=min_dollar_vol, min_adr=min_adr,
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

    return {
        "mode": mode,
        "universe_size": len(symbols),
        "scored": len(candidates),
        "elapsed_seconds": round(elapsed, 1),
        "as_of": datetime.now().isoformat(timespec="seconds"),
        "min_adr": min_adr,
        "include_movers": include_movers,
        "results": top,
    }


@router.get("/universe")
async def get_universe_endpoint(include_movers: bool = False):
    symbols = get_universe(include_movers=include_movers)
    return {"size": len(symbols), "symbols": symbols, "include_movers": include_movers}


@router.get("/history/recent-developing")
async def history_recent_developing(days: int = Query(30, ge=1, le=180)):
    return {"days": days, "results": recent_developing(days)}


@router.get("/history/{symbol}")
async def history_for_symbol(symbol: str, days: int = Query(60, ge=1, le=365)):
    return {"symbol": symbol.upper(), "days": days, "history": symbol_history(symbol, days)}


@router.get("/snapshot/stats")
async def get_snapshot_stats():
    return snapshot_stats()


@router.get("/intraday/{symbol}")
async def get_intraday(symbol: str, days_back: int = Query(2, ge=1, le=5)):
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
