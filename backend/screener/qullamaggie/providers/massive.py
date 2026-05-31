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

from .base import OHLCV_COLS, NoApiKey, NoData, NotEntitled, RateLimited

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
                # Polygon-shape: t (ms), o, h, l, c, v (plus optional vw, n).
                # We now also capture `vw` (daily VWAP) as the `vwap` column —
                # needed for the Tier-A Accumulation Score (close-vs-VWAP).
                df["date"] = pd.to_datetime(df["t"], unit="ms").dt.tz_localize(None).dt.normalize()
                df = df.rename(columns={
                    "o": "open", "h": "high", "l": "low", "c": "close", "v": "volume",
                    "vw": "vwap",
                })
                keep = OHLCV_COLS + [c for c in ("vwap",) if c in df.columns]
                df = df.set_index("date")[keep]
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

    def fetch_option_chain(self, underlying: str, max_pages: int = 6, limit: int = 250) -> dict | None:
        """Pull the full option chain snapshot for an underlying.

        Endpoint: /v3/snapshot/options/{underlyingAsset}
        Paginates via Massive's `next_url`. Returns:
          {
            "underlying_price": float | None,
            "contracts": [...]
          }

        Raises:
          NotEntitled — Massive plan doesn't include Options data (401/403).
          RateLimited — 429 across all retry attempts.
          NoData      — 200/404 with empty result set.
        """
        if not self.api_key:
            raise NoApiKey("MASSIVE_API_KEY is not configured")
        path = f"/v3/snapshot/options/{underlying.upper()}"
        params = {"limit": limit, "apiKey": self.api_key}
        contracts: list[dict] = []
        underlying_price: float | None = None
        next_url: str | None = None
        for _ in range(max_pages):
            try:
                if next_url:
                    sep = "&" if "?" in next_url else "?"
                    r = self._client.get(f"{next_url}{sep}apiKey={self.api_key}")
                else:
                    r = self._client.get(BASE_URL + path, params=params)
            except Exception as e:
                logger.debug("massive option chain network error for %s: %s", underlying, e)
                break

            # Classify the response. 401/403 → entitlement. 429 → rate limit.
            # 404 → no data for ticker. 200 with empty results also → NoData.
            if r.status_code in (401, 403):
                # Body may have a message clarifying ("not authorized for this
                # endpoint" vs "invalid key"). Surface both possibilities.
                detail = (r.text or "")[:200]
                logger.warning("massive options entitlement issue for %s (HTTP %d): %s",
                               underlying, r.status_code, detail)
                raise NotEntitled("Options", status_code=r.status_code)
            if r.status_code == 429:
                raise RateLimited(f"Massive rate limit (429) while fetching options for {underlying}")
            if r.status_code == 404:
                # Treat as no-data (ticker has no listed options).
                return None
            if r.status_code != 200:
                logger.debug("massive option chain HTTP %d for %s body=%s",
                             r.status_code, underlying, r.text[:200])
                break

            try:
                data = r.json() or {}
            except Exception as e:
                logger.debug("massive option chain decode error for %s: %s", underlying, e)
                break
            results = data.get("results") or []
            contracts.extend(results)
            if underlying_price is None and results:
                ua = results[0].get("underlying_asset") or {}
                underlying_price = ua.get("price") or ua.get("last_price")
            next_url = data.get("next_url")
            if not next_url:
                break

        if not contracts:
            return None
        return {"underlying_price": underlying_price, "contracts": contracts}

    def fetch_option_trades_sample(
        self,
        options_ticker: str,
        date: str | None = None,
        max_pages: int = 1,
        per_page: int = 5000,
    ) -> list[dict]:
        """Pull tick-level trades for a single options contract.

        Raises:
          NotEntitled — tick-level Options Trades not on the plan (401/403).
          RateLimited — 429.
        Returns [] on no-data; raises on actionable errors.
        """
        from datetime import date as _date
        if not self.api_key:
            raise NoApiKey("MASSIVE_API_KEY is not configured")
        d = date or _date.today().isoformat()
        path = f"/v3/trades/{options_ticker}"
        params = {
            "timestamp": d,
            "limit": per_page,
            "order": "asc",
            "sort": "timestamp",
            "apiKey": self.api_key,
        }
        out: list[dict] = []
        next_url: str | None = None
        for _ in range(max_pages):
            try:
                if next_url:
                    sep = "&" if "?" in next_url else "?"
                    r = self._client.get(f"{next_url}{sep}apiKey={self.api_key}")
                else:
                    r = self._client.get(BASE_URL + path, params=params)
            except Exception as e:
                logger.debug("massive opt-trades network error for %s: %s", options_ticker, e)
                break
            if r.status_code in (401, 403):
                raise NotEntitled("Options Trades (tick-level)", status_code=r.status_code)
            if r.status_code == 429:
                raise RateLimited(f"Massive rate limit on opt-trades for {options_ticker}")
            if r.status_code != 200:
                logger.debug("massive opt-trades HTTP %d for %s", r.status_code, options_ticker)
                break
            try:
                data = r.json() or {}
            except Exception:
                break
            results = data.get("results") or []
            for t in results:
                out.append({
                    "size": t.get("size") or 0,
                    "price": t.get("price") or 0,
                    "exchange": t.get("exchange"),
                    "conditions": t.get("conditions") or [],
                    "sip_timestamp": t.get("sip_timestamp") or 0,
                })
            next_url = data.get("next_url")
            if not next_url:
                break
        return out

    def fetch_trades_sample(
        self,
        symbol: str,
        date: str | None = None,
        max_pages: int = 2,
        per_page: int = 50000,
    ) -> list[dict]:
        """Pull a **sample** of tick-level trades for block & dark-pool stats.

        Raises:
          NotEntitled — tick-level Trades endpoint isn't on the plan (401/403).
          RateLimited — 429.
        """
        from datetime import date as _date
        if not self.api_key:
            raise NoApiKey("MASSIVE_API_KEY is not configured")
        d = date or _date.today().isoformat()
        path = f"/v3/trades/{symbol.upper()}"
        params = {
            "timestamp": d,
            "limit": per_page,
            "order": "asc",
            "sort": "timestamp",
            "apiKey": self.api_key,
        }
        out: list[dict] = []
        next_url: str | None = None
        for _ in range(max_pages):
            try:
                if next_url:
                    sep = "&" if "?" in next_url else "?"
                    r = self._client.get(f"{next_url}{sep}apiKey={self.api_key}")
                else:
                    r = self._client.get(BASE_URL + path, params=params)
            except Exception as e:
                logger.debug("massive trades network error for %s: %s", symbol, e)
                break
            if r.status_code in (401, 403):
                raise NotEntitled("Tick-level Trades", status_code=r.status_code)
            if r.status_code == 429:
                raise RateLimited(f"Massive rate limit on trades for {symbol}")
            if r.status_code != 200:
                logger.debug("massive trades HTTP %d for %s", r.status_code, symbol)
                break
            try:
                data = r.json() or {}
            except Exception:
                break
            results = data.get("results") or []
            for t in results:
                out.append({
                    "size": t.get("size") or 0,
                    "price": t.get("price") or 0,
                    "exchange": t.get("exchange"),
                    "conditions": t.get("conditions") or [],
                    "trf_id": t.get("trf_id"),
                })
            next_url = data.get("next_url")
            if not next_url:
                break
        return out

    def fetch_daily_market_summary(self, date: str | None = None) -> list[dict]:
        """Pull OHLCV for every US-listed stock on the given trading day.

        One request returns the whole tape (~8K-10K rows). Used by the wide
        universe builder to dynamically pick liquid names without us having to
        maintain a curated list.

        Endpoint: /v2/aggs/grouped/locale/us/market/stocks/{date}
        Returns: [{T, o, h, l, c, v, vw, n}, ...] (Polygon-style single letters)
        """
        from datetime import date as _date, timedelta
        if not self.api_key:
            raise NoApiKey("MASSIVE_API_KEY is not configured")
        # If no date given, use most recent weekday (the grouped endpoint
        # returns nothing on weekends — would need to crawl back).
        if date is None:
            d = _date.today()
            while d.weekday() >= 5:
                d -= timedelta(days=1)
            date = d.isoformat()
        path = f"/v2/aggs/grouped/locale/us/market/stocks/{date}"
        params = {"adjusted": "true", "apiKey": self.api_key}
        try:
            r = self._client.get(BASE_URL + path, params=params)
        except Exception as e:
            logger.debug("massive grouped market summary network error: %s", e)
            return []
        if r.status_code in (401, 403):
            raise NotEntitled("Daily Market Summary (grouped)", status_code=r.status_code)
        if r.status_code == 429:
            raise RateLimited("Massive rate limit on grouped market summary")
        if r.status_code != 200:
            logger.debug("massive grouped market summary HTTP %d: %s", r.status_code, r.text[:200])
            return []
        try:
            return (r.json() or {}).get("results") or []
        except Exception:
            return []

    def fetch_form4_recent(self, symbol: str, days_back: int = 60) -> list[dict]:
        """Recent SEC Form 4 insider transactions for `symbol`.

        Form 4s are filed within 2 business days of any insider buy/sell. We
        return the raw rows from the last `days_back` days so the caller can
        count purchase codes ('P') separately from sales ('S').

        Endpoint: /stocks/filings/vX/form-4
        """
        from datetime import date, timedelta
        cutoff = (date.today() - timedelta(days=days_back)).isoformat()
        try:
            r = self._client.get(
                BASE_URL + "/stocks/filings/vX/form-4",
                params={
                    "tickers": symbol.upper(),
                    "filing_date.gte": cutoff,
                    "sort": "filing_date.desc",
                    "limit": 100,
                    "apiKey": self.api_key,
                },
            )
            if r.status_code in (401, 403):
                raise NotEntitled("SEC Form 4 Filings", status_code=r.status_code)
            if r.status_code == 429:
                raise RateLimited(f"Massive rate limit on form-4 for {symbol}")
            if r.status_code != 200:
                logger.debug("massive form-4 HTTP %d for %s", r.status_code, symbol)
                return []
            return (r.json() or {}).get("results") or []
        except (NotEntitled, RateLimited):
            raise
        except Exception as e:
            logger.debug("massive form-4 error for %s: %s", symbol, e)
            return []

    def fetch_13f_recent(self, symbol: str, days_back: int = 90) -> list[dict]:
        """Recent SEC 13-F filings mentioning `symbol` as a holding.

        13-F filings are quarterly snapshots from institutional managers with
        ≥$100M AUM. We pull the last `days_back` days of FILINGS (not holdings
        as-of-date) — gives us a sense of how many funds disclosed positions in
        the most recent quarter.

        Endpoint: /stocks/filings/vX/13-F
        Note: this endpoint filters by filing_date, not by holding ticker. We
        fetch a window and would need to inspect holdings server-side for an
        exact "who holds X" count. Massive's row schema may include a holdings
        list per filing — we count filings whose holdings include `symbol`.
        """
        from datetime import date, timedelta
        cutoff = (date.today() - timedelta(days=days_back)).isoformat()
        try:
            r = self._client.get(
                BASE_URL + "/stocks/filings/vX/13-F",
                params={
                    "filing_date.gte": cutoff,
                    "sort": "filing_date.desc",
                    "limit": 200,
                    "apiKey": self.api_key,
                },
            )
            if r.status_code in (401, 403):
                raise NotEntitled("SEC 13-F Filings", status_code=r.status_code)
            if r.status_code == 429:
                raise RateLimited(f"Massive rate limit on 13-F for {symbol}")
            if r.status_code != 200:
                logger.debug("massive 13-F HTTP %d for %s", r.status_code, symbol)
                return []
            # Filter to filings whose holdings include the symbol. The exact
            # field name varies by Massive's schema — we look for any list/dict
            # in the row that contains the ticker case-insensitively. This is a
            # best-effort filter; a future iteration could use a dedicated
            # holdings endpoint when available.
            rows = (r.json() or {}).get("results") or []
            sym = symbol.upper()
            out = []
            for row in rows:
                blob = str(row).upper()
                if sym in blob:
                    out.append(row)
            return out
        except (NotEntitled, RateLimited):
            raise
        except Exception as e:
            logger.debug("massive 13-F error for %s: %s", symbol, e)
            return []

    def fetch_short_interest(self, symbol: str) -> dict | None:
        """Pull the most recent bi-weekly short interest record.

        Different from short *volume* (which is daily): this is the OUTSTANDING
        short position from FINRA's bi-weekly settlement. Includes days-to-cover
        which is the gold ratio for spotting squeeze setups.

        Endpoint: /stocks/v1/short-interest?ticker=X&sort=settlement_date.desc&limit=1
        Returns: {short_interest, days_to_cover, avg_daily_volume, settlement_date}
        """
        try:
            r = self._client.get(
                BASE_URL + "/stocks/v1/short-interest",
                params={
                    "ticker": symbol.upper(),
                    "sort": "settlement_date.desc",
                    "limit": 1,
                    "apiKey": self.api_key,
                },
            )
            if r.status_code in (401, 403):
                raise NotEntitled("Short Interest", status_code=r.status_code)
            if r.status_code == 429:
                raise RateLimited(f"Massive rate limit on short-interest for {symbol}")
            if r.status_code != 200:
                logger.debug("massive short-interest HTTP %d for %s", r.status_code, symbol)
                return None
            results = (r.json() or {}).get("results") or []
            if not results:
                return None
            return results[0]
        except (NotEntitled, RateLimited):
            raise
        except Exception as e:
            logger.debug("massive short-interest error for %s: %s", symbol, e)
            return None

    def fetch_short_volume(self, symbol: str) -> dict | None:
        """Pull the most recent off-exchange (FINRA ATS) short volume row.

        Returns:
          {
            "date": "YYYY-MM-DD",
            "short_volume": int,
            "total_volume": int,
            "short_volume_ratio": float,  # 0-100 (percentage)
          }
        Endpoint: /stocks/v1/short-volume?ticker=X&sort=date.desc&limit=1
        """
        try:
            r = self._client.get(
                BASE_URL + "/stocks/v1/short-volume",
                params={
                    "ticker": symbol.upper(),
                    "sort": "date.desc",
                    "limit": 1,
                    "apiKey": self.api_key,
                },
            )
            if r.status_code != 200:
                logger.debug("massive short-volume HTTP %d for %s", r.status_code, symbol)
                return None
            results = (r.json() or {}).get("results") or []
            if not results:
                return None
            row = results[0]
            return {
                "date": row.get("date"),
                "short_volume": row.get("short_volume"),
                "total_volume": row.get("total_volume"),
                "short_volume_ratio": row.get("short_volume_ratio"),
            }
        except Exception as e:
            logger.debug("massive short-volume error for %s: %s", symbol, e)
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
