"""Relative Rotation Graph (RRG) data — RS-ratio × RS-momentum vs SPY.

The classic institutional rotation read: every ETF orbits clockwise through
Improving → Leading → Weakening → Lagging. The tradeable moment is the
Improving-quadrant entry (RS still below average but momentum has turned),
not the Leading confirmation everyone can see.

JdK's exact smoothing is proprietary; this is the standard open
approximation, both axes centered at 100:
    rs        = ETF close / SPY close
    rs_ratio  = 100 · rs / SMA(rs, 50)          — where RS sits vs its trend
    rs_mom    = 100 · rs_ratio / rs_ratio[-10]  — which way RS is turning

Trail = one point per 5 sessions (≈weekly), last 8 points, so you can see
the orbit direction, not just today's dot.
"""

from __future__ import annotations

import logging

from .panel import build_panels
from .sectors import SECTOR_ETF

logger = logging.getLogger(__name__)

BENCH = "SPY"

# label → (ticker, group). Sectors are the 11 SPDRs; industries are the
# high-signal groups a momentum swing trader actually rotates through.
RRG_ETFS: dict[str, tuple[str, str]] = {
    **{sector: (etf, "sector") for sector, etf in SECTOR_ETF.items()},
    "Semiconductors": ("SMH", "industry"),
    "Biotech": ("XBI", "industry"),
    "Software": ("IGV", "industry"),
    "Retail": ("XRT", "industry"),
    "Homebuilders": ("XHB", "industry"),
    "Regional Banks": ("KRE", "industry"),
    "Metals & Mining": ("XME", "industry"),
    "Oil & Gas E&P": ("XOP", "industry"),
    "Aerospace & Defense": ("XAR", "industry"),
    "Airlines": ("JETS", "industry"),
    "Gold Miners": ("GDX", "industry"),
    "Uranium": ("URA", "industry"),
}

RATIO_WINDOW = 50
MOM_WINDOW = 10
TRAIL_STEP = 5
TRAIL_POINTS = 6  # ~6 weeks of orbit; longer gets spaghetti-ish with 23 ETFs


def _quadrant(ratio: float, mom: float) -> str:
    if ratio >= 100 and mom >= 100:
        return "leading"
    if ratio < 100 and mom >= 100:
        return "improving"
    if ratio >= 100 and mom < 100:
        return "weakening"
    return "lagging"


def compute_rrg() -> dict:
    close = build_panels(days=126, fields=("close",))["close"]
    if close.empty or BENCH not in close.columns:
        return {"points": [], "as_of": None}

    spy = close[BENCH]
    points = []
    for label, (ticker, group) in RRG_ETFS.items():
        if ticker not in close.columns:
            continue
        series = close[ticker]
        rs = (series / spy).dropna()
        if len(rs) < RATIO_WINDOW + MOM_WINDOW + TRAIL_STEP * (TRAIL_POINTS - 1):
            continue
        rs_ratio = 100.0 * rs / rs.rolling(RATIO_WINDOW).mean()
        rs_mom = 100.0 * rs_ratio / rs_ratio.shift(MOM_WINDOW)

        # Weekly-ish trail, oldest → newest, ending on the latest session.
        idx = list(range(len(rs) - 1, -1, -TRAIL_STEP))[:TRAIL_POINTS][::-1]
        trail = []
        for i in idx:
            r, m = rs_ratio.iloc[i], rs_mom.iloc[i]
            if r == r and m == m:  # NaN guard
                trail.append([round(float(r), 2), round(float(m), 2)])
        if not trail:
            continue
        r_now, m_now = trail[-1]
        points.append({
            "label": label,
            "ticker": ticker,
            "group": group,
            "rs_ratio": r_now,
            "rs_mom": m_now,
            "quadrant": _quadrant(r_now, m_now),
            "trail": trail,
        })

    # Improving first — that's the actionable quadrant.
    order = {"improving": 0, "leading": 1, "weakening": 2, "lagging": 3}
    points.sort(key=lambda p: (order[p["quadrant"]], -p["rs_mom"]))
    return {"points": points, "as_of": str(close.index[-1].date())}
