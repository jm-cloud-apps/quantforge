"""News + per-ticker analysis endpoints (extracted from main.py).

Company news (with earnings-catalyst tagging), the pre-market snapshot, the
persistent news-cache CRUD, the market-movers list, and the two per-ticker
analysis endpoints (criteria-check + Qullamaggie EP score). These share a pooled
Finnhub HTTP client and the configured data provider (imported locally). main.py
registers this via app.include_router.
"""

import json
import os
import threading
import time
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Body, HTTPException, Query

router = APIRouter()

FINNHUB_BASE_URL = "https://finnhub.io/api/v1"

# Shared, thread-safe HTTP client for the per-symbol Finnhub enrichment calls
# (earnings / news / quote / profile / metric) — pooled TCP+TLS across back-to-back
# requests to the same host.
_http_client = httpx.Client(
    timeout=15,
    limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
)


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
        resp = _http_client.get(
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


@router.get("/api/news")
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


@router.get("/api/analysis/premarket/{ticker}")
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


@router.get("/api/news/cache")
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


@router.post("/api/news/cache")
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


@router.post("/api/news/cache/refresh-prices")
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


_movers_cache_lock = threading.Lock()
# Cache the largest list we serve (limit=50) and slice per-request, so callers
# asking for different limits all share one upstream fetch.
_movers_cache = {"data": None, "ts": 0.0}
_MOVERS_ACTIVE_TTL = 60  # seconds during the session; market_clock stretches to 4h when closed


@router.get("/api/movers")
def get_market_movers(limit: int = Query(10, ge=1, le=50)):
    """Today's top gainers and losers across US stocks (Massive snapshot).

    Cached: the snapshot is a couple of live fetches, and after hours the data
    is frozen — market_clock.effective_cache_ttl keeps it for 4h when closed so
    the dashboard isn't re-pulling it on every visit. Best-effort: returns
    empty lists if the provider is unavailable so the card degrades gracefully.
    """
    from market_clock import effective_cache_ttl

    with _movers_cache_lock:
        if (
            _movers_cache["data"] is not None
            and (time.time() - _movers_cache["ts"]) < effective_cache_ttl(_MOVERS_ACTIVE_TTL)
        ):
            c = _movers_cache["data"]
            return {**c, "gainers": c["gainers"][:limit], "losers": c["losers"][:limit], "from_cache": True}

    try:
        from screener.qullamaggie.providers.massive import MassiveProvider
        mp = MassiveProvider()
    except Exception as e:
        return {"gainers": [], "losers": [], "provider": "massive", "error": str(e)}
    try:
        # Fetch the max we'd ever serve once; per-request limit is applied below.
        gainers = mp.fetch_movers("gainers", limit=50)
        losers = mp.fetch_movers("losers", limit=50)
    finally:
        try:
            mp.close()
        except Exception:
            pass

    payload = {
        "gainers": gainers,
        "losers": losers,
        "provider": "massive",
        "as_of": datetime.now().isoformat(timespec="seconds"),
    }
    with _movers_cache_lock:
        _movers_cache["data"] = payload
        _movers_cache["ts"] = time.time()
    return {**payload, "gainers": gainers[:limit], "losers": losers[:limit], "from_cache": False}


@router.delete("/api/news/cache")
def clear_news_cache():
    """Clear all cached search history."""
    _save_news_cache([])
    return {"ok": True}


@router.delete("/api/news/cache/{index}")
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


@router.post("/api/analysis/criteria-check")
def criteria_check(body: dict):
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
            resp = _http_client.get(
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
                        context_parts.append("\n## Volume Analysis")
                        context_parts.append(f"- Latest Volume: {latest_vol:,.0f}")
                        context_parts.append(f"- 20-Day Avg Volume: {avg_vol_20:,.0f}")
                        context_parts.append(f"- Volume Ratio (latest/avg): {vol_ratio:.1f}×")

                    # Find largest single-day gaps in last 30 days
                    if len(closes) >= 30:
                        context_parts.append("\n## Recent Gaps (Last 30 Trading Days)")
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
                        context_parts.append("\n## Basing Analysis")
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
            qresp = _http_client.get(
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
        presp = _http_client.get(
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
        mresp = _http_client.get(
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


@router.get("/api/analysis/qulla-ep/{ticker}")
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
# Refresh is the only call that hits the upstream API and pulls any missing
# trading days; the read endpoints are pure pandas over cached pickles.
#
# Response cache (Trade Today / Market Monitor). The reads make no upstream
# calls, but the compute is heavy — `situational` pivots ~400 sessions × ~5k
# tickers and `regime-backtest` builds that panel twice. The underlying data
# only changes when a new session lands in the grouped cache or the universe is
# refreshed, i.e. at most once per trading day via /api/breadth/refresh. So we
# memoize each read against a cheap *freshness fingerprint* of the cache
# directory: identical fingerprint ⇒ the answer can't have changed, so we serve
# the stored payload and skip the pandas work. After the close the fingerprint
# is frozen until the next session, so overnight / weekend / holiday reloads
# never recompute. While the market is active a short TTL caps staleness as a
# backstop. Invalidated explicitly on refresh.
# ---------------------------------------------------------------------------


# ── Breadth / situational endpoints moved to breadth_router.py (included near app setup). ──
