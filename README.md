# QuantForge

A full-stack trading platform for backtesting strategies, analyzing real trade history, journaling, and executing orders via Interactive Brokers — all in a dark fintech-style dashboard.

## Features

### Backtesting
- **Previous Day Breakout** — Buy when price closes above previous day high, sell when it breaks below
- **Indicator Strategies** — SMA Crossover, RSI, Mean Reversion, Buy & Hold
- **Multi-symbol support** — Backtest across multiple tickers with aggregate summaries
- Equity curves, performance metrics, and full trade history

### Trading Analysis
Upload your real trade data (Excel) or load a default file, then get:
- **Performance Metrics** — Win rate, profit factor, Sharpe ratio, max drawdown, expectancy
- **Key Insights Summary** — Data-driven strengths, weaknesses, and opportunities
- **P&L Distribution** — Histogram of trade outcomes
- **Daily P&L Heatmap** — GitHub-style calendar view (weekdays only)
- **Hold Time vs P&L** — Scatter plot of trade duration vs outcome
- **Streak & Tilt Detection** — Consecutive wins/losses, revenge trade patterns
- **Entry/Exit Timing** — Win rate by hour of day, filterable by month
- **Setup & Symbol Stats** — Performance breakdown by trade setup and ticker
- **Market Cap Performance** — Win rate by Mega/Large/Mid/Small/Micro cap
- **Portfolio vs SPY Benchmark** — Cumulative return comparison with alpha
- **R-Multiple Analysis** — Risk-normalized returns using 1% portfolio risk rule
- **Rolling Performance** — 10/20/50-trade rolling win rate and P&L
- **Drawdown Analysis** — Drawdown periods and recovery tracking

### Trade Journal
- Log pre-trade plan, emotions (entry & exit), lessons learned, and execution rating (1-5 stars)
- Tag trades with custom labels (earnings, gap-up, thesis-failed, etc.)
- Search and filter by emotion, rating, or keyword
- Stats dashboard: average rating, most common emotions, top tags

### Trading Tools
- **Position Sizer** — Calculate shares to buy using Fixed % risk, Kelly Criterion, or ATR-based sizing
- **Pre-Trade Checklist** — Customizable 8-item discipline checklist with progress tracking

### Bot Trader (Interactive Brokers)
- Connect to TWS or IB Gateway (paper or live account)
- Account summary: net liquidation, cash, buying power, available funds
- View positions and open orders in real-time (3s polling)
- Place Market, Limit, and Stop orders with confirmation modal
- Paper/Live toggle with safety warnings for live mode
- US stocks only (IBKR Canada IIROC 3200A compliance)

### Sector Screener
- Live sector performance via SPDR ETFs (fetched from Yahoo Finance)
- File-based caching with in-memory 5-minute cache
- Automatic fallback to demo data when rate-limited

### Market Breadth & Situational Awareness
- **Market Monitor** — Stockbee-style breadth across the active US common-stock universe (~5,000 names): 4% up/down movers, 5/10-day thrust ratios, quarterly/monthly ±25% leadership, and a local T2108 (% of the universe above its 40-day SMA)
- **Situational Awareness** — turns that breadth into an *actionable, setup-specific* read: an exposure score (0–100) and stance (aggressive → cash), plus a green/amber/red light per setup family (momentum breakouts, episodic pivots, pullbacks, mean-reversion, shorts), each with a live ✓/✗ decision checklist
- **How & why** — every read is fully auditable: score build-up off a neutral 50 baseline, a stance-band ladder, per-factor scoring criteria, and the drivers behind the number (rules-as-data, so what's shown can't drift from what's computed)
- **Persistent daily ledger** with 1-year statistical context (percentile vs the trailing year, days-in-regime) and a 1M/3M/6M/1Y exposure history chart
- **Regime-conditioned backtest** — joins the ledger to equal-weight universe forward returns to measure forward return by stance and the green-vs-red edge per setup (the empirical check on whether the filter actually works)
- **Provenance & honesty** — real end-of-day prices from the Massive grouped-daily endpoint; the read is a *backward-looking regime filter, not a timing signal*; thresholds are Stockbee's published method plus heuristic scoring priors. A built-in pipeline verifier independently recounts the 4%-movers straight from the raw cached bars so the on-screen numbers are traceable to source

## Tech Stack

| Layer    | Technology                                           |
|----------|------------------------------------------------------|
| Backend  | Python, FastAPI, pandas, NumPy, yfinance, ib_insync  |
| Frontend | React 18, Vite, Tailwind CSS, Recharts               |
| Broker   | Interactive Brokers (TWS / IB Gateway)               |
| Data     | Massive (grouped-daily EOD), Yahoo Finance, Excel trade files, JSON storage |

## Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+
- (Optional) TWS or IB Gateway for Bot Trader

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file in `backend/` (see `.env.example`):

```env
DEFAULT_TRADES_PATH=/path/to/your/Trades_2025.xlsx
```

Start the server:

```bash
uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

### 3. Open the app

Visit **http://localhost:5173** — the frontend proxies `/api` requests to the backend.

## Project Structure

```
quantforge/
├── backend/
│   ├── main.py                # FastAPI app & all endpoints
│   ├── requirements.txt
│   ├── .env.example           # Environment variable template
│   ├── data/                  # Runtime data (journal, checklist)
│   ├── backtester/
│   │   ├── engine.py          # Backtest engine
│   │   ├── breakout_engine.py # Breakout strategy engine
│   │   ├── strategies.py      # Strategy implementations
│   │   └── data_fetcher.py    # Yahoo Finance data fetcher
│   └── broker/
│       ├── connection.py      # IB connection wrapper (ib_insync)
│       ├── manager.py         # Singleton broker instance
│       └── router.py          # FastAPI router for /api/broker/*
├── frontend/
│   ├── src/
│   │   ├── api/               # API client modules
│   │   ├── components/        # Reusable UI components
│   │   └── pages/             # All app pages
│   ├── package.json
│   └── vite.config.js
├── .gitignore
└── README.md
```

## API Endpoints

### Backtesting
| Method | Endpoint                      | Description                     |
|--------|-------------------------------|---------------------------------|
| GET    | `/api/strategies`             | List available strategies       |
| POST   | `/api/backtest/run`           | Run single-symbol backtest      |
| POST   | `/api/backtest/run-multi`     | Run multi-symbol backtest       |
| POST   | `/api/backtest/run-breakout`  | Run breakout strategy backtest  |

### Trading Analysis
| Method | Endpoint                                      | Description                        |
|--------|-----------------------------------------------|------------------------------------|
| GET    | `/api/trading-analysis/load-default`          | Load default trade file            |
| POST   | `/api/trading-analysis/upload`                | Upload trade data (Excel)          |
| POST   | `/api/trading-analysis/analyze`               | Full trade analysis                |
| POST   | `/api/trading-analysis/statistics`            | Core trade statistics              |
| POST   | `/api/trading-analysis/setup-statistics`      | Stats by trade setup               |
| POST   | `/api/trading-analysis/symbol-statistics`     | Stats by ticker symbol             |
| POST   | `/api/trading-analysis/drawdown-analysis`     | Drawdown periods                   |
| POST   | `/api/trading-analysis/time-performance`      | Performance by time period         |
| POST   | `/api/trading-analysis/rolling-performance`   | Rolling window metrics             |
| POST   | `/api/trading-analysis/advanced-metrics`      | Sharpe, Sortino, expectancy        |
| POST   | `/api/trading-analysis/entry-timing-analysis` | Win rate by entry/exit hour        |
| POST   | `/api/trading-analysis/streak-detection`      | Win/loss streaks & tilt detection  |
| POST   | `/api/trading-analysis/market-cap-performance`| Performance by market cap tier     |
| POST   | `/api/trading-analysis/benchmark-comparison`  | Portfolio vs SPY comparison        |
| POST   | `/api/trading-analysis/r-multiple`            | R-multiple analysis (1% risk)      |

### Trade Journal
| Method | Endpoint                              | Description                |
|--------|---------------------------------------|----------------------------|
| GET    | `/api/journal/entries`                | List all journal entries   |
| GET    | `/api/journal/entries/{trade_id}`     | Get single entry           |
| POST   | `/api/journal/entries`                | Create/update entry        |
| DELETE | `/api/journal/entries/{trade_id}`     | Delete entry               |
| GET    | `/api/journal/stats`                  | Aggregate journal stats    |
| GET    | `/api/journal/search?q=keyword`       | Full-text search           |

### Trading Tools
| Method | Endpoint                         | Description                |
|--------|----------------------------------|----------------------------|
| POST   | `/api/tools/position-size`       | Calculate position size    |
| GET    | `/api/tools/checklist/template`  | Get checklist template     |
| POST   | `/api/tools/checklist/template`  | Save checklist template    |

### Bot Trader (Interactive Brokers)
| Method | Endpoint                            | Description              |
|--------|-------------------------------------|--------------------------|
| POST   | `/api/broker/connect`               | Connect to TWS/Gateway   |
| POST   | `/api/broker/disconnect`            | Disconnect               |
| GET    | `/api/broker/status`                | Connection status        |
| GET    | `/api/broker/account`               | Account summary          |
| GET    | `/api/broker/positions`             | Current positions        |
| GET    | `/api/broker/orders`                | Open orders              |
| POST   | `/api/broker/orders/place`          | Place order (US only)    |
| POST   | `/api/broker/orders/cancel/{id}`    | Cancel order             |

### Screener
| Method | Endpoint                                     | Description                    |
|--------|----------------------------------------------|--------------------------------|
| GET    | `/api/screener/sector-performance`           | Sector ETF performance data    |
| GET    | `/api/screener/sector-performance/progress`  | Fetch progress (polling)       |

## Environment Variables

| Variable              | Description                           | Default                    |
|-----------------------|---------------------------------------|----------------------------|
| `DEFAULT_TRADES_PATH` | Path to default trades Excel file     | `trades/Trades_2025.xlsx`  |
| `JOURNAL_PATH`        | Journal storage file path             | `data/journal.json`        |
| `CHECKLIST_PATH`      | Checklist template file path          | `data/checklist_template.json` |

## License

MIT
