"""FastAPI backend for stock backtesting application."""

import os
import json
import logging
import math
import re
import sys
import threading
import time
from datetime import datetime, timedelta
import pandas as pd
import numpy as np
import httpx
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query, Body
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel
from typing import Optional, List
import io
from dotenv import load_dotenv

import yfinance as yf

from backtester import BacktestEngine, fetch_ohlcv, get_available_strategies
from backtester.breakout_engine import run_breakout_backtest

# Load .env from the backend directory first (where the file template lives),
# then fall back to the project-root .env. Either location works without the
# user needing to remember which one.
_HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_HERE, ".env"))
load_dotenv(os.path.join(os.path.dirname(_HERE), ".env"), override=False)

# ---------------------------------------------------------------------------
# Logging
#
# The app and its routers are full of `logger.info(...)` progress lines (e.g.
# the screener logs "refresh_universe progress: 50/250 ..." every 25 symbols
# plus per-scan timing). None of it was ever visible because logging was never
# configured — under uvicorn the root logger has no INFO handler, so every
# INFO record was silently dropped. Configuring it here lights all of that up
# in the terminal you launched the app from, which is the only way to tell
# what a slow dashboard load is actually waiting on.
#
# Level is INFO by default; set QF_LOG_LEVEL=DEBUG for the chattier per-symbol
# enrichment lines, or WARNING to quiet things back down.
# ---------------------------------------------------------------------------
def _configure_logging() -> logging.Logger:
    level_name = os.getenv("QF_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    root = logging.getLogger()
    root.setLevel(level)

    # Guard against duplicate handlers: uvicorn's --reload reimports this module
    # in the same process, which would otherwise stack a new handler each time
    # and print every line N times.
    if not any(getattr(h, "_qf_handler", False) for h in root.handlers):
        handler = logging.StreamHandler(sys.stdout)
        handler._qf_handler = True  # tag so the guard above can find it
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)-7s %(name)s | %(message)s",
                datefmt="%H:%M:%S",
            )
        )
        root.addHandler(handler)

    # Third-party libraries are noisy at INFO/DEBUG — keep them at WARNING so the
    # signal stays our own progress lines, not HTTP plumbing.
    for noisy in ("httpx", "httpcore", "urllib3", "yfinance", "peewee", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    return logging.getLogger("quantforge")


logger = _configure_logging()

# One-shot startup log so it's easy to see which providers are wired.
logger.info(
    "[startup] MASSIVE_API_KEY=%s FINNHUB_API_KEY=%s QF_DATA_PROVIDER=%s QF_NEWS_PROVIDER=%s",
    "set" if os.getenv("MASSIVE_API_KEY") else "MISSING",
    "set" if os.getenv("FINNHUB_API_KEY") else "missing",
    os.getenv("QF_DATA_PROVIDER", "massive"),
    os.getenv("QF_NEWS_PROVIDER", "massive"),
)

# In-memory cache for trading analysis data
# _trades_cache moved to trading_analysis_router.py (imported near app setup).

# Shared, thread-safe HTTP client for the ad-hoc provider calls in this module
# (per-symbol Finnhub earnings/news/quote/profile/metric enrichment). Several
# of these fire back-to-back against the same host, so reusing pooled TCP+TLS
# connections avoids a fresh handshake on every call.
_http_client = httpx.Client(
    timeout=15,
    limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
)


app = FastAPI(
    title="QuantForge API",
    description="API for backtesting, trading analysis, and automated trading",
    version="1.0.0",
)

# Register broker router (Interactive Brokers integration)
try:
    from broker.router import router as broker_router
    app.include_router(broker_router)
except ImportError:
    pass  # ib_insync not installed — broker endpoints will be unavailable

# Register trade log formatter router
from formatter.router import router as formatter_router
app.include_router(formatter_router)

# Register stock advisor router
from advisor.router import router as advisor_router
app.include_router(advisor_router)

# Register Qullamaggie breakout screener router
from screener.qullamaggie.router import router as qullamaggie_router
app.include_router(qullamaggie_router)

# Find-Setups scanner endpoints (extracted from main.py). The functions are also
# imported by name because the Setups Board aggregator calls them in-process to
# reuse their warm caches.
from scanners_router import (
    router as scanners_router,
    get_9m_scan,
    get_stage_scan,
    get_reversal_scan,
    get_ma_reclaim_scan,
)
app.include_router(scanners_router)

# Shared file-endpoint guard (used by the upload endpoints that remain in main.py).
from security import _enforce_upload_limit

# Trade Journal + Playbook CRUD routers (extracted from main.py). `_load_journal`
# is imported because a trade-analytics endpoint here merges journal data.
from journal_router import router as journal_router, _load_journal
from playbook_router import router as playbook_router
app.include_router(journal_router)
app.include_router(playbook_router)

# Pure trade-workbook parsing + metrics (the scale-out formula eval, the
# closed-trade normalizer, the metrics). The review-notes overlay that wraps these
# stays in main.py.
from trade_data import read_trades_excel, normalize_trade_data, calculate_trade_metrics

# Trading-analysis router (the trade-log analytics). `_trades_cache` is imported
# because main.py's calendar / weekly-review endpoints reuse the loaded trades.
from trading_analysis_router import router as trading_analysis_router, _trades_cache
app.include_router(trading_analysis_router)

from ai_trader.router import router as ai_trader_router
app.include_router(ai_trader_router)

from theme_radar.router import router as theme_radar_router
app.include_router(theme_radar_router)

# Register Options Flow router (Tier-D — Unusual Whales-style)
from options_flow.router import router as options_flow_router
app.include_router(options_flow_router)

from watchlists import router as watchlists_router
app.include_router(watchlists_router)

from daily_journal import router as daily_journal_router
app.include_router(daily_journal_router)

from calendar_router import router as calendar_router
app.include_router(calendar_router)

from movers_router import router as movers_router
app.include_router(movers_router)

from review_notes_router import router as review_notes_router, merge_review_notes_into_trades
app.include_router(review_notes_router)

from wealthsimple_router import router as wealthsimple_router
app.include_router(wealthsimple_router)

from trade_plans_router import router as trade_plans_router
app.include_router(trade_plans_router)

# Sector-rotation intelligence (internals / RRG / leaders) — computes from the
# breadth grouped cache + a cached symbol→sector map, so it's API-free once warm
from sector_rotation.router import router as sector_rotation_router
app.include_router(sector_rotation_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class _SelectiveGZipMiddleware(GZipMiddleware):
    """GZipMiddleware that leaves Server-Sent Events uncompressed.

    Most endpoints return JSON that compresses well (breadth, screener,
    movers, news payloads are the fat ones), and over a remote/tunnelled
    connection gzip is the cheapest latency win available. The catch:
    Starlette's gzip buffers streaming bodies, which would stall the
    real-time progress events the formatter emits over text/event-stream.
    The formatter routes are the only SSE endpoints, so we bypass gzip for
    that prefix and compress everything else.
    """

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope.get("path", "").startswith("/api/formatter/"):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


# Compress API responses (skips SSE — see class docstring). minimum_size avoids
# spending CPU on tiny payloads where the gzip header would outweigh the win.
app.add_middleware(_SelectiveGZipMiddleware, minimum_size=1024)


# Request timing — logs each API call as it arrives and again when it finishes,
# with the wall-clock duration. The dashboard fires ~13 of these in parallel on
# load; watching them stream in (and which one sits there for 8s) is the
# fastest way to see where a slow "Market Overview" is actually spending time.
# Slow responses (>3s) are flagged with a marker so they're easy to scan for.
@app.middleware("http")
async def log_requests(request, call_next):
    path = request.url.path
    # CORS preflight and non-API noise add nothing — skip arrival logging.
    is_api = path.startswith("/api") and request.method != "OPTIONS"
    start = time.perf_counter()
    if is_api:
        logger.info("→ %s %s", request.method, path)
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.exception("✗ %s %s failed after %.0fms", request.method, path, elapsed_ms)
        raise
    elapsed_ms = (time.perf_counter() - start) * 1000
    if is_api:
        marker = " ⏳ SLOW" if elapsed_ms > 3000 else ""
        logger.info(
            "✓ %s %s → %s in %.0fms%s",
            request.method, path, response.status_code, elapsed_ms, marker,
        )
    return response


# ──────────────────────────────────────────────────────────────────────
# Upload / file-serving safety helpers
#
# QuantForge binds to localhost and serves a single user, so the threat
# model is narrow — but uploaded files and path parameters are the two
# places untrusted bytes reach the filesystem. We cap upload size (so a
# stray multi-GB body can't OOM the process) and contain any served path
# to its intended directory (defense-in-depth against path traversal).
# See SECURITY.md for the full threat model.
# ──────────────────────────────────────────────────────────────────────

# Upload-size + path-traversal guards moved to security.py (shared with routers);
# imported near app setup above as `_enforce_upload_limit`.


class BacktestRequest(BaseModel):
    symbol: str
    strategy_id: str
    start_date: str
    end_date: str
    initial_capital: float = 100_000
    params: Optional[dict] = None


class MultiBacktestRequest(BaseModel):
    symbols: list[str]
    strategy_id: str
    start_date: str
    end_date: str
    initial_capital: float = 100_000
    params: Optional[dict] = None


class BreakoutBacktestRequest(BaseModel):
    """Ticker + allocation. E.g. [{"symbol": "AAPL", "allocation_pct": 100}] or [{"symbol": "AAPL", "allocation_pct": 60}, {"symbol": "MSFT", "allocation_pct": 40}]"""
    holdings: list[dict]  # [{"symbol": "AAPL", "allocation_pct": 100}]
    start_date: str
    end_date: str
    initial_capital: float = 100_000
    risk_pct: float = 1.0
    max_position_pct: float = 25.0


@app.get("/api/strategies")
def list_strategies():
    """Return available backtesting strategies."""
    return get_available_strategies()


@app.post("/api/backtest/run")
def run_backtest(request: BacktestRequest):
    """Run a single backtest."""
    try:
        engine = BacktestEngine(initial_capital=request.initial_capital)
        result = engine.run(
            symbol=request.symbol,
            strategy_id=request.strategy_id,
            start_date=request.start_date,
            end_date=request.end_date,
            params=request.params,
        )
        return {
            "symbol": result.symbol,
            "strategy_id": result.strategy_id,
            "start_date": result.start_date,
            "end_date": result.end_date,
            "initial_capital": result.initial_capital,
            "final_value": result.final_value,
            "total_return_pct": result.total_return_pct,
            "cagr": result.cagr,
            "sharpe_ratio": result.sharpe_ratio,
            "max_drawdown_pct": result.max_drawdown_pct,
            "total_trades": result.total_trades,
            "winning_trades": result.winning_trades,
            "losing_trades": result.losing_trades,
            "win_rate_pct": result.win_rate_pct,
            "avg_win_pct": result.avg_win_pct,
            "avg_loss_pct": result.avg_loss_pct,
            "profit_factor": result.profit_factor,
            "equity_curve": result.equity_curve,
            "trades": result.trades,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backtest failed: {str(e)}")


@app.post("/api/backtest/run-multi")
def run_multi_backtest(request: MultiBacktestRequest):
    """Run backtests for multiple symbols and aggregate results."""
    results = []
    engine = BacktestEngine(initial_capital=request.initial_capital)

    for symbol in request.symbols:
        try:
            result = engine.run(
                symbol=symbol.strip().upper(),
                strategy_id=request.strategy_id,
                start_date=request.start_date,
                end_date=request.end_date,
                params=request.params,
            )
            results.append({
                "symbol": result.symbol,
                "strategy_id": result.strategy_id,
                "start_date": result.start_date,
                "end_date": result.end_date,
                "initial_capital": result.initial_capital,
                "final_value": result.final_value,
                "total_return_pct": result.total_return_pct,
                "cagr": result.cagr,
                "sharpe_ratio": result.sharpe_ratio,
                "max_drawdown_pct": result.max_drawdown_pct,
                "total_trades": result.total_trades,
                "winning_trades": result.winning_trades,
                "losing_trades": result.losing_trades,
                "win_rate_pct": result.win_rate_pct,
                "avg_win_pct": result.avg_win_pct,
                "avg_loss_pct": result.avg_loss_pct,
                "profit_factor": result.profit_factor,
                "equity_curve": result.equity_curve,
                "trades": result.trades,
            })
        except Exception as e:
            results.append({
                "symbol": symbol,
                "error": str(e),
                "total_trades": 0,
                "equity_curve": [],
                "trades": [],
            })

    # Aggregate metrics across symbols
    successful = [r for r in results if "error" not in r]
    if successful:
        avg_return = sum(r["total_return_pct"] for r in successful) / len(successful)
        total_trades = sum(r["total_trades"] for r in successful)
        wins = sum(r["winning_trades"] for r in successful)
        losses = sum(r["losing_trades"] for r in successful)
        win_rate = (wins / total_trades * 100) if total_trades > 0 else 0
    else:
        avg_return = 0
        total_trades = 0
        win_rate = 0

    return {
        "results": results,
        "aggregate": {
            "symbols_run": len(results),
            "successful": len(successful),
            "failed": len(results) - len(successful),
            "avg_return_pct": round(avg_return, 2) if successful else 0,
            "total_trades": total_trades,
            "win_rate_pct": round(win_rate, 1),
        },
    }


@app.post("/api/backtest/breakout")
def run_breakout_backtest_endpoint(request: BreakoutBacktestRequest):
    """
    Run previous day breakout strategy.
    Rules: Buy when price > prev day high, sell when price < prev day low.
    Risk 1% per trade, max 25% in any position.
    """
    if not request.holdings:
        raise HTTPException(status_code=400, detail="At least one holding required")
    
    total_pct = sum(h.get("allocation_pct", 0) for h in request.holdings)
    if abs(total_pct - 100) > 0.1:
        raise HTTPException(status_code=400, detail="Allocation percentages must sum to 100")

    results = []
    equity_curves = []

    for h in request.holdings:
        symbol = str(h.get("symbol", "")).strip().upper()
        alloc_pct = float(h.get("allocation_pct", 0))
        alloc_capital = request.initial_capital * (alloc_pct / 100)

        try:
            r = run_breakout_backtest(
                symbol=symbol,
                start_date=request.start_date,
                end_date=request.end_date,
                allocation_capital=alloc_capital,
                risk_pct=request.risk_pct,
                max_position_pct=request.max_position_pct,
            )
            results.append({
                "symbol": r.symbol,
                "allocation_pct": alloc_pct,
                "strategy_id": "previous_day_breakout",
                "start_date": r.start_date,
                "end_date": r.end_date,
                "initial_capital": r.initial_capital,
                "final_value": r.final_value,
                "total_return_pct": r.total_return_pct,
                "cagr": r.cagr,
                "sharpe_ratio": r.sharpe_ratio,
                "max_drawdown_pct": r.max_drawdown_pct,
                "total_trades": r.total_trades,
                "winning_trades": r.winning_trades,
                "losing_trades": r.losing_trades,
                "win_rate_pct": r.win_rate_pct,
                "avg_win_pct": r.avg_win_pct,
                "avg_loss_pct": r.avg_loss_pct,
                "profit_factor": r.profit_factor,
                "equity_curve": r.equity_curve,
                "trades": r.trades,
            })
            equity_curves.append((symbol, r.equity_curve))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # Combine equity curves by date (forward-fill each, then sum)
    all_dates = set()
    for _, curve in equity_curves:
        for p in curve:
            all_dates.add(p["date"])
    all_dates = sorted(all_dates)

    filled_by_symbol = {}
    for symbol, curve in equity_curves:
        d = {p["date"]: p["value"] for p in curve}
        last = 0
        filled = {}
        for dt in all_dates:
            last = d.get(dt, last)
            filled[dt] = last
        filled_by_symbol[symbol] = filled

    combined = [{"date": dt, "value": round(sum(filled_by_symbol[sym][dt] for sym, _ in equity_curves), 2)} for dt in all_dates]

    total_final = sum(r["final_value"] for r in results)
    total_return = (total_final / request.initial_capital - 1) * 100
    all_trades = [t for r in results for t in r["trades"]]
    total_trades = len(all_trades)
    wins = sum(r["winning_trades"] for r in results)
    losses = sum(r["losing_trades"] for r in results)
    win_rate = (wins / total_trades * 100) if total_trades > 0 else 0

    winning_trades_list = [t for t in all_trades if t["pnl"] > 0]
    losing_trades_list = [t for t in all_trades if t["pnl"] <= 0]
    avg_win_pct = np.mean([t["pnl_pct"] for t in winning_trades_list]) if winning_trades_list else 0
    avg_loss_pct = np.mean([t["pnl_pct"] for t in losing_trades_list]) if losing_trades_list else 0
    gross_profit = sum(t["pnl"] for t in winning_trades_list)
    gross_loss = abs(sum(t["pnl"] for t in losing_trades_list))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (gross_profit if gross_profit > 0 else 0)

    equity_series = pd.Series([p["value"] for p in combined])
    returns = equity_series.pct_change().dropna()
    sharpe = (returns.mean() / returns.std()) * np.sqrt(252) if len(returns) > 1 and returns.std() > 0 else 0.0
    cummax = equity_series.cummax()
    drawdown = (equity_series - cummax) / cummax * 100
    max_dd = round(drawdown.min(), 2)
    days = (pd.to_datetime(request.end_date) - pd.to_datetime(request.start_date)).days
    years = max(days / 365.25, 0.01)
    cagr = (total_final / request.initial_capital) ** (1 / years) - 1
    cagr *= 100

    return {
        "symbol": "+".join(r["symbol"] for r in results),
        "strategy_id": "previous_day_breakout",
        "start_date": request.start_date,
        "end_date": request.end_date,
        "initial_capital": request.initial_capital,
        "final_value": round(total_final, 2),
        "total_return_pct": round(total_return, 2),
        "cagr": round(cagr, 2),
        "sharpe_ratio": round(sharpe, 2),
        "max_drawdown_pct": max_dd,
        "total_trades": total_trades,
        "winning_trades": wins,
        "losing_trades": losses,
        "win_rate_pct": round(win_rate, 1),
        "avg_win_pct": round(avg_win_pct, 2),
        "avg_loss_pct": round(avg_loss_pct, 2),
        "profit_factor": round(profit_factor, 2),
        "equity_curve": combined,
        "trades": all_trades,
        "results": results,
    }


@app.get("/api/health")
def health():
    """Health check."""
    return {"status": "ok"}


# Trading Analysis Endpoints

# ── Trading-analysis endpoints moved to trading_analysis_router.py (included near app setup). ──


def _money(v) -> str:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return "$0"
    sign = "-" if v < 0 else ""
    return f"{sign}${abs(v):,.0f}" if abs(v) >= 100 else f"{sign}${abs(v):,.2f}"


# ── calculate_trade_metrics moved to trade_data.py (imported near app setup). ──


# Sector-performance screener endpoints.
#
# NOTE: despite the historical "Finnhub" naming below, candle/return data is
# fetched via the configured data provider (Massive.com by default, yfinance
# fallback) through `_fetch_sectors_via_provider`. Finnhub's free-tier
# /stock/candle endpoint returns 403 and is no longer used here. The
# FINNHUB_BASE_URL constant remains only because the News / EP-scorer paths
# further down still use Finnhub for earnings + company-news lookups.

from datetime import datetime, timedelta
import time
import requests
import json

FINNHUB_BASE_URL = "https://finnhub.io/api/v1"
import os

# Cache for sector performance data (2 hour TTL)
_sector_cache = {"data": None, "timestamp": None}
CACHE_TTL = 7200  # 2 hours
CACHE_FILE = "sector_cache.json"  # File to persist cache data

# Progress tracking for sector data loading
_fetch_progress = {"loading": False, "current": 0, "total": 0, "current_ticker": "", "current_name": ""}

def load_cache_from_file():
    """Load cache data from JSON file."""
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, 'r') as f:
                cache_data = json.load(f)
                cache_timestamp = datetime.fromisoformat(cache_data.get('timestamp', ''))
                time_since_cache = (datetime.now() - cache_timestamp).total_seconds()

                if time_since_cache < CACHE_TTL:
                    print(f"Loaded cache from file (age: {time_since_cache:.0f}s)")
                    return cache_data.get('data'), cache_timestamp
    except Exception as e:
        print(f"Error loading cache from file: {str(e)}")

    return None, None

def save_cache_to_file(data):
    """Save cache data to JSON file."""
    try:
        cache_data = {
            'data': data,
            'timestamp': datetime.now().isoformat()
        }
        with open(CACHE_FILE, 'w') as f:
            json.dump(cache_data, f)
        print("Cache saved to file")
    except Exception as e:
        print(f"Error saving cache to file: {str(e)}")

def get_all_etf_tickers():
    """Get dictionary of all ETF tickers organized by category."""
    return {
        # Major Sectors
        'Technology': 'XLK',
        'Financials': 'XLF',
        'Healthcare': 'XLV',
        'Energy': 'XLE',
        'Consumer Discretionary': 'XLY',
        'Consumer Staples': 'XLP',
        'Industrials': 'XLI',
        'Materials': 'XLB',
        'Real Estate': 'XLRE',
        'Utilities': 'XLU',
        'Communication Services': 'XLC',

        # Industry-Specific ETFs
        'Transportation': 'XTN',
        'Homebuilders': 'XHB',
        'Airlines': 'JETS',
        'Retail': 'XRT',
        'Biotech': 'XBI',
        'Oil & Gas Exploration': 'XES',
        'Metals & Mining': 'XME',
        'Robotics & AI': 'ROBO',
        'Healthcare Services': 'XHS',
        'Aerospace & Defense': 'XAR',
        'Small Caps': 'IWM',
        'Oil & Gas': 'XOP',
        'Clean Energy': 'PBW',
        'Regional Banks': 'KRE',
        'Bank ETF': 'KBP',
        'Bank Sector': 'KBWB',
        'Software': 'XSW',
        'Airlines & Airports': 'IAT',
        'Capital Markets': 'KCE',
        'Software & Services': 'IGV',
        'Biotech SPDR': 'IBB',
        'Infrastructure': 'PAVE',
        'Health Tech': 'XHE',
        'FinTech': 'FSPN',
        'FinTech Growth': 'FTXD',
        'Small-Mid Cap': 'RITY',
        'S&P 600 North': 'RSPN',
        'S&P 600 Momentum': 'RSPM',
        'S&P 600 Dividend': 'RSPD',
        'S&P 600 Pure Style': 'RSPS',
        'S&P 600 Tech': 'RSPT',
        'Equal Weight Industrials': 'EWWI',
        'Steel': 'SLX',
        'Natural Resources': 'GNR',
        'Insurance': 'KIE',
        'S&P 600 Growth': 'RSPG',
        'iShares Healthcare': 'IYH',
        'Agriculture': 'MOO',
        'S&P Healthcare Services': 'XSR',
        'Cloud Computing': 'WCLD',
        'Oil Fund': 'USO',
        'Base Metals': 'DBB',
        'Marine': 'BOAT',
        'Consumer Goods': 'IYC',
        'Latin America': 'ILF',
        'iShares Biotech': 'IIBR',
        'Energy Select': 'IYE',
        'S&P 600 Resources': 'RSPR',
        'Canadian Dollar': 'FXC',
        'India': 'INDY',
        'NASDAQ India': 'PNQI',
        'S&P 600 Utilities': 'RSPU',
        'Bitcoin Trust': 'GBTC',
    }

def get_demo_sector_data():
    """Generate demo sector data for when Yahoo Finance is unavailable."""
    import random
    random.seed(42)  # Consistent demo data

    sectors = get_all_etf_tickers()

    sector_data = []
    for sector_name, ticker in sectors.items():
        # Generate realistic-looking demo data
        base_price = random.uniform(40, 180)
        sector_data.append({
            'sector': sector_name,
            'ticker': ticker,
            'price': round(base_price, 2),
            'returns': {
                '1D': round(random.uniform(-2, 2), 2),
                '5D': round(random.uniform(-3, 3), 2),
                '1M': round(random.uniform(-5, 5), 2),
                '3M': round(random.uniform(-8, 8), 2),
                'YTD': round(random.uniform(-10, 15), 2),
                '1Y': round(random.uniform(-15, 25), 2),
            },
            'volume': random.randint(5000000, 50000000),
            'is_demo': True
        })

    return sector_data

def _returns_from_closes(closes, dates):
    """Compute period returns (%) from a list of closes + matching dates."""
    def r(n):
        return ((closes[-1] / closes[-1 - n]) - 1) * 100 if len(closes) > n else None

    returns = {"1D": r(1), "5D": r(5), "1M": r(21), "3M": r(63)}

    current_year = datetime.now().year
    ytd_i = next((i for i, d in enumerate(dates) if d.year == current_year), None)
    if ytd_i is not None and ytd_i < len(closes) - 1:
        returns["YTD"] = ((closes[-1] / closes[ytd_i]) - 1) * 100

    if len(closes) > 252:
        returns["1Y"] = ((closes[-1] / closes[-253]) - 1) * 100
    elif len(closes) >= 2:
        returns["1Y"] = ((closes[-1] / closes[0]) - 1) * 100

    return {k: round(float(v), 2) for k, v in returns.items() if v is not None}


def _fetch_sectors_via_provider(sectors):
    """Fetch sector/industry ETF performance via the configured data provider
    (Massive.com by default, yfinance fallback). Replaces the deprecated
    Finnhub /stock/candle endpoint."""
    global _fetch_progress
    from screener.qullamaggie.providers import get_provider

    provider = get_provider()
    items = list(sectors.items())
    total = len(items)
    out = []
    for idx, (sector_name, ticker) in enumerate(items):
        _fetch_progress = {
            "loading": True, "current": idx + 1, "total": total,
            "current_ticker": ticker, "current_name": sector_name,
        }
        try:
            df = provider.fetch(ticker, lookback_days=400)
            if df is None or len(df) < 2:
                print(f"No candle data for {sector_name} ({ticker})")
                continue
            closes = [float(c) for c in df["close"].tolist()]
            dates = list(df.index)
            volumes = [float(v) for v in df["volume"].tolist()]
            avg_volume = int(np.mean(volumes[-20:])) if volumes else 0
            out.append({
                "sector": sector_name,
                "ticker": ticker,
                "price": round(closes[-1], 2),
                "returns": _returns_from_closes(closes, dates),
                "volume": avg_volume,
            })
        except Exception as e:
            print(f"Error fetching data for {sector_name} ({ticker}): {str(e)}")
        if getattr(provider, "name", "") == "massive":
            time.sleep(0.12)  # be polite to the API
    try:
        provider.close()
    except Exception:
        pass
    _fetch_progress = {"loading": False, "current": total, "total": total, "current_ticker": "", "current_name": ""}
    return out, getattr(provider, "name", "unknown")


@app.get("/api/screener/sector-performance/progress")
def get_fetch_progress():
    """Get the current progress of sector data fetching."""
    return _fetch_progress

@app.get("/api/screener/sector-performance")
def get_sector_performance(force: int = 0):
    """Get performance data for sector and industry ETFs."""
    global _sector_cache, _fetch_progress

    # Force refresh: clear all caches so we fetch fresh data from the provider
    if force:
        print("Force refresh requested — clearing all caches")
        _sector_cache = {"data": None, "timestamp": None}
        try:
            if os.path.exists(CACHE_FILE):
                os.remove(CACHE_FILE)
        except Exception:
            pass
    else:
        # Check in-memory cache first
        if _sector_cache["data"] is not None and _sector_cache["timestamp"] is not None:
            time_since_cache = (datetime.now() - _sector_cache["timestamp"]).total_seconds()
            if time_since_cache < CACHE_TTL:
                print(f"Returning in-memory cached data (age: {time_since_cache:.0f}s)")
                return _sector_cache["data"]

        # Check file cache
        cached_data, cached_timestamp = load_cache_from_file()
        if cached_data is not None:
            _sector_cache = {"data": cached_data, "timestamp": cached_timestamp}
            return cached_data

    try:
        sectors = get_all_etf_tickers()
        total_tickers = len(sectors)
        _fetch_progress = {"loading": True, "current": 0, "total": total_tickers, "current_ticker": "", "current_name": ""}

        sector_data, provider_name = _fetch_sectors_via_provider(sectors)

        # If we got at least some real data, cache and return it
        if sector_data:
            result = {
                "sectors": sector_data,
                "last_updated": datetime.now().isoformat(),
                "is_demo": False,
                "provider": provider_name,
            }
            _sector_cache = {"data": result, "timestamp": datetime.now()}
            save_cache_to_file(result)  # Persist to file
            return result

        # If the provider failed completely, return demo data
        print("Data provider unavailable, using demo data")
        demo_data = get_demo_sector_data()
        result = {
            "sectors": demo_data,
            "last_updated": datetime.now().isoformat(),
            "is_demo": True,
            "note": "Live market data is currently unavailable. Showing demo data. Please try again later.",
        }
        _sector_cache = {"data": result, "timestamp": datetime.now()}
        return result

    except Exception as e:
        print(f"Error in sector performance endpoint: {str(e)}")
        _fetch_progress = {"loading": False, "current": 0, "total": 0, "current_ticker": "", "current_name": ""}
        demo_data = get_demo_sector_data()
        result = {
            "sectors": demo_data,
            "last_updated": datetime.now().isoformat(),
            "is_demo": True,
            "note": "Live market data is currently unavailable. Showing demo data. Please try again later.",
        }
        _sector_cache = {"data": result, "timestamp": datetime.now()}
        return result


# ── Trade Journal CRUD moved to journal_router.py (included near app setup).
# The P&L calendar below stays here — it's trades-workbook analytics, not CRUD.


@app.get("/api/journal/calendar")
def get_journal_calendar():
    """Return calendar P&L data from the default trades file for Journal page."""
    default_path = os.getenv("DEFAULT_TRADES_PATH", "trades/Trades.xlsx")
    try:
        if not os.path.exists(default_path):
            return {"days": [], "weeks": [], "months": [], "best_day": None, "worst_day": None, "green_days": 0, "red_days": 0, "total_trading_days": 0}

        # Reuse cached trades if available
        current_mtime = os.path.getmtime(default_path)
        if _trades_cache["file_mtime"] == current_mtime and _trades_cache["data"] is not None:
            trades = _trades_cache["data"]["trades"]
        else:
            df = pd.read_excel(default_path)
            df = df.loc[:, ~df.columns.str.contains('^Unnamed')]
            trades = normalize_trade_data(df)

        if not trades:
            return {"days": [], "weeks": [], "months": [], "best_day": None, "worst_day": None, "green_days": 0, "red_days": 0, "total_trading_days": 0}

        df = pd.DataFrame(trades)
        date_col = 'exit_date' if 'exit_date' in df.columns else 'entry_date'
        if date_col not in df.columns:
            return {"days": [], "weeks": [], "months": []}

        df['date'] = pd.to_datetime(df[date_col], errors='coerce')
        df = df.dropna(subset=['date'])
        df['date_str'] = df['date'].dt.strftime('%Y-%m-%d')

        daily = df.groupby('date_str').agg(
            pnl=('pnl', 'sum'),
            trades=('pnl', 'count'),
            wins=('pnl', lambda x: (x > 0).sum()),
        ).reset_index()
        daily['date'] = pd.to_datetime(daily['date_str'])
        daily = daily.sort_values('date')

        days = []
        for _, row in daily.iterrows():
            days.append({
                "date": row['date_str'],
                "pnl": round(float(row['pnl']), 2),
                "trades": int(row['trades']),
                "wins": int(row['wins']),
                "weekday": int(row['date'].dayofweek),
                "week": int(row['date'].isocalendar()[1]),
                "year": int(row['date'].year),
                "month": int(row['date'].month),
            })

        df['week_key'] = df['date'].dt.strftime('%Y-W%W')
        weekly = df.groupby('week_key').agg(pnl=('pnl', 'sum'), trades=('pnl', 'count')).reset_index()
        weeks = [{"week": r['week_key'], "pnl": round(float(r['pnl']), 2), "trades": int(r['trades'])} for _, r in weekly.iterrows()]

        df['month_key'] = df['date'].dt.strftime('%Y-%m')
        monthly = df.groupby('month_key').agg(pnl=('pnl', 'sum'), trades=('pnl', 'count')).reset_index()
        months = [{"month": r['month_key'], "pnl": round(float(r['pnl']), 2), "trades": int(r['trades'])} for _, r in monthly.iterrows()]

        best_day = max(days, key=lambda d: d['pnl']) if days else None
        worst_day = min(days, key=lambda d: d['pnl']) if days else None
        green_days = len([d for d in days if d['pnl'] > 0])
        red_days = len([d for d in days if d['pnl'] < 0])

        return {
            "days": days,
            "weeks": weeks,
            "months": months,
            "best_day": best_day,
            "worst_day": worst_day,
            "green_days": green_days,
            "red_days": red_days,
            "total_trading_days": len(days),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading calendar data: {str(e)}")


# ─── AI Weekly Journal Review ─────────────────────────────────────────────────
#
# Joins trade outcomes (default file) with per-trade journal entries (emotion,
# lessons, rating, tags) and daily-journal entries (mood, thesis, reflection)
# over a rolling N-day window, then asks Claude to surface 3-5 behavioral
# patterns. Cached against input file mtimes — won't re-call the model unless
# something changed.

WEEKLY_REVIEW_SYSTEM_PROMPT = """You are a sharp, evidence-driven trading coach reviewing a short window of a trader's recent activity.

Your job: find 3-5 NON-OBVIOUS behavioral patterns that the trader probably hasn't noticed themselves. Examples of the kind of insight that's valuable:
- "5 of your 6 losses were entered after 10:30 AM" (time-of-day discipline)
- "Every trade you tagged 'FOMO' lost money, average -1.4R"
- "Your win rate on Setup X is 75% but you only took it 4 times this week"
- "You wrote 'patient' in your morning plan on 3 days; you took zero trades on those days"

Be specific — cite which trades, days, tags, or emotions support each pattern. Avoid platitudes ("trade your plan", "manage risk"). Avoid restating obvious aggregates ("your win rate is 60%"). One pattern = one actionable recommendation.

Return ONLY valid JSON, no markdown fences, matching:
{
  "headline": "one-sentence read of this trader's week",
  "patterns": [
    {"title": "...", "evidence": "...", "recommendation": "..."}
  ]
}

If the input is too sparse for confident patterns, return an empty patterns array and a headline that says so."""


_WEEKLY_REVIEW_CACHE: dict = {"key": None, "result": None, "ts": 0.0}
_WEEKLY_REVIEW_TTL_SECONDS = 10 * 60


def _build_review_context(days: int) -> dict:
    """Pull trades + journals over the window and assemble an objective digest.

    Returns a dict with `window`, `objective_stats`, `trades`, `per_trade_notes`,
    `daily_notes`, and a `cache_key` derived from the underlying file mtimes
    so the caller can decide whether to bypass the Claude cache.
    """
    end = datetime.now().date()
    start = end - timedelta(days=days)

    # --- Trades (from default file) -----------------------------------------
    default_path = os.getenv("DEFAULT_TRADES_PATH", "trades/Trades.xlsx")
    trades_mtime: Optional[float] = None
    trades: list[dict] = []
    try:
        trades_mtime = os.path.getmtime(default_path)
        if _trades_cache["file_mtime"] == trades_mtime and _trades_cache["data"] is not None:
            trades = _trades_cache["data"]["trades"]
        else:
            df = pd.read_excel(default_path)
            df = df.loc[:, ~df.columns.str.contains('^Unnamed')]
            trades = normalize_trade_data(df)
    except FileNotFoundError:
        trades = []  # journal-only review still works
    except Exception as e:
        print(f"weekly-review: trade load failed: {e}")
        trades = []

    # Filter to the window. Use exit_date if available, else entry_date.
    def _in_window(t: dict) -> bool:
        d_str = t.get("exit_date") or t.get("entry_date")
        if not d_str:
            return False
        try:
            d = pd.to_datetime(d_str).date()
            return start <= d <= end
        except Exception:
            return False

    window_trades = [t for t in trades if _in_window(t)]

    # --- Per-trade journal --------------------------------------------------
    journal = _load_journal()
    per_trade_entries = journal.get("entries", {})

    # --- Daily journal ------------------------------------------------------
    daily_path = os.path.join(_HERE, "data", "daily_journal.json")
    daily_mtime: Optional[float] = None
    daily_entries: dict = {}
    try:
        daily_mtime = os.path.getmtime(daily_path)
        with open(daily_path, "r") as f:
            daily_entries = (json.load(f) or {}).get("entries", {})
    except FileNotFoundError:
        daily_entries = {}
    except Exception as e:
        print(f"weekly-review: daily-journal load failed: {e}")
        daily_entries = {}

    window_daily = [
        e for e in daily_entries.values()
        if start.isoformat() <= (e.get("date") or "") <= end.isoformat()
    ]
    window_daily.sort(key=lambda e: e.get("date", ""))

    # --- Objective stats ----------------------------------------------------
    def _entry_hour(t: dict) -> Optional[int]:
        v = t.get("entry_time") or t.get("entry_date")
        if not v:
            return None
        try:
            ts = pd.to_datetime(v)
            return int(ts.hour)
        except Exception:
            return None

    wins = [t for t in window_trades if (t.get("pnl") or 0) > 0]
    losses = [t for t in window_trades if (t.get("pnl") or 0) < 0]
    total_pnl = round(sum((t.get("pnl") or 0) for t in window_trades), 2)
    avg_win = round(sum(t.get("pnl") or 0 for t in wins) / len(wins), 2) if wins else 0.0
    avg_loss = round(sum(t.get("pnl") or 0 for t in losses) / len(losses), 2) if losses else 0.0
    win_rate = round(len(wins) / len(window_trades) * 100, 1) if window_trades else 0.0

    # Time-of-day buckets — morning (<10:30) / mid (10:30-13:00) / afternoon (>13:00)
    tod_counts = {"morning": 0, "mid": 0, "afternoon": 0, "unknown": 0}
    tod_pnl = {"morning": 0.0, "mid": 0.0, "afternoon": 0.0, "unknown": 0.0}
    for t in window_trades:
        h = _entry_hour(t)
        bucket = "unknown" if h is None else ("morning" if h < 10 or (h == 10 and (pd.to_datetime(t.get("entry_time") or t.get("entry_date")).minute < 30)) else ("mid" if h < 13 else "afternoon"))
        tod_counts[bucket] += 1
        tod_pnl[bucket] = round(tod_pnl[bucket] + (t.get("pnl") or 0), 2)

    # Tag/emotion frequency from per-trade entries that match a window symbol
    window_symbols = {(t.get("symbol") or "").upper() for t in window_trades}
    relevant_notes = {
        tid: e for tid, e in per_trade_entries.items()
        if (tid or "").upper() in window_symbols
    }

    return {
        "window": {"start": start.isoformat(), "end": end.isoformat(), "days": days},
        "objective_stats": {
            "trade_count": len(window_trades),
            "win_rate_pct": win_rate,
            "wins": len(wins),
            "losses": len(losses),
            "total_pnl": total_pnl,
            "avg_win": avg_win,
            "avg_loss": avg_loss,
            "biggest_win": round(max((t.get("pnl") or 0) for t in window_trades), 2) if window_trades else 0,
            "biggest_loss": round(min((t.get("pnl") or 0) for t in window_trades), 2) if window_trades else 0,
            "tod_counts": tod_counts,
            "tod_pnl": tod_pnl,
        },
        "trades": [
            {
                "symbol": t.get("symbol"),
                "side": t.get("side"),
                "entry_date": (t.get("entry_date") or "")[:10],
                "entry_time": t.get("entry_time"),
                "exit_date": (t.get("exit_date") or "")[:10],
                "exit_time": t.get("exit_time"),
                "pnl": round(t.get("pnl") or 0, 2),
                "pnl_pct": round(t.get("pnl_pct") or 0, 2),
                "setup": t.get("setup") or None,
                "emotion": t.get("emotion") or None,
                "grade": t.get("grade") or None,
                "duration_days": t.get("duration_days"),
            }
            for t in window_trades
        ],
        "per_trade_notes": [
            {
                "trade_id": tid,
                "rating": e.get("rating"),
                "emotion_entry": e.get("emotion_entry"),
                "emotion_exit": e.get("emotion_exit"),
                "pre_trade_plan": (e.get("pre_trade_plan") or "")[:400],
                "lessons_learned": (e.get("lessons_learned") or "")[:400],
                "tags": e.get("tags") or [],
            }
            for tid, e in relevant_notes.items()
        ],
        "daily_notes": [
            {
                "date": e.get("date"),
                "mood": e.get("mood"),
                "market_thesis": (e.get("market_thesis") or "")[:400],
                "plan": (e.get("plan") or "")[:400],
                "reflection": (e.get("reflection") or "")[:400],
                "tags": e.get("tags") or [],
            }
            for e in window_daily
        ],
        "_cache_key": (days, trades_mtime, daily_mtime, len(per_trade_entries)),
    }


@app.get("/api/journal/weekly-review")
def get_weekly_review(days: int = 7, force: int = 0) -> dict:
    """AI-powered behavioral review of the last `days` trading days.

    Joins trade outcomes (default file) + per-trade journal + daily journal and
    asks Claude for 3-5 specific behavioral patterns. Cached for 10 minutes
    against the inputs — set `force=1` to bypass.
    """
    import time as _time

    days = max(1, min(int(days), 90))
    ctx = _build_review_context(days)
    cache_key = ctx.pop("_cache_key")

    # Quick cache hit
    if not force and _WEEKLY_REVIEW_CACHE["key"] == cache_key and (_time.time() - _WEEKLY_REVIEW_CACHE["ts"]) < _WEEKLY_REVIEW_TTL_SECONDS:
        cached = _WEEKLY_REVIEW_CACHE["result"]
        return {**cached, "from_cache": True}

    # Empty-window early return — no need to spend tokens
    if ctx["objective_stats"]["trade_count"] == 0 and not ctx["per_trade_notes"] and not ctx["daily_notes"]:
        result = {
            **ctx,
            "ai": {
                "headline": f"No trades or journal entries in the last {days} days. Nothing to review yet.",
                "patterns": [],
            },
            "model": None,
            "from_cache": False,
        }
        return result

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY is not configured. Add it to backend/.env to enable AI review.",
        )

    user_payload = json.dumps({
        "window": ctx["window"],
        "objective_stats": ctx["objective_stats"],
        "trades": ctx["trades"],
        "per_trade_notes": ctx["per_trade_notes"],
        "daily_notes": ctx["daily_notes"],
    }, default=str, indent=2)

    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1500,
            system=WEEKLY_REVIEW_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_payload}],
        )
        raw = message.content[0].text.strip()
        # Be tolerant — strip any accidental ```json fences before parsing.
        if raw.startswith("```"):
            raw = raw.strip("`").lstrip("json").strip()
        ai_block = json.loads(raw)
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=401, detail="Invalid ANTHROPIC_API_KEY. Check your .env file.")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Claude returned non-JSON payload: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Claude API error: {str(e)}")

    result = {
        **ctx,
        "ai": ai_block,
        "model": "claude-sonnet-4-6",
        "from_cache": False,
    }
    _WEEKLY_REVIEW_CACHE["key"] = cache_key
    _WEEKLY_REVIEW_CACHE["result"] = result
    _WEEKLY_REVIEW_CACHE["ts"] = _time.time()
    return result


# ── The $9M / Reversal / Stage / 200-MA-Reclaim scanner endpoints were extracted
# to scanners_router.py (registered via app.include_router near app setup). ──


# ─── Setups Board (aggregator) ───────────────────────────────────────────────
#
# A read-only aggregation over the five setup scanners in section 2 · Find Setups.
# It reuses each scanner's OWN warm cache — it calls their endpoint functions
# in-process, so with force=0 they return their cached results and the board
# recomputes nothing. It then lays out per-setup top-N lanes plus the confluence
# set (symbols flagged by 2+ scanners) and the risk-on/off regime. Aggregation
# logic lives in setups_board.py; this is the HTTP shell + a market-aware cache
# keyed on the breadth data day — so the board invalidates whenever the underlying
# scans roll to a new trading day, and otherwise serves without re-aggregating.

_SETUPS_BOARD_CACHE: dict = {"day": None, "result": None, "ts": 0.0}
_SETUPS_BOARD_TTL_ACTIVE = 5 * 60


@app.get("/api/setups/board")
def get_setups_board(force: int = 0) -> dict:
    """Aggregate the five Find-Setups scanners into one board.

    Reads each scanner's cached result (200 MA reclaim, Stage 1→2, breakouts,
    $9M, reversal) plus the situational regime, and returns per-setup lanes with
    the cross-scanner confluence. Cached per breadth trading day with a
    market-aware TTL (held for hours when the market is closed, since the
    underlying data is frozen). force=1 rebuilds and forces every underlying scan.

    Depends entirely on the other scans: it holds no market data of its own, and
    its cache is invalidated by the breadth data day the scanners share.
    """
    import time as _time
    from market_clock import effective_cache_ttl
    from breadth.cache import list_cached_days
    from setups_board import build_board
    from screener.qullamaggie.router import get_breakouts

    days = list_cached_days()
    data_day = days[-1].isoformat() if days else None
    ttl = effective_cache_ttl(_SETUPS_BOARD_TTL_ACTIVE)
    now = _time.time()
    if (not force and _SETUPS_BOARD_CACHE["day"] == data_day
            and _SETUPS_BOARD_CACHE["result"] is not None
            and (now - _SETUPS_BOARD_CACHE["ts"]) < ttl):
        return {**_SETUPS_BOARD_CACHE["result"], "from_cache": True}

    f = int(bool(force))
    sources: dict = {}

    def _safe(name: str, fn) -> None:
        # One failing scanner must never sink the whole board — degrade to an
        # error lane instead (build_board renders it and moves on).
        try:
            sources[name] = fn()
        except Exception as e:
            logger.warning("setups board: source %s failed: %s", name, e)
            sources[name] = {"error": str(e)}

    _safe("ma_reclaim", lambda: get_ma_reclaim_scan(force=f))
    _safe("stage", lambda: get_stage_scan(force=f))
    # The board only needs score/status/pivot/ADR, so skip the per-symbol news/RSI/
    # calendar enrichment and don't persist a lean snapshot over the rich one.
    # Every param must be passed explicitly: get_breakouts is a route function whose
    # unspecified args keep their FastAPI Query(...) *default objects*, which then
    # blow up the numeric comparisons inside it when called in-process.
    _safe("breakouts", lambda: get_breakouts(
        mode="breakout", limit=24, min_dollar_vol=5_000_000, min_adr=0.05,
        min_rvol=1.5, day_filter=0, include_movers=False, enrich_news=False,
        enrich_rsi=False, enrich_calendar=False, enrich_blocks=False,
        enrich_institutional=False, wide=False, persist=False, fresh=bool(f)))
    _safe("ep9m", lambda: get_9m_scan(force=f))
    _safe("reversal", lambda: get_reversal_scan(force=f))
    _safe("regime", lambda: get_breadth_situational(trend_days=30))

    board = build_board(sources)
    board["generated_at"] = datetime.now().isoformat(timespec="seconds")

    _SETUPS_BOARD_CACHE["day"] = data_day
    _SETUPS_BOARD_CACHE["result"] = board
    _SETUPS_BOARD_CACHE["ts"] = now
    return {**board, "from_cache": False}


# ─── Cross-sectional Factor Model ────────────────────────────────────────────
#
# Ranks the liquid universe on price/volume style factors (momentum, trend
# quality, relative strength, low-vol, short reversal, liquidity) with z-scores,
# a composite, factor rotation and factor correlation. Logic in
# analytics/factor_model.py; this is the HTTP shell + a 5-minute TTL cache.

_FACTOR_CACHE: dict = {"key": None, "result": None, "ts": 0.0}
_FACTOR_TTL_SECONDS = 5 * 60


@app.get("/api/analyze/factors")
def get_factor_model(
    min_price: float = 5.0,
    min_dollar_volume: float = 3_000_000.0,
    force: int = 0,
) -> dict:
    """Cross-sectional price/volume factor model off the breadth cache.

    Cached for 5 minutes per parameter tuple. force=1 bypasses. Returns 500 if the
    breadth cache hasn't been seeded — point the user at Market Monitor → Refresh.
    """
    import time as _time
    from analytics import factor_model as _fm

    key = (float(min_price), float(min_dollar_volume))
    if not force and _FACTOR_CACHE["key"] == key and (_time.time() - _FACTOR_CACHE["ts"]) < _FACTOR_TTL_SECONDS:
        return {**_FACTOR_CACHE["result"], "from_cache": True}

    try:
        result = _fm.run(min_price=float(min_price), min_dollar_volume=float(min_dollar_volume))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Factor model failed: {e}")

    _FACTOR_CACHE.update(key=key, result=result, ts=_time.time())
    return {**result, "from_cache": False}


# ─── Edge Validation (event-study / multiple-testing) ────────────────────────
#
# Replays a family of entry signals over the cached history and scores each
# against multiple testing (bootstrap CIs, deflated Sharpe, BH-FDR) to quantify
# data-mining risk. Logic in analytics/edge_validation.py.

_EDGE_CACHE: dict = {"key": None, "result": None, "ts": 0.0}
_EDGE_TTL_SECONDS = 5 * 60


@app.get("/api/analyze/edge-validation")
def get_edge_validation(
    horizon: int = 10,
    min_price: float = 5.0,
    min_dollar_volume: float = 3_000_000.0,
    force: int = 0,
) -> dict:
    """Event-study edge validation with multiple-testing correction.

    `horizon` is the forward holding period in trading days. Cached for 5 minutes
    per parameter tuple. force=1 bypasses. Returns 500 if the breadth cache is empty.
    """
    import time as _time
    from analytics import edge_validation as _ev

    key = (int(horizon), float(min_price), float(min_dollar_volume))
    if not force and _EDGE_CACHE["key"] == key and (_time.time() - _EDGE_CACHE["ts"]) < _EDGE_TTL_SECONDS:
        return {**_EDGE_CACHE["result"], "from_cache": True}

    try:
        result = _ev.run(horizon=int(horizon), min_price=float(min_price),
                         min_dollar_volume=float(min_dollar_volume))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Edge validation failed: {e}")

    _EDGE_CACHE.update(key=key, result=result, ts=_time.time())
    return {**result, "from_cache": False}


# ─── Trading Tools ────────────────────────────────────────────────────────────

class PositionSizeRequest(BaseModel):
    account_size: float
    risk_per_trade_pct: float
    entry_price: float
    stop_loss_price: float
    method: str = "fixed_pct"
    win_rate: float = 0
    avg_win: float = 0
    avg_loss: float = 0
    atr_value: float = 0
    atr_multiplier: float = 2.0


@app.post("/api/tools/position-size")
def calculate_position_size(request: PositionSizeRequest):
    """Calculate position size using Fixed %, Kelly Criterion, or ATR-based method."""
    try:
        account = request.account_size
        risk_pct = request.risk_per_trade_pct
        entry = request.entry_price
        stop = request.stop_loss_price

        risk_amount = account * risk_pct / 100
        risk_per_share = abs(entry - stop)

        if risk_per_share <= 0:
            raise HTTPException(status_code=400, detail="Entry and stop loss cannot be the same price")

        result = {
            "method": request.method,
            "account_size": account,
            "risk_amount": round(risk_amount, 2),
            "risk_per_share": round(risk_per_share, 2),
            "stop_loss_distance_pct": round(risk_per_share / entry * 100, 2),
        }

        if request.method == "fixed_pct":
            shares = int(risk_amount / risk_per_share)
            position_value = shares * entry
            result.update({
                "shares": shares,
                "position_value": round(position_value, 2),
                "position_pct_of_account": round(position_value / account * 100, 1),
            })

        elif request.method == "kelly":
            wr = request.win_rate / 100 if request.win_rate > 1 else request.win_rate
            avg_w = abs(request.avg_win)
            avg_l = abs(request.avg_loss) if request.avg_loss != 0 else 1

            win_loss_ratio = avg_w / avg_l if avg_l > 0 else 0
            kelly = (wr * win_loss_ratio - (1 - wr)) / win_loss_ratio if win_loss_ratio > 0 else 0
            kelly = max(0, min(kelly, 1))
            half_kelly = kelly / 2

            kelly_risk = account * kelly
            half_kelly_risk = account * half_kelly
            shares_kelly = int(kelly_risk / risk_per_share) if risk_per_share > 0 else 0
            shares_half = int(half_kelly_risk / risk_per_share) if risk_per_share > 0 else 0

            result.update({
                "kelly_pct": round(kelly * 100, 2),
                "half_kelly_pct": round(half_kelly * 100, 2),
                "shares_kelly": shares_kelly,
                "shares_half_kelly": shares_half,
                "position_value_kelly": round(shares_kelly * entry, 2),
                "position_value_half_kelly": round(shares_half * entry, 2),
                "shares": shares_half,
                "position_value": round(shares_half * entry, 2),
                "position_pct_of_account": round(shares_half * entry / account * 100, 1) if account > 0 else 0,
            })

        elif request.method == "atr_based":
            atr = request.atr_value
            mult = request.atr_multiplier
            if atr <= 0:
                raise HTTPException(status_code=400, detail="ATR value must be positive")
            stop_distance = atr * mult
            shares = int(risk_amount / stop_distance)
            position_value = shares * entry
            result.update({
                "atr_value": atr,
                "atr_multiplier": mult,
                "atr_stop_distance": round(stop_distance, 2),
                "shares": shares,
                "position_value": round(position_value, 2),
                "position_pct_of_account": round(position_value / account * 100, 1),
            })

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating position size: {str(e)}")


# Pre-Trade Checklist
CHECKLIST_PATH = os.getenv("CHECKLIST_PATH", os.path.join(os.path.dirname(__file__), "data", "checklist_template.json"))

DEFAULT_CHECKLIST = [
    "Is this trade in my playbook/setup?",
    "Is the risk/reward at least 2:1?",
    "Have I set my stop loss?",
    "Is volume above 20-day average?",
    "Am I in the right emotional state? (No FOMO/revenge)",
    "Does this fit my daily loss limit?",
    "Is the market trend aligned? (SPY direction)",
    "Have I sized the position correctly? (1% rule)",
]


@app.get("/api/tools/checklist/template")
def get_checklist_template():
    if os.path.exists(CHECKLIST_PATH):
        with open(CHECKLIST_PATH, "r") as f:
            return json.load(f)
    return {"items": DEFAULT_CHECKLIST}


class ChecklistTemplate(BaseModel):
    items: List[str]


@app.post("/api/tools/checklist/template")
def save_checklist_template(template: ChecklistTemplate):
    os.makedirs(os.path.dirname(CHECKLIST_PATH), exist_ok=True)
    with open(CHECKLIST_PATH, "w") as f:
        json.dump({"items": template.items}, f, indent=2)
    return {"status": "saved", "items": template.items}


# ──────────────────────────────────────────────────────────────────────
# ── Playbook endpoints moved to playbook_router.py (included near app setup). ──


# ---------------------------------------------------------------------------
# News Analysis (Finnhub API)
# ---------------------------------------------------------------------------

_EARNINGS_KEYWORDS = [
    "earnings", "eps", "revenue beat", "revenue miss", "quarterly results",
    "q1 ", "q2 ", "q3 ", "q4 ", "profit", "guidance", "blowout",
    "beats estimates", "misses estimates", "tops expectations",
]


def _has_earnings_keywords(articles):
    """Check if any article text mentions earnings."""
    for a in articles:
        combined = f"{a.get('title', '')} {a.get('text', '')}".lower()
        if any(kw in combined for kw in _EARNINGS_KEYWORDS):
            return True
    return False


def _fetch_earnings_data(symbol: str, api_key: str):
    """Fetch last 8 quarters of earnings from Finnhub and compute growth."""
    try:
        resp = _http_client.get(
            f"{FINNHUB_BASE_URL}/stock/earnings",
            params={"symbol": symbol, "limit": 8, "token": api_key},
            timeout=10.0,
        )
        resp.raise_for_status()
        quarters = resp.json()
        if not quarters or len(quarters) < 2:
            return None

        # Finnhub returns most recent first
        current = quarters[0]
        if current.get("actual") is None:
            return None

        result = {
            "actual": current["actual"],
            "estimate": current.get("estimate"),
            "surprise": current.get("surprise"),
            "surprisePercent": current.get("surprisePercent"),
            "period": current.get("period"),
            "quarter": current.get("quarter"),
            "year": current.get("year"),
        }

        # QoQ growth (vs previous quarter)
        prev_q = quarters[1] if len(quarters) > 1 else None
        if prev_q and prev_q.get("actual") and prev_q["actual"] != 0:
            result["qoq_growth"] = round(
                ((current["actual"] - prev_q["actual"]) / abs(prev_q["actual"])) * 100, 1
            )
            result["prev_quarter_eps"] = prev_q["actual"]

        # YoY growth (vs same quarter last year = 4 quarters back)
        yoy_q = quarters[4] if len(quarters) > 4 else None
        if yoy_q and yoy_q.get("actual") and yoy_q["actual"] != 0:
            result["yoy_growth"] = round(
                ((current["actual"] - yoy_q["actual"]) / abs(yoy_q["actual"])) * 100, 1
            )
            result["year_ago_eps"] = yoy_q["actual"]

        return result
    except Exception:
        return None


@app.get("/api/news")
def get_stock_news(
    tickers: str = Query(..., description="Comma-separated stock tickers"),
    lookback_days: int = Query(7, ge=1, le=30, description="How many days back to search"),
):
    """Fetch recent news for one or more stock tickers.

    Uses the news provider configured via QF_NEWS_PROVIDER (default: massive,
    fallback: finnhub). Response includes a per-ticker status breakdown so the
    UI can tell "no coverage" apart from "fetch failed" apart from "you didn't
    ask for anything."
    """
    from news import get_news_provider

    symbols = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not symbols:
        raise HTTPException(status_code=400, detail="No valid tickers provided")

    provider = get_news_provider()
    finnhub_key = os.getenv("FINNHUB_API_KEY")  # only used for earnings lookup

    all_articles: list = []
    earnings: dict = {}
    with_news: list[str] = []
    errors: dict[str, str] = {}

    for sym in symbols:
        try:
            articles = provider.fetch_for(sym, lookback_days=lookback_days, limit=25)
            if articles:
                all_articles.extend(articles)
                with_news.append(sym)

            # Earnings lookup still uses Finnhub (Massive's free-tier endpoints
            # for fundamentals are limited). Only run when a headline mentions
            # earnings keywords.
            if finnhub_key and _has_earnings_keywords(articles):
                edata = _fetch_earnings_data(sym, finnhub_key)
                if edata:
                    earnings[sym] = edata
        except Exception as e:
            errors[sym] = str(e)

    try:
        provider.close()
    except Exception:
        pass

    return {
        "articles": all_articles,
        "earnings": earnings,
        "provider": provider.name,
        "lookback_days": lookback_days,
        "queried": symbols,
        "with_news": with_news,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Pre-market snapshot — surfaces extended-hours price + volume + gap vs prev
# close. Designed to drop alongside the EP score card on /news.
# ---------------------------------------------------------------------------

def _classify_session(snap: dict | None) -> str:
    """Heuristically classify which session a snapshot reflects.

    Massive's snapshot doesn't carry a session flag, but we can infer:
    - day_open == 0 + minute bar exists  → pre-market (or after-hours later in day)
    - day_open > 0                       → regular session (or just after close)
    - no minute bar at all               → market closed, weekend, or stale
    """
    if not snap:
        return "closed"
    if snap.get("day_open"):
        return "regular"
    if snap.get("minute_close") is not None:
        # Without a session timestamp we can't tell pre-market from post-market
        # by data alone, but the UI labels it as "extended hours" which covers both.
        return "extended"
    return "closed"


@app.get("/api/analysis/premarket/{ticker}")
def get_premarket(ticker: str):
    """Pre-market / extended-hours snapshot for a single ticker."""
    ticker = ticker.strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="Ticker is required")
    try:
        from screener.qullamaggie.providers.massive import MassiveProvider
        mp = MassiveProvider()
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Massive provider unavailable: {e}",
        )
    try:
        snap = mp.fetch_snapshot(ticker)
    finally:
        try:
            mp.close()
        except Exception:
            pass
    if not snap:
        raise HTTPException(status_code=404, detail=f"No snapshot for '{ticker}'")
    snap["session"] = _classify_session(snap)
    return snap


# ---------------------------------------------------------------------------
# News Search Cache — stores last 500 searches with full article data
# ---------------------------------------------------------------------------
NEWS_CACHE_PATH = os.path.join(os.path.dirname(__file__), "data", "news_cache.json")
NEWS_CACHE_MAX = 500


def _load_news_cache():
    if os.path.exists(NEWS_CACHE_PATH):
        with open(NEWS_CACHE_PATH, "r") as f:
            return json.load(f)
    return []


def _save_news_cache(cache):
    with open(NEWS_CACHE_PATH, "w") as f:
        json.dump(cache[:NEWS_CACHE_MAX], f, indent=2)


@app.get("/api/news/cache")
def get_news_cache():
    """Return cached search history (last 30 entries)."""
    return {"history": _load_news_cache()}


def _bulk_snapshot_prices(symbols: list[str]) -> dict[str, dict]:
    """Best-effort bulk snapshot — one Massive call serves the prices for
    every symbol. Returns a {sym: {price, change_pct, prev_close}} mapping.
    On failure returns an empty dict; callers should treat as best-effort.
    """
    if not symbols:
        return {}
    try:
        from screener.qullamaggie.providers.massive import MassiveProvider
        mp = MassiveProvider()
    except Exception:
        return {}
    try:
        snaps = mp.fetch_snapshots(symbols)
    finally:
        try:
            mp.close()
        except Exception:
            pass
    return {
        sym: {
            "price": s.get("last_price"),
            "change_pct": s.get("change_pct"),
            "prev_close": s.get("prev_close"),
        }
        for sym, s in snaps.items()
    }


@app.post("/api/news/cache")
def save_news_cache_entry(body: dict = Body(...)):
    """Save a search result to cache. Body: {tickers, articles, earnings}

    On save we also snapshot the latest price for each ticker so the
    history list can compute return-since-search later.
    """
    tickers = [t.upper() for t in body.get("tickers", [])]
    if not tickers:
        raise HTTPException(status_code=400, detail="No tickers provided")

    # Snapshot prices once at search time (single Massive call for all tickers).
    snap = _bulk_snapshot_prices(tickers)
    snapshot_prices = {sym: snap.get(sym, {}).get("price") for sym in tickers}

    entry = {
        "tickers": tickers,
        "articles": body.get("articles", []),
        "earnings": body.get("earnings", {}),
        "epScores": body.get("epScores", {}),
        "articleCount": len(body.get("articles", [])),
        "timestamp": datetime.now().isoformat(),
        "snapshot_prices": snapshot_prices,
    }

    cache = _load_news_cache()
    # Remove duplicate (same ticker set)
    key = ",".join(sorted(tickers))
    cache = [c for c in cache if ",".join(sorted(c.get("tickers", []))) != key]
    cache.insert(0, entry)
    _save_news_cache(cache)
    return {"ok": True, "snapshot_prices": snapshot_prices}


@app.post("/api/news/cache/refresh-prices")
def refresh_news_cache_prices(body: dict = Body(...)):
    """Bulk-fetch the latest price for `symbols` in one Massive snapshot call.

    The frontend calls this when the user clicks "Refresh prices" on the
    recent-searches list. Returning {sym: {price, change_pct}} keeps the
    response small even for 150 entries.
    """
    raw = body.get("symbols") or []
    symbols = sorted({(s or "").strip().upper() for s in raw if s})
    if not symbols:
        raise HTTPException(status_code=400, detail="symbols required")
    snap = _bulk_snapshot_prices(list(symbols))
    return {
        "as_of": datetime.now().isoformat(timespec="seconds"),
        "prices": snap,
    }


_movers_cache_lock = threading.Lock()
# Cache the largest list we serve (limit=50) and slice per-request, so callers
# asking for different limits all share one upstream fetch.
_movers_cache = {"data": None, "ts": 0.0}
_MOVERS_ACTIVE_TTL = 60  # seconds during the session; market_clock stretches to 4h when closed


@app.get("/api/movers")
def get_market_movers(limit: int = Query(10, ge=1, le=50)):
    """Today's top gainers and losers across US stocks (Massive snapshot).

    Cached: the snapshot is a couple of live fetches, and after hours the data
    is frozen — market_clock.effective_cache_ttl keeps it for 4h when closed so
    the dashboard isn't re-pulling it on every visit. Best-effort: returns
    empty lists if the provider is unavailable so the card degrades gracefully.
    """
    from market_clock import effective_cache_ttl

    with _movers_cache_lock:
        if (
            _movers_cache["data"] is not None
            and (time.time() - _movers_cache["ts"]) < effective_cache_ttl(_MOVERS_ACTIVE_TTL)
        ):
            c = _movers_cache["data"]
            return {**c, "gainers": c["gainers"][:limit], "losers": c["losers"][:limit], "from_cache": True}

    try:
        from screener.qullamaggie.providers.massive import MassiveProvider
        mp = MassiveProvider()
    except Exception as e:
        return {"gainers": [], "losers": [], "provider": "massive", "error": str(e)}
    try:
        # Fetch the max we'd ever serve once; per-request limit is applied below.
        gainers = mp.fetch_movers("gainers", limit=50)
        losers = mp.fetch_movers("losers", limit=50)
    finally:
        try:
            mp.close()
        except Exception:
            pass

    payload = {
        "gainers": gainers,
        "losers": losers,
        "provider": "massive",
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }
    with _movers_cache_lock:
        _movers_cache["data"] = payload
        _movers_cache["ts"] = time.time()
    return {**payload, "gainers": gainers[:limit], "losers": losers[:limit], "from_cache": False}


@app.delete("/api/news/cache")
def clear_news_cache():
    """Clear all cached search history."""
    _save_news_cache([])
    return {"ok": True}


@app.delete("/api/news/cache/{index}")
def delete_news_cache_entry(index: int):
    """Delete a single cache entry by index."""
    cache = _load_news_cache()
    if 0 <= index < len(cache):
        cache.pop(index)
        _save_news_cache(cache)
    return {"ok": True}


# ---------------------------------------------------------------------------
# AI-Powered Criteria Analysis (Anthropic Claude API)
# ---------------------------------------------------------------------------

import anthropic

CRITERIA_SYSTEM_PROMPT = """You are an expert momentum stock analyst who evaluates stocks against two specific trading frameworks:

## Framework 1: Pradeep Bonde — CAP 10×10 MAGNA53

**CAP:**
- C — Catalyst: The stock must have a clear, identifiable catalyst (earnings beat, FDA approval, contract win, new product, M&A). No catalyst = no trade.
- A — Anticipation: Was the move anticipated? Best setups are surprises that catch the market off guard. If analysts priced it in, the edge is gone.
- P — Price Action: Price must confirm the catalyst — gap up on massive volume, clean breakout, or a powerful trend day.

**10×10 Rule:**
- 10% Gap: The stock should gap at least 10% at the open.
- 10× Volume: Volume on the gap day should be at least 10× the average daily volume.

**MAGNA53:**
- M — Market Cap: Small to mid-cap ($300M–$10B). Explosive potential that mega-caps lack.
- A — Acceleration: Earnings and revenue growth accelerating quarter over quarter.
- G — Growth: Minimum 25%+ earnings growth. Revenue must confirm.
- N — Neglect: Low analyst coverage (fewer than 5 analysts). Under-followed = more room for surprise.
- A — Actionable Setup: Clean technical pattern — proper base (3–6+ months), tight range near highs, volume contraction before breakout.
- 5 — 5 Day Return: After gap day, stock should hold gap and not give back more than 50% of day-1 move over 5 days.
- 3 — 3 Day Close: Stock should close in upper third of range for 3 consecutive days after gap.

## Framework 2: Qullamaggie — Episodic Pivot Setup

**Pre-Conditions:**
- Prior basing/consolidation (3–6+ months of sideways-to-down). The longer the base, the bigger the move.
- Identifiable fundamental catalyst significant enough to permanently re-rate the stock.
- Gap of 10%+ at open.

**Day 1 Confirmation:**
- Massive volume (5–10×+ average daily volume). Institutional algo buying in pre-market.
- Strong close in upper half of day's range, ideally near HOD.
- Range expansion: Day's range 3–5×+ ATR.

**Follow-Through:**
- Hold above gap-up open price. Gap fill = failure.
- Volume dry-up on pullback (low volume = healthy, high volume = selling).
- Higher lows on each pullback.

**Risk Management:**
- Stop below day-1 low.
- Risk 0.5–1% of account per trade.
- Target 2–5× risk minimum.

## Your Task
Given a stock ticker and its recent data (news, price action, volume), evaluate it against BOTH frameworks above. Be specific — reference actual data points. Give a clear verdict.

## Response Format
Always respond in this exact format:

**OVERALL RATING: X/10**

### Pradeep Bonde — CAP 10×10 MAGNA53
For each criterion, state PASS ✓, PARTIAL ~, or FAIL ✗ with a brief explanation using actual data.

### Qullamaggie — Episodic Pivot
For each criterion, state PASS ✓, PARTIAL ~, or FAIL ✗ with a brief explanation using actual data.

### Verdict
2-3 sentences: Is this a valid setup? What's the risk? What to watch for.
"""


@app.post("/api/analysis/criteria-check")
def criteria_check(body: dict):
    """Evaluate a stock against Pradeep Bonde and Qullamaggie criteria using Claude."""
    ticker = body.get("ticker", "").strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="Ticker is required")

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not configured. Add it to your .env file.")

    finnhub_key = os.getenv("FINNHUB_API_KEY", "")

    # Gather context data for Claude
    context_parts = [f"Stock: {ticker}\n"]

    # 1. Fetch recent news from Finnhub
    if finnhub_key:
        try:
            to_date = datetime.now().strftime("%Y-%m-%d")
            from_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
            resp = _http_client.get(
                f"{FINNHUB_BASE_URL}/company-news",
                params={"symbol": ticker, "from": from_date, "to": to_date, "token": finnhub_key},
                timeout=10,
            )
            if resp.status_code == 200:
                news = resp.json()[:8]
                if news:
                    context_parts.append("## Recent News (Last 7 Days)")
                    for a in news:
                        headline = a.get("headline", "")
                        summary = a.get("summary", "")
                        source = a.get("source", "")
                        ts = a.get("datetime", 0)
                        date_str = datetime.fromtimestamp(ts).strftime("%Y-%m-%d") if ts else ""
                        context_parts.append(f"- [{date_str}] {headline} ({source})")
                        if summary:
                            context_parts.append(f"  {summary[:200]}")
                    context_parts.append("")
        except Exception as e:
            context_parts.append(f"(News fetch failed: {str(e)})\n")

    # 2. Fetch price/volume data via the configured data provider (Massive
    # primary, yfinance fallback) — Finnhub's free-tier /stock/candle returns
    # 403, so this path no longer depends on a Finnhub key at all.
    try:
        from screener.qullamaggie.providers import get_provider as _get_data_provider
        _dp = _get_data_provider()
        df = _dp.fetch(ticker, lookback_days=365)
        try:
            _dp.close()
        except Exception:
            pass
        if df is not None and len(df) >= 2:
            closes = [float(c) for c in df["close"].tolist()]
            volumes = [float(v) for v in df["volume"].tolist()]
            highs = [float(h) for h in df["high"].tolist()]
            lows = [float(l) for l in df["low"].tolist()]
            timestamps = [int(d.timestamp()) for d in df.index]
            if True:
                if True:
                    current_price = closes[-1] if closes else None
                    prev_close = closes[-2] if len(closes) >= 2 else None

                    # Calculate key metrics
                    context_parts.append("## Price Action Data")
                    if current_price:
                        context_parts.append(f"- Current Price: ${current_price:.2f}")
                    if prev_close and current_price:
                        day_change = ((current_price / prev_close) - 1) * 100
                        context_parts.append(f"- 1-Day Change: {day_change:+.2f}%")

                    # Recent returns
                    if len(closes) >= 6:
                        ret_5d = ((closes[-1] / closes[-6]) - 1) * 100
                        context_parts.append(f"- 5-Day Return: {ret_5d:+.2f}%")
                    if len(closes) >= 22:
                        ret_1m = ((closes[-1] / closes[-22]) - 1) * 100
                        context_parts.append(f"- 1-Month Return: {ret_1m:+.2f}%")
                    if len(closes) >= 64:
                        ret_3m = ((closes[-1] / closes[-64]) - 1) * 100
                        context_parts.append(f"- 3-Month Return: {ret_3m:+.2f}%")
                    if len(closes) >= 2:
                        ret_1y = ((closes[-1] / closes[0]) - 1) * 100
                        context_parts.append(f"- 1-Year Return: {ret_1y:+.2f}%")

                    # Volume analysis
                    if volumes and len(volumes) >= 21:
                        avg_vol_20 = sum(volumes[-21:-1]) / 20
                        latest_vol = volumes[-1]
                        vol_ratio = latest_vol / avg_vol_20 if avg_vol_20 > 0 else 0
                        context_parts.append(f"\n## Volume Analysis")
                        context_parts.append(f"- Latest Volume: {latest_vol:,.0f}")
                        context_parts.append(f"- 20-Day Avg Volume: {avg_vol_20:,.0f}")
                        context_parts.append(f"- Volume Ratio (latest/avg): {vol_ratio:.1f}×")

                    # Find largest single-day gaps in last 30 days
                    if len(closes) >= 30:
                        context_parts.append(f"\n## Recent Gaps (Last 30 Trading Days)")
                        recent_n = min(30, len(closes) - 1)
                        gaps = []
                        for i in range(len(closes) - recent_n, len(closes)):
                            if i > 0:
                                gap_pct = ((closes[i] / closes[i-1]) - 1) * 100
                                vol = volumes[i] if i < len(volumes) else 0
                                date_str = datetime.fromtimestamp(timestamps[i]).strftime("%Y-%m-%d") if i < len(timestamps) else ""
                                if abs(gap_pct) >= 3:
                                    gaps.append((date_str, gap_pct, vol))
                        if gaps:
                            for date_str, gap_pct, vol in sorted(gaps, key=lambda x: abs(x[1]), reverse=True)[:5]:
                                context_parts.append(f"- {date_str}: {gap_pct:+.1f}% gap, volume {vol:,.0f}")
                        else:
                            context_parts.append("- No significant gaps (>3%) in last 30 days")

                    # Price range / basing analysis
                    if len(closes) >= 60:
                        context_parts.append(f"\n## Basing Analysis")
                        high_3m = max(highs[-63:]) if len(highs) >= 63 else max(highs)
                        low_3m = min(lows[-63:]) if len(lows) >= 63 else min(lows)
                        range_pct = ((high_3m / low_3m) - 1) * 100 if low_3m > 0 else 0
                        context_parts.append(f"- 3-Month High: ${high_3m:.2f}")
                        context_parts.append(f"- 3-Month Low: ${low_3m:.2f}")
                        context_parts.append(f"- 3-Month Range: {range_pct:.1f}%")

                    if len(closes) >= 126:
                        high_6m = max(highs[-126:])
                        low_6m = min(lows[-126:])
                        range_6m = ((high_6m / low_6m) - 1) * 100 if low_6m > 0 else 0
                        context_parts.append(f"- 6-Month High: ${high_6m:.2f}")
                        context_parts.append(f"- 6-Month Low: ${low_6m:.2f}")
                        context_parts.append(f"- 6-Month Range: {range_6m:.1f}%")

                    if len(closes) >= 252:
                        high_1y = max(highs)
                        low_1y = min(lows)
                        range_1y = ((high_1y / low_1y) - 1) * 100 if low_1y > 0 else 0
                        context_parts.append(f"- 52-Week High: ${high_1y:.2f}")
                        context_parts.append(f"- 52-Week Low: ${low_1y:.2f}")
                        context_parts.append(f"- 52-Week Range: {range_1y:.1f}%")

                    context_parts.append("")
    except Exception as e:
        context_parts.append(f"(Price data fetch failed: {str(e)})\n")

    # 3. Fetch earnings data from Finnhub
    if finnhub_key:
        edata = _fetch_earnings_data(ticker, finnhub_key)
        if edata:
            context_parts.append("## Earnings Data (Latest Quarter)")
            context_parts.append(f"- EPS Actual: ${edata.get('actual', 'N/A')}")
            context_parts.append(f"- EPS Estimate: ${edata.get('estimate', 'N/A')}")
            if edata.get('surprisePercent') is not None:
                context_parts.append(f"- Surprise: {edata['surprisePercent']:+.1f}%")
            if edata.get('yoy_growth') is not None:
                context_parts.append(f"- YoY EPS Growth: {edata['yoy_growth']:+.1f}%")
            if edata.get('qoq_growth') is not None:
                context_parts.append(f"- QoQ EPS Growth: {edata['qoq_growth']:+.1f}%")
            context_parts.append("")

    stock_context = "\n".join(context_parts)

    # 4. Call Claude API
    try:
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2000,
            system=CRITERIA_SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": f"Evaluate {ticker} against both criteria frameworks.\n\n{stock_context}"}
            ],
        )
        analysis_text = message.content[0].text
        return {"ticker": ticker, "analysis": analysis_text, "context": stock_context}
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=401, detail="Invalid ANTHROPIC_API_KEY. Check your .env file.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Claude API error: {str(e)}")


# ---------------------------------------------------------------------------
# Qullamaggie EP Scorer — deterministic letter grade per ticker
# ---------------------------------------------------------------------------

import time as _time
from ep_scorer import score_ep as _score_ep

_QULLA_EP_CACHE: dict[str, tuple[float, dict]] = {}
_QULLA_EP_TTL = 300  # 5 minutes


def _build_ep_metrics(ticker: str, finnhub_key: str) -> dict:
    """Pull all data needed to score a ticker against Qullamaggie's EP criteria."""
    metrics: dict = {
        "gap_pct": None, "volume_ratio": None, "dollar_volume": None,
        "adr_pct": None, "prior_move_pct": None,
        "float_shares": None, "market_cap": None,
        "news": [], "eps_surprise": None,
        "_data_source": None,  # internal: which provider supplied OHLCV
    }

    # Massive financial ratios — primary source for market cap, price, and
    # 30-day average volume. Shares outstanding is derived as market_cap/price.
    try:
        from screener.qullamaggie.providers.massive import MassiveProvider
        _mp = MassiveProvider()
        try:
            ratios = _mp.fetch_ratios(ticker)
            if ratios:
                if ratios.get("market_cap"):
                    metrics["market_cap"] = float(ratios["market_cap"])
                if ratios.get("market_cap") and ratios.get("price"):
                    shares_out = float(ratios["market_cap"]) / float(ratios["price"])
                    # Default float = shares outstanding; refined below if
                    # Massive's free-float endpoint succeeds.
                    metrics["float_shares"] = shares_out
            ff = _mp.fetch_float(ticker)
            if ff is not None and metrics.get("market_cap") and ratios and ratios.get("price"):
                shares_out = float(ratios["market_cap"]) / float(ratios["price"])
                metrics["float_shares"] = shares_out * (ff / 100.0 if ff > 1 else ff)
        finally:
            try:
                _mp.close()
            except Exception:
                pass
    except Exception as e:
        print(f"massive ratios/float unavailable for {ticker}: {e}")

    # Quote — best-effort gap %; OHLCV below is the real source of truth.
    if finnhub_key:
        try:
            qresp = _http_client.get(
                f"{FINNHUB_BASE_URL}/quote",
                params={"symbol": ticker, "token": finnhub_key},
                timeout=10.0,
            )
            if qresp.status_code == 200:
                quote = qresp.json() or {}
                today_open = quote.get("o")
                prev_close = quote.get("pc")
                if today_open and prev_close:
                    metrics["gap_pct"] = ((today_open / prev_close) - 1) * 100
        except Exception:
            pass

    # Profile — name + market cap + share-outstanding
    try:
        presp = _http_client.get(
            f"{FINNHUB_BASE_URL}/stock/profile2",
            params={"symbol": ticker, "token": finnhub_key},
            timeout=10.0,
        )
        if presp.status_code == 200:
            profile = presp.json() or {}
            if metrics["market_cap"] is None and profile.get("marketCapitalization"):
                # Finnhub returns market cap in millions
                metrics["market_cap"] = float(profile["marketCapitalization"]) * 1_000_000
            if metrics["float_shares"] is None and profile.get("shareOutstanding"):
                metrics["float_shares"] = float(profile["shareOutstanding"]) * 1_000_000
    except Exception:
        pass

    # Basic financials — use 10DayAverageTradingVolume + share float fallback
    try:
        mresp = _http_client.get(
            f"{FINNHUB_BASE_URL}/stock/metric",
            params={"symbol": ticker, "metric": "all", "token": finnhub_key},
            timeout=10.0,
        )
        if mresp.status_code == 200:
            mjson = mresp.json() or {}
            mdata = mjson.get("metric") or {}
            # Prefer explicit shareFloat if available
            if metrics["float_shares"] is None and mdata.get("shareFloat"):
                metrics["float_shares"] = float(mdata["shareFloat"]) * 1_000_000
    except Exception:
        pass

    # ~180 days of daily OHLCV via the configured data provider (Massive
    # default, yfinance fallback) — used for gap, volume ratio, ADR, prior move.
    try:
        from screener.qullamaggie.providers import get_provider as _get_data_provider
        _data_provider = _get_data_provider()
        metrics["_data_source"] = getattr(_data_provider, "name", "unknown")
        df = _data_provider.fetch(ticker, lookback_days=180)
        try:
            _data_provider.close()
        except Exception:
            pass
        if df is None or len(df) < 2:
            print(
                f"OHLCV fetch returned no rows for {ticker} via "
                f"{metrics['_data_source']} — volume/ADR/prior-move will be null"
            )
        if df is not None and len(df) >= 2:
            opens = df["open"].tolist()
            highs = df["high"].tolist()
            lows = df["low"].tolist()
            closes = df["close"].tolist()
            volumes = df["volume"].tolist()

            today_open = opens[-1]
            prev_close = closes[-2]
            if prev_close:
                metrics["gap_pct"] = ((today_open / prev_close) - 1) * 100

            if len(volumes) >= 51:
                avg_vol_50 = sum(volumes[-51:-1]) / 50
                today_vol = volumes[-1]
                if avg_vol_50:
                    metrics["volume_ratio"] = today_vol / avg_vol_50
                metrics["dollar_volume"] = today_vol * closes[-1]
            elif volumes:
                metrics["dollar_volume"] = volumes[-1] * closes[-1]

            if len(closes) >= 20:
                ranges = [
                    (highs[i] - lows[i]) / closes[i] * 100
                    for i in range(len(closes) - 20, len(closes))
                    if closes[i]
                ]
                if ranges:
                    metrics["adr_pct"] = sum(ranges) / len(ranges)

            if len(closes) >= 22:
                base = closes[-22]
                ref = closes[-2]
                if base:
                    metrics["prior_move_pct"] = ((ref / base) - 1) * 100
    except Exception:
        pass

    # Earnings surprise (latest quarter) — reuse helper
    try:
        edata = _fetch_earnings_data(ticker, finnhub_key)
        if edata:
            metrics["eps_surprise"] = edata
    except Exception:
        pass

    # Recent news (last 7 days) via the configured news provider — Massive's
    # feed is substantially richer than Finnhub's for the same tickers, and
    # the keyword-based catalyst classifier benefits from a longer window.
    try:
        from news import get_news_provider as _get_news_provider
        _news_provider = _get_news_provider()
        try:
            articles = _news_provider.fetch_for(ticker, lookback_days=7, limit=25)
        finally:
            try:
                _news_provider.close()
            except Exception:
                pass
        metrics["news"] = [
            {
                "title": a.get("title", ""),
                "site": a.get("site", ""),
                "url": a.get("url", ""),
                "publishedDate": a.get("publishedDate", ""),
            }
            for a in (articles or [])
        ]
    except Exception:
        pass

    return metrics


@app.get("/api/analysis/qulla-ep/{ticker}")
def qulla_ep(ticker: str):
    """Return a Qullamaggie EP letter grade for a single ticker."""
    ticker = ticker.strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="Ticker is required")

    # Finnhub is now optional — Massive handles OHLCV + news; Finnhub still
    # supplies profile (market cap, float) and quarterly earnings when keyed.
    finnhub_key = os.getenv("FINNHUB_API_KEY", "")

    # Cache lookup
    cached = _QULLA_EP_CACHE.get(ticker)
    if cached and (_time.time() - cached[0]) < _QULLA_EP_TTL:
        return cached[1]

    metrics = _build_ep_metrics(ticker, finnhub_key)
    score = _score_ep(metrics)

    result = {
        "ticker": ticker,
        "grade": score["grade"],
        "total_score": score["total_score"],
        "verdict": score["verdict"],
        "criteria": score["criteria"],
        "catalyst": score["catalyst"],
        "gap_pct": metrics["gap_pct"],
        "volume_ratio": metrics["volume_ratio"],
        "dollar_volume": metrics["dollar_volume"],
        "float_shares": metrics["float_shares"],
        "market_cap": metrics["market_cap"],
        "adr_pct": metrics["adr_pct"],
        "prior_move_pct": metrics["prior_move_pct"],
        "eps_surprise": metrics["eps_surprise"],
        "data_source": metrics.get("_data_source"),
    }

    _QULLA_EP_CACHE[ticker] = (_time.time(), result)
    return result


# ---------------------------------------------------------------------------
# Market Breadth (Stockbee-style scanner)
#
# Reads from the local grouped-daily cache built by `backend/breadth/cache.py`.
# Refresh is the only call that hits the upstream API and pulls any missing
# trading days; the read endpoints are pure pandas over cached pickles.
#
# Response cache (Trade Today / Market Monitor). The reads make no upstream
# calls, but the compute is heavy — `situational` pivots ~400 sessions × ~5k
# tickers and `regime-backtest` builds that panel twice. The underlying data
# only changes when a new session lands in the grouped cache or the universe is
# refreshed, i.e. at most once per trading day via /api/breadth/refresh. So we
# memoize each read against a cheap *freshness fingerprint* of the cache
# directory: identical fingerprint ⇒ the answer can't have changed, so we serve
# the stored payload and skip the pandas work. After the close the fingerprint
# is frozen until the next session, so overnight / weekend / holiday reloads
# never recompute. While the market is active a short TTL caps staleness as a
# backstop. Invalidated explicitly on refresh.
# ---------------------------------------------------------------------------

_BREADTH_RESP_CACHE: dict[str, tuple] = {}   # key -> (fingerprint, ts, payload)
_BREADTH_ACTIVE_TTL = 300                     # 5-min backstop while trading


def _breadth_fingerprint() -> str:
    """Cheap signature of the upstream data: (#cached days, latest day, universe
    mtime). Changes exactly when a new session is cached or the universe is
    refreshed — i.e. exactly when any breadth read could change. Pure filesystem
    metadata (a filename glob + one stat), no pickle loads."""
    from breadth.cache import list_cached_days, DATA_DIR
    days = list_cached_days()
    latest = days[-1].isoformat() if days else "none"
    try:
        uni_mtime = int((DATA_DIR / "universe.json").stat().st_mtime)
    except OSError:
        uni_mtime = 0
    return f"{len(days)}:{latest}:{uni_mtime}"


def _breadth_cached(key: str, compute):
    """Return a memoized breadth read, recomputing only when the upstream data
    fingerprint changes (or, while trading, the short backstop TTL lapses).
    Annotates the payload with a small `_cache` block so callers can see whether
    the read was served from cache."""
    from market_clock import is_market_active_now
    fp = _breadth_fingerprint()
    now = time.time()
    hit = _BREADTH_RESP_CACHE.get(key)
    if hit:
        h_fp, h_ts, payload = hit
        if h_fp == fp and (not is_market_active_now() or (now - h_ts) < _BREADTH_ACTIVE_TTL):
            return {**payload, "_cache": {"hit": True, "age_seconds": int(now - h_ts), "fingerprint": fp}}
    payload = compute()
    _BREADTH_RESP_CACHE[key] = (fp, now, payload)
    return {**payload, "_cache": {"hit": False, "fingerprint": fp}}


@app.get("/api/breadth/snapshot")
def get_breadth_snapshot():
    """Latest single-day breadth read from the local cache. No API calls."""
    def _compute():
        from breadth import compute_snapshot, classify
        snap = compute_snapshot()
        snap["regime"] = classify(snap.get("metrics"))
        return snap
    return _breadth_cached("snapshot", _compute)


@app.get("/api/breadth/history")
def get_breadth_history(days: int = Query(15, ge=1, le=120)):
    """Last `days` rows of breadth metrics, oldest→newest. Drives the table
    + sparkline charts on the Market Monitor page."""
    from breadth import compute_history
    return _breadth_cached(f"history:{days}", lambda: compute_history(days=days))


# Roughly a year of trading days — how far back we seed the SA ledger from the
# breadth cache so the 1-year history chart fills in as the cache allows.
_SA_BACKFILL_DAYS = 400


def _sa_compute(trend_days: int = 30) -> dict:
    """Compute the SA read, persist today's record, and attach 1y stats.

    Shared by the snapshot + history endpoints so the ledger is seeded the same
    way from either entry point. Pure compute over cached pickles + a small
    JSON ledger write — no upstream calls.
    """
    from breadth import compute_history, assess_situational, sa_compact_record, sa_history

    full = compute_history(days=max(trend_days, _SA_BACKFILL_DAYS))
    rows = full.get("rows", [])

    # Seed/extend the durable ledger only with days that have a fully warmed-up
    # lookback. The calculator returns qtr_up_25/qtr_down_25 = 0 (not None) for
    # early rows lacking ~63 prior sessions, so gate on T2108 being defined
    # (needs 40 obs) AND the quarterly counts not being a 0/0 warmup artifact —
    # otherwise we'd plot scores computed on incomplete inputs.
    def _seedable(r: dict) -> bool:
        if r.get("t2108") is None:
            return False
        qu, qd = r.get("qtr_up_25"), r.get("qtr_down_25")
        if qu is None or qd is None or (qu + qd) == 0:
            return False
        return True

    records = [sa_compact_record(r) for r in rows if _seedable(r)]
    if records:
        sa_history.upsert(records)

    read = assess_situational(
        rows[-trend_days:] if trend_days else rows,
        universe_size=full.get("universe_size", 0),
        universe_as_of=full.get("universe_as_of"),
    )
    ledger = sa_history.load(days=365)
    read["stats"] = sa_history.stats(ledger, read.get("score"), (read.get("stance") or {}).get("level"))
    return read


@app.get("/api/breadth/situational")
def get_breadth_situational(trend_days: int = Query(30, ge=5, le=120)):
    """Situational-awareness read: translate the local breadth history into an
    exposure stance + per-setup lights + decision criteria + score trend, and
    record today's read into the persistent daily ledger. Pure compute over the
    cached pickles — no upstream calls. Drives the Trade Today page and the
    dashboard snippet. Memoized against the cache fingerprint (see above)."""
    return _breadth_cached(f"situational:{trend_days}", lambda: _sa_compute(trend_days))


@app.get("/api/breadth/regime-backtest")
def get_breadth_regime_backtest():
    """Regime-conditioned backtest: join the SA ledger to equal-weight universe
    forward returns and report forward return by stance level + green-vs-red
    edge per setup family. Pure compute over the cached pickles + ledger.
    Seeds the ledger first so the join has rows to work with. Memoized against
    the cache fingerprint (see above)."""
    def _compute():
        _sa_compute(30)  # ensure the ledger is seeded/current before joining
        from breadth import run_regime_backtest
        return run_regime_backtest()
    return _breadth_cached("regime-backtest", _compute)


@app.get("/api/breadth/index-trend")
def get_breadth_index_trend():
    """Headline index ETFs (SPY/QQQ/IWM) trend posture from the grouped cache —
    lets the Trade Today page flag breadth-vs-price divergence. Memoized against
    the cache fingerprint."""
    from breadth import index_trend
    return _breadth_cached("index-trend", lambda: index_trend())


@app.get("/api/breadth/system-backtest")
def get_breadth_system_backtest():
    """Whole-system equity curve: sizing by the exposure stance vs. always-
    invested buy-and-hold of the equal-weight universe index. Seeds the ledger
    first so the join has rows. Memoized against the cache fingerprint."""
    def _compute():
        _sa_compute(30)  # ensure the ledger is seeded/current before the join
        from breadth import run_system_backtest
        return run_system_backtest()
    return _breadth_cached("system-backtest", _compute)


@app.get("/api/breadth/verify")
def verify_breadth():
    """Independently recount today's 4%-up/down from the raw cached EOD bars
    (a separate code path from the calculator) and compare against the figure
    the pages display. Proves the pipeline from vendor data → on-screen number,
    with sample tickers the user can spot-check on any chart."""
    from breadth import recount_4pct, compute_snapshot
    rc = recount_4pct()
    snap = compute_snapshot()
    m = snap.get("metrics") or {}
    rc["official"] = {"up_4": m.get("up_4"), "down_4": m.get("down_4"), "as_of": snap.get("as_of")}
    rc["matches"] = bool(
        rc.get("available")
        and rc.get("date") == snap.get("as_of")
        and rc.get("up_4_recount") == m.get("up_4")
        and rc.get("down_4_recount") == m.get("down_4")
    )
    return rc


@app.get("/api/breadth/situational/history")
def get_breadth_situational_history(days: int = Query(365, ge=5, le=800)):
    """Persistent daily SA history (exposure score + stance level per trading
    day) for the long-range trend chart. Seeds the ledger from the breadth
    cache on first access if it's empty."""
    from breadth import sa_history
    rows = sa_history.load(days=days)
    if not rows:
        _sa_compute(30)  # seed from cache, then re-read
        rows = sa_history.load(days=days)
    return {"rows": rows, "count": len(rows)}


@app.post("/api/breadth/refresh")
def refresh_breadth(body: dict = Body(default={})):
    """Pull any missing trading days into the grouped cache, optionally
    refresh the universe list, then recompute the latest snapshot.

    Body (all optional):
      - lookback_days: int — how far back to backfill (default 130)
      - refresh_universe: bool — force a new /v3/reference/tickers pull
    """
    from breadth import (
        refresh_grouped_cache,
        refresh_universe as _refresh_universe,
        load_or_refresh_universe,
        compute_snapshot,
        classify,
    )

    universe_refreshed = False
    try:
        if body.get("refresh_universe"):
            _refresh_universe()
            universe_refreshed = True
        else:
            # Pull a universe at least once if the cache is empty — otherwise
            # the snapshot below has nothing to score against.
            before = load_or_refresh_universe()
            universe_refreshed = before.get("as_of") and not body.get("refresh_universe") is None
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Universe refresh failed: {e}")

    lookback = int(body.get("lookback_days") or 130)
    try:
        cache_summary = refresh_grouped_cache(lookback_days=lookback)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Grouped cache refresh failed: {e}")

    # New sessions may have landed in the grouped cache — drop the memoized
    # reads so the next Trade Today / Market Monitor load recomputes fresh. (The
    # fingerprint would catch a new day anyway, but a universe-only refresh with
    # the same day set is also invalidated here.)
    _BREADTH_RESP_CACHE.clear()

    snap = compute_snapshot()
    snap["regime"] = classify(snap.get("metrics"))
    return {
        "snapshot": snap,
        "cache_summary": cache_summary,
        "universe_refreshed": universe_refreshed,
    }
