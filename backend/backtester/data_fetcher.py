"""Fetch historical OHLCV data from Yahoo Finance."""

import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta


def fetch_ohlcv(symbol: str, start_date: str, end_date: str) -> pd.DataFrame | None:
    """
    Fetch OHLCV data for a symbol.
    
    Args:
        symbol: Stock ticker (e.g., AAPL, MSFT)
        start_date: Start date (YYYY-MM-DD)
        end_date: End date (YYYY-MM-DD)
    
    Returns:
        DataFrame with columns: Open, High, Low, Close, Volume, or None if failed
    """
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(start=start_date, end=end_date, auto_adjust=True)
        
        if df.empty or len(df) < 2:
            return None
            
        df = df.reset_index()
        df.columns = [c.replace(' ', '_') for c in df.columns]
        
        # Standardize column names
        column_map = {
            'Open': 'open', 'High': 'high', 'Low': 'low', 
            'Close': 'close', 'Volume': 'volume'
        }
        df = df.rename(columns={k: v for k, v in column_map.items() if k in df.columns})
        
        if 'Date' in df.columns:
            df['date'] = pd.to_datetime(df['Date']).dt.strftime('%Y-%m-%d')
        elif 'Datetime' in df.columns:
            df['date'] = pd.to_datetime(df['Datetime']).dt.strftime('%Y-%m-%d')
            
        return df[['date', 'open', 'high', 'low', 'close', 'volume']].copy()
    
    except Exception:
        return None
