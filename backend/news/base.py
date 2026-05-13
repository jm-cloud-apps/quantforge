"""Provider-agnostic news article shape.

The dict shape is intentionally compatible with what the existing
NewsAnalysis frontend already consumes (`symbol/title/text/url/image/
site/publishedDate`), with an optional `sentiment` block surfaced when
the provider gives us one (Massive does, Finnhub doesn't).
"""

from __future__ import annotations

from typing import Protocol, TypedDict, Optional


class Sentiment(TypedDict, total=False):
    label: str          # 'positive' | 'neutral' | 'negative'
    reasoning: str      # human-readable explanation


class Article(TypedDict, total=False):
    symbol: str
    title: str
    text: str
    url: str
    image: str
    site: str
    publishedDate: str
    sentiment: Optional[Sentiment]
    keywords: Optional[list[str]]


class NewsProvider(Protocol):
    name: str

    def fetch_for(self, symbol: str, lookback_days: int = 4, limit: int = 8) -> list[Article]:
        ...
