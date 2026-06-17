# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

QuantForge is a personal full-stack trading platform: backtesting, real-trade analytics, journaling, screeners, options flow, and Interactive Brokers order execution. Two processes: a Python FastAPI backend (port 8000) and a React/Vite frontend (port 5173) that proxies `/api/*` to the backend.

## Commands

```bash
./start.sh                 # Start backend + frontend together (creates venv / installs deps on first run)

# Backend only
cd backend && source venv/bin/activate
python -m uvicorn main:app --reload --port 8000

# Frontend only
cd frontend && npm run dev      # dev server on :5173
cd frontend && npm run build    # production build (vite build)

# Data-provider sanity check (from backend/, venv active)
python -m screener.qullamaggie.test_fetch
QF_DATA_PROVIDER=yahoo python -m screener.qullamaggie.test_fetch
```

There is no test suite and no linter configured. `test_fetch.py` is a manual sanity script, not a pytest test.

Configuration lives in `backend/.env` (template: `backend/.env.example`; a project-root `.env` also works). Key vars: `DEFAULT_TRADES_PATH` (trades Excel workbook), `MASSIVE_API_KEY`, `QF_DATA_PROVIDER` (massive|yahoo), `QF_NEWS_PROVIDER` (massive|finnhub), `ANTHROPIC_API_KEY`, `IB_*` (broker), `QF_LOG_LEVEL` (set DEBUG for per-symbol enrichment logs).

## Architecture

### Backend (`backend/`)

`main.py` (~4100 lines) is the hub: app setup, logging config, a request-timing middleware (logs every API call, flags >3s as SLOW), plus all backtesting and trading-analysis endpoints inline. Every other feature is a self-contained package/module exposing a FastAPI `APIRouter` that `main.py` registers:

- `formatter/` — trade log formatter (see "Trade data pipeline" below)
- `advisor/`, `ai_trader/` — AI-powered analysis (Anthropic API)
- `screener/qullamaggie/` — breakout screener with its own provider abstraction, scoring, and sqlite snapshot cache
- `options_flow/`, `scanners/`, `breadth/`, `news/` — market data features
- `broker/` — Interactive Brokers via ib_insync; import is guarded in `main.py`, so broker endpoints simply vanish if ib_insync isn't installed
- `watchlists.py`, `daily_journal.py`, `calendar_router.py`, `movers_router.py`, `review_notes_router.py`, `wealthsimple_router.py` — single-file routers

Market data comes from Massive (primary) with Yahoo Finance fallback for OHLCV and Finnhub fallback for news, switched by `QF_DATA_PROVIDER` / `QF_NEWS_PROVIDER`. Provider implementations live in `news/` and `screener/qullamaggie/providers/`.

Runtime state is file-based: JSON files and `screener_snapshots.db` (sqlite) under `backend/data/`. There is no database server.

### Trade data pipeline (important to understand before touching analytics)

1. The actual trade-log formatter lives in a **separate sibling repo** (`../trade-log-formatter`). It parses Interactive Brokers daily PDF reports from `TRADES_BASE_PATH` (folders named `MM.YYYY`, e.g. `06.2026`) and writes the trades Excel workbook.
2. `backend/formatter/` is only a thin wrapper that shells out to that script and streams progress back to the UI via SSE (`/api/formatter/run/{date}`, `/api/formatter/run-daily/{month}`).
3. Analytics endpoints read the workbook at `DEFAULT_TRADES_PATH` via `read_trades_excel()` in `main.py`, which has a critical quirk: scale-out (multi-fill) exits are stored as literal arithmetic Excel formulas (e.g. `=((100*49.401)+(125*54.61))/225`); pandas reads formula cells as NaN, so `read_trades_excel` re-evaluates them with openpyxl. Bypassing this helper silently drops every scale-out trade.
4. `normalize_trade_data()` filters to **closed trades only** (rows with an Exit Price); open positions are intentionally excluded from analytics.
5. Editable review fields (notes, setup, grade, emotion…) live in a sidecar (`backend/data/review_notes.json`) and are merged over the Excel data on every load — the sidecar is authoritative for those fields because the user edits them through the Review UI, not Excel.
6. Trade data is cached in memory keyed by the workbook's mtime; `?force=1` on `/api/trading-analysis/load-default` bypasses it.

### Frontend (`frontend/src/`)

- `pages/` — one component per route; routes are declared with route-level code-splitting in `App.jsx` (each page is its own chunk)
- `api/` — one client module per backend router (e.g. `tradingAnalysis.js`, `wealthsimple.js`); all calls go through the Vite `/api` proxy, so there are no hardcoded backend URLs
- `components/` — shared UI, with feature-specific subfolders (`analysis/`, `review/`, `screener/`)
- Styling is Tailwind (dark fintech theme); charts are Recharts and lightweight-charts

A `__BUILD_ID__` constant is baked into the bundle by `vite.config.js` to verify the browser is running fresh code rather than a cached bundle.
