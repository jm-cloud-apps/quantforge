"""News provider registry.

Set QF_NEWS_PROVIDER=massive (default) or =finnhub. If the primary provider
isn't configured, automatically falls back to the other.
"""

from __future__ import annotations

import logging
import os

from .base import NewsProvider
from .finnhub import FinnhubNewsProvider
from .massive import MassiveNewsProvider

logger = logging.getLogger(__name__)


def get_news_provider() -> NewsProvider:
    name = os.getenv("QF_NEWS_PROVIDER", "massive").strip().lower()
    if name == "finnhub":
        try:
            return FinnhubNewsProvider()
        except ValueError:
            logger.warning("Finnhub configured but key missing; falling back to Massive.")
            return MassiveNewsProvider()
    # Default: massive
    try:
        return MassiveNewsProvider()
    except ValueError:
        logger.warning("Massive key missing; falling back to Finnhub.")
        return FinnhubNewsProvider()
