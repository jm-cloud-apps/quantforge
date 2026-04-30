"""
Curated universe of ~60 high-liquidity US large-caps.

Kept intentionally small so price + fundamentals fetches finish in ~90s without
triggering Yahoo Finance rate limits. Covers all major sectors and is broad
enough to surface genuine Qullamaggie momentum and Adam Khoo value-growth picks.
"""

_CURATED_UNIVERSE = [
    # Mega-cap tech
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA",
    # Semiconductors
    "AVGO", "AMD", "QCOM", "TXN", "LRCX", "AMAT", "KLAC",
    # Software / Cloud / Security
    "ORCL", "CRM", "ADBE", "INTU", "NOW", "PANW", "CRWD", "ANET", "PLTR", "DDOG",
    # Finance
    "JPM", "BAC", "GS", "BX", "BLK", "V", "MA", "SPGI", "ICE", "AXP",
    # Healthcare
    "LLY", "JNJ", "ABBV", "MRK", "AMGN", "REGN", "VRTX", "ISRG", "UNH", "TMO",
    # Consumer Discretionary
    "HD", "COST", "MCD", "SBUX", "BKNG", "UBER", "NFLX", "CMG",
    # Industrials
    "GE", "CAT", "HON", "ETN", "LMT", "RTX", "DE",
    # Energy
    "XOM", "CVX", "COP",
    # Consumer Staples
    "KO", "PEP", "PM",
    # Other quality large-caps
    "NEE", "ACN", "WM", "CME", "ADP",
]

_UNIVERSE: list[str] = list(dict.fromkeys(_CURATED_UNIVERSE))


def get_sp500_tickers() -> list[str]:
    return _UNIVERSE
