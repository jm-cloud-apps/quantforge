"""FastAPI backend for stock backtesting application."""

import os
import json
import logging
import sys
import time
from datetime import datetime, timedelta
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from typing import Optional
from dotenv import load_dotenv

# Used by the weekly-review endpoint (the AI review); previously pulled in via a
# mid-file import in the news section, which now lives in news_router.py.
import anthropic


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
    get_parabolic_scan,
    get_breakdown_scan,
)
app.include_router(scanners_router)

# Trade Journal + Playbook CRUD routers (extracted from main.py). `_load_journal`
# is imported because a trade-analytics endpoint here merges journal data.
from journal_router import router as journal_router, _load_journal
from playbook_router import router as playbook_router
app.include_router(journal_router)
app.include_router(playbook_router)

# Pure trade-workbook parsing + metrics (the scale-out formula eval, the
# closed-trade normalizer, the metrics). The review-notes overlay that wraps these
# stays in main.py.
from trade_data import normalize_trade_data

# Trading-analysis router (the trade-log analytics). `_trades_cache` is imported
# because main.py's calendar / weekly-review endpoints reuse the loaded trades.
from trading_analysis_router import router as trading_analysis_router, _trades_cache
app.include_router(trading_analysis_router)

# Backtesting router (single / multi / breakout backtests over the backtester engine).
from backtest_router import router as backtest_router
app.include_router(backtest_router)

# Breadth / situational router. `get_breadth_situational` is imported because the
# Setups Board aggregator reads the regime stance from it.
from breadth_router import router as breadth_router, get_breadth_situational
app.include_router(breadth_router)

# Research/validation (factor model, edge validation) + trading tools (position
# size, checklist) routers.
from analyze_router import router as analyze_router
from tools_router import router as tools_router
app.include_router(analyze_router)
app.include_router(tools_router)

# Sector-performance screener (Sector Scan page's ETF performance grid).
from sector_router import router as sector_router
app.include_router(sector_router)

# News + per-ticker analysis (news, premarket, news-cache, movers, EP/criteria).
from news_router import router as news_router
app.include_router(news_router)

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

from review_notes_router import router as review_notes_router
app.include_router(review_notes_router)

from wealthsimple_router import router as wealthsimple_router
app.include_router(wealthsimple_router)

from trade_plans_router import router as trade_plans_router
app.include_router(trade_plans_router)

# Process analytics over the plan store + the trade workbook: plan-vs-fill
# compliance, holding-period edge, post-exit excursion, and setup decay.
from discipline_router import router as discipline_router
app.include_router(discipline_router)

# Sector-rotation intelligence (internals / RRG / leaders) — computes from the
# breadth grouped cache + a cached symbol→sector map, so it's API-free once warm
from sector_rotation.router import router as sector_rotation_router
app.include_router(sector_rotation_router)

# Pre-market prep: the 6M/3M/1M relative-strength scan (off the breadth cache)
# plus the persisted record of each weekend/evening prep run.
from prep_router import router as prep_router
app.include_router(prep_router)

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


# ── Backtesting endpoints moved to backtest_router.py (included near app setup). ──


@app.get("/api/health")
def health():
    """Health check."""
    return {"status": "ok"}


# Trading Analysis Endpoints

# ── Trading-analysis endpoints moved to trading_analysis_router.py (included near app setup). ──


# _money() (edge-insights $ formatter) moved to trading_analysis_router.py.


# ── calculate_trade_metrics moved to trade_data.py (imported near app setup). ──


# ── Sector-performance screener endpoints moved to sector_router.py (included near app setup). ──


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
    _safe("parabolic", lambda: get_parabolic_scan(force=f))
    _safe("breakdown", lambda: get_breakdown_scan(force=f))
    _safe("regime", lambda: get_breadth_situational(trend_days=30))

    board = build_board(sources)
    board["generated_at"] = datetime.now().isoformat(timespec="seconds")

    _SETUPS_BOARD_CACHE["day"] = data_day
    _SETUPS_BOARD_CACHE["result"] = board
    _SETUPS_BOARD_CACHE["ts"] = now
    return {**board, "from_cache": False}


# ── Factor model + edge validation moved to analyze_router.py (included near app setup). ──


# ── Position-size + checklist tools moved to tools_router.py (included near app setup). ──


# ──────────────────────────────────────────────────────────────────────
# ── Playbook endpoints moved to playbook_router.py (included near app setup). ──


# ── News + per-ticker analysis endpoints moved to news_router.py (included near app setup). ──
