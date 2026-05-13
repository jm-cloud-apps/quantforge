"""Massive.com news provider.

GET /v2/reference/news?ticker=X
Returns Polygon-shaped results with per-ticker AI-generated sentiment under
the `insights` field — substantially richer than Finnhub.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://api.massive.com"
ENDPOINT = "/v2/reference/news"


def _fmt_published(s: str | None) -> str:
    if not s:
        return ""
    try:
        # Massive sends ISO with Z; convert to "YYYY-MM-DD HH:MM:SS" local for
        # display parity with the existing Finnhub-format the frontend expects.
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return s


class MassiveNewsProvider:
    name = "massive"

    def __init__(self, api_key: str | None = None, timeout: float = 15.0):
        self.api_key = api_key or os.getenv("MASSIVE_API_KEY")
        if not self.api_key:
            raise ValueError("MASSIVE_API_KEY not set")
        self._client = httpx.Client(timeout=timeout)

    def fetch_for(self, symbol: str, lookback_days: int = 4, limit: int = 8) -> list[dict]:
        since = (datetime.utcnow() - timedelta(days=lookback_days)).strftime("%Y-%m-%dT00:00:00Z")
        params = {
            "ticker": symbol.upper(),
            "published_utc.gte": since,
            "limit": min(limit, 50),
            "order": "desc",
            "sort": "published_utc",
            "apiKey": self.api_key,
        }
        try:
            r = self._client.get(BASE_URL + ENDPOINT, params=params)
            if r.status_code != 200:
                logger.warning("massive news HTTP %d for %s: %s", r.status_code, symbol, r.text[:200])
                return []
            data = r.json()
        except Exception as e:
            logger.warning("massive news error for %s: %s", symbol, e)
            return []

        out: list[dict] = []
        for item in (data.get("results") or [])[:limit]:
            publisher = item.get("publisher") or {}
            insights = item.get("insights") or []
            sym_insight = next(
                (ins for ins in insights if (ins.get("ticker") or "").upper() == symbol.upper()),
                None,
            )
            article = {
                "symbol": symbol.upper(),
                "title": item.get("title", ""),
                "text": item.get("description", ""),
                "url": item.get("article_url", ""),
                "image": item.get("image_url", ""),
                "site": (publisher.get("name") if isinstance(publisher, dict) else publisher) or "",
                "publishedDate": _fmt_published(item.get("published_utc")),
                "keywords": item.get("keywords", []) or [],
            }
            if sym_insight:
                article["sentiment"] = {
                    "label": sym_insight.get("sentiment") or "neutral",
                    "reasoning": sym_insight.get("sentiment_reasoning") or "",
                }
            out.append(article)
        return out

    def close(self) -> None:
        try:
            self._client.close()
        except Exception:
            pass
