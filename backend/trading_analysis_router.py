"""Trading-analysis endpoints (extracted from main.py).

The trade-log analytics: load / upload, and the per-setup / per-symbol / drawdown /
timing / streak / market-cap / benchmark / R-multiple / emotion / calendar /
edge-insights breakdowns over a set of closed trades. Pure compute over the trades
in each request body — no external data calls. The parsing core lives in
trade_data.py, the review-notes overlay in review_notes_router, the upload guard in
security. main.py registers this via app.include_router and imports `_trades_cache`
(the in-memory mtime cache this module owns) for its calendar / weekly-review reads.
Covered by tests/test_trading_analysis.py.
"""

import io
import math
import os
from datetime import timedelta
from typing import List

import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from security import _enforce_upload_limit
from trade_data import read_trades_excel, normalize_trade_data, calculate_trade_metrics
from review_notes_router import merge_review_notes_into_trades

router = APIRouter()


def _money(v) -> str:
    """Format a dollar amount for the edge-insights narrative."""
    try:
        v = float(v)
    except (TypeError, ValueError):
        return "$0"
    sign = "-" if v < 0 else ""
    return f"{sign}${abs(v):,.0f}" if abs(v) >= 100 else f"{sign}${abs(v):,.2f}"

# In-memory cache for trading-analysis data (keyed by the workbook's mtime).
_trades_cache = {
    "file_mtime": None,
    "data": None,
}


class TradeDataRequest(BaseModel):
    trades: List[dict]


class RMultipleRequest(BaseModel):
    trades: List[dict]
    initial_capital: float = 100000


@router.get("/api/trading-analysis/file-status")
def get_file_status():
    """Return the last-modified timestamp of the default trades file."""
    default_path = os.getenv("DEFAULT_TRADES_PATH", "trades/Trades.xlsx")
    try:
        mtime = os.path.getmtime(default_path)
        return {"mtime": mtime, "path": default_path}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Default trades file not found")


# ── read_trades_excel + scale-out formula eval moved to trade_data.py (imported near app setup). ──


@router.get("/api/trading-analysis/load-default")
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
            # Re-overlay review notes on every call — the sidecar can change
            # without bumping the workbook's mtime, so we never trust a cached
            # notes snapshot. The merge mutates in place; deep-copying is
            # avoided since downstream consumers only read.
            cached = _trades_cache["data"]
            merged_trades = merge_review_notes_into_trades([dict(t) for t in cached["trades"]])
            return {**cached, "trades": merged_trades, "from_cache": True}

        df = read_trades_excel(default_path)

        # Clean up dataframe - remove unnamed columns
        df = df.loc[:, ~df.columns.str.contains('^Unnamed')]

        total_rows = len(df)

        # Normalize column names to match expected format. Note that this
        # filters to closed trades only (rows with an exit_price). Open
        # positions are intentionally excluded from the analytics page.
        trades = normalize_trade_data(df)

        # Overlay any per-trade review notes from the sidecar — these are the
        # authoritative values for the editable fields (notes, setup, grade,
        # etc.) since the user edits them through the Review UI.
        trades = merge_review_notes_into_trades(trades)

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


@router.post("/api/trading-analysis/upload")
async def upload_trade_data(file: UploadFile = File(...)):
    """
    Upload and parse trade data from CSV or Excel file.
    Expected columns: Symbol, Qty, Side, Entry Price, Entry Date, Exit Price, Exit Date, Profit / Loss, Profit / Loss %
    """
    try:
        contents = await file.read()
        _enforce_upload_limit(contents, "Trade file")

        # Determine file type and read accordingly
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided.")
        if file.filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(contents))
        elif file.filename.endswith(('.xlsx', '.xls')):
            df = read_trades_excel(io.BytesIO(contents))
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

    except HTTPException:
        raise  # preserve intended 4xx status (bad format, too large) — don't mask as 500
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")


@router.post("/api/trading-analysis/analyze")
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


@router.post("/api/trading-analysis/statistics")
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


# ── normalize_trade_data moved to trade_data.py (imported near app setup). ──


@router.post("/api/trading-analysis/setup-statistics")
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


@router.post("/api/trading-analysis/symbol-statistics")
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


@router.post("/api/trading-analysis/drawdown-analysis")
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


@router.post("/api/trading-analysis/time-performance")
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


@router.post("/api/trading-analysis/rolling-performance")
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


@router.post("/api/trading-analysis/advanced-metrics")
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


@router.post("/api/trading-analysis/entry-timing-analysis")
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


@router.post("/api/trading-analysis/streak-detection")
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


@router.post("/api/trading-analysis/market-cap-performance")
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


@router.post("/api/trading-analysis/benchmark-comparison")
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


@router.post("/api/trading-analysis/r-multiple")
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


@router.post("/api/trading-analysis/emotion-performance")
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


@router.post("/api/trading-analysis/calendar-heatmap")
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


@router.post("/api/trading-analysis/edge-insights")
def get_edge_insights(request: TradeDataRequest):
    """Synthesize actionable 'where is my edge' insights from the trade log:
    performance by hold-duration, position-size, day-of-week and entry-time,
    after-loss (revenge) behavior, and best/worst setup — plus a ranked list of
    plain-English findings derived from those breakdowns."""
    trades = request.trades
    if not trades:
        raise HTTPException(status_code=400, detail="No trade data provided")

    df = pd.DataFrame(trades)
    df['pnl'] = pd.to_numeric(df.get('pnl'), errors='coerce').fillna(0.0)
    df['quantity'] = pd.to_numeric(df.get('quantity'), errors='coerce').fillna(0.0)
    df['entry_price'] = pd.to_numeric(df.get('entry_price'), errors='coerce').fillna(0.0)
    df['_entry'] = pd.to_datetime(df.get('entry_date'), errors='coerce')
    df['_exit'] = pd.to_datetime(df.get('exit_date'), errors='coerce')

    def _summ(group: pd.DataFrame) -> dict:
        n = len(group)
        if n == 0:
            return {"count": 0, "win_rate": 0, "avg_pnl": 0, "total_pnl": 0}
        wins = int((group['pnl'] > 0).sum())
        return {
            "count": n,
            "win_rate": round(wins / n * 100, 1),
            "avg_pnl": round(float(group['pnl'].mean()), 2),
            "total_pnl": round(float(group['pnl'].sum()), 2),
        }

    MIN_N = 4  # don't draw conclusions from tiny samples

    # ── Hold-duration buckets ───────────────────────────────────────────────
    if 'duration_days' in df.columns:
        dur = pd.to_numeric(df['duration_days'], errors='coerce')
    else:
        dur = (df['_exit'] - df['_entry']).dt.days
    df['_dur'] = dur.fillna(0).clip(lower=0)

    def _dur_bucket(d):
        if d <= 0: return '0 · Intraday'
        if d <= 2: return '1 · 1–2 days'
        if d <= 5: return '2 · 3–5 days'
        if d <= 10: return '3 · 6–10 days'
        return '4 · 11+ days'
    df['_durb'] = df['_dur'].apply(_dur_bucket)
    hold = []
    for label in ['0 · Intraday', '1 · 1–2 days', '2 · 3–5 days', '3 · 6–10 days', '4 · 11+ days']:
        g = df[df['_durb'] == label]
        if len(g):
            s = _summ(g); s['bucket'] = label.split(' · ')[1]; hold.append(s)

    # ── Position-size buckets (quartiles of $ exposure) ─────────────────────
    df['_size'] = (df['quantity'].abs() * df['entry_price'].abs())
    sized = df[df['_size'] > 0]
    position_size = []
    if len(sized) >= 4:
        try:
            df['_sizeq'] = pd.qcut(sized['_size'].rank(method='first'), 4, labels=['Q1','Q2','Q3','Q4'])
        except Exception:
            df['_sizeq'] = None
        for q, name in [('Q1','Smallest 25%'), ('Q2','Small–mid'), ('Q3','Mid–large'), ('Q4','Largest 25%')]:
            g = sized[df.loc[sized.index, '_sizeq'] == q]
            if len(g):
                s = _summ(g)
                s['bucket'] = name
                s['avg_size'] = round(float(g['_size'].mean()), 0)
                position_size.append(s)

    # ── Day of week (by exit/realization date) ──────────────────────────────
    df['_day'] = df['_exit'].fillna(df['_entry']).dt.day_name()
    day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
    by_dow = []
    for d in day_order:
        g = df[df['_day'] == d]
        if len(g):
            s = _summ(g); s['day'] = d; by_dow.append(s)

    # ── Entry-time-of-day buckets ───────────────────────────────────────────
    def _time_bucket(t):
        if not isinstance(t, str):
            return None
        m = pd.Series([t]).str.extract(r'(\d{1,2}):(\d{2})')
        try:
            hh = int(m.iloc[0, 0]); mm = int(m.iloc[0, 1])
        except Exception:
            return None
        mins = hh * 60 + mm - 570  # minutes from 9:30 open
        if mins < 0: return '0 · Pre-market'
        if mins <= 30: return '1 · Open (9:30–10:00)'
        if mins <= 120: return '2 · Morning (10:00–11:30)'
        if mins <= 270: return '3 · Midday (11:30–2:00)'
        if mins <= 390: return '4 · Power hour (2:00–4:00)'
        return '5 · After-hours'
    by_entry_time = []
    if 'entry_time' in df.columns:
        df['_tb'] = df['entry_time'].apply(_time_bucket)
        for label in ['0 · Pre-market', '1 · Open (9:30–10:00)', '2 · Morning (10:00–11:30)',
                      '3 · Midday (11:30–2:00)', '4 · Power hour (2:00–4:00)', '5 · After-hours']:
            g = df[df['_tb'] == label]
            if len(g):
                s = _summ(g); s['bucket'] = label.split(' · ')[1]; by_entry_time.append(s)

    # ── After-loss (revenge) behavior ───────────────────────────────────────
    ordered = df.sort_values('_entry')
    pnls = ordered['pnl'].tolist()
    after_loss = [pnls[i] for i in range(1, len(pnls)) if pnls[i - 1] < 0]
    overall_avg = round(float(df['pnl'].mean()), 2)
    revenge = None
    if len(after_loss) >= MIN_N:
        al_avg = round(sum(after_loss) / len(after_loss), 2)
        al_win = round(len([p for p in after_loss if p > 0]) / len(after_loss) * 100, 1)
        revenge = {"count": len(after_loss), "avg_pnl": al_avg, "win_rate": al_win,
                   "overall_avg_pnl": overall_avg}

    # ── Best/worst setup ────────────────────────────────────────────────────
    setups = []
    if 'setup' in df.columns:
        for name, g in df[df['setup'].apply(lambda x: isinstance(x, str) and x.strip() != '')].groupby('setup'):
            if len(g) >= MIN_N:
                s = _summ(g); s['setup'] = name; setups.append(s)

    # ── Synthesize plain-English findings, ranked by $ impact ───────────────
    findings = []

    def best_worst(rows, key='avg_pnl', label_key='bucket', min_n=MIN_N):
        elig = [r for r in rows if r['count'] >= min_n]
        if len(elig) < 2:
            return None, None
        return max(elig, key=lambda r: r[key]), min(elig, key=lambda r: r[key])

    bd, wd = best_worst(by_dow, label_key='day')
    if bd and wd and bd['day'] != wd['day']:
        findings.append({"severity": "good", "title": f"{bd['day']} is your strongest day",
                         "detail": f"{bd['win_rate']}% win · {_money(bd['avg_pnl'])}/trade avg · {_money(bd['total_pnl'])} total",
                         "impact": abs(bd['total_pnl'])})
        if wd['avg_pnl'] < 0:
            findings.append({"severity": "bad", "title": f"{wd['day']} drags you down",
                             "detail": f"{wd['win_rate']}% win · {_money(wd['avg_pnl'])}/trade avg · {_money(wd['total_pnl'])} total — consider trading lighter",
                             "impact": abs(wd['total_pnl'])})

    bt, wt = best_worst(by_entry_time)
    if bt and wt and bt['bucket'] != wt['bucket']:
        findings.append({"severity": "good", "title": f"You enter best during {bt['bucket']}",
                         "detail": f"{bt['win_rate']}% win · {_money(bt['avg_pnl'])}/trade avg",
                         "impact": abs(bt['total_pnl'])})
        if wt['avg_pnl'] < 0:
            findings.append({"severity": "bad", "title": f"Entries during {wt['bucket']} lose money",
                             "detail": f"{wt['win_rate']}% win · {_money(wt['avg_pnl'])}/trade avg",
                             "impact": abs(wt['total_pnl'])})

    bh, wh = best_worst(hold)
    if bh and wh and bh['bucket'] != wh['bucket']:
        findings.append({"severity": "info", "title": f"{bh['bucket']} holds are your sweet spot",
                         "detail": f"{_money(bh['avg_pnl'])}/trade vs {_money(wh['avg_pnl'])} for {wh['bucket']}",
                         "impact": abs(bh['total_pnl'])})

    if len(position_size) >= 2:
        largest = position_size[-1]; smallest = position_size[0]
        if largest['count'] >= MIN_N and smallest['count'] >= MIN_N:
            if largest['avg_pnl'] < smallest['avg_pnl'] and largest['avg_pnl'] < 0:
                findings.append({"severity": "bad", "title": "Your biggest positions underperform",
                                 "detail": f"Largest-25% bets avg {_money(largest['avg_pnl'])}/trade vs {_money(smallest['avg_pnl'])} on your smallest — size discipline to review",
                                 "impact": abs(largest['total_pnl'])})
            elif largest['avg_pnl'] > smallest['avg_pnl']:
                findings.append({"severity": "good", "title": "You size up on your winners",
                                 "detail": f"Largest-25% bets avg {_money(largest['avg_pnl'])}/trade vs {_money(smallest['avg_pnl'])} on the smallest — good conviction sizing",
                                 "impact": abs(largest['total_pnl'])})

    if revenge and revenge['avg_pnl'] < overall_avg - 1e-9 and revenge['avg_pnl'] < 0:
        findings.append({"severity": "bad", "title": "Possible revenge trading",
                         "detail": f"After a loss your next trade averages {_money(revenge['avg_pnl'])} ({revenge['win_rate']}% win) vs {_money(overall_avg)} overall — consider a reset rule",
                         "impact": abs(revenge['avg_pnl']) * revenge['count']})

    if setups:
        bs = max(setups, key=lambda r: r['total_pnl'])
        ws = min(setups, key=lambda r: r['total_pnl'])
        if bs['total_pnl'] > 0:
            findings.append({"severity": "good", "title": f"Best setup: {bs['setup']}",
                             "detail": f"{bs['count']} trades · {bs['win_rate']}% win · {_money(bs['total_pnl'])} total",
                             "impact": abs(bs['total_pnl'])})
        if ws['total_pnl'] < 0 and ws['setup'] != bs['setup']:
            findings.append({"severity": "bad", "title": f"Worst setup: {ws['setup']}",
                             "detail": f"{ws['count']} trades · {ws['win_rate']}% win · {_money(ws['total_pnl'])} total",
                             "impact": abs(ws['total_pnl'])})

    findings.sort(key=lambda f: f.get('impact', 0), reverse=True)

    return {
        "hold_duration": hold,
        "position_size": position_size,
        "by_dow": by_dow,
        "by_entry_time": by_entry_time,
        "setups": sorted(setups, key=lambda r: r['total_pnl'], reverse=True),
        "revenge": revenge,
        "overall_avg_pnl": overall_avg,
        "findings": findings,
        "total_trades": len(df),
    }
