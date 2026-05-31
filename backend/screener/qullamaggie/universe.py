"""Starter ticker universe for the Qullamaggie breakout screener.

Curated list of ~250 liquid US large/mid/small caps that historically produce
momentum setups. Edit `EXTRA_TICKERS` to add your own watchlist symbols, or
override entirely by setting QF_SCREENER_UNIVERSE to a comma-separated list.

Keep this list focused — yfinance is rate-limited, and 200-300 names hits the
sweet spot of broad coverage vs. fetch time.
"""

import json
import logging
import os
import time
from datetime import date as _date, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]
_WIDE_CACHE = BACKEND_DIR / "data" / "wide_universe.json"
_WIDE_CACHE.parent.mkdir(parents=True, exist_ok=True)
# Wide universe barely changes day-to-day; 24h cache is plenty. Re-fetched
# automatically when the cached date doesn't match today.
_WIDE_CACHE_TTL_SEC = 24 * 3600

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


def wide_universe(min_dollar_vol: float = 5_000_000, max_symbols: int = 3000) -> list[str]:
    """Build a dynamic universe of every US-listed stock with ≥`min_dollar_vol`
    dollar volume on the most recent trading day.

    Uses Massive's grouped daily aggregates endpoint — one HTTP call returns
    the whole tape (~8K-10K tickers). We filter by close × volume, optionally
    cap at `max_symbols` (sorted by dollar volume desc).

    Result is cached to disk for 24h since this list barely changes day-to-day.
    Raises NotEntitled if the grouped endpoint isn't on the API plan; caller
    should fall back to get_universe().
    """
    today = _date.today().isoformat()
    # Read cache first.
    if _WIDE_CACHE.exists():
        try:
            cached = json.loads(_WIDE_CACHE.read_text())
            age = time.time() - cached.get("cached_at", 0)
            if (cached.get("date") == today
                    and age < _WIDE_CACHE_TTL_SEC
                    and cached.get("min_dollar_vol") == min_dollar_vol):
                return cached.get("symbols", [])
        except Exception as e:
            logger.debug("wide_universe cache read failed: %s", e)

    from .providers import get_provider
    provider = get_provider()
    if not hasattr(provider, "fetch_daily_market_summary"):
        return []
    rows = provider.fetch_daily_market_summary()
    if not rows:
        return []
    scored = []
    for r in rows:
        sym = r.get("T")
        close = r.get("c") or 0
        vol = r.get("v") or 0
        if not sym or close <= 0 or vol <= 0:
            continue
        # Skip OTC / pink names (5+ char tickers, ones with dots — Massive
        # includes warrants, ADRs, preferred series). Keep it simple — we
        # want common stocks only.
        if "." in sym or len(sym) > 5:
            continue
        dv = close * vol
        if dv < min_dollar_vol:
            continue
        scored.append((sym.upper(), dv))
    # Highest dollar volume first; cap if requested.
    scored.sort(key=lambda x: x[1], reverse=True)
    symbols = [s for s, _ in scored[:max_symbols]]

    try:
        _WIDE_CACHE.write_text(json.dumps({
            "date": today,
            "cached_at": time.time(),
            "min_dollar_vol": min_dollar_vol,
            "symbols": symbols,
            "count": len(symbols),
        }))
    except Exception as e:
        logger.debug("wide_universe cache write failed: %s", e)

    return symbols


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
