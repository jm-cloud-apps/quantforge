import json
import os
import threading
import time
from datetime import datetime

import pandas as pd
import yfinance as yf

from .universe import get_sp500_tickers

# ── History persistence ───────────────────────────────────────────────────────
_HISTORY_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "advisor_history.json")
_HISTORY_MAX_DAYS = 30
_history_lock = threading.Lock()


def _load_history() -> dict:
    try:
        with open(_HISTORY_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"qullamaggie": [], "adam_khoo": []}


def _save_history(history: dict) -> None:
    os.makedirs(os.path.dirname(_HISTORY_FILE), exist_ok=True)
    with open(_HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)


def record_history(persona: str, result: dict) -> None:
    today = datetime.now().strftime("%Y-%m-%d")
    entry = {
        "date": today,
        "picks": [{"ticker": p["ticker"], "company": p["company"], "price": p["price"]} for p in result.get("picks", [])],
        "generated_at": result.get("generated_at"),
        "candidates_evaluated": result.get("candidates_evaluated"),
    }
    with _history_lock:
        history = _load_history()
        records = history.get(persona, [])
        # Replace existing entry for today (re-run on same day)
        records = [r for r in records if r.get("date") != today]
        records.append(entry)
        # Keep only the most recent _HISTORY_MAX_DAYS days
        records.sort(key=lambda r: r["date"], reverse=True)
        history[persona] = records[:_HISTORY_MAX_DAYS]
        _save_history(history)


def get_history(persona: str) -> list:
    with _history_lock:
        history = _load_history()
        return history.get(persona, [])

CACHE_TTL = 4 * 3600

_results_cache: dict = {
    "qullamaggie": {"data": None, "timestamp": None},
    "adam_khoo": {"data": None, "timestamp": None},
}

_progress: dict = {
    "status": "idle",   # idle | running | done | error
    "step": 0,          # 1 = price data, 2 = fundamentals, 3 = screening
    "persona": None,
    "current": 0,
    "total": 0,
    "current_ticker": "",
    "error": None,
    "started_at": None,
}
_progress_lock = threading.Lock()


# ── Data fetching ─────────────────────────────────────────────────────────────

def _fetch_price_data(tickers: list[str]) -> dict:
    # Split into batches of 20 — larger single calls get throttled by Yahoo.
    result = {}
    batch_size = 20
    batches = [tickers[i:i + batch_size] for i in range(0, len(tickers), batch_size)]

    for idx, batch in enumerate(batches):
        if idx > 0:
            time.sleep(2.0)
        try:
            raw = yf.download(
                batch,
                period="1y",
                interval="1d",
                auto_adjust=True,
                progress=False,
                threads=False,
            )
            if raw.empty:
                continue

            # Single-ticker download returns a plain DataFrame (no MultiIndex).
            if len(batch) == 1:
                closes  = raw["Close"].dropna()
                volumes = raw["Volume"].dropna()
                if isinstance(closes, pd.DataFrame):
                    closes  = closes.iloc[:, 0]
                    volumes = volumes.iloc[:, 0]
                if len(closes) >= 60:
                    result[batch[0]] = {"closes": closes, "volumes": volumes}
            else:
                for ticker in batch:
                    try:
                        closes  = raw["Close"][ticker].dropna()
                        volumes = raw["Volume"][ticker].dropna()
                        if len(closes) >= 60:
                            result[ticker] = {"closes": closes, "volumes": volumes}
                    except (KeyError, TypeError):
                        continue
        except Exception:
            continue

    return result


def _fetch_one_info(ticker: str) -> tuple[str, dict]:
    # Fully sequential (called from a single-worker pool) with 0.5 s breathing
    # room between requests — keeps us reliably under Yahoo's rate limit.
    time.sleep(0.5)
    for attempt in range(2):
        try:
            info = yf.Ticker(ticker).info or {}
            if not info.get("marketCap") and attempt == 0:
                time.sleep(2.0)
                continue
            return ticker, info
        except Exception:
            if attempt == 0:
                time.sleep(2.0)
    return ticker, {}


def _fetch_fundamentals(tickers: list[str], on_progress=None) -> dict:
    result = {}
    total = len(tickers)
    count = 0

    # Single worker — sequential is the only reliable strategy against Yahoo's
    # per-IP rate limiter. Concurrency at any level triggers mass empty responses.
    for ticker in tickers:
        sym, info = _fetch_one_info(ticker)
        count += 1
        result[sym] = info
        if on_progress:
            on_progress(sym, count, total)

    return result


# ── Rationale builders ────────────────────────────────────────────────────────

def _qulla_rationale(price, sma50, sma200, high_52w, vol_surge, rs_ratio, return_3m):
    return [
        f"Stage 2 uptrend: ${price:.2f} > SMA50 ${sma50:.2f} > SMA200 ${sma200:.2f}",
        f"Within {abs((price / high_52w - 1) * 100):.1f}% of 52-week high (${high_52w:.2f})",
        f"Volume surge {vol_surge:.1f}× 20-day average (last 3 days)",
        f"Outperforming SPY by {rs_ratio:.1f}% over 3 months ({return_3m:+.1f}%)",
    ]


def _khoo_rationale(pe, eps, roe, rev_growth, profit_margin):
    return [
        f"P/E {pe:.1f} — growth-at-reasonable-price zone (5–35)",
        f"Trailing EPS ${eps:.2f} — consistently profitable",
        f"ROE {roe * 100:.1f}% — strong return on equity (min 15%)",
        f"Revenue growth {rev_growth * 100:.1f}% year-over-year",
        f"Profit margin {profit_margin * 100:.1f}%",
    ]


# ── Persona screeners ─────────────────────────────────────────────────────────

def _screen_qullamaggie(price_data: dict, fundamentals: dict) -> list[dict]:
    # Fetch SPY separately. If Yahoo throttles this too, fall back to a neutral
    # baseline so the screener doesn't crash.
    spy_3m = 10.0  # fallback: assume ~10% SPY 3-month return
    try:
        spy_raw = yf.download("SPY", period="3mo", interval="1d", progress=False, auto_adjust=True)
        if not spy_raw.empty:
            spy_closes = spy_raw["Close"].dropna()
            if isinstance(spy_closes, pd.DataFrame):
                spy_closes = spy_closes.iloc[:, 0]
            if len(spy_closes) >= 2:
                spy_3m = float((spy_closes.iloc[-1] / spy_closes.iloc[0] - 1) * 100)
    except Exception:
        pass

    candidates = []
    for ticker, pdata in price_data.items():
        closes = pdata["closes"]
        volumes = pdata["volumes"]
        if len(closes) < 200:
            continue

        info = fundamentals.get(ticker, {})
        price = float(closes.iloc[-1])
        mkt_cap = info.get("marketCap") or 0

        if price < 10 or mkt_cap < 300_000_000:
            continue

        sma50 = float(closes.tail(50).mean())
        sma150 = float(closes.tail(150).mean())
        sma200 = float(closes.tail(200).mean())
        if not (price > sma50 > sma150 > sma200):
            continue

        high_52w = float(closes.max())
        if price < high_52w * 0.75:
            continue

        avg_vol_20d = float(volumes.tail(20).mean())
        avg_vol_3d = float(volumes.tail(3).mean())
        if avg_vol_20d <= 0 or avg_vol_3d < avg_vol_20d * 1.5:
            continue

        idx_3m = max(0, len(closes) - 63)
        stock_3m = float((closes.iloc[-1] / closes.iloc[idx_3m] - 1) * 100)
        rs_ratio = stock_3m - spy_3m
        if rs_ratio <= 0:
            continue

        eps = info.get("trailingEps") or 0
        if eps <= 0:
            continue

        vol_surge = avg_vol_3d / avg_vol_20d

        candidates.append({
            "ticker": ticker,
            "company": info.get("shortName", ticker),
            "price": round(price, 2),
            "sector": info.get("sector", ""),
            "market_cap_b": round(mkt_cap / 1e9, 2),
            "rs_ratio": round(rs_ratio, 2),
            "stock_3m_return": round(stock_3m, 2),
            "sma50": round(sma50, 2),
            "sma200": round(sma200, 2),
            "dist_from_52w_high_pct": round((price / high_52w - 1) * 100, 1),
            "volume_surge": round(vol_surge, 2),
            "eps": round(float(eps), 2),
            "why": _qulla_rationale(price, sma50, sma200, high_52w, vol_surge, rs_ratio, stock_3m),
        })

    candidates.sort(key=lambda x: x["rs_ratio"], reverse=True)
    return candidates[:5]


def _screen_adam_khoo(price_data: dict, fundamentals: dict) -> list[dict]:
    candidates = []
    for ticker, pdata in price_data.items():
        closes = pdata["closes"]
        info = fundamentals.get(ticker, {})
        price = float(closes.iloc[-1])
        mkt_cap = info.get("marketCap") or 0

        if mkt_cap < 1_000_000_000:
            continue

        pe = info.get("trailingPE") or info.get("forwardPE")
        if pe is None or not (5 <= pe <= 35):
            continue

        eps = info.get("trailingEps") or 0
        if eps <= 0:
            continue

        rev_growth = info.get("revenueGrowth")
        if rev_growth is None or rev_growth <= 0:
            continue

        roe = info.get("returnOnEquity")
        if roe is None or roe < 0.15:
            continue

        profit_margin = info.get("profitMargins")
        if profit_margin is None or profit_margin <= 0:
            continue

        pe_score = max(0, (35 - pe) / 30)
        score = (
            float(roe) * 100 * 0.30
            + float(rev_growth) * 100 * 0.25
            + float(profit_margin) * 100 * 0.25
            + pe_score * 0.20
        )

        candidates.append({
            "ticker": ticker,
            "company": info.get("shortName", ticker),
            "price": round(price, 2),
            "sector": info.get("sector", ""),
            "market_cap_b": round(mkt_cap / 1e9, 2),
            "pe_ratio": round(float(pe), 1),
            "eps": round(float(eps), 2),
            "roe_pct": round(float(roe) * 100, 1),
            "revenue_growth_pct": round(float(rev_growth) * 100, 1),
            "profit_margin_pct": round(float(profit_margin) * 100, 1),
            "composite_score": round(score, 2),
            "why": _khoo_rationale(pe, eps, roe, rev_growth, profit_margin),
        })

    candidates.sort(key=lambda x: x["composite_score"], reverse=True)
    return candidates[:5]


# ── Background job ────────────────────────────────────────────────────────────

def run_screening_job(persona: str) -> None:
    global _progress
    try:
        with _progress_lock:
            _progress.update({
                "status": "running",
                "step": 1,
                "persona": persona,
                "current": 0,
                "total": 0,
                "current_ticker": "",
                "error": None,
                "started_at": datetime.now().isoformat(),
            })

        tickers = get_sp500_tickers()

        # ── Step 1: batch price download ──────────────────────────────────────
        with _progress_lock:
            _progress["step"] = 1
            _progress["total"] = len(tickers)
            _progress["current_ticker"] = "Downloading price history..."

        price_data = _fetch_price_data(tickers)

        # ── Step 2: fundamentals fetch (per-ticker progress) ──────────────────
        eligible = list(price_data.keys())

        with _progress_lock:
            _progress["step"] = 2
            _progress["current"] = 0
            _progress["total"] = len(eligible)
            _progress["current_ticker"] = eligible[0] if eligible else ""

        def _on_fundamentals_progress(ticker, count, total):
            with _progress_lock:
                _progress["current"] = count
                _progress["total"] = total
                _progress["current_ticker"] = ticker

        fundamentals = _fetch_fundamentals(eligible, on_progress=_on_fundamentals_progress)

        # ── Step 3: apply screening criteria ─────────────────────────────────
        with _progress_lock:
            _progress["step"] = 3
            _progress["current_ticker"] = "Applying criteria..."

        if persona == "qullamaggie":
            picks = _screen_qullamaggie(price_data, fundamentals)
        else:
            picks = _screen_adam_khoo(price_data, fundamentals)

        output = {
            "persona": persona,
            "picks": picks,
            "universe_size": len(tickers),
            "candidates_evaluated": len(price_data),
            "generated_at": datetime.now().isoformat(),
        }
        _results_cache[persona] = {"data": output, "timestamp": datetime.now()}
        record_history(persona, output)

        with _progress_lock:
            _progress["status"] = "done"
            _progress["current"] = len(tickers)
            _progress["current_ticker"] = "Complete"

    except Exception as exc:
        with _progress_lock:
            _progress["status"] = "error"
            _progress["error"] = str(exc)
