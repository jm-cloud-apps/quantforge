"""Massive.com OHLCV provider.

Path: GET /v2/aggs/ticker/{symbol}/range/1/day/{from}/{to}
Auth: ?apiKey=... query param
Response: {"status": "OK", "results": [{"t": ms, "o": .., "h": .., "l": .., "c": .., "v": ..}]}

The API is Polygon.io-shaped (Massive is a Polygon-compatible service), so the
field names are single letters and timestamps are Unix milliseconds.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta

import httpx
import pandas as pd

from .base import OHLCV_COLS

logger = logging.getLogger(__name__)

BASE_URL = "https://api.massive.com"
ENDPOINT = "/v2/aggs/ticker/{symbol}/range/1/day/{frm}/{to}"


class MassiveProvider:
    name = "massive"

    def __init__(self, api_key: str | None = None, timeout: float = 15.0):
        self.api_key = api_key or os.getenv("MASSIVE_API_KEY")
        if not self.api_key:
            raise ValueError(
                "MASSIVE_API_KEY not set. Add it to your .env or set the env var."
            )
        self.timeout = timeout
        self._client = httpx.Client(timeout=timeout)

    def fetch(self, symbol: str, lookback_days: int) -> pd.DataFrame | None:
        end = datetime.now().date()
        start = end - timedelta(days=lookback_days)
        url = BASE_URL + ENDPOINT.format(
            symbol=symbol.upper(),
            frm=start.strftime("%Y-%m-%d"),
            to=end.strftime("%Y-%m-%d"),
        )
        params = {
            "adjusted": "true",
            "sort": "asc",
            "limit": 50000,
            "apiKey": self.api_key,
        }
        for attempt in range(1, 4):
            try:
                resp = self._client.get(url, params=params)
                if resp.status_code == 429:
                    # Rate limited — backoff and retry.
                    logger.warning("massive: 429 on %s, backing off", symbol)
                    time.sleep(1.5 * attempt)
                    continue
                if resp.status_code != 200:
                    logger.debug("massive: HTTP %d for %s body=%s", resp.status_code, symbol, resp.text[:200])
                    return None
                data = resp.json()
                if data.get("status") not in ("OK", "DELAYED"):
                    logger.debug("massive: non-OK status %s for %s", data.get("status"), symbol)
                    return None
                results = data.get("results") or []
                if not results:
                    return None
                df = pd.DataFrame(results)
                # Polygon-shape: t (ms), o, h, l, c, v (plus optional vw, n)
                df["date"] = pd.to_datetime(df["t"], unit="ms").dt.tz_localize(None).dt.normalize()
                df = df.rename(columns={"o": "open", "h": "high", "l": "low", "c": "close", "v": "volume"})
                df = df.set_index("date")[OHLCV_COLS]
                return df.sort_index()
            except httpx.RequestError as e:
                logger.debug("massive: request error %s for %s", e, symbol)
                time.sleep(0.5 * attempt)
            except Exception as e:
                logger.warning("massive: unexpected error for %s: %s", symbol, e)
                return None
        return None

    # ------------------------------------------------------------------
    # Edge enhancements (gainers / RSI / intraday)
    # ------------------------------------------------------------------

    def fetch_gainers(self, kind: str = "gainers", limit: int = 50) -> list[str]:
        """Pull today's top gainers or most-active US stocks.

        kind: 'gainers' | 'losers' | (we don't pull losers — kept for future)
        Returns a list of symbol strings.
        """
        path = f"/v2/snapshot/locale/us/markets/stocks/{kind}"
        try:
            r = self._client.get(BASE_URL + path, params={"apiKey": self.api_key})
            if r.status_code != 200:
                logger.warning("massive gainers HTTP %d: %s", r.status_code, r.text[:200])
                return []
            data = r.json()
            tickers = data.get("tickers") or []
            out = [t.get("ticker") for t in tickers if t.get("ticker")]
            return [s.upper() for s in out[:limit]]
        except Exception as e:
            logger.warning("massive gainers error: %s", e)
            return []

    def fetch_rsi(self, symbol: str, window: int = 14) -> float | None:
        """Pull the latest RSI value via Massive's indicators endpoint."""
        path = f"/v1/indicators/rsi/{symbol.upper()}"
        params = {
            "timespan": "day",
            "window": window,
            "series_type": "close",
            "order": "desc",
            "limit": 1,
            "apiKey": self.api_key,
        }
        try:
            r = self._client.get(BASE_URL + path, params=params)
            if r.status_code != 200:
                return None
            data = r.json()
            values = (data.get("results") or {}).get("values") or []
            if not values:
                return None
            return float(values[0].get("value"))
        except Exception as e:
            logger.debug("massive RSI error for %s: %s", symbol, e)
            return None

    def fetch_intraday(self, symbol: str, days_back: int = 2) -> list[dict]:
        """Pull 5-minute bars for the last `days_back` trading days.

        Returns a list of {time (epoch seconds), open, high, low, close, volume}.
        """
        end = datetime.now().date()
        start = end - timedelta(days=days_back + 1)
        path = f"/v2/aggs/ticker/{symbol.upper()}/range/5/minute/{start.isoformat()}/{end.isoformat()}"
        params = {
            "adjusted": "true",
            "sort": "asc",
            "limit": 50000,
            "apiKey": self.api_key,
        }
        try:
            r = self._client.get(BASE_URL + path, params=params)
            if r.status_code != 200:
                return []
            data = r.json()
            results = data.get("results") or []
            return [
                {
                    "time": int(b["t"] / 1000),  # lightweight-charts wants seconds
                    "open": b["o"], "high": b["h"], "low": b["l"], "close": b["c"],
                    "volume": b["v"],
                }
                for b in results
            ]
        except Exception as e:
            logger.warning("massive intraday error for %s: %s", symbol, e)
            return []

    def close(self) -> None:
        try:
            self._client.close()
        except Exception:
            pass
