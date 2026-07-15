"""Sector → leaders drill-down: the actionable candidates list.

Qullamaggie's rule: trade the leaders of the leading group. Once internals or
the RRG flag a sector, this ranks its members so the rotation read ends in
tickers, not a mood. RS rank is cross-sectional (percentile of 63-day return
across ALL mapped liquid names), so "RS 95" means the same thing in every
sector.
"""

from __future__ import annotations

import logging

import pandas as pd

from .panel import build_panels
from .sectors import SECTOR_ETF, load_map

logger = logging.getLogger(__name__)

MIN_BARS = 55
TOP_N = 15
MIN_DOLLAR_VOL = 5_000_000  # his own entry rule: ≥$5M daily dollar volume


def compute_leaders(sector: str) -> dict:
    if sector not in SECTOR_ETF:
        return {"error": f"Unknown sector '{sector}'", "leaders": []}

    sector_map = load_map().get("symbols", {})

    panels = build_panels(days=70, fields=("close", "volume", "high", "low"))
    close, vol = panels["close"], panels["volume"]
    high, low = panels["high"], panels["low"]
    if close.empty:
        return {"sector": sector, "leaders": [], "as_of": None}

    bar_counts = close.notna().sum()
    mapped = [s for s, info in sector_map.items()
              if s in close.columns and bar_counts.get(s, 0) >= MIN_BARS and info.get("sector")]
    members = [s for s in mapped if sector_map[s]["sector"] == sector]
    if not members:
        return {"sector": sector, "leaders": [], "as_of": str(close.index[-1].date())}

    # Cross-sectional RS: percentile of 63d return across ALL mapped names.
    window = min(63, len(close) - 1)
    ret63_all = (close[mapped].iloc[-1] / close[mapped].iloc[-window - 1] - 1.0) * 100
    rs_rank_all = ret63_all.rank(pct=True) * 100

    rets = close[members].pct_change()
    ma50 = close[members].rolling(50).mean()
    dollar = (close[members] * vol[members])

    rows = []
    for sym in members:
        c = close[sym].dropna()
        ret21 = float(c.iloc[-1] / c.iloc[-22] - 1.0) * 100 if len(c) >= 22 else None
        hi = float(close[sym].iloc[-63:].max())
        adr = float(((high[sym] - low[sym]) / close[sym]).iloc[-20:].mean() * 100)
        dv20 = float(dollar[sym].iloc[-20:].median())

        r20 = rets[sym].iloc[-20:]
        d20 = dollar[sym].iloc[-20:]
        udv = float(d20[r20 > 0].sum())
        ddv = float(d20[(r20 < 0)].sum())

        rows.append({
            "symbol": sym,
            "name": (sector_map[sym].get("name") or sym)[:48],
            "mcap": sector_map[sym].get("mcap"),
            "rs_rank": round(float(rs_rank_all.get(sym, 0)), 0),
            "ret21": round(ret21, 1) if ret21 is not None else None,
            "ret63": round(float(ret63_all.get(sym, 0)), 1),
            "above_50ma": bool(c.iloc[-1] > ma50[sym].iloc[-1]) if ma50[sym].notna().iloc[-1] else False,
            "ma50_rising": bool(ma50[sym].iloc[-1] > ma50[sym].iloc[-6]) if ma50[sym].notna().iloc[-6:].all() else False,
            "pct_off_high": round(float(c.iloc[-1] / hi - 1.0) * 100, 1),
            "ud_vol_ratio": round(udv / ddv, 2) if ddv > 0 else None,
            "adr20": round(adr, 1),
            "dollar_vol_m": round(dv20 / 1e6, 1),
            "liquid": dv20 >= MIN_DOLLAR_VOL,
        })

    # Leaders = strongest RS first; illiquid names sink regardless of RS so
    # the list is buyable, not just impressive.
    rows.sort(key=lambda r: (r["liquid"], r["rs_rank"]), reverse=True)
    return {
        "sector": sector,
        "etf": SECTOR_ETF[sector],
        "member_count": len(members),
        "leaders": rows[:TOP_N],
        "as_of": str(close.index[-1].date()),
    }
