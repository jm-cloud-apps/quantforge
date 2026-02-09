"""Backtesting engine."""

import pandas as pd
import numpy as np
from dataclasses import dataclass, field
from typing import Optional

from .data_fetcher import fetch_ohlcv
from .strategies import run_strategy, STRATEGIES


@dataclass
class Trade:
    """Single trade record."""
    symbol: str
    entry_date: str
    exit_date: str
    entry_price: float
    exit_price: float
    quantity: int
    pnl: float
    pnl_pct: float
    side: str  # 'long' or 'short'


@dataclass
class BacktestResult:
    """Result of a backtest run."""
    symbol: str
    strategy_id: str
    start_date: str
    end_date: str
    initial_capital: float
    final_value: float
    total_return_pct: float
    cagr: float
    sharpe_ratio: float
    max_drawdown_pct: float
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate_pct: float
    avg_win_pct: float
    avg_loss_pct: float
    profit_factor: float
    equity_curve: list[dict]  # [{date, value}, ...]
    trades: list[dict]  # Trade records
    benchmark_return_pct: Optional[float] = None


class BacktestEngine:
    """Runs backtests with configurable strategies and parameters."""

    def __init__(self, initial_capital: float = 100_000):
        self.initial_capital = initial_capital

    def run(
        self,
        symbol: str,
        strategy_id: str,
        start_date: str,
        end_date: str,
        params: Optional[dict] = None,
    ) -> BacktestResult:
        """
        Run a backtest for a single symbol.
        
        Args:
            symbol: Stock ticker
            strategy_id: Strategy identifier (sma_crossover, rsi, etc.)
            start_date: Start date YYYY-MM-DD
            end_date: End date YYYY-MM-DD
            params: Strategy-specific parameters
        
        Returns:
            BacktestResult with metrics and trade history
        """
        params = params or {}
        
        # Fetch data
        df = fetch_ohlcv(symbol, start_date, end_date)
        if df is None or len(df) < 10:
            raise ValueError(f"Failed to fetch sufficient data for {symbol}")
        
        # Run strategy
        df = run_strategy(strategy_id, df, params)
        
        # Execute trades and compute metrics
        return self._compute_results(symbol, strategy_id, start_date, end_date, df)

    def _compute_results(
        self,
        symbol: str,
        strategy_id: str,
        start_date: str,
        end_date: str,
        df: pd.DataFrame,
    ) -> BacktestResult:
        """Compute backtest metrics from strategy signals."""
        capital = self.initial_capital
        position = 0  # shares
        entry_price = 0.0
        entry_date = ""
        
        equity_curve = []
        trades = []
        
        for i, row in df.iterrows():
            date = row['date']
            close = row['close']
            
            if row['position'] == 1:  # Buy signal
                if position == 0 and capital > 0:
                    position = int(capital / close)
                    if position > 0:
                        entry_price = close
                        entry_date = date
                        capital -= position * close
            
            elif row['position'] == -1:  # Sell signal
                if position > 0:
                    exit_value = position * close
                    capital += exit_value
                    pnl = exit_value - (position * entry_price)
                    pnl_pct = (close / entry_price - 1) * 100
                    
                    trades.append({
                        'symbol': symbol,
                        'entry_date': entry_date,
                        'exit_date': date,
                        'entry_price': round(entry_price, 2),
                        'exit_price': round(close, 2),
                        'quantity': position,
                        'pnl': round(pnl, 2),
                        'pnl_pct': round(pnl_pct, 2),
                        'side': 'long',
                    })
                    position = 0
            
            portfolio_value = capital + position * close
            equity_curve.append({'date': date, 'value': round(portfolio_value, 2)})
        
        # Close any open position at end
        if position > 0:
            close_val = position * df.iloc[-1]['close']
            capital += close_val
            pnl = close_val - (position * entry_price)
            pnl_pct = (df.iloc[-1]['close'] / entry_price - 1) * 100
            trades.append({
                'symbol': symbol,
                'entry_date': entry_date,
                'exit_date': df.iloc[-1]['date'],
                'entry_price': round(entry_price, 2),
                'exit_price': round(df.iloc[-1]['close'], 2),
                'quantity': position,
                'pnl': round(pnl, 2),
                'pnl_pct': round(pnl_pct, 2),
                'side': 'long',
            })
        
        final_value = capital
        
        # Compute metrics
        total_return_pct = (final_value / self.initial_capital - 1) * 100
        
        # CAGR
        days = (pd.to_datetime(end_date) - pd.to_datetime(start_date)).days
        years = max(days / 365.25, 0.01)
        cagr = (final_value / self.initial_capital) ** (1 / years) - 1
        cagr *= 100
        
        # Sharpe ratio (annualized, assuming daily returns)
        equity_series = pd.Series([e['value'] for e in equity_curve])
        returns = equity_series.pct_change().dropna()
        if len(returns) > 1 and returns.std() > 0:
            sharpe_ratio = (returns.mean() / returns.std()) * np.sqrt(252)
        else:
            sharpe_ratio = 0.0
        
        # Max drawdown
        cummax = equity_series.cummax()
        drawdown = (equity_series - cummax) / cummax * 100
        max_drawdown_pct = round(drawdown.min(), 2)
        
        # Trade stats
        winning = [t for t in trades if t['pnl'] > 0]
        losing = [t for t in trades if t['pnl'] <= 0]
        winning_trades = len(winning)
        losing_trades = len(losing)
        total_trades = len(trades)
        
        win_rate_pct = (winning_trades / total_trades * 100) if total_trades > 0 else 0
        
        avg_win_pct = np.mean([t['pnl_pct'] for t in winning]) if winning else 0
        avg_loss_pct = np.mean([t['pnl_pct'] for t in losing]) if losing else 0
        
        gross_profit = sum(t['pnl'] for t in winning)
        gross_loss = abs(sum(t['pnl'] for t in losing))
        profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (gross_profit if gross_profit > 0 else 0)
        
        return BacktestResult(
            symbol=symbol,
            strategy_id=strategy_id,
            start_date=start_date,
            end_date=end_date,
            initial_capital=self.initial_capital,
            final_value=round(final_value, 2),
            total_return_pct=round(total_return_pct, 2),
            cagr=round(cagr, 2),
            sharpe_ratio=round(sharpe_ratio, 2),
            max_drawdown_pct=max_drawdown_pct,
            total_trades=total_trades,
            winning_trades=winning_trades,
            losing_trades=losing_trades,
            win_rate_pct=round(win_rate_pct, 1),
            avg_win_pct=round(avg_win_pct, 2),
            avg_loss_pct=round(avg_loss_pct, 2),
            profit_factor=round(profit_factor, 2),
            equity_curve=equity_curve,
            trades=trades,
        )
