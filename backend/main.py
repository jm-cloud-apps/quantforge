"""FastAPI backend for stock backtesting application."""

import os
import json
import math
import threading
from datetime import datetime, timedelta
import pandas as pd
import numpy as np
import httpx
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query, Body
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
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

# One-shot startup log so it's easy to see which providers are wired.
print(
    f"[startup] MASSIVE_API_KEY={'set' if os.getenv('MASSIVE_API_KEY') else 'MISSING'} "
    f"FINNHUB_API_KEY={'set' if os.getenv('FINNHUB_API_KEY') else 'missing'} "
    f"QF_DATA_PROVIDER={os.getenv('QF_DATA_PROVIDER', 'massive')} "
    f"QF_NEWS_PROVIDER={os.getenv('QF_NEWS_PROVIDER', 'massive')}"
)

# In-memory cache for trading analysis data
_trades_cache = {
    "file_mtime": None,
    "data": None,
}


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

# Register Options Flow router (Tier-D — Unusual Whales-style)
from options_flow.router import router as options_flow_router
app.include_router(options_flow_router)

from watchlists import router as watchlists_router
app.include_router(watchlists_router)

from daily_journal import router as daily_journal_router
app.include_router(daily_journal_router)

from calendar_router import router as calendar_router
app.include_router(calendar_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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

class TradeDataRequest(BaseModel):
    trades: List[dict]


class RMultipleRequest(BaseModel):
    trades: List[dict]
    initial_capital: float = 100000


@app.get("/api/trading-analysis/file-status")
def get_file_status():
    """Return the last-modified timestamp of the default trades file."""
    default_path = os.getenv("DEFAULT_TRADES_PATH", "trades/Trades.xlsx")
    try:
        mtime = os.path.getmtime(default_path)
        return {"mtime": mtime, "path": default_path}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Default trades file not found")


@app.get("/api/trading-analysis/load-default")
def load_default_trades(force: int = 0):
    """Load trades from the default file path. Uses in-memory cache if file
    hasn't changed. Pass ?force=1 to bypass the cache after an out-of-band
    edit (e.g., a hand edit in Excel that didn't bump mtime visibly)."""
    default_path = os.getenv("DEFAULT_TRADES_PATH", "trades/Trades.xlsx")

    try:
        current_mtime = os.path.getmtime(default_path)

        # Return cached data if file hasn't been modified and the caller
        # didn't explicitly ask for a fresh read.
        if (
            not force
            and _trades_cache["file_mtime"] == current_mtime
            and _trades_cache["data"] is not None
        ):
            return {**_trades_cache["data"], "from_cache": True}

        df = pd.read_excel(default_path)

        # Clean up dataframe - remove unnamed columns
        df = df.loc[:, ~df.columns.str.contains('^Unnamed')]

        total_rows = len(df)

        # Normalize column names to match expected format. Note that this
        # filters to closed trades only (rows with an exit_price). Open
        # positions are intentionally excluded from the analytics page.
        trades = normalize_trade_data(df)

        # Surface how many rows were dropped so the UI can explain
        # "X trades hidden — still open" instead of silently omitting them.
        open_count = max(0, total_rows - len(trades))

        # Calculate metrics
        metrics = calculate_trade_metrics(trades)

        result = {
            "trades": trades,
            "metrics": metrics,
            "total_records": len(trades),
            "open_positions_excluded": open_count,
            "total_rows_in_file": total_rows,
            "source": "default_file",
            "file_mtime": current_mtime,
        }

        # Update cache
        _trades_cache["file_mtime"] = current_mtime
        _trades_cache["data"] = result

        return {**result, "from_cache": False}

    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Default trades file not found at {default_path}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading default trades: {str(e)}")


@app.post("/api/trading-analysis/upload")
async def upload_trade_data(file: UploadFile = File(...)):
    """
    Upload and parse trade data from CSV or Excel file.
    Expected columns: Symbol, Qty, Side, Entry Price, Entry Date, Exit Price, Exit Date, Profit / Loss, Profit / Loss %
    """
    try:
        contents = await file.read()

        # Determine file type and read accordingly
        if file.filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(contents))
        elif file.filename.endswith(('.xlsx', '.xls')):
            df = pd.read_excel(io.BytesIO(contents))
        else:
            raise HTTPException(status_code=400, detail="Unsupported file format. Please upload CSV or Excel file.")

        # Clean up dataframe - remove unnamed columns
        df = df.loc[:, ~df.columns.str.contains('^Unnamed')]

        # Normalize column names to match expected format
        trades = normalize_trade_data(df)

        # Calculate metrics
        metrics = calculate_trade_metrics(trades)

        return {
            "trades": trades,
            "metrics": metrics,
            "total_records": len(trades)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")


@app.post("/api/trading-analysis/analyze")
def analyze_trade_data(request: TradeDataRequest):
    """Analyze trade data and return comprehensive metrics."""
    try:
        trades = request.trades
        metrics = calculate_trade_metrics(trades)

        # Calculate time-based metrics
        if trades:
            df = pd.DataFrame(trades)
            # Use exit_date as the primary date for analysis
            date_column = None
            if 'exit_date' in df.columns:
                date_column = 'exit_date'
            elif 'date' in df.columns:
                date_column = 'date'

            if date_column:
                df['date'] = pd.to_datetime(df[date_column])
                df = df.sort_values('date')

                # Monthly P&L
                df['month'] = df['date'].dt.to_period('M')
                monthly_pnl = df.groupby('month')['pnl'].sum().reset_index()
                monthly_pnl['month'] = monthly_pnl['month'].astype(str)

                # Cumulative P&L
                df['cumulative_pnl'] = df['pnl'].cumsum()
                cumulative_pnl = df[['date', 'cumulative_pnl']].to_dict('records')

                metrics['monthly_pnl'] = monthly_pnl.to_dict('records')
                metrics['cumulative_pnl'] = cumulative_pnl

        return metrics

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing trades: {str(e)}")


@app.post("/api/trading-analysis/statistics")
def get_trade_statistics(request: TradeDataRequest):
    """Get detailed trade statistics."""
    try:
        trades = request.trades

        if not trades:
            raise HTTPException(status_code=400, detail="No trade data provided")

        df = pd.DataFrame(trades)

        winning_trades = [t for t in trades if t.get('pnl', 0) > 0]
        losing_trades = [t for t in trades if t.get('pnl', 0) <= 0]

        # Calculate consecutive wins/losses
        pnl_series = df['pnl'].values
        max_consecutive_wins = 0
        max_consecutive_losses = 0
        current_wins = 0
        current_losses = 0

        for pnl in pnl_series:
            if pnl > 0:
                current_wins += 1
                current_losses = 0
                max_consecutive_wins = max(max_consecutive_wins, current_wins)
            else:
                current_losses += 1
                current_wins = 0
                max_consecutive_losses = max(max_consecutive_losses, current_losses)

        # Calculate expectancy
        win_rate = len(winning_trades) / len(trades) if trades else 0
        avg_win = np.mean([t['pnl'] for t in winning_trades]) if winning_trades else 0
        avg_loss = abs(np.mean([t['pnl'] for t in losing_trades])) if losing_trades else 0
        expectancy = (win_rate * avg_win) - ((1 - win_rate) * avg_loss)

        # Kelly Criterion
        if avg_loss > 0:
            kelly = (win_rate * avg_win - (1 - win_rate) * avg_loss) / avg_win
        else:
            kelly = 0

        # Calculate average trade duration (in days and time components)
        avg_duration_days = 0
        avg_duration_hours = 0
        avg_duration_minutes = 0

        if 'duration_days' in df.columns:
            valid_durations = df['duration_days'].dropna()
            if len(valid_durations) > 0:
                avg_duration_days = valid_durations.mean()
                # Convert to hours and minutes for better granularity
                avg_duration_hours = avg_duration_days * 24
                avg_duration_minutes = avg_duration_hours * 60

        # Calculate duration for winners vs losers
        winners_df = df[df['pnl'] > 0]
        losers_df = df[df['pnl'] <= 0]

        avg_winner_duration = 0
        avg_loser_duration = 0

        if 'duration_days' in winners_df.columns and len(winners_df) > 0:
            avg_winner_duration = winners_df['duration_days'].mean()
        if 'duration_days' in losers_df.columns and len(losers_df) > 0:
            avg_loser_duration = losers_df['duration_days'].mean()

        return {
            "largest_win": round(max([t['pnl'] for t in trades]), 2) if trades else 0,
            "largest_loss": round(min([t['pnl'] for t in trades]), 2) if trades else 0,
            "avg_trade_duration_days": round(avg_duration_days, 1),
            "avg_trade_duration_hours": round(avg_duration_hours, 1),
            "avg_trade_duration_minutes": round(avg_duration_minutes, 0),
            "avg_winner_duration_days": round(avg_winner_duration, 1),
            "avg_loser_duration_days": round(avg_loser_duration, 1),
            "consecutive_wins": max_consecutive_wins,
            "consecutive_losses": max_consecutive_losses,
            "expectancy": round(expectancy, 2),
            "risk_reward_ratio": round(avg_win / avg_loss, 2) if avg_loss > 0 else 0,
            "kelly_criterion_pct": round(kelly * 100, 1) if kelly > 0 else 0,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating statistics: {str(e)}")


def normalize_trade_data(df):
    """
    Normalize trade data from various formats to a consistent structure.
    Handles the specific format from Trades_2025.xlsx with columns like:
    Symbol, Qty, Side, Entry Price, Entry Date, Exit Price, Exit Date, Profit / Loss, Profit / Loss %
    """
    # Column mapping - handles different naming conventions
    column_mapping = {
        'Symbol': 'symbol',
        'Qty': 'quantity',
        'Side': 'side',
        'Entry Price': 'entry_price',
        'Entry Date': 'entry_date',
        'Entry Time': 'entry_time',
        'Exit Price': 'exit_price',
        'Exit Date': 'exit_date',
        'Exit Time': 'exit_time',
        'Exit Qty': 'exit_quantity',
        'Profit / Loss': 'pnl',
        'Profit / Loss %': 'pnl_pct',
        'Setup': 'setup',
        'Entry Notes': 'entry_notes',
        'Notes': 'notes',
        'Market Cap': 'market_cap',
        'Stock/Option': 'instrument_type',
        'Emotion': 'emotion',
        'Conviction': 'conviction',
        'Stop Price': 'stop_price',
        'Target Price': 'target_price',
        'Grade': 'grade',
    }

    # Rename columns if they exist
    df_renamed = df.rename(columns=column_mapping)

    # Filter only closed trades (those with exit prices)
    df_filtered = df_renamed[df_renamed['exit_price'].notna()].copy()

    # Ensure date columns are datetime
    if 'entry_date' in df_filtered.columns:
        df_filtered['entry_date'] = pd.to_datetime(df_filtered['entry_date'], errors='coerce')
    if 'exit_date' in df_filtered.columns:
        df_filtered['exit_date'] = pd.to_datetime(df_filtered['exit_date'], errors='coerce')

    # Calculate trade duration in days
    if 'entry_date' in df_filtered.columns and 'exit_date' in df_filtered.columns:
        df_filtered['duration_days'] = (df_filtered['exit_date'] - df_filtered['entry_date']).dt.days

    # Calculate P&L if not present
    if 'pnl' not in df_filtered.columns or df_filtered['pnl'].isna().all():
        df_filtered['pnl'] = (df_filtered['exit_price'] - df_filtered['entry_price']) * df_filtered['quantity']

    # Handle pnl_pct - if it exists but is in decimal form (0.12 instead of 12%), convert it
    if 'pnl_pct' in df_filtered.columns and not df_filtered['pnl_pct'].isna().all():
        # Check if values are in decimal form (between -1 and 1 for most cases)
        sample_values = df_filtered['pnl_pct'].dropna().head(10)
        if len(sample_values) > 0 and sample_values.abs().max() < 10:
            # Likely in decimal form, convert to percentage
            df_filtered['pnl_pct'] = df_filtered['pnl_pct'] * 100
    elif 'pnl_pct' not in df_filtered.columns or df_filtered['pnl_pct'].isna().all():
        df_filtered['pnl_pct'] = ((df_filtered['exit_price'] - df_filtered['entry_price']) / df_filtered['entry_price']) * 100

    # Convert to list of dicts, handling NaN values
    trades = df_filtered.to_dict('records')

    # Clean up NaN values and convert dates to ISO strings
    for trade in trades:
        for key, value in trade.items():
            if pd.isna(value):
                if key in ['entry_date', 'exit_date', 'entry_time', 'exit_time']:
                    trade[key] = None
                elif key in ['stop_price', 'target_price', 'conviction']:
                    trade[key] = None
                elif isinstance(value, (float, int)):
                    trade[key] = 0
                else:
                    trade[key] = ''
            elif key in ['entry_date', 'exit_date'] and hasattr(value, 'isoformat'):
                trade[key] = value.isoformat()

    return trades


@app.post("/api/trading-analysis/setup-statistics")
def get_setup_statistics(request: TradeDataRequest):
    """Get statistics broken down by setup type."""
    try:
        trades = request.trades

        if not trades:
            raise HTTPException(status_code=400, detail="No trade data provided")

        df = pd.DataFrame(trades)

        # Check if setup column exists
        if 'setup' not in df.columns:
            return {"setups": [], "message": "No setup data available"}

        # Group by setup
        setup_stats = []

        for setup in df['setup'].dropna().unique():
            setup_trades = df[df['setup'] == setup]

            winning_trades = setup_trades[setup_trades['pnl'] > 0]
            losing_trades = setup_trades[setup_trades['pnl'] <= 0]

            total_pnl = setup_trades['pnl'].sum()
            win_rate = (len(winning_trades) / len(setup_trades) * 100) if len(setup_trades) > 0 else 0
            avg_pnl = setup_trades['pnl'].mean()

            setup_stats.append({
                "setup": setup,
                "total_trades": len(setup_trades),
                "winning_trades": len(winning_trades),
                "losing_trades": len(losing_trades),
                "total_pnl": round(total_pnl, 2),
                "avg_pnl": round(avg_pnl, 2),
                "win_rate": round(win_rate, 1),
                "best_trade": round(setup_trades['pnl'].max(), 2),
                "worst_trade": round(setup_trades['pnl'].min(), 2),
            })

        # Sort by total P&L descending
        setup_stats.sort(key=lambda x: x['total_pnl'], reverse=True)

        return {"setups": setup_stats}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating setup statistics: {str(e)}")


@app.post("/api/trading-analysis/symbol-statistics")
def get_symbol_statistics(request: TradeDataRequest):
    """Get statistics broken down by symbol."""
    try:
        trades = request.trades

        if not trades:
            raise HTTPException(status_code=400, detail="No trade data provided")

        df = pd.DataFrame(trades)

        # Group by symbol
        symbol_stats = []

        for symbol in df['symbol'].dropna().unique():
            symbol_trades = df[df['symbol'] == symbol]

            winning_trades = symbol_trades[symbol_trades['pnl'] > 0]
            losing_trades = symbol_trades[symbol_trades['pnl'] <= 0]

            total_pnl = symbol_trades['pnl'].sum()
            win_rate = (len(winning_trades) / len(symbol_trades) * 100) if len(symbol_trades) > 0 else 0
            avg_pnl = symbol_trades['pnl'].mean()

            symbol_stats.append({
                "symbol": symbol,
                "total_trades": len(symbol_trades),
                "winning_trades": len(winning_trades),
                "losing_trades": len(losing_trades),
                "total_pnl": round(total_pnl, 2),
                "avg_pnl": round(avg_pnl, 2),
                "win_rate": round(win_rate, 1),
                "best_trade": round(symbol_trades['pnl'].max(), 2),
                "worst_trade": round(symbol_trades['pnl'].min(), 2),
            })

        # Sort by total P&L descending
        symbol_stats.sort(key=lambda x: x['total_pnl'], reverse=True)

        return {"symbols": symbol_stats}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating symbol statistics: {str(e)}")


@app.post("/api/trading-analysis/drawdown-analysis")
def get_drawdown_analysis(request: TradeDataRequest):
    """Calculate drawdown metrics."""
    try:
        trades = request.trades
        if not trades:
            raise HTTPException(status_code=400, detail="No trade data provided")

        df = pd.DataFrame(trades)

        # Use exit_date for chronological ordering
        date_column = 'exit_date' if 'exit_date' in df.columns else 'date'
        if date_column not in df.columns:
            return {"error": "No date column found"}

        df['date'] = pd.to_datetime(df[date_column])
        df = df.sort_values('date')

        # Calculate cumulative P&L and equity curve
        df['cumulative_pnl'] = df['pnl'].cumsum()
        df['peak'] = df['cumulative_pnl'].cummax()
        df['drawdown'] = df['cumulative_pnl'] - df['peak']
        df['drawdown_pct'] = (df['drawdown'] / df['peak'].replace(0, 1)) * 100

        # Find maximum drawdown
        max_dd_idx = df['drawdown'].idxmin()
        max_drawdown = df.loc[max_dd_idx, 'drawdown']
        max_drawdown_pct = df.loc[max_dd_idx, 'drawdown_pct']

        # Find peak before max drawdown
        peak_before_dd = df.loc[:max_dd_idx, 'peak'].max()
        peak_date_idx = df.loc[:max_dd_idx][df['peak'] == peak_before_dd].index[-1]
        peak_date = df.loc[peak_date_idx, 'date']
        trough_date = df.loc[max_dd_idx, 'date']

        # Calculate recovery (if recovered)
        recovery_date = None
        days_to_recover = None
        recovered = False

        after_trough = df.loc[max_dd_idx:]
        recovery_idx = after_trough[after_trough['cumulative_pnl'] >= peak_before_dd].index
        if len(recovery_idx) > 0:
            recovery_date = df.loc[recovery_idx[0], 'date']
            days_to_recover = (recovery_date - trough_date).days
            recovered = True

        # Current drawdown
        current_peak = df['peak'].iloc[-1]
        current_pnl = df['cumulative_pnl'].iloc[-1]
        current_drawdown = current_pnl - current_peak
        current_drawdown_pct = (current_drawdown / current_peak * 100) if current_peak > 0 else 0

        # Average drawdown
        drawdown_periods = []
        in_drawdown = False
        dd_start = None

        for idx, row in df.iterrows():
            if row['drawdown'] < 0 and not in_drawdown:
                in_drawdown = True
                dd_start = idx
            elif row['drawdown'] == 0 and in_drawdown:
                in_drawdown = False
                if dd_start is not None:
                    dd_data = df.loc[dd_start:idx]
                    drawdown_periods.append({
                        'max_dd': dd_data['drawdown'].min(),
                        'duration': len(dd_data)
                    })

        avg_drawdown = np.mean([dd['max_dd'] for dd in drawdown_periods]) if drawdown_periods else 0
        avg_dd_duration = np.mean([dd['duration'] for dd in drawdown_periods]) if drawdown_periods else 0

        # Equity curve data for chart
        equity_curve = df[['date', 'cumulative_pnl', 'peak', 'drawdown']].to_dict('records')

        return {
            "max_drawdown": round(max_drawdown, 2),
            "max_drawdown_pct": round(max_drawdown_pct, 2),
            "peak_date": peak_date.isoformat() if pd.notna(peak_date) else None,
            "trough_date": trough_date.isoformat() if pd.notna(trough_date) else None,
            "recovery_date": recovery_date.isoformat() if recovery_date and pd.notna(recovery_date) else None,
            "days_to_recover": int(days_to_recover) if days_to_recover else None,
            "recovered": recovered,
            "current_drawdown": round(current_drawdown, 2),
            "current_drawdown_pct": round(current_drawdown_pct, 2),
            "avg_drawdown": round(avg_drawdown, 2),
            "avg_drawdown_duration": round(avg_dd_duration, 1),
            "total_drawdown_periods": len(drawdown_periods),
            "equity_curve": equity_curve
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating drawdown: {str(e)}")


@app.post("/api/trading-analysis/time-performance")
def get_time_performance(request: TradeDataRequest):
    """Analyze performance by time periods (day of week, month, hour)."""
    try:
        trades = request.trades
        if not trades:
            raise HTTPException(status_code=400, detail="No trade data provided")

        df = pd.DataFrame(trades)

        # Use exit_date for analysis
        date_column = 'exit_date' if 'exit_date' in df.columns else 'date'
        if date_column not in df.columns:
            return {"error": "No date column found"}

        df['date'] = pd.to_datetime(df[date_column])

        # Day of week analysis
        df['day_of_week'] = df['date'].dt.day_name()
        day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

        dow_stats = []
        for day in day_order:
            day_trades = df[df['day_of_week'] == day]
            if len(day_trades) > 0:
                winning = day_trades[day_trades['pnl'] > 0]
                dow_stats.append({
                    'day': day,
                    'total_trades': len(day_trades),
                    'total_pnl': round(day_trades['pnl'].sum(), 2),
                    'avg_pnl': round(day_trades['pnl'].mean(), 2),
                    'win_rate': round((len(winning) / len(day_trades) * 100), 1),
                    'winning_trades': len(winning),
                    'losing_trades': len(day_trades) - len(winning)
                })

        # Monthly analysis
        df['month'] = df['date'].dt.to_period('M').astype(str)
        monthly_stats = []

        for month in df['month'].unique():
            month_trades = df[df['month'] == month]
            winning = month_trades[month_trades['pnl'] > 0]
            monthly_stats.append({
                'month': month,
                'total_trades': len(month_trades),
                'total_pnl': round(month_trades['pnl'].sum(), 2),
                'avg_pnl': round(month_trades['pnl'].mean(), 2),
                'win_rate': round((len(winning) / len(month_trades) * 100), 1),
                'winning_trades': len(winning),
                'losing_trades': len(month_trades) - len(winning)
            })

        # Sort monthly stats chronologically
        monthly_stats.sort(key=lambda x: x['month'])

        return {
            "day_of_week": dow_stats,
            "monthly": monthly_stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating time performance: {str(e)}")


@app.post("/api/trading-analysis/rolling-performance")
def get_rolling_performance(request: TradeDataRequest):
    """Calculate rolling performance metrics."""
    try:
        trades = request.trades
        if not trades:
            raise HTTPException(status_code=400, detail="No trade data provided")

        df = pd.DataFrame(trades)

        date_column = 'exit_date' if 'exit_date' in df.columns else 'date'
        if date_column not in df.columns:
            return {"error": "No date column found"}

        df['date'] = pd.to_datetime(df[date_column])
        df = df.sort_values('date')

        # 30-day rolling metrics
        df['cumulative_pnl'] = df['pnl'].cumsum()

        rolling_data = []
        window_size = 30  # 30 trades window

        for i in range(window_size, len(df) + 1):
            window = df.iloc[i-window_size:i]
            winning = window[window['pnl'] > 0]

            rolling_data.append({
                'trade_number': i,
                'date': window['date'].iloc[-1].isoformat(),
                'pnl': round(window['pnl'].sum(), 2),
                'win_rate': round((len(winning) / len(window) * 100), 1),
                'avg_pnl': round(window['pnl'].mean(), 2),
                'cumulative_pnl': round(df.iloc[i-1]['cumulative_pnl'], 2)
            })

        return {"rolling_30_trades": rolling_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating rolling performance: {str(e)}")


@app.post("/api/trading-analysis/advanced-metrics")
def get_advanced_metrics(request: TradeDataRequest):
    """Calculate advanced risk-adjusted metrics (Sharpe, Sortino, Calmar)."""
    try:
        trades = request.trades
        if not trades:
            raise HTTPException(status_code=400, detail="No trade data provided")

        df = pd.DataFrame(trades)

        # Calculate returns
        returns = df['pnl'].values

        if len(returns) == 0:
            return {"error": "No returns data"}

        # Sharpe Ratio (assuming risk-free rate of 0 for simplicity)
        mean_return = np.mean(returns)
        std_return = np.std(returns)
        sharpe_ratio = (mean_return / std_return) if std_return > 0 else 0

        # Sortino Ratio (only penalize downside volatility)
        downside_returns = returns[returns < 0]
        downside_std = np.std(downside_returns) if len(downside_returns) > 0 else 0
        sortino_ratio = (mean_return / downside_std) if downside_std > 0 else 0

        # Calmar Ratio (return / max drawdown)
        date_column = 'exit_date' if 'exit_date' in df.columns else 'date'
        if date_column in df.columns:
            df['date'] = pd.to_datetime(df[date_column])
            df = df.sort_values('date')
            df['cumulative_pnl'] = df['pnl'].cumsum()
            df['peak'] = df['cumulative_pnl'].cummax()
            df['drawdown'] = df['cumulative_pnl'] - df['peak']

            max_drawdown = abs(df['drawdown'].min())
            total_return = df['cumulative_pnl'].iloc[-1]
            calmar_ratio = (total_return / max_drawdown) if max_drawdown > 0 else 0
        else:
            calmar_ratio = 0
            max_drawdown = 0

        return {
            "sharpe_ratio": round(sharpe_ratio, 3),
            "sortino_ratio": round(sortino_ratio, 3),
            "calmar_ratio": round(calmar_ratio, 3),
            "mean_return": round(mean_return, 2),
            "std_return": round(std_return, 2),
            "downside_std": round(downside_std, 2)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating advanced metrics: {str(e)}")


@app.post("/api/trading-analysis/entry-timing-analysis")
def get_entry_timing_analysis(request: TradeDataRequest):
    """Analyze performance by entry time relative to market open."""
    try:
        trades = request.trades
        if not trades:
            raise HTTPException(status_code=400, detail="No trade data provided")

        df = pd.DataFrame(trades)

        # Check if entry_time exists
        if 'entry_time' not in df.columns or df['entry_time'].isna().all():
            return {"error": "No entry time data available"}

        # Parse entry_time - handle different formats
        def parse_time(time_val):
            if pd.isna(time_val):
                return None
            if isinstance(time_val, str):
                # Handle various time formats
                try:
                    return pd.to_datetime(time_val, format='%H:%M:%S').time()
                except:
                    try:
                        return pd.to_datetime(time_val).time()
                    except:
                        return None
            elif hasattr(time_val, 'time'):
                return time_val.time()
            else:
                return None

        df['parsed_time'] = df['entry_time'].apply(parse_time)
        df = df[df['parsed_time'].notna()].copy()

        if len(df) == 0:
            return {"error": "No valid entry times found"}

        # Convert time to minutes from market open (9:30 AM = 0 minutes)
        def minutes_from_open(time_obj):
            if time_obj is None:
                return None
            market_open_minutes = 9 * 60 + 30  # 9:30 AM in minutes
            time_minutes = time_obj.hour * 60 + time_obj.minute
            return time_minutes - market_open_minutes

        df['minutes_from_open'] = df['parsed_time'].apply(minutes_from_open)

        # Define time buckets
        def categorize_entry_time(minutes):
            if minutes < 0:
                return "Pre-market"
            elif minutes <= 5:
                return "0-5 min"
            elif minutes <= 15:
                return "5-15 min"
            elif minutes <= 30:
                return "15-30 min"
            elif minutes <= 60:
                return "30-60 min"
            elif minutes <= 120:
                return "1-2 hours"
            elif minutes <= 330:
                return "Mid-day (11:30-3:00)"
            elif minutes <= 390:
                return "Power hour (3:00-4:00)"
            else:
                return "After hours"

        df['time_bucket'] = df['minutes_from_open'].apply(categorize_entry_time)

        # Calculate stats for each bucket
        bucket_order = [
            "0-5 min", "5-15 min", "15-30 min", "30-60 min",
            "1-2 hours", "Mid-day (11:30-3:00)", "Power hour (3:00-4:00)",
            "Pre-market", "After hours"
        ]

        entry_stats = []
        for bucket in bucket_order:
            bucket_trades = df[df['time_bucket'] == bucket]
            if len(bucket_trades) > 0:
                winning = bucket_trades[bucket_trades['pnl'] > 0]
                entry_stats.append({
                    'time_bucket': bucket,
                    'total_trades': len(bucket_trades),
                    'total_pnl': round(bucket_trades['pnl'].sum(), 2),
                    'avg_pnl': round(bucket_trades['pnl'].mean(), 2),
                    'win_rate': round((len(winning) / len(bucket_trades) * 100), 1),
                    'winning_trades': len(winning),
                    'losing_trades': len(bucket_trades) - len(winning),
                    'best_trade': round(bucket_trades['pnl'].max(), 2),
                    'worst_trade': round(bucket_trades['pnl'].min(), 2)
                })

        # Also analyze exit timing
        exit_stats = []
        if 'exit_time' in df.columns and not df['exit_time'].isna().all():
            df['parsed_exit_time'] = df['exit_time'].apply(parse_time)
            df_with_exit = df[df['parsed_exit_time'].notna()].copy()

            if len(df_with_exit) > 0:
                df_with_exit['exit_minutes_from_open'] = df_with_exit['parsed_exit_time'].apply(minutes_from_open)
                df_with_exit['exit_time_bucket'] = df_with_exit['exit_minutes_from_open'].apply(categorize_entry_time)

                for bucket in bucket_order:
                    bucket_trades = df_with_exit[df_with_exit['exit_time_bucket'] == bucket]
                    if len(bucket_trades) > 0:
                        winning = bucket_trades[bucket_trades['pnl'] > 0]
                        exit_stats.append({
                            'time_bucket': bucket,
                            'total_trades': len(bucket_trades),
                            'total_pnl': round(bucket_trades['pnl'].sum(), 2),
                            'avg_pnl': round(bucket_trades['pnl'].mean(), 2),
                            'win_rate': round((len(winning) / len(bucket_trades) * 100), 1),
                            'winning_trades': len(winning),
                            'losing_trades': len(bucket_trades) - len(winning)
                        })

        return {
            "entry_timing": entry_stats,
            "exit_timing": exit_stats if exit_stats else None
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating entry timing: {str(e)}")


@app.post("/api/trading-analysis/streak-detection")
def get_streak_detection(request: TradeDataRequest):
    """Detect losing/winning streaks and potential tilt/revenge trading patterns."""
    try:
        trades = request.trades
        if not trades:
            raise HTTPException(status_code=400, detail="No trade data provided")

        df = pd.DataFrame(trades)

        date_column = 'exit_date' if 'exit_date' in df.columns else 'date'
        if date_column in df.columns:
            df['date'] = pd.to_datetime(df[date_column])
            df = df.sort_values('date').reset_index(drop=True)

        pnl_list = df['pnl'].tolist()

        # Calculate streaks (3+ consecutive wins or losses)
        streaks = []
        if pnl_list:
            streak_type = 'win' if pnl_list[0] > 0 else 'loss'
            streak_start = 0
            streak_len = 1

            for i in range(1, len(pnl_list)):
                is_win = pnl_list[i] > 0
                current_type = 'win' if is_win else 'loss'

                if current_type == streak_type:
                    streak_len += 1
                else:
                    if streak_len >= 3:
                        streak_pnl = sum(pnl_list[streak_start:i])
                        streaks.append({
                            'type': streak_type,
                            'length': streak_len,
                            'start_date': df.iloc[streak_start]['date'].isoformat() if 'date' in df.columns else None,
                            'end_date': df.iloc[i - 1]['date'].isoformat() if 'date' in df.columns else None,
                            'total_pnl': round(streak_pnl, 2),
                        })
                    streak_type = current_type
                    streak_start = i
                    streak_len = 1

            # Final streak
            if streak_len >= 3:
                streak_pnl = sum(pnl_list[streak_start:])
                streaks.append({
                    'type': streak_type,
                    'length': streak_len,
                    'start_date': df.iloc[streak_start]['date'].isoformat() if 'date' in df.columns else None,
                    'end_date': df.iloc[-1]['date'].isoformat() if 'date' in df.columns else None,
                    'total_pnl': round(streak_pnl, 2),
                })

        # Detect revenge trades (trade entered within 24h after a loss)
        revenge_trades = []
        if 'entry_date' in df.columns and 'date' in df.columns:
            df['entry_date_parsed'] = pd.to_datetime(df['entry_date'], errors='coerce')
            for i in range(1, len(df)):
                prev_pnl = df.iloc[i - 1]['pnl']
                if prev_pnl < 0:
                    prev_exit = df.iloc[i - 1]['date']
                    curr_entry = df.iloc[i].get('entry_date_parsed')
                    if pd.notna(prev_exit) and pd.notna(curr_entry):
                        hours_diff = (curr_entry - prev_exit).total_seconds() / 3600
                        if 0 <= hours_diff <= 24:
                            revenge_trades.append({
                                'trade_index': i,
                                'symbol': df.iloc[i].get('symbol', ''),
                                'pnl': round(df.iloc[i]['pnl'], 2),
                                'previous_loss': round(prev_pnl, 2),
                                'hours_after_loss': round(hours_diff, 1),
                                'date': df.iloc[i]['date'].isoformat() if pd.notna(df.iloc[i]['date']) else None,
                            })

        revenge_losses = [r for r in revenge_trades if r['pnl'] < 0]
        tilt_score = (len(revenge_losses) / len(revenge_trades) * 100) if revenge_trades else 0

        losing_streaks = [s for s in streaks if s['type'] == 'loss']
        winning_streaks = [s for s in streaks if s['type'] == 'win']

        return {
            'streaks': streaks,
            'losing_streaks': len(losing_streaks),
            'winning_streaks': len(winning_streaks),
            'longest_losing_streak': max([s['length'] for s in losing_streaks]) if losing_streaks else 0,
            'longest_winning_streak': max([s['length'] for s in winning_streaks]) if winning_streaks else 0,
            'worst_streak_pnl': round(min([s['total_pnl'] for s in losing_streaks]), 2) if losing_streaks else 0,
            'revenge_trades': revenge_trades[:20],
            'total_revenge_trades': len(revenge_trades),
            'revenge_trade_loss_rate': round(tilt_score, 1),
            'tilt_score': round(tilt_score, 1),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error detecting streaks: {str(e)}")


def classify_market_cap(value):
    """Classify a numeric market cap value into standard categories."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return 'Unknown'
    # Handle string labels passed through directly (e.g. "Large-cap")
    if isinstance(value, str):
        lower = value.lower()
        if '#' in lower or 'field' in lower or 'error' in lower or 'n/a' in lower:
            return 'Unknown'
        # Already a category label
        for cat in ['Mega-cap', 'Large-cap', 'Mid-cap', 'Small-cap', 'Micro-cap']:
            if cat.lower() in lower:
                return cat + {
                    'mega-cap': ' (>$200B)', 'large-cap': ' ($10B-$200B)',
                    'mid-cap': ' ($2B-$10B)', 'small-cap': ' ($500M-$2B)',
                    'micro-cap': ' (<$500M)',
                }.get(cat.lower(), '')
    try:
        v = float(value)
        if math.isnan(v) or math.isinf(v):
            return 'Unknown'
    except (TypeError, ValueError):
        return 'Unknown'
    if v >= 200_000_000_000:
        return 'Mega-cap (>$200B)'
    elif v >= 10_000_000_000:
        return 'Large-cap ($10B-$200B)'
    elif v >= 2_000_000_000:
        return 'Mid-cap ($2B-$10B)'
    elif v >= 500_000_000:
        return 'Small-cap ($500M-$2B)'
    else:
        return 'Micro-cap (<$500M)'


# Defines display order for market cap categories (largest first)
MARKET_CAP_ORDER = [
    'Mega-cap (>$200B)',
    'Large-cap ($10B-$200B)',
    'Mid-cap ($2B-$10B)',
    'Small-cap ($500M-$2B)',
    'Micro-cap (<$500M)',
    'Unknown',
]


@app.post("/api/trading-analysis/market-cap-performance")
def get_market_cap_performance(request: TradeDataRequest):
    """Analyze performance broken down by market cap category."""
    try:
        trades = request.trades
        if not trades:
            raise HTTPException(status_code=400, detail="No trade data provided")

        df = pd.DataFrame(trades)

        if 'market_cap' not in df.columns or df['market_cap'].isna().all():
            return {"categories": [], "message": "No market cap data available"}

        df['market_cap_category'] = df['market_cap'].apply(classify_market_cap)

        categories = []
        for cap in df['market_cap_category'].unique():
            cap_trades = df[df['market_cap_category'] == cap]
            winning = cap_trades[cap_trades['pnl'] > 0]

            categories.append({
                'market_cap': cap,
                'total_trades': len(cap_trades),
                'winning_trades': len(winning),
                'losing_trades': len(cap_trades) - len(winning),
                'win_rate': round(len(winning) / len(cap_trades) * 100, 1) if len(cap_trades) > 0 else 0,
                'total_pnl': round(cap_trades['pnl'].sum(), 2),
                'avg_pnl': round(cap_trades['pnl'].mean(), 2),
                'best_trade': round(cap_trades['pnl'].max(), 2),
                'worst_trade': round(cap_trades['pnl'].min(), 2),
            })

        # Sort by standard market cap order
        cap_order = {name: i for i, name in enumerate(MARKET_CAP_ORDER)}
        categories.sort(key=lambda x: cap_order.get(x['market_cap'], 99))

        return {"categories": categories}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating market cap performance: {str(e)}")


@app.post("/api/trading-analysis/benchmark-comparison")
def get_benchmark_comparison(request: TradeDataRequest):
    """Compare portfolio performance against SPY benchmark."""
    try:
        trades = request.trades
        if not trades:
            raise HTTPException(status_code=400, detail="No trade data provided")

        df = pd.DataFrame(trades)

        date_column = 'exit_date' if 'exit_date' in df.columns else 'date'
        if date_column not in df.columns:
            return {"error": "No date column found"}

        df['date'] = pd.to_datetime(df[date_column])
        df = df.sort_values('date')

        start_date = df['date'].min()
        end_date = df['date'].max()

        # Fetch SPY data
        spy_data = []
        try:
            spy = yf.Ticker('SPY')
            spy_hist = spy.history(start=start_date, end=end_date + timedelta(days=1))

            if not spy_hist.empty:
                spy_hist['return'] = spy_hist['Close'].pct_change().fillna(0)
                spy_hist['cumulative_return'] = (1 + spy_hist['return']).cumprod() - 1
                spy_hist['cumulative_return_pct'] = spy_hist['cumulative_return'] * 100

                for idx, row in spy_hist.iterrows():
                    spy_data.append({
                        'date': idx.strftime('%Y-%m-%d'),
                        'spy_return_pct': round(float(row['cumulative_return_pct']), 2)
                    })
        except Exception as spy_err:
            print(f"Could not fetch SPY data: {spy_err}")

        # Calculate portfolio cumulative return
        df['cumulative_pnl'] = df['pnl'].cumsum()
        initial_capital = 100000
        df['portfolio_return_pct'] = (df['cumulative_pnl'] / initial_capital) * 100

        portfolio_data = []
        for _, row in df.iterrows():
            portfolio_data.append({
                'date': row['date'].strftime('%Y-%m-%d'),
                'portfolio_return_pct': round(float(row['portfolio_return_pct']), 2)
            })

        portfolio_total_return = float(df['portfolio_return_pct'].iloc[-1]) if len(df) > 0 else 0
        spy_total_return = spy_data[-1]['spy_return_pct'] if spy_data else 0
        alpha = portfolio_total_return - spy_total_return

        return {
            'portfolio_data': portfolio_data,
            'spy_data': spy_data,
            'portfolio_total_return': round(portfolio_total_return, 2),
            'spy_total_return': round(spy_total_return, 2),
            'alpha': round(alpha, 2),
            'start_date': start_date.strftime('%Y-%m-%d'),
            'end_date': end_date.strftime('%Y-%m-%d'),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating benchmark comparison: {str(e)}")


@app.post("/api/trading-analysis/r-multiple")
def get_r_multiple_analysis(request: RMultipleRequest):
    """Calculate R-multiple for each trade using 1% portfolio risk rule."""
    try:
        trades = request.trades
        initial_capital = request.initial_capital

        if not trades:
            raise HTTPException(status_code=400, detail="No trade data provided")

        df = pd.DataFrame(trades)

        date_column = 'exit_date' if 'exit_date' in df.columns else 'date'
        if date_column in df.columns:
            df['date'] = pd.to_datetime(df[date_column])
            df = df.sort_values('date').reset_index(drop=True)

        cumulative_pnl = 0.0
        r_multiples = []

        for _, row in df.iterrows():
            portfolio_value = initial_capital + cumulative_pnl
            risk_amount = portfolio_value * 0.01

            r_multiple = row['pnl'] / risk_amount if risk_amount > 0 else 0

            r_multiples.append({
                'symbol': row.get('symbol', ''),
                'date': row['date'].strftime('%Y-%m-%d') if 'date' in row and pd.notna(row.get('date')) else None,
                'pnl': round(float(row['pnl']), 2),
                'portfolio_value': round(portfolio_value, 2),
                'risk_amount': round(risk_amount, 2),
                'r_multiple': round(float(r_multiple), 2),
            })

            cumulative_pnl += row['pnl']

        r_values = [r['r_multiple'] for r in r_multiples]

        if r_values:
            avg_r = float(np.mean(r_values))
            median_r = float(np.median(r_values))
            best_r = max(r_values)
            worst_r = min(r_values)
            positive_r = len([r for r in r_values if r > 0])
            negative_r = len([r for r in r_values if r <= 0])
            cumulative_r = sum(r_values)

            bucket_order = ['<-3R', '-3R to -2R', '-2R to -1R', '-1R to 0', '0 to 1R', '1R to 2R', '2R to 3R', '>3R']
            distribution = {b: 0 for b in bucket_order}
            for r in r_values:
                if r <= -3:
                    distribution['<-3R'] += 1
                elif r <= -2:
                    distribution['-3R to -2R'] += 1
                elif r <= -1:
                    distribution['-2R to -1R'] += 1
                elif r <= 0:
                    distribution['-1R to 0'] += 1
                elif r <= 1:
                    distribution['0 to 1R'] += 1
                elif r <= 2:
                    distribution['1R to 2R'] += 1
                elif r <= 3:
                    distribution['2R to 3R'] += 1
                else:
                    distribution['>3R'] += 1

            distribution_list = [{'bucket': b, 'count': distribution[b]} for b in bucket_order]
        else:
            avg_r = median_r = best_r = worst_r = cumulative_r = 0
            positive_r = negative_r = 0
            distribution_list = []

        return {
            'trades': r_multiples,
            'avg_r': round(avg_r, 2),
            'median_r': round(median_r, 2),
            'best_r': round(best_r, 2),
            'worst_r': round(worst_r, 2),
            'positive_r_trades': positive_r,
            'negative_r_trades': negative_r,
            'cumulative_r': round(cumulative_r, 2),
            'distribution': distribution_list,
            'initial_capital': initial_capital,
            'risk_pct': 1.0,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating R-multiples: {str(e)}")


@app.post("/api/trading-analysis/emotion-performance")
def get_emotion_performance(request: TradeDataRequest):
    """Analyze performance broken down by emotion at entry, conviction level, and trade grade."""
    try:
        trades = request.trades
        if not trades:
            raise HTTPException(status_code=400, detail="No trade data provided")

        df = pd.DataFrame(trades)
        result = {}

        # --- Emotion breakdown ---
        if 'emotion' in df.columns and df['emotion'].notna().any() and (df['emotion'] != '').any():
            emotion_df = df[df['emotion'].notna() & (df['emotion'] != '')]
            emotion_stats = []
            for emotion in emotion_df['emotion'].unique():
                e_trades = emotion_df[emotion_df['emotion'] == emotion]
                winning = e_trades[e_trades['pnl'] > 0]
                total_pnl = float(e_trades['pnl'].sum())
                avg_pnl = float(e_trades['pnl'].mean())
                win_rate = (len(winning) / len(e_trades) * 100) if len(e_trades) > 0 else 0
                avg_win = float(winning['pnl'].mean()) if len(winning) > 0 else 0
                losing = e_trades[e_trades['pnl'] <= 0]
                avg_loss = float(losing['pnl'].mean()) if len(losing) > 0 else 0

                emotion_stats.append({
                    "emotion": emotion,
                    "total_trades": len(e_trades),
                    "winning_trades": len(winning),
                    "losing_trades": len(losing),
                    "win_rate": round(win_rate, 1),
                    "total_pnl": round(total_pnl, 2),
                    "avg_pnl": round(avg_pnl, 2),
                    "avg_win": round(avg_win, 2),
                    "avg_loss": round(avg_loss, 2),
                    "best_trade": round(float(e_trades['pnl'].max()), 2),
                    "worst_trade": round(float(e_trades['pnl'].min()), 2),
                })

            emotion_stats.sort(key=lambda x: x['total_pnl'], reverse=True)
            result["emotions"] = emotion_stats
            result["trades_with_emotion"] = len(emotion_df)
            result["trades_without_emotion"] = len(df) - len(emotion_df)
        else:
            result["emotions"] = []
            result["trades_with_emotion"] = 0
            result["trades_without_emotion"] = len(df)

        # --- Conviction breakdown ---
        if 'conviction' in df.columns and df['conviction'].notna().any():
            # Coerce to numeric and drop anything that doesn't parse (Excel
            # often has stray strings like 'High' or empty cells that crash
            # the `sorted()` + `int()` calls below).
            conv_df = df[df['conviction'].notna()].copy()
            conv_df['conviction'] = pd.to_numeric(conv_df['conviction'], errors='coerce')
            conv_df = conv_df[conv_df['conviction'].notna()]

            conv_stats = []
            for level in sorted(conv_df['conviction'].unique()):
                c_trades = conv_df[conv_df['conviction'] == level]
                winning = c_trades[c_trades['pnl'] > 0]
                total_pnl = float(c_trades['pnl'].sum())
                win_rate = (len(winning) / len(c_trades) * 100) if len(c_trades) > 0 else 0

                conv_stats.append({
                    "conviction": int(level),
                    "total_trades": len(c_trades),
                    "win_rate": round(win_rate, 1),
                    "total_pnl": round(total_pnl, 2),
                    "avg_pnl": round(float(c_trades['pnl'].mean()), 2),
                })

            result["conviction"] = conv_stats
        else:
            result["conviction"] = []

        # --- Grade breakdown ---
        if 'grade' in df.columns and df['grade'].notna().any() and (df['grade'] != '').any():
            grade_df = df[df['grade'].notna() & (df['grade'] != '')].copy()
            # Stringify the column so mixed types (NaN + 'A' + 1.0) don't
            # raise TypeError on the unique-sort path.
            grade_df['grade'] = grade_df['grade'].astype(str)
            grade_uniques = sorted(grade_df['grade'].unique())
            grade_stats = []
            for grade in grade_uniques:
                g_trades = grade_df[grade_df['grade'] == grade]
                winning = g_trades[g_trades['pnl'] > 0]
                total_pnl = float(g_trades['pnl'].sum())
                win_rate = (len(winning) / len(g_trades) * 100) if len(g_trades) > 0 else 0

                grade_stats.append({
                    "grade": grade,
                    "total_trades": len(g_trades),
                    "win_rate": round(win_rate, 1),
                    "total_pnl": round(total_pnl, 2),
                    "avg_pnl": round(float(g_trades['pnl'].mean()), 2),
                })

            result["grades"] = grade_stats
        else:
            result["grades"] = []

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating emotion performance: {str(e)}")


@app.post("/api/trading-analysis/calendar-heatmap")
def get_calendar_heatmap(request: TradeDataRequest):
    """Generate daily P&L data for calendar heatmap visualization."""
    try:
        trades = request.trades
        if not trades:
            raise HTTPException(status_code=400, detail="No trade data provided")

        df = pd.DataFrame(trades)

        # Determine date column — use exit_date (when P&L is realized)
        date_col = 'exit_date' if 'exit_date' in df.columns else 'entry_date'
        if date_col not in df.columns:
            return {"days": [], "weeks": [], "months": []}

        df['date'] = pd.to_datetime(df[date_col], errors='coerce')
        df = df.dropna(subset=['date'])
        df['date_str'] = df['date'].dt.strftime('%Y-%m-%d')
        df['weekday'] = df['date'].dt.dayofweek  # 0=Mon, 6=Sun

        # Aggregate by day
        daily = df.groupby('date_str').agg(
            pnl=('pnl', 'sum'),
            trades=('pnl', 'count'),
            wins=('pnl', lambda x: (x > 0).sum()),
        ).reset_index()

        daily['date'] = pd.to_datetime(daily['date_str'])
        daily = daily.sort_values('date')

        # Build day-level data
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

        # Weekly summary
        df['week_key'] = df['date'].dt.strftime('%Y-W%W')
        weekly = df.groupby('week_key').agg(
            pnl=('pnl', 'sum'),
            trades=('pnl', 'count'),
        ).reset_index()
        weeks = [{"week": r['week_key'], "pnl": round(float(r['pnl']), 2), "trades": int(r['trades'])} for _, r in weekly.iterrows()]

        # Monthly summary
        df['month_key'] = df['date'].dt.strftime('%Y-%m')
        monthly = df.groupby('month_key').agg(
            pnl=('pnl', 'sum'),
            trades=('pnl', 'count'),
        ).reset_index()
        months = [{"month": r['month_key'], "pnl": round(float(r['pnl']), 2), "trades": int(r['trades'])} for _, r in monthly.iterrows()]

        # Streaks
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
        raise HTTPException(status_code=500, detail=f"Error generating calendar heatmap: {str(e)}")


def calculate_trade_metrics(trades):
    """Calculate comprehensive trading metrics from trade data."""
    if not trades:
        return {
            "total_pnl": 0,
            "win_rate": 0,
            "avg_win": 0,
            "avg_loss": 0,
            "profit_factor": 0,
            "total_trades": 0,
        }

    df = pd.DataFrame(trades)

    winning_trades = [t for t in trades if t.get('pnl', 0) > 0]
    losing_trades = [t for t in trades if t.get('pnl', 0) <= 0]

    total_pnl = df['pnl'].sum() if 'pnl' in df.columns else 0
    total_trades = len(trades)
    win_count = len(winning_trades)
    loss_count = len(losing_trades)
    win_rate = (win_count / total_trades * 100) if total_trades > 0 else 0

    avg_win = np.mean([t['pnl'] for t in winning_trades]) if winning_trades else 0
    avg_loss = np.mean([t['pnl'] for t in losing_trades]) if losing_trades else 0

    gross_profit = sum([t['pnl'] for t in winning_trades])
    gross_loss = abs(sum([t['pnl'] for t in losing_trades]))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else 0

    return {
        "total_pnl": round(total_pnl, 2),
        "win_rate": round(win_rate, 1),
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "profit_factor": round(profit_factor, 2),
        "total_trades": total_trades,
        "winning_trades": win_count,
        "losing_trades": loss_count,
    }


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


# ─── Trade Journal ────────────────────────────────────────────────────────────

JOURNAL_PATH = os.getenv("JOURNAL_PATH", os.path.join(os.path.dirname(__file__), "data", "journal.json"))
_journal_lock = threading.Lock()


class JournalEntry(BaseModel):
    trade_id: str
    pre_trade_plan: str = ""
    emotion_entry: str = ""
    emotion_exit: str = ""
    lessons_learned: str = ""
    rating: int = 0
    tags: List[str] = []


def _load_journal() -> dict:
    with _journal_lock:
        if os.path.exists(JOURNAL_PATH):
            with open(JOURNAL_PATH, "r") as f:
                return json.load(f)
        return {"entries": {}}


def _save_journal(data: dict):
    with _journal_lock:
        os.makedirs(os.path.dirname(JOURNAL_PATH), exist_ok=True)
        with open(JOURNAL_PATH, "w") as f:
            json.dump(data, f, indent=2)


@app.get("/api/journal/entries")
def list_journal_entries():
    journal = _load_journal()
    entries = list(journal["entries"].values())
    entries.sort(key=lambda e: e.get("trade_id", ""), reverse=True)
    return {"entries": entries, "total": len(entries)}


@app.get("/api/journal/entries/{trade_id:path}")
def get_journal_entry(trade_id: str):
    journal = _load_journal()
    entry = journal["entries"].get(trade_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return entry


@app.post("/api/journal/entries")
def save_journal_entry(entry: JournalEntry):
    journal = _load_journal()
    journal["entries"][entry.trade_id] = entry.dict()
    _save_journal(journal)
    return {"status": "saved", "trade_id": entry.trade_id}


@app.delete("/api/journal/entries/{trade_id:path}")
def delete_journal_entry(trade_id: str):
    journal = _load_journal()
    if trade_id not in journal["entries"]:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    del journal["entries"][trade_id]
    _save_journal(journal)
    return {"status": "deleted", "trade_id": trade_id}


@app.get("/api/journal/stats")
def get_journal_stats():
    journal = _load_journal()
    entries = list(journal["entries"].values())
    if not entries:
        return {"total": 0, "avg_rating": 0, "emotions": {}, "top_tags": [], "rated_entries": 0}

    ratings = [e["rating"] for e in entries if e.get("rating", 0) > 0]
    emotions_entry = {}
    emotions_exit = {}
    tag_counts = {}

    for e in entries:
        if e.get("emotion_entry"):
            emotions_entry[e["emotion_entry"]] = emotions_entry.get(e["emotion_entry"], 0) + 1
        if e.get("emotion_exit"):
            emotions_exit[e["emotion_exit"]] = emotions_exit.get(e["emotion_exit"], 0) + 1
        for tag in e.get("tags", []):
            tag_counts[tag] = tag_counts.get(tag, 0) + 1

    top_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:10]

    return {
        "total": len(entries),
        "rated_entries": len(ratings),
        "avg_rating": round(sum(ratings) / len(ratings), 1) if ratings else 0,
        "emotions_entry": emotions_entry,
        "emotions_exit": emotions_exit,
        "top_tags": [{"tag": t, "count": c} for t, c in top_tags],
    }


@app.get("/api/journal/search")
def search_journal(q: str = ""):
    if not q:
        return {"entries": [], "total": 0}
    journal = _load_journal()
    q_lower = q.lower()
    results = []
    for entry in journal["entries"].values():
        searchable = " ".join([
            entry.get("trade_id", ""),
            entry.get("pre_trade_plan", ""),
            entry.get("lessons_learned", ""),
            entry.get("emotion_entry", ""),
            entry.get("emotion_exit", ""),
            " ".join(entry.get("tags", [])),
        ]).lower()
        if q_lower in searchable:
            results.append(entry)
    return {"entries": results, "total": len(results)}


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


# ─── $9 Million Method Scanner ───────────────────────────────────────────────
#
# Stockbee's volume-filtered breakout system. Rules + classification live in
# scanners/ep9m.py; this is just the HTTP shell + a small TTL cache so the
# page doesn't recompute the whole panel on every click.

_EP9M_CACHE: dict = {"key": None, "result": None, "ts": 0.0}
_EP9M_TTL_SECONDS = 5 * 60


@app.get("/api/scanner/9m")
def get_9m_scan(
    min_volume: int = 9_000_000,
    min_price: float = 3.0,
    require_compression: int = 0,
    require_not_late: int = 0,
    force: int = 0,
) -> dict:
    """Run the $9 Million Method scanner against the breadth cache.

    Hard filters are always applied. Compression and "not late" are computed
    as soft signals; pass `require_compression=1` or `require_not_late=1` to
    promote them to hard gates (Stockbee's stricter formulation).

    Cached for 5 minutes per parameter tuple. force=1 bypasses. Returns 500
    if the breadth cache hasn't been seeded — point the user at Market
    Monitor → Refresh to build it.
    """
    import time as _time
    from scanners import ep9m as _ep9m

    key = (int(min_volume), float(min_price), bool(require_compression), bool(require_not_late))
    if not force and _EP9M_CACHE["key"] == key and (_time.time() - _EP9M_CACHE["ts"]) < _EP9M_TTL_SECONDS:
        cached = _EP9M_CACHE["result"]
        return {**cached, "from_cache": True}

    try:
        result = _ep9m.run(
            min_volume=int(min_volume),
            min_price=float(min_price),
            require_compression=bool(require_compression),
            require_not_late=bool(require_not_late),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"9M scan failed: {e}")

    _EP9M_CACHE["key"] = key
    _EP9M_CACHE["result"] = result
    _EP9M_CACHE["ts"] = _time.time()
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
# Playbook — 5-star trade examples
# ──────────────────────────────────────────────────────────────────────

PLAYBOOK_PATH = os.getenv("PLAYBOOK_PATH", os.path.join(os.path.dirname(__file__), "data", "playbook.json"))
PLAYBOOK_SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), "data", "playbook_screenshots")
_playbook_lock = threading.Lock()


def _load_playbook() -> dict:
    with _playbook_lock:
        if os.path.exists(PLAYBOOK_PATH):
            with open(PLAYBOOK_PATH, "r") as f:
                return json.load(f)
        return {"entries": {}}


def _save_playbook(data: dict):
    with _playbook_lock:
        os.makedirs(os.path.dirname(PLAYBOOK_PATH), exist_ok=True)
        with open(PLAYBOOK_PATH, "w") as f:
            json.dump(data, f, indent=2)


@app.get("/api/playbook/entries")
def list_playbook_entries():
    playbook = _load_playbook()
    entries = list(playbook["entries"].values())
    entries.sort(key=lambda e: e.get("date", ""), reverse=True)
    return {"entries": entries, "total": len(entries)}


@app.post("/api/playbook/entries")
async def create_playbook_entry(
    symbol: str = Form(...),
    date: str = Form(...),
    setup: str = Form(""),
    pnl: float = Form(0),
    pnl_pct: float = Form(0),
    notes: str = Form(""),
    tags: str = Form(""),
    screenshot: Optional[UploadFile] = File(None),
):
    from datetime import datetime as dt

    entry_id = str(int(dt.now().timestamp() * 1000))
    screenshot_filename = None

    if screenshot and screenshot.filename:
        os.makedirs(PLAYBOOK_SCREENSHOTS_DIR, exist_ok=True)
        ext = os.path.splitext(screenshot.filename)[1] or ".png"
        screenshot_filename = f"{entry_id}{ext}"
        filepath = os.path.join(PLAYBOOK_SCREENSHOTS_DIR, screenshot_filename)
        contents = await screenshot.read()
        with open(filepath, "wb") as f:
            f.write(contents)

    entry = {
        "id": entry_id,
        "symbol": symbol.upper().strip(),
        "date": date,
        "setup": setup,
        "pnl": pnl,
        "pnl_pct": pnl_pct,
        "notes": notes,
        "tags": [t.strip() for t in tags.split(",") if t.strip()] if tags else [],
        "screenshot": screenshot_filename,
        "created_at": dt.now().isoformat(),
    }

    playbook = _load_playbook()
    playbook["entries"][entry_id] = entry
    _save_playbook(playbook)

    return {"status": "created", "entry": entry}


@app.patch("/api/playbook/entries/{entry_id}")
async def update_playbook_entry(
    entry_id: str,
    symbol: str = Form(...),
    date: str = Form(...),
    setup: str = Form(""),
    pnl: float = Form(0),
    pnl_pct: float = Form(0),
    notes: str = Form(""),
    tags: str = Form(""),
    screenshot: Optional[UploadFile] = File(None),
    remove_screenshot: str = Form(""),
):
    playbook = _load_playbook()
    if entry_id not in playbook["entries"]:
        raise HTTPException(status_code=404, detail="Playbook entry not found")

    entry = playbook["entries"][entry_id]

    if remove_screenshot == "1" and entry.get("screenshot"):
        old_path = os.path.join(PLAYBOOK_SCREENSHOTS_DIR, entry["screenshot"])
        if os.path.exists(old_path):
            os.remove(old_path)
        entry["screenshot"] = None

    if screenshot and screenshot.filename:
        if entry.get("screenshot"):
            old_path = os.path.join(PLAYBOOK_SCREENSHOTS_DIR, entry["screenshot"])
            if os.path.exists(old_path):
                os.remove(old_path)
        os.makedirs(PLAYBOOK_SCREENSHOTS_DIR, exist_ok=True)
        ext = os.path.splitext(screenshot.filename)[1] or ".png"
        screenshot_filename = f"{entry_id}{ext}"
        filepath = os.path.join(PLAYBOOK_SCREENSHOTS_DIR, screenshot_filename)
        contents = await screenshot.read()
        with open(filepath, "wb") as f:
            f.write(contents)
        entry["screenshot"] = screenshot_filename

    entry["symbol"] = symbol.upper().strip()
    entry["date"] = date
    entry["setup"] = setup
    entry["pnl"] = pnl
    entry["pnl_pct"] = pnl_pct
    entry["notes"] = notes
    entry["tags"] = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    playbook["entries"][entry_id] = entry
    _save_playbook(playbook)

    return {"status": "updated", "entry": entry}


@app.delete("/api/playbook/entries/{entry_id}")
def delete_playbook_entry(entry_id: str):
    playbook = _load_playbook()
    if entry_id not in playbook["entries"]:
        raise HTTPException(status_code=404, detail="Playbook entry not found")

    entry = playbook["entries"][entry_id]
    if entry.get("screenshot"):
        filepath = os.path.join(PLAYBOOK_SCREENSHOTS_DIR, entry["screenshot"])
        if os.path.exists(filepath):
            os.remove(filepath)

    del playbook["entries"][entry_id]
    _save_playbook(playbook)
    return {"status": "deleted", "id": entry_id}


@app.get("/api/playbook/screenshots/{filename}")
def get_playbook_screenshot(filename: str):
    filepath = os.path.join(PLAYBOOK_SCREENSHOTS_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(filepath)


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
        resp = httpx.get(
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


@app.get("/api/movers")
def get_market_movers(limit: int = Query(10, ge=1, le=50)):
    """Today's top gainers and losers across US stocks (Massive snapshot).

    Best-effort: returns empty lists if the provider is unavailable so the
    dashboard card can degrade gracefully instead of erroring the page.
    """
    try:
        from screener.qullamaggie.providers.massive import MassiveProvider
        mp = MassiveProvider()
    except Exception as e:
        return {"gainers": [], "losers": [], "provider": "massive", "error": str(e)}
    try:
        gainers = mp.fetch_movers("gainers", limit=limit)
        losers = mp.fetch_movers("losers", limit=limit)
    finally:
        try:
            mp.close()
        except Exception:
            pass
    return {
        "gainers": gainers,
        "losers": losers,
        "provider": "massive",
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }


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
async def criteria_check(body: dict):
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
            resp = httpx.get(
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
            qresp = httpx.get(
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
        presp = httpx.get(
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
        mresp = httpx.get(
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
# Snapshot + history are cheap (pure pandas over cached pickles); refresh is
# the only call that hits the upstream API and pulls any missing trading days.
# ---------------------------------------------------------------------------

@app.get("/api/breadth/snapshot")
def get_breadth_snapshot():
    """Latest single-day breadth read from the local cache. No API calls."""
    from breadth import compute_snapshot, classify
    snap = compute_snapshot()
    snap["regime"] = classify(snap.get("metrics"))
    return snap


@app.get("/api/breadth/history")
def get_breadth_history(days: int = Query(15, ge=1, le=120)):
    """Last `days` rows of breadth metrics, oldest→newest. Drives the table
    + sparkline charts on the Market Monitor page."""
    from breadth import compute_history
    return compute_history(days=days)


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

    snap = compute_snapshot()
    snap["regime"] = classify(snap.get("metrics"))
    return {
        "snapshot": snap,
        "cache_summary": cache_summary,
        "universe_refreshed": universe_refreshed,
    }
