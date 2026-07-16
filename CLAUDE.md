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

# Tests (from backend/, venv active)
python -m pytest                # pytest suite in backend/tests/ (config: backend/pytest.ini)

# Data-provider sanity check (from backend/, venv active)
python -m screener.qullamaggie.test_fetch
QF_DATA_PROVIDER=yahoo python -m screener.qullamaggie.test_fetch
```

Tests live in `backend/tests/` (pytest; `pytest.ini` sets `pythonpath = .`). They favour **pure-logic units** — position sizing/validation (`trade_plans_router`), the EP scorer, the MA-reclaim math, the Setups Board aggregation — plus `test_app_routes.py`, which imports the app and asserts every critical route is registered (the safety net for moving endpoints between routers). There is no linter configured. `screener/qullamaggie/test_fetch.py` is a separate manual data-provider script, not a pytest test.

Configuration lives in `backend/.env` (template: `backend/.env.example`; a project-root `.env` also works). Key vars: `DEFAULT_TRADES_PATH` (trades Excel workbook), `MASSIVE_API_KEY`, `QF_DATA_PROVIDER` (massive|yahoo), `QF_NEWS_PROVIDER` (massive|finnhub), `ANTHROPIC_API_KEY`, `IB_*` (broker), `QF_LOG_LEVEL` (set DEBUG for per-symbol enrichment logs).

## Architecture

### Backend (`backend/`)

`main.py` (~750 lines) is now a thin hub: app setup, logging config, a request-timing middleware (logs every API call, flags >3s as SLOW), the ~20 `app.include_router(...)` registrations, and just four cross-cutting inline endpoints — `/api/health`, the Setups Board aggregator (`/api/setups/board`), and the two trade-log-plus-AI endpoints (`/api/journal/calendar`, `/api/journal/weekly-review`) that lean on `_trades_cache` + the advisor. Every feature is a self-contained package/module exposing a FastAPI `APIRouter`. (The hub was progressively carved from ~4700 lines down to ~750 into routers: `scanners_router`, `journal_router`, `playbook_router`, `trading_analysis_router` (19 analytics routes), `backtest_router`, `breadth_router`, `analyze_router`, `tools_router`, `sector_router`, and `news_router`, plus the pure-logic modules `trade_data.py`, `security.py`, `setups_board.py`. When extracting further, run `python -m pyflakes <module>.py` — it catches undefined-name misses in handler bodies that the tests can't reach.)

- `formatter/` — trade log formatter (see "Trade data pipeline" below)
- `advisor/`, `ai_trader/` — AI-powered analysis (Anthropic API)
- `screener/qullamaggie/` — breakout screener with its own provider abstraction, scoring, and sqlite snapshot cache
- `breadth/` — the market-context engine behind Trade Today / Market Monitor / Situational Awareness: `universe` (active US common-stock universe), `calculator` (Stockbee-style 4%/thrust/T2108 breadth), `situational` (exposure score + per-setup regime filter), `regime` / `regime_backtest` (forward-return validation of the filter), `sa_history` (persistent daily ledger), `index_trend`, and `verify` (independent pipeline recount). The HTTP endpoints (`/api/breadth/*`, memoized via `_breadth_cached` against a data fingerprint) live in `breadth_router.py`; `backtester/` is likewise fronted by `backtest_router.py`
- `scanners/` — pure scanner logic: `ep9m` ($9M episodic-pivot scanner), `reversal` (reversal setup), `stage_analysis` (Weinstein stages), `ma_reclaim` (200-day-MA reclaim). Their HTTP shells (thin cache + route) live in `scanners_router.py`, registered by `main.py`
- `setups_board.py` — pure aggregation for the Setups Board (`/api/setups/board`, endpoint in `main.py`): reads the five setup scanners' cached results, builds per-setup lanes + cross-scanner confluence + the regime read
- `analytics/` — `factor_model` (cross-sectional ranking) and `edge_validation` (anti-overfitting checks) over a shared `panel`
- `sector_rotation/` — the Sector Scan page's rotation intelligence: `sectors` (symbol→sector map via Massive per-ticker SIC lookups, cached in `data/sector_rotation/sector_map.json`, background-warmed), `internals` (per-sector member breadth + stealth-accumulation flag), `rrg` (RS-ratio × RS-momentum quadrants vs SPY), `leaders` (per-sector members RS-ranked). Computes from the breadth grouped cache — API-free once the map is warm
- `theme_radar/` — institutional theme-velocity analysis
- `options_flow/`, `scanners/`, `news/` — market data features
- `broker/` — Interactive Brokers via ib_insync; import is guarded in `main.py`, so broker endpoints simply vanish if ib_insync isn't installed
- `watchlists.py`, `daily_journal.py`, `calendar_router.py`, `movers_router.py`, `review_notes_router.py`, `wealthsimple_router.py`, `trade_plans_router.py`, `journal_router.py` (trade-journal CRUD), `playbook_router.py` (5-star examples + screenshots) — single-file routers
- `security.py` — shared file-endpoint guards (`_enforce_upload_limit`, `_safe_within`), imported by `main.py` and the file-serving routers
- `trade_data.py` — pure trade-workbook parsing + metrics (`read_trades_excel`, `normalize_trade_data`, `calculate_trade_metrics`); see "Trade data pipeline" below
- `trading_analysis_router.py` — the 19 `/api/trading-analysis/*` trade-log analytics endpoints (per-setup / symbol / drawdown / timing / streak / R-multiple / emotion / edge breakdowns) + the in-memory `_trades_cache`; pure compute over `trade_data` parsing, covered by `tests/test_trading_analysis.py`
- `ep_scorer.py` — deterministic, pure-function Qullamaggie EP scorer (each criterion returns a uniform checklist dict; no I/O)
- `market_clock.py` — `effective_cache_ttl()`: outside the active US-market window (weekday, not a holiday, before 5pm ET) the underlying data is frozen, so every response/snapshot cache extends its TTL aggressively (default 4h when closed). ~7 call sites import it instead of hardcoding `time.time() + TTL`.

Market data comes from Massive (primary) with Yahoo Finance fallback for OHLCV and Finnhub fallback for news, switched by `QF_DATA_PROVIDER` / `QF_NEWS_PROVIDER`. Provider implementations live in `news/` and `screener/qullamaggie/providers/`.

Runtime state is file-based: JSON files and `screener_snapshots.db` (sqlite) under `backend/data/`. There is no database server.

### Trade data pipeline (important to understand before touching analytics)

1. The actual trade-log formatter lives in a **separate sibling repo** (`../trade-log-formatter`). It parses Interactive Brokers daily PDF reports from `TRADES_BASE_PATH` (folders named `MM.YYYY`, e.g. `06.2026`) and writes the trades Excel workbook.
2. `backend/formatter/` is only a thin wrapper that shells out to that script and streams progress back to the UI via SSE (`/api/formatter/run/{date}`, `/api/formatter/run-daily/{month}`).
3. Analytics endpoints read the workbook at `DEFAULT_TRADES_PATH` via `read_trades_excel()` (in `trade_data.py`), which has a critical quirk: scale-out (multi-fill) exits are stored as literal arithmetic Excel formulas (e.g. `=((100*49.401)+(125*54.61))/225`); pandas reads formula cells as NaN, so `read_trades_excel` re-evaluates them with openpyxl. Bypassing this helper silently drops every scale-out trade. This is covered by `tests/test_trade_data.py`.
4. `normalize_trade_data()` (also `trade_data.py`) filters to **closed trades only** (rows with an Exit Price); open positions are intentionally excluded from analytics. `trade_data.py` holds the pure parsing/metrics core; the in-memory mtime cache (`_trades_cache`) and the review-notes overlay stay in `main.py`.
5. Editable review fields (notes, setup, grade, emotion…) live in a sidecar (`backend/data/review_notes.json`) and are merged over the Excel data on every load — the sidecar is authoritative for those fields because the user edits them through the Review UI, not Excel.
6. Trade data is cached in memory keyed by the workbook's mtime; `?force=1` on `/api/trading-analysis/load-default` bypasses it.

### Frontend (`frontend/src/`)

- `pages/` — one component per route; routes are declared with route-level code-splitting in `App.jsx` (each page is its own chunk)
- The sidebar (`components/Layout.jsx`) organizes pages by a trading **workflow**, not alphabetically: Overview → 1 · Market Context (Trade Today, Market Monitor, Theme Radar) → 2 · Find Setups (Stage Analysis, Breakouts, $9M Scanner, Reversal, Sector Scan, Earnings, Stock Analysis, Options Flow) → 3 · Plan & Execute (Rules, Playbook, Tools, Watchlist, AI Trader) → 4 · Review & Learn (Review, Journal, Trading Analysis, Wealthsimple, Yearly Strongest) → Research & Validation (Edge Validation, Factor Model, Backtesting, Signal Lab, Bot Trader). Note "Trade Today" is the label for the `/situational-awareness` route.
- `api/` — one client module per backend router (e.g. `tradingAnalysis.js`, `wealthsimple.js`); all calls go through the Vite `/api` proxy, so there are no hardcoded backend URLs
- `components/` — shared UI, with feature-specific subfolders (`analysis/`, `review/`, `screener/`)
- `autorefresh/` — a background daily-warm queue. On boot, every registered job (in `registry.js`) that hasn't run today is enqueued and drained **serially** (one warm at a time, ~700ms gap) so we never fan out a burst of expensive scans; each job writes an on-disk server cache so the page reads fresh data on mount. Per-job freshness is a `localStorage` wall-clock stamp that also drives the "Updated …" label on the shared `RefreshControl`. Auto is ON by default per job.
- Styling is Tailwind (dark fintech theme); charts are Recharts and lightweight-charts

A `__BUILD_ID__` constant is baked into the bundle by `vite.config.js` to verify the browser is running fresh code rather than a cached bundle.

### Security

QuantForge is single-user and localhost-bound; see `SECURITY.md` for the full threat model. Practical rules when touching the backend:

- **Never widen CORS or bind `0.0.0.0`.** The allow-list in `main.py` is exactly the two localhost origins; uvicorn stays on `127.0.0.1`. There is no auth layer — network exposure is the user's responsibility.
- **File uploads** go through `_enforce_upload_limit()` (25 MB cap → `413`); reuse it for any new upload endpoint. Stored filenames are always server-generated, never the client's.
- **Serving a file by a path parameter** must go through `_safe_within(base_dir, filename)`, which contains the resolved path to its directory (rejects `..`, absolute paths, symlink escapes).
- Both guards live in `backend/security.py` (import them from there, not from `main.py`); they're covered by `tests/test_security.py`.
- **Secrets** live only in `backend/.env` (git-ignored). Never commit real keys or echo a key value to logs — startup logging reports only "set / missing".
