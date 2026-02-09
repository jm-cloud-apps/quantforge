"""Trading strategies for backtesting."""

import pandas as pd
import numpy as np
from typing import Callable


def _sma(series: pd.Series, period: int) -> pd.Series:
    """Simple Moving Average."""
    return series.rolling(window=period).mean()


def _rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index."""
    delta = series.diff()
    gain = delta.where(delta > 0, 0)
    loss = (-delta).where(delta < 0, 0)
    avg_gain = gain.rolling(window=period).mean()
    avg_loss = loss.rolling(window=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.inf)
    return 100 - (100 / (1 + rs))


def strategy_sma_crossover(
    df: pd.DataFrame,
    fast_period: int = 20,
    slow_period: int = 50
) -> pd.DataFrame:
    """
    SMA Crossover: Buy when fast SMA crosses above slow SMA, sell when below.
    """
    df = df.copy()
    df['sma_fast'] = _sma(df['close'], fast_period)
    df['sma_slow'] = _sma(df['close'], slow_period)
    
    df['signal'] = 0
    df.loc[df['sma_fast'] > df['sma_slow'], 'signal'] = 1
    df.loc[df['sma_fast'] <= df['sma_slow'], 'signal'] = -1
    
    df['position'] = df['signal'].diff()
    return df


def strategy_rsi(
    df: pd.DataFrame,
    period: int = 14,
    oversold: float = 30,
    overbought: float = 70
) -> pd.DataFrame:
    """
    RSI Strategy: Buy when RSI < oversold, sell when RSI > overbought.
    """
    df = df.copy()
    df['rsi'] = _rsi(df['close'], period)
    
    df['signal'] = 0
    df.loc[df['rsi'] < oversold, 'signal'] = 1
    df.loc[df['rsi'] > overbought, 'signal'] = -1
    
    # Forward fill to hold position until opposite signal
    df['signal'] = df['signal'].replace(0, np.nan).ffill().fillna(0).astype(int)
    
    df['position'] = df['signal'].diff()
    return df


def strategy_buy_hold(df: pd.DataFrame) -> pd.DataFrame:
    """Buy and hold: Buy at start, sell at end."""
    df = df.copy()
    df['signal'] = 1
    df['position'] = 0
    df.loc[df.index[0], 'position'] = 1
    df.loc[df.index[-1], 'position'] = -1
    return df


def strategy_mean_reversion(
    df: pd.DataFrame,
    sma_period: int = 20,
    std_threshold: float = 2.0
) -> pd.DataFrame:
    """
    Mean reversion: Buy when price is below SMA - N*std, sell when above SMA + N*std.
    """
    df = df.copy()
    df['sma'] = _sma(df['close'], sma_period)
    df['std'] = df['close'].rolling(window=sma_period).std()
    df['upper'] = df['sma'] + std_threshold * df['std']
    df['lower'] = df['sma'] - std_threshold * df['std']
    
    df['signal'] = 0
    df.loc[df['close'] < df['lower'], 'signal'] = 1
    df.loc[df['close'] > df['upper'], 'signal'] = -1
    
    df['signal'] = df['signal'].replace(0, np.nan).ffill().fillna(0).astype(int)
    df['position'] = df['signal'].diff()
    return df


STRATEGIES = {
    'sma_crossover': {
        'name': 'SMA Crossover',
        'description': 'Buy when fast SMA crosses above slow SMA',
        'params': [
            {'key': 'fast_period', 'label': 'Fast SMA Period', 'type': 'number', 'default': 20},
            {'key': 'slow_period', 'label': 'Slow SMA Period', 'type': 'number', 'default': 50},
        ],
        'fn': strategy_sma_crossover,
    },
    'rsi': {
        'name': 'RSI',
        'description': 'Buy when RSI oversold, sell when overbought',
        'params': [
            {'key': 'period', 'label': 'RSI Period', 'type': 'number', 'default': 14},
            {'key': 'oversold', 'label': 'Oversold Level', 'type': 'number', 'default': 30},
            {'key': 'overbought', 'label': 'Overbought Level', 'type': 'number', 'default': 70},
        ],
        'fn': strategy_rsi,
    },
    'buy_hold': {
        'name': 'Buy & Hold',
        'description': 'Buy at start, hold until end',
        'params': [],
        'fn': strategy_buy_hold,
    },
    'mean_reversion': {
        'name': 'Mean Reversion',
        'description': 'Buy when price deviates below mean, sell when above',
        'params': [
            {'key': 'sma_period', 'label': 'SMA Period', 'type': 'number', 'default': 20},
            {'key': 'std_threshold', 'label': 'Std Dev Threshold', 'type': 'number', 'default': 2.0},
        ],
        'fn': strategy_mean_reversion,
    },
}


def get_available_strategies():
    """Return strategy metadata for UI."""
    return {
        k: {
            'id': k,
            'name': v['name'],
            'description': v['description'],
            'params': v['params'],
        }
        for k, v in STRATEGIES.items()
    }


def run_strategy(strategy_id: str, df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Run a strategy and return the dataframe with signals."""
    if strategy_id not in STRATEGIES:
        raise ValueError(f"Unknown strategy: {strategy_id}")
    
    strategy = STRATEGIES[strategy_id]
    fn: Callable = strategy['fn']
    
    if strategy['params']:
        return fn(df, **params)
    return fn(df)
