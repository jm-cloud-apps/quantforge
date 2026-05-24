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


def _normalize_snapshot(t: dict) -> dict:
    """Massive snapshot rows nest current / minute / day / prevDay. Pull
    the fields that matter for pre-market scoring + simple price refresh."""
    day = t.get("day") or {}
    minute = t.get("min") or {}
    prev = t.get("prevDay") or {}

    # `day.c` is the today's regular-session close (0 before close).
    # Latest tradeable price = minute close while regular session is open OR
    # in extended hours; falls back to prevDay close when the market hasn't
    # opened yet at all.
    last_price = (
        minute.get("c") if minute.get("c") else day.get("c") or prev.get("c") or None
    )
    prev_close = prev.get("c") or None
    change_pct = None
    if last_price and prev_close:
        try:
            change_pct = (float(last_price) / float(prev_close) - 1) * 100
        except Exception:
            change_pct = None

    return {
        "symbol": (t.get("ticker") or "").upper(),
        "last_price": float(last_price) if last_price else None,
        "prev_close": float(prev_close) if prev_close else None,
        "change_pct": round(change_pct, 2) if change_pct is not None else None,
        # "minute" is the most recent 1-min bar; in pre/post market this is
        # the live extended-hours quote.
        "minute_close": float(minute.get("c")) if minute.get("c") else None,
        "minute_volume": float(minute.get("v")) if minute.get("v") else None,
        "minute_av": float(minute.get("av")) if minute.get("av") else None,  # accumulated session volume
        "minute_timestamp": int(minute.get("t") / 1000) if minute.get("t") else None,
        # Today's regular session — populated after 9:30am ET
        "day_open": float(day.get("o")) if day.get("o") else None,
        "day_high": float(day.get("h")) if day.get("h") else None,
        "day_low": float(day.get("l")) if day.get("l") else None,
        "day_close": float(day.get("c")) if day.get("c") else None,
        "day_volume": float(day.get("v")) if day.get("v") else None,
    }


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

    def fetch_snapshot(self, symbol: str) -> dict | None:
        """Single-ticker snapshot. Includes latest minute bar (which carries
        the current pre-market / after-hours quote when the regular session
        is closed) plus today's OHLCV and the previous-day reference close.
        """
        path = f"/v2/snapshot/locale/us/markets/stocks/tickers/{symbol.upper()}"
        try:
            r = self._client.get(BASE_URL + path, params={"apiKey": self.api_key})
            if r.status_code != 200:
                logger.debug("massive snapshot HTTP %d for %s", r.status_code, symbol)
                return None
            data = r.json() or {}
            t = data.get("ticker") or {}
            if not t:
                return None
            return _normalize_snapshot(t)
        except Exception as e:
            logger.debug("massive snapshot error for %s: %s", symbol, e)
            return None

    def fetch_snapshots(self, symbols: list[str]) -> dict[str, dict]:
        """Bulk snapshot — one HTTP call returns the latest quote for every
        symbol in `symbols`. Returned dict is keyed by symbol.
        """
        if not symbols:
            return {}
        path = "/v2/snapshot/locale/us/markets/stocks/tickers"
        # Massive caps URL length; chunk in groups of 100 just in case.
        out: dict[str, dict] = {}
        for i in range(0, len(symbols), 100):
            chunk = symbols[i : i + 100]
            params = {"tickers": ",".join(s.upper() for s in chunk), "apiKey": self.api_key}
            try:
                r = self._client.get(BASE_URL + path, params=params)
                if r.status_code != 200:
                    logger.debug("massive bulk snapshot HTTP %d", r.status_code)
                    continue
                data = r.json() or {}
                for t in data.get("tickers") or []:
                    sym = (t.get("ticker") or "").upper()
                    if sym:
                        out[sym] = _normalize_snapshot(t)
            except Exception as e:
                logger.debug("massive bulk snapshot error: %s", e)
        return out

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

    def fetch_ratios(self, symbol: str) -> dict | None:
        """Fetch latest financial ratios — market cap, price, 30d avg volume.
        Shares outstanding can be derived as market_cap / price.

        Endpoint: /stocks/financials/v1/ratios?ticker=X&limit=1
        """
        try:
            r = self._client.get(
                BASE_URL + "/stocks/financials/v1/ratios",
                params={"ticker": symbol.upper(), "limit": 1, "apiKey": self.api_key},
            )
            if r.status_code != 200:
                logger.debug("massive ratios HTTP %d for %s", r.status_code, symbol)
                return None
            results = (r.json() or {}).get("results") or []
            if not results:
                return None
            row = results[0]
            return {
                "market_cap": row.get("market_cap"),
                "price": row.get("price"),
                "average_volume": row.get("average_volume"),
                "earnings_per_share": row.get("earnings_per_share"),
                "date": row.get("date"),
            }
        except Exception as e:
            logger.debug("massive ratios error for %s: %s", symbol, e)
            return None

    def fetch_float(self, symbol: str) -> float | None:
        """Fetch free-float percentage (0-1) from Massive's float endpoint.

        Endpoint: /stocks/vX/float?ticker=X
        """
        try:
            r = self._client.get(
                BASE_URL + "/stocks/vX/float",
                params={"ticker": symbol.upper(), "limit": 1, "apiKey": self.api_key},
            )
            if r.status_code != 200:
                return None
            results = (r.json() or {}).get("results") or []
            if not results:
                return None
            return results[0].get("free_float_percent")
        except Exception as e:
            logger.debug("massive float error for %s: %s", symbol, e)
            return None

    def fetch_calendar(self, symbol: str) -> dict:
        """Return the next upcoming earnings date and ex-dividend date (if any).

        Both are best-effort — Massive's calendar feeds (Benzinga earnings,
        stocks dividends) are queried for the first record on/after today.
        Returns {"earnings_date": "YYYY-MM-DD" | None, "ex_dividend_date": ... | None}.
        """
        today = datetime.now().date().isoformat()
        out = {"earnings_date": None, "ex_dividend_date": None}

        try:
            r = self._client.get(
                BASE_URL + "/benzinga/v1/earnings",
                params={
                    "ticker": symbol.upper(),
                    "date.gte": today,
                    "sort": "date.asc",
                    "limit": 1,
                    "apiKey": self.api_key,
                },
            )
            if r.status_code == 200:
                results = r.json().get("results") or []
                if results:
                    out["earnings_date"] = results[0].get("date")
        except Exception as e:
            logger.debug("massive earnings error for %s: %s", symbol, e)

        try:
            r = self._client.get(
                BASE_URL + "/stocks/v1/dividends",
                params={
                    "ticker": symbol.upper(),
                    "ex_dividend_date.gte": today,
                    "sort": "ex_dividend_date.asc",
                    "limit": 1,
                    "apiKey": self.api_key,
                },
            )
            if r.status_code == 200:
                results = r.json().get("results") or []
                if results:
                    out["ex_dividend_date"] = results[0].get("ex_dividend_date")
        except Exception as e:
            logger.debug("massive dividends error for %s: %s", symbol, e)

        return out

    def fetch_earnings_window(
        self,
        start: str,
        end: str,
        tickers: list[str] | None = None,
        max_pages: int = 6,
    ) -> list[dict]:
        """Pull every earnings entry in [start, end] (YYYY-MM-DD inclusive).

        Returns a flat list of dicts shaped like:
          {"symbol": "AAPL", "date": "2026-05-23", "time": "amc",
           "eps_estimate": 1.23, "eps_actual": None, "revenue_estimate": ...,
           "revenue_actual": ..., "currency": "USD", "exchange": "NASDAQ"}

        If `tickers` is set, the result is filtered to that subset client-side
        (the Benzinga endpoint accepts a single ticker filter, so for multi-
        ticker windows the cheaper approach is to fetch the full window and
        filter locally). Paginates via `cursor` up to `max_pages` to cover
        peak earnings weeks (~500 reports/day).
        """
        results: list[dict] = []
        next_url: str | None = None
        params = {
            "date.gte": start,
            "date.lte": end,
            "sort": "date.asc",
            "limit": 1000,
            "apiKey": self.api_key,
        }

        for _ in range(max_pages):
            try:
                if next_url:
                    # Polygon's `next_url` already encodes pagination params;
                    # we only need to re-attach the apiKey.
                    sep = "&" if "?" in next_url else "?"
                    r = self._client.get(f"{next_url}{sep}apiKey={self.api_key}")
                else:
                    r = self._client.get(BASE_URL + "/benzinga/v1/earnings", params=params)
                if r.status_code != 200:
                    logger.debug("massive earnings window HTTP %d: %s", r.status_code, r.text[:200])
                    break
                data = r.json() or {}
                results.extend(data.get("results") or [])
                next_url = data.get("next_url")
                if not next_url:
                    break
            except Exception as e:
                logger.warning("massive earnings window error: %s", e)
                break

        # Normalize. Benzinga fields include: ticker, date, time ("bmo"/"amc"/"dmt"),
        # eps_estimate, eps, revenue_estimate, revenue, currency, exchange,
        # importance, fiscal_year, fiscal_period.
        out: list[dict] = []
        ticker_set = {t.upper() for t in (tickers or [])}
        for row in results:
            sym = (row.get("ticker") or "").upper()
            if not sym:
                continue
            if ticker_set and sym not in ticker_set:
                continue
            out.append({
                "symbol": sym,
                "date": row.get("date"),
                "time": (row.get("time") or "").lower() or None,  # bmo / amc / dmt
                "eps_estimate": row.get("eps_estimate"),
                "eps_actual": row.get("eps"),
                "revenue_estimate": row.get("revenue_estimate"),
                "revenue_actual": row.get("revenue"),
                "currency": row.get("currency"),
                "exchange": row.get("exchange"),
                "importance": row.get("importance"),
                "fiscal_period": row.get("fiscal_period"),
                "fiscal_year": row.get("fiscal_year"),
            })
        return out

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
