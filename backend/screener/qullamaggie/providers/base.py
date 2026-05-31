"""Provider abstraction for OHLCV data sources.

Each provider implements fetch(symbol, lookback_days) -> DataFrame indexed by
date with columns [open, high, low, close, volume]. Return None on failure
so the caller can fall back.

To add a new provider: create a sibling module with a Provider subclass and
register it in providers/__init__.py REGISTRY.
"""

from __future__ import annotations

from typing import Protocol

import pandas as pd

OHLCV_COLS = ["open", "high", "low", "close", "volume"]
# Optional column — populated when the provider supplies a daily VWAP (Massive
# Polygon-style `vw`). Callers must treat absence gracefully (fall back to
# typical price (H+L+C)/3 as a VWAP proxy).
OHLCV_OPTIONAL_COLS = ["vwap"]


# ---------------------------------------------------------------------------
# Typed errors so the router can distinguish:
#   • "no API key configured"      (operator misconfiguration)
#   • "endpoint not entitled"      (paid-tier or add-on required)
#   • "no data for this ticker"    (legitimate empty result)
#   • "rate limit / transient"     (retry-friendly)
# ---------------------------------------------------------------------------
class ProviderError(Exception):
    """Base provider error. Has a human-readable hint for the UI."""
    hint: str = ""


class NoApiKey(ProviderError):
    """Provider has no API key configured."""
    hint = "Set MASSIVE_API_KEY in your .env or environment."


class NotEntitled(ProviderError):
    """The Massive plan/key doesn't include access to this endpoint.

    `endpoint_name` is shown to the user (e.g. 'Options' or 'Tick-level Trades')
    along with a suggested upgrade path.
    """

    def __init__(self, endpoint_name: str, status_code: int = 403):
        self.endpoint_name = endpoint_name
        self.status_code = status_code
        super().__init__(
            f"{endpoint_name} endpoint is not entitled on your Massive plan "
            f"(HTTP {status_code})."
        )
        self.hint = (
            f"Your Massive API key doesn't have access to {endpoint_name}. "
            "Upgrade your plan or add the relevant data product, then try again."
        )


class NoData(ProviderError):
    """Endpoint returned 200/204 with no records — ticker simply has none."""
    hint = "This ticker has no data on this endpoint."


class RateLimited(ProviderError):
    """429 — provider rate limit. Retry after backoff."""
    hint = "Massive API rate limit hit. Wait a moment and try again."


class Provider(Protocol):
    name: str

    def fetch(self, symbol: str, lookback_days: int) -> pd.DataFrame | None:
        """Return a DateTimeIndex'd OHLCV DataFrame, or None on failure."""
        ...
