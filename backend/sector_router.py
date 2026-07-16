"""Sector-performance screener endpoints (extracted from main.py).

The Sector Scan page's ETF sector/industry performance grid: per-ETF returns via
the configured data provider (Massive/yfinance), with a 2-hour file-backed cache
and a progress ledger for the loading UI, plus a demo-data fallback. main.py
registers this via app.include_router.
"""

import json
import os
import time
from datetime import datetime, timedelta

import numpy as np
from fastapi import APIRouter

router = APIRouter()


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


@router.get("/api/screener/sector-performance/progress")
def get_fetch_progress():
    """Get the current progress of sector data fetching."""
    return _fetch_progress

@router.get("/api/screener/sector-performance")
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
