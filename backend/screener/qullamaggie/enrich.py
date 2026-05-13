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
