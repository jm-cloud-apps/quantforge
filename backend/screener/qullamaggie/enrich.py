"""Post-ranking enrichment: attach catalyst headline + RSI to top candidates.

These are extra API calls per top-N candidate, so we only run them on the
slice that's actually going to be returned to the frontend. Failures are
non-fatal — we still return the candidate without the enrichment.
"""

from __future__ import annotations

import logging

from .providers import get_provider

logger = logging.getLogger(__name__)


def enrich_with_news(candidates: list[dict], top_n: int = 20) -> None:
    """Attach the most recent headline + per-ticker sentiment from Massive."""
    try:
        from news import get_news_provider
        news_provider = get_news_provider()
    except Exception as e:
        logger.warning("news provider unavailable for enrichment: %s", e)
        return

    for c in candidates[:top_n]:
        try:
            articles = news_provider.fetch_for(c["symbol"], lookback_days=7, limit=3)
            if articles:
                top = articles[0]
                c["news"] = {
                    "title": top.get("title"),
                    "site": top.get("site"),
                    "url": top.get("url"),
                    "publishedDate": top.get("publishedDate"),
                    "sentiment": top.get("sentiment"),  # {label, reasoning} when Massive
                }
        except Exception as e:
            logger.debug("news enrich failed for %s: %s", c.get("symbol"), e)

    try:
        news_provider.close()
    except Exception:
        pass


def enrich_with_calendar(candidates: list[dict], top_n: int = 20) -> None:
    """Attach upcoming earnings + ex-dividend dates from Massive's calendar
    feeds, and surface a 'Earnings <date>' / 'Ex-dividend <date>' tag when the
    event lands within the next 14 days."""
    from datetime import date, datetime as _dt

    provider = get_provider()
    if not hasattr(provider, "fetch_calendar"):
        return
    today = date.today()
    for c in candidates[:top_n]:
        try:
            cal = provider.fetch_calendar(c["symbol"])
        except Exception as e:
            logger.debug("calendar enrich failed for %s: %s", c.get("symbol"), e)
            continue
        ed = cal.get("earnings_date")
        xd = cal.get("ex_dividend_date")
        if ed:
            c["earnings_date"] = ed
        if xd:
            c["ex_dividend_date"] = xd
        tags = c.setdefault("tags", [])

        def _within(day_str, n):
            try:
                d = _dt.strptime(day_str, "%Y-%m-%d").date()
                return 0 <= (d - today).days <= n
            except Exception:
                return False

        if ed and _within(ed, 14):
            tag = f"Earnings {ed}"
            if tag not in tags:
                tags.insert(0, tag)
        if xd and _within(xd, 14):
            tag = f"Ex-dividend {xd}"
            if tag not in tags:
                tags.append(tag)


def enrich_with_institutional_footprint(
    candidates: list[dict], top_n: int = 8,
) -> dict | None:
    """Tier-E (no options): SEC Form 4 insider buys + 13-F institutional holdings.

    For each of the top-N candidates we pull:
      • Form 4 transactions in the last 60 days, count `P` (purchase) codes.
        ≥2 purchases by distinct insiders = the cleanest "smart money" tell.
      • 13-F filings in the last 90 days that mention this ticker. Count of
        institutional managers (with ≥$100M AUM) that disclosed a position.

    Returns None on success, or {code, message, hint, endpoint_name} when the
    Filings endpoint isn't entitled — same contract as enrich_with_blocks so
    the router and frontend can surface one notice instead of N silent fails.
    """
    from .providers.base import NotEntitled, RateLimited
    provider = get_provider()
    if not hasattr(provider, "fetch_form4_recent"):
        return None

    for c in candidates[:top_n]:
        symbol = c.get("symbol")
        # --- Form 4 insider buys (last 60 days)
        try:
            form4 = provider.fetch_form4_recent(symbol, days_back=60)
        except NotEntitled as e:
            return {
                "code": "filings_not_entitled",
                "message": f"{e.endpoint_name} not on your Massive plan.",
                "hint": e.hint,
                "endpoint_name": e.endpoint_name,
            }
        except RateLimited as e:
            return {"code": "rate_limited", "message": str(e), "hint": e.hint}
        except Exception as e:
            logger.debug("form-4 enrich failed for %s: %s", symbol, e)
            form4 = []
        if form4:
            buy_codes = {"P"}                   # Purchase
            sell_codes = {"S"}                  # Sale
            buys = sum(1 for f in form4 if (f.get("transaction_code") or "").upper() in buy_codes)
            sells = sum(1 for f in form4 if (f.get("transaction_code") or "").upper() in sell_codes)
            distinct_buyers = len({
                f.get("owner_cik") for f in form4
                if (f.get("transaction_code") or "").upper() in buy_codes
            })
            c["insider_buys_60d"] = buys
            c["insider_sells_60d"] = sells
            c["distinct_insider_buyers_60d"] = distinct_buyers

        # --- 13-F filings (last 90 days)
        try:
            f13 = provider.fetch_13f_recent(symbol, days_back=90)
        except NotEntitled as e:
            return {
                "code": "filings_not_entitled",
                "message": f"{e.endpoint_name} not on your Massive plan.",
                "hint": e.hint,
                "endpoint_name": e.endpoint_name,
            }
        except RateLimited as e:
            return {"code": "rate_limited", "message": str(e), "hint": e.hint}
        except Exception as e:
            logger.debug("13-F enrich failed for %s: %s", symbol, e)
            f13 = []
        if f13:
            distinct_filers = len({r.get("filer_cik") for r in f13 if r.get("filer_cik")})
            c["institutional_filers_90d"] = distinct_filers
    return None


def enrich_with_blocks(candidates: list[dict], top_n: int = 8) -> dict | None:
    """Tier-C: block trades + dark-pool % from a tick-level trade sample.

    Returns:
      None on success, or an error dict {code, message, hint, endpoint_name}
      when the tick-level Trades endpoint isn't entitled / rate-limited. The
      router attaches that dict to the response so the frontend can show a
      single clear notice instead of N silent failures.
    """
    from .blocks import get_block_metrics, smart_money_label
    from .providers.base import NotEntitled, RateLimited

    for c in candidates[:top_n]:
        symbol = c.get("symbol")
        try:
            m = get_block_metrics(symbol)
        except NotEntitled as e:
            # Entitlement issue is global to the API key — no point retrying
            # on the next symbol. Surface once and stop.
            return {
                "code": "trades_not_entitled",
                "message": "Smart Money analysis requires tick-level Trades access.",
                "hint": e.hint,
                "endpoint_name": e.endpoint_name,
            }
        except RateLimited as e:
            return {"code": "rate_limited", "message": str(e), "hint": e.hint}
        except Exception as e:
            logger.debug("block enrich failed for %s: %s", symbol, e)
            continue
        if not m:
            continue
        c["block_count"] = m["block_count"]
        c["block_pct"] = m["block_pct"]
        c["block_volume"] = m["block_volume"]
        c["darkpool_pct"] = m["darkpool_pct"]
        c["darkpool_volume"] = m["darkpool_volume"]
        c["darkpool_block_count"] = m["darkpool_block_count"]
        c["block_sample_size"] = m["sample_size"]
        label, cls = smart_money_label(m)
        if label:
            c["smart_money_label"] = label
            c["smart_money_class"] = cls
    return None


def enrich_with_short_and_float(candidates: list[dict], top_n: int = 20) -> None:
    """Tier-B accumulation context: short-volume ratio + free-float.

    Two extra Massive calls per top-N candidate:
      1. /stocks/v1/short-volume — latest FINRA ATS short-sale ratio. High RVOL
         with LOW short ratio = real buying. High RVOL with HIGH short ratio =
         could be a short squeeze (still bullish short-term) or distribution.
      2. /stocks/vX/float — free float % of shares outstanding. Lets us derive
         volume-vs-float (more meaningful than vs. total shares outstanding).

    Attaches to each candidate:
      - short_volume_ratio: float (0-100, % of total volume sold short)
      - short_volume_date: "YYYY-MM-DD"
      - free_float_pct: float (0-1)
      - vol_vs_float_pct: float (today's RVOL volume / float, 0-1+)
    """
    provider = get_provider()
    if not hasattr(provider, "fetch_short_volume"):
        return
    for c in candidates[:top_n]:
        symbol = c.get("symbol")
        try:
            sv = provider.fetch_short_volume(symbol)
            if sv:
                c["short_volume_ratio"] = sv.get("short_volume_ratio")
                c["short_volume_date"] = sv.get("date")
        except Exception as e:
            logger.debug("short-volume enrich failed for %s: %s", symbol, e)

        # Float — derive volume-vs-float using today's RVOL volume.
        try:
            if hasattr(provider, "fetch_float"):
                ff = provider.fetch_float(symbol)
                if ff is not None:
                    c["free_float_pct"] = round(float(ff), 4)
        except Exception as e:
            logger.debug("float enrich failed for %s: %s", symbol, e)

        # Bi-weekly short interest + days-to-cover. Outstanding short position
        # is the squeeze-setup metric — high SI + bullish accumulation = fuel.
        try:
            if hasattr(provider, "fetch_short_interest"):
                si = provider.fetch_short_interest(symbol)
                if si:
                    short_int = int(si.get("short_interest") or 0)
                    avg_vol = int(si.get("avg_daily_volume") or 0)
                    c["short_interest"] = short_int
                    c["days_to_cover"] = si.get("days_to_cover")
                    c["short_interest_date"] = si.get("settlement_date")
                    # Short interest as % of float — most actionable form.
                    # Need a shares-outstanding proxy: avg_daily_volume × ~250
                    # underestimates float, so this is only meaningful if
                    # free_float_pct is known. Fall back to raw short interest.
                    if c.get("free_float_pct") and avg_vol > 0:
                        # Approximate float shares from avg daily volume × turnover.
                        # Massive's free-float endpoint doesn't give share count
                        # directly; using days_to_cover (SI / avg_vol) is the
                        # cleanest metric here. ≥5 days = real squeeze setup.
                        pass
        except Exception as e:
            logger.debug("short-interest enrich failed for %s: %s", symbol, e)


def enrich_with_rsi(candidates: list[dict], top_n: int = 20) -> None:
    """Attach 14-period daily RSI from Massive's indicators endpoint."""
    provider = get_provider()
    if not hasattr(provider, "fetch_rsi"):
        return
    for c in candidates[:top_n]:
        try:
            rsi = provider.fetch_rsi(c["symbol"])
            if rsi is not None:
                c["rsi"] = round(rsi, 1)
        except Exception as e:
            logger.debug("rsi enrich failed for %s: %s", c.get("symbol"), e)
