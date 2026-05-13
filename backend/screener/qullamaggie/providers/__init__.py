"""Provider registry and selection.

Set QF_DATA_PROVIDER=massive (default) or =yahoo to switch. The registry is
kept tiny on purpose — if you stop paying for Massive, change the env var
and restart; no code changes needed.
"""

from __future__ import annotations

import logging
import os

from .base import Provider
from .massive import MassiveProvider
from .yahoo import YahooProvider

logger = logging.getLogger(__name__)


def get_provider() -> Provider:
    name = os.getenv("QF_DATA_PROVIDER", "massive").strip().lower()
    if name == "yahoo":
        logger.info("Data provider: yahoo (yfinance)")
        return YahooProvider()
    if name == "massive":
        try:
            p = MassiveProvider()
            logger.info("Data provider: massive")
            return p
        except ValueError as e:
            logger.warning("%s — falling back to yahoo provider.", e)
            return YahooProvider()
    raise ValueError(f"Unknown QF_DATA_PROVIDER: {name!r} (expected 'massive' or 'yahoo')")
