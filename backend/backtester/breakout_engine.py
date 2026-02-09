"""
Previous Day Breakout Strategy Engine.

Rules:
- Buy when stock closes above previous day high
- Sell when stock closes below previous day low (stop loss)
- Risk 1% of portfolio per trade
- Max 25% of portfolio in any single trade
"""

import pandas as pd
import numpy as np
from dataclasses import dataclass
from typing import Optional

from .data_fetcher import fetch_ohlcv


@dataclass
class BreakoutResult:
    """Result of a breakout strategy backtest."""
    symbol: str
    allocation_pct: float
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
    equity_curve: list[dict]
    trades: list[dict]


def run_breakout_backtest(
    symbol: str,
    start_date: str,
    end_date: str,
    allocation_capital: float,
    risk_pct: float = 1.0,
    max_position_pct: float = 25.0,
) -> BreakoutResult:
    """
    Run the previous day breakout strategy.
    
    Args:
        symbol: Stock ticker
        start_date: Start date YYYY-MM-DD
        end_date: End date YYYY-MM-DD
        allocation_capital: Capital allocated to this symbol
        risk_pct: % of portfolio to risk per trade (default 1%)
        max_position_pct: Max % of portfolio in any single trade (default 25%)
    
    Returns:
        BreakoutResult with metrics and trades
    """
    df = fetch_ohlcv(symbol, start_date, end_date)
    if df is None or len(df) < 3:
        raise ValueError(f"Failed to fetch sufficient data for {symbol}")
    
    # Previous day high/low
    df['prev_high'] = df['high'].shift(1)
    df['prev_low'] = df['low'].shift(1)
    df = df.dropna(subset=['prev_high', 'prev_low'])
    
    capital = allocation_capital
    position = 0
    entry_price = 0.0
    entry_date = ""
    stop_price = 0.0
    
    equity_curve = []
    trades = []
    
    for i, row in df.iterrows():
        date = row['date']
        close = row['close']
        prev_high = row['prev_high']
        prev_low = row['prev_low']
        
        portfolio_value = capital + position * close
        
        # Check sell first (stop loss: close below prev day low)
        if position > 0:
            if close < prev_low:
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
                    'exit_reason': 'stop',
                })
                position = 0
                entry_date = ""
        
        # Check buy (only if flat and price above prev day high)
        if position == 0 and close > prev_high and capital > 0:
            risk_amount = portfolio_value * (risk_pct / 100)
            max_investment = portfolio_value * (max_position_pct / 100)
            
            # Stop will be at prev_low
            risk_per_share = close - prev_low
            if risk_per_share <= 0:
                risk_per_share = close * 0.01  # fallback: 1% of price
            
            shares_by_risk = int(risk_amount / risk_per_share) if risk_per_share > 0 else 0
            shares_by_cap = int(max_investment / close) if close > 0 else 0
            
            position = min(shares_by_risk, shares_by_cap) if (shares_by_risk and shares_by_cap) else 0
            
            if position > 0:
                cost = position * close
                if cost <= capital:
                    capital -= cost
                    entry_price = close
                    entry_date = date
                    stop_price = prev_low
        
        equity_curve.append({'date': date, 'value': round(capital + position * close, 2)})
    
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
            'exit_reason': 'end',
        })
    
    final_value = capital
    
    # Metrics
    total_return_pct = (final_value / allocation_capital - 1) * 100
    days = (pd.to_datetime(end_date) - pd.to_datetime(start_date)).days
    years = max(days / 365.25, 0.01)
    cagr = (final_value / allocation_capital) ** (1 / years) - 1
    cagr *= 100
    
    equity_series = pd.Series([e['value'] for e in equity_curve])
    returns = equity_series.pct_change().dropna()
    sharpe_ratio = (returns.mean() / returns.std()) * np.sqrt(252) if len(returns) > 1 and returns.std() > 0 else 0.0
    
    cummax = equity_series.cummax()
    drawdown = (equity_series - cummax) / cummax * 100
    max_drawdown_pct = round(drawdown.min(), 2)
    
    winning = [t for t in trades if t['pnl'] > 0]
    losing = [t for t in trades if t['pnl'] <= 0]
    total_trades = len(trades)
    win_rate_pct = (len(winning) / total_trades * 100) if total_trades > 0 else 0
    avg_win_pct = np.mean([t['pnl_pct'] for t in winning]) if winning else 0
    avg_loss_pct = np.mean([t['pnl_pct'] for t in losing]) if losing else 0
    
    gross_profit = sum(t['pnl'] for t in winning)
    gross_loss = abs(sum(t['pnl'] for t in losing))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (gross_profit if gross_profit > 0 else 0)
    
    return BreakoutResult(
        symbol=symbol,
        allocation_pct=0,  # filled by caller
        start_date=start_date,
        end_date=end_date,
        initial_capital=allocation_capital,
        final_value=round(final_value, 2),
        total_return_pct=round(total_return_pct, 2),
        cagr=round(cagr, 2),
        sharpe_ratio=round(sharpe_ratio, 2),
        max_drawdown_pct=max_drawdown_pct,
        total_trades=total_trades,
        winning_trades=len(winning),
        losing_trades=len(losing),
        win_rate_pct=round(win_rate_pct, 1),
        avg_win_pct=round(avg_win_pct, 2),
        avg_loss_pct=round(avg_loss_pct, 2),
        profit_factor=round(profit_factor, 2),
        equity_curve=equity_curve,
        trades=trades,
    )
