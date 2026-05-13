"""Finnhub news provider — fallback when Massive isn't configured.

Extracted from the original /api/news endpoint in main.py to keep one
canonical implementation.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://finnhub.io/api/v1"


class FinnhubNewsProvider:
    name = "finnhub"

    def __init__(self, api_key: str | None = None, timeout: float = 15.0):
        self.api_key = api_key or os.getenv("FINNHUB_API_KEY")
        if not self.api_key:
            raise ValueError("FINNHUB_API_KEY not set")
        self._client = httpx.Client(timeout=timeout)

    def fetch_for(self, symbol: str, lookback_days: int = 4, limit: int = 8) -> list[dict]:
        today = datetime.now().strftime("%Y-%m-%d")
        since = (datetime.now() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
        try:
            r = self._client.get(
                f"{BASE_URL}/company-news",
                params={"symbol": symbol, "from": since, "to": today, "token": self.api_key},
            )
            if r.status_code != 200:
                logger.warning("finnhub HTTP %d for %s", r.status_code, symbol)
                return []
            raw = r.json() or []
        except Exception as e:
            logger.warning("finnhub error for %s: %s", symbol, e)
            return []

        out: list[dict] = []
        for a in raw[:limit]:
            ts = a.get("datetime") or 0
            out.append({
                "symbol": symbol.upper(),
                "title": a.get("headline", ""),
                "text": a.get("summary", ""),
                "url": a.get("url", ""),
                "image": a.get("image", ""),
                "site": a.get("source", ""),
                "publishedDate": datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S") if ts else "",
            })
        return out

    def close(self) -> None:
        try:
            self._client.close()
        except Exception:
            pass
