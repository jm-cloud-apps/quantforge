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
