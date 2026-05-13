"""Starter ticker universe for the Qullamaggie breakout screener.

Curated list of ~250 liquid US large/mid/small caps that historically produce
momentum setups. Edit `EXTRA_TICKERS` to add your own watchlist symbols, or
override entirely by setting QF_SCREENER_UNIVERSE to a comma-separated list.

Keep this list focused — yfinance is rate-limited, and 200-300 names hits the
sweet spot of broad coverage vs. fetch time.
"""

import os

# Large caps + liquid mid/small caps that show up in momentum leader scans.
CORE_TICKERS: list[str] = [
    # Mega-cap tech & megacaps
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "AVGO", "ORCL", "CRM",
    "ADBE", "AMD", "QCOM", "INTC", "TXN", "MU", "AMAT", "LRCX", "KLAC", "ASML",
    # Software / cloud / AI
    "PLTR", "SNOW", "NET", "DDOG", "CRWD", "ZS", "MDB", "TEAM", "NOW", "PANW",
    "FTNT", "OKTA", "S", "PATH", "U", "AI", "BBAI", "SOUN", "GTLB", "ESTC",
    # Semis / hardware
    "MRVL", "ON", "MCHP", "ADI", "NXPI", "STM", "ARM", "WOLF", "AEHR", "LSCC",
    "MPWR", "ENTG", "ACMR", "POWI", "FORM", "ALGM", "INDI", "MTSI",
    # Communications / 5G / satellite
    "TMUS", "VZ", "T", "IRDM", "VSAT", "GSAT", "TSAT", "ASTS", "RKLB",
    # Industrials / defense
    "BA", "LMT", "RTX", "GD", "NOC", "HII", "LDOS", "KTOS", "AVAV", "MRCY",
    "LUNR", "ACHR", "JOBY", "EH", "BLDE",
    # Energy / nuclear / fuel cell
    "XOM", "CVX", "OXY", "COP", "EOG", "FSLR", "ENPH", "SEDG", "RUN", "ARRY",
    "NEE", "BE", "PLUG", "FCEL", "BLDP", "BWXT", "CCJ", "URA", "UEC", "OKLO",
    "VST", "NRG", "CEG", "TLN", "SMR", "NNE",
    # Financials / payments / fintech
    "JPM", "BAC", "WFC", "GS", "MS", "C", "V", "MA", "PYPL", "SQ",
    "SOFI", "AFRM", "UPST", "COIN", "HOOD", "IBKR", "LPLA", "RKT",
    # Consumer / retail
    "AMZN", "WMT", "COST", "HD", "LOW", "TGT", "NKE", "LULU", "ABNB",
    "DASH", "UBER", "LYFT", "BKNG", "CMG", "MCD", "SBUX", "CAVA",
    "DKNG", "PENN", "MGM", "LVS", "RCL", "CCL", "NCLH",
    # Healthcare / biotech leaders
    "UNH", "JNJ", "LLY", "PFE", "MRK", "ABBV", "TMO", "DHR", "ABT", "ISRG",
    "MRNA", "BNTX", "NVAX", "VRTX", "REGN", "BIIB", "GILD", "ARGX", "PCVX",
    "RXRX", "SDGR", "RGTI",
    # Quantum / emerging tech
    "QBTS", "IONQ", "QUBT",
    # Industrial / materials / "old economy" leaders
    "CAT", "DE", "ETN", "EMR", "ITW", "PH", "ROK", "FAST", "URI", "PWR",
    "VRT", "GEV", "GE", "HON", "MMM", "LIN", "APD", "ECL", "SHW", "DOW",
    # Space / aerospace / EV / batteries
    "PL", "RKLB", "NVTS", "QS", "MVST", "STEM", "FREY", "CHPT", "EVGO", "WBX",
    "RIVN", "LCID", "NIO", "XPEV", "LI",
    # Healthcare tech / robotics
    "TDOC", "DOCS", "VEEV", "IDXX", "ALNY", "EXAS", "NTLA", "BEAM", "EDIT",
    # Crypto-adjacent
    "MSTR", "MARA", "RIOT", "CLSK", "CIFR", "HUT", "BITF", "WULF", "IREN",
    # ETFs for benchmarking (skip in screener but available)
    # — handled separately
]

# Index ETFs used for benchmark comparisons (NOT scored as candidates).
BENCHMARKS: list[str] = ["SPY", "QQQ", "IWM", "MDY"]

# User can add tickers here without editing CORE_TICKERS.
EXTRA_TICKERS: list[str] = []


def get_universe(include_movers: bool = False, movers_limit: int = 30) -> list[str]:
    """Return the deduplicated active universe, sorted.

    If `include_movers=True` and the configured provider supports it, also
    pull today's top gainers and merge them in. This catches names that
    aren't in the static list (the IRDM/LUNR/QBTS-of-tomorrow problem).
    """
    env = os.getenv("QF_SCREENER_UNIVERSE")
    if env:
        return sorted({t.strip().upper() for t in env.split(",") if t.strip()})

    combined = set(CORE_TICKERS) | set(EXTRA_TICKERS)

    if include_movers:
        try:
            from .providers import get_provider
            provider = get_provider()
            if hasattr(provider, "fetch_gainers"):
                movers = provider.fetch_gainers(limit=movers_limit)
                combined |= set(movers)
        except Exception:
            pass  # non-fatal — degrade to static universe

    return sorted(combined)
