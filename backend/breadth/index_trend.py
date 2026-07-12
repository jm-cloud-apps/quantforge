"""Index/price trend cross-check — is the tape's *price* confirming breadth?

Breadth (Trade Today / Market Monitor) measures the *average* stock. It can
diverge from the cap-weighted indices the trader actually benchmarks against —
the classic failure mode is "breadth reads risk-on while SPY quietly rolls over,
propped up by a few megacaps," or the reverse (a strong index masking weak
participation). This module reads the headline index ETFs straight from the
grouped-daily cache — which carries every symbol that printed, ETFs included
(the universe filter only excludes them from the *breadth* count) — and reports
each one's trend posture so the Trade Today page can flag divergence.

Pure compute over the local cache; no network.
"""

from __future__ import annotations

import logging

import pandas as pd

from .cache import list_cached_days, load_cached_day

logger = logging.getLogger(__name__)

# Broad market, big-cap growth, small caps. IWM (small caps) matters most to a
# breakout trader — it confirms or denies that breadth is broad, not megacap-led.
INDEX_ETFS = [
    ("SPY", "S&P 500"),
    ("QQQ", "Nasdaq 100"),
    ("IWM", "Russell 2000"),
]

SMA_FAST = 20
SMA_SLOW = 50


def _trend_state(above20: bool, above50: bool) -> str:
    if above20 and above50:
        return "up"
    if not above20 and not above50:
        return "down"
    return "mixed"


def index_trend(lookback: int = 260) -> dict:
    """Per-ETF trend posture (vs 20/50-day, distance from the window high, and
    5/20-session returns) from the grouped-daily cache."""
    days = list_cached_days()
    if not days:
        return {"available": False, "reason": "no cached price data", "indices": []}
    days = days[-lookback:]

    closes: dict[str, list] = {sym: [] for sym, _ in INDEX_ETFS}
    dates: list = []
    for d in days:
        df = load_cached_day(d)
        if df is None or df.empty:
            continue
        dates.append(d)
        for sym, _ in INDEX_ETFS:
            try:
                closes[sym].append(float(df.at[sym, "close"]))
            except (KeyError, ValueError, TypeError):
                closes[sym].append(None)

    if len(dates) < SMA_FAST + 1:
        return {"available": False, "reason": "insufficient price history", "indices": []}

    as_of = dates[-1].isoformat() if hasattr(dates[-1], "isoformat") else str(dates[-1])
    out = []
    for sym, name in INDEX_ETFS:
        s = pd.Series(closes[sym], index=dates, dtype="float64").dropna()
        if len(s) < SMA_FAST + 1:
            out.append({"symbol": sym, "name": name, "available": False})
            continue
        last = float(s.iloc[-1])
        sma20 = float(s.rolling(SMA_FAST).mean().iloc[-1]) if len(s) >= SMA_FAST else None
        sma50_series = s.rolling(SMA_SLOW).mean()
        sma50 = float(sma50_series.iloc[-1]) if len(s) >= SMA_SLOW else None
        above20 = sma20 is not None and last > sma20
        above50 = sma50 is not None and last > sma50
        hi = float(s.max())
        # SMA50 slope: rising if it's above where it sat ~10 sessions ago.
        sma50_rising = None
        if len(s) >= SMA_SLOW + 10 and not pd.isna(sma50_series.iloc[-11]):
            sma50_rising = bool(sma50_series.iloc[-1] > sma50_series.iloc[-11])
        out.append({
            "symbol": sym, "name": name, "available": True,
            "last": round(last, 2),
            "above_sma20": above20, "above_sma50": above50,
            "sma50_rising": sma50_rising,
            "trend": _trend_state(above20, above50),
            "pct_from_high": round(last / hi - 1.0, 4) if hi else None,
            "ret_5d": round(last / float(s.iloc[-6]) - 1.0, 4) if len(s) >= 6 else None,
            "ret_20d": round(last / float(s.iloc[-21]) - 1.0, 4) if len(s) >= 21 else None,
        })

    return {"available": True, "as_of": as_of, "window_sessions": len(dates), "indices": out}
