"""Per-sector internals — breadth computed from members, not the ETF.

The cap-weighted ETF return is what three mega-caps did; internals measure
whether *the group* is being accumulated. All series come from the on-disk
grouped cache, so this is API-free after the sector map is warm.

Signals per sector:
  pct_above_20 / pct_above_50 — % of members above their 20/50-day SMA
  delta_above_50              — change in %>50MA vs 5 sessions ago (pp)
  net_4pct_10d                — Σ over members of (+4% days − −4% days), last 10 sessions
  new_high_pct                — % of members within 2% of their 63-day high
  ud_vol_ratio                — Σ dollar-volume on up days / down days, last 10 sessions
  median_ret21 vs etf_ret21   — broad vs narrow participation
  score                       — cross-sectional rank composite (0–100)
  verdict / breadth_shape / stealth — the human-readable read
"""

from __future__ import annotations

import logging

import pandas as pd

from .panel import build_panels
from .sectors import SECTOR_ETF, ensure_map

logger = logging.getLogger(__name__)

MIN_BARS = 55  # need a real 50-SMA + delta lookback


def _pct(n: int, d: int) -> float:
    return round(100.0 * n / d, 1) if d else 0.0


def compute_internals() -> dict:
    sector_map, warming = ensure_map()

    panels = build_panels(days=70, fields=("close", "volume"))
    close, vol = panels["close"], panels["volume"]
    if close.empty:
        return {"warming": warming, "sectors": [], "as_of": None}

    # Members: mapped symbols present in the panel with enough history.
    by_sector: dict[str, list[str]] = {s: [] for s in SECTOR_ETF}
    bar_counts = close.notna().sum()
    for sym, info in sector_map.items():
        sec = info.get("sector")
        if sec in by_sector and sym in close.columns and bar_counts.get(sym, 0) >= MIN_BARS:
            by_sector[sec].append(sym)

    rets = close.pct_change()
    ma20 = close.rolling(20).mean()
    ma50 = close.rolling(50).mean()
    dollar = close * vol

    rows = []
    for sector, members in by_sector.items():
        if len(members) < 5:
            continue
        c = close[members]
        n = len(members)

        above20 = (c.iloc[-1] > ma20[members].iloc[-1]).sum()
        above50_now = (c.iloc[-1] > ma50[members].iloc[-1]).sum()
        above50_prev = (c.iloc[-6] > ma50[members].iloc[-6]).sum()

        r10 = rets[members].iloc[-10:]
        net4 = int((r10 >= 0.04).sum().sum() - (r10 <= -0.04).sum().sum())

        hi63 = c.iloc[-63:].max()
        near_high = (c.iloc[-1] >= hi63 * 0.98).sum()

        d10 = dollar[members].iloc[-10:]
        up_mask = r10 > 0
        udv = float(d10[up_mask].sum().sum())
        ddv = float(d10[~up_mask & r10.notna()].sum().sum())
        ud_ratio = round(udv / ddv, 2) if ddv > 0 else None

        ret21 = (c.iloc[-1] / c.iloc[-22] - 1.0) * 100
        median_ret21 = round(float(ret21.median()), 2)

        etf = SECTOR_ETF[sector]
        etf_ret21 = None
        if etf in close.columns and close[etf].notna().sum() >= 22:
            etf_ret21 = round(float(close[etf].iloc[-1] / close[etf].iloc[-22] - 1.0) * 100, 2)

        rows.append({
            "sector": sector,
            "etf": etf,
            "members": n,
            "pct_above_20": _pct(int(above20), n),
            "pct_above_50": _pct(int(above50_now), n),
            "delta_above_50": round(_pct(int(above50_now), n) - _pct(int(above50_prev), n), 1),
            "net_4pct_10d": net4,
            "net_4pct_norm": round(net4 / n, 2),  # per-member, comparable across sectors
            "new_high_pct": _pct(int(near_high), n),
            "ud_vol_ratio": ud_ratio,
            "median_ret21": median_ret21,
            "etf_ret21": etf_ret21,
        })

    if not rows:
        return {"warming": warming, "sectors": [], "as_of": str(close.index[-1].date())}

    # ── cross-sectional composite score (rank-based, transparent) ────────
    df = pd.DataFrame(rows)
    ranks = pd.DataFrame({
        "level": df["pct_above_50"].rank(pct=True),
        "delta": df["delta_above_50"].rank(pct=True),
        "udv": df["ud_vol_ratio"].fillna(1.0).rank(pct=True),
        "thrust": df["net_4pct_norm"].rank(pct=True),
    })
    # Change-weighted: rotation detection cares more about the turn (delta,
    # volume, thrust) than the level, which is where late money piles in.
    score = (0.25 * ranks["level"] + 0.30 * ranks["delta"]
             + 0.25 * ranks["udv"] + 0.20 * ranks["thrust"]) * 100
    df["score"] = score.round(0)

    etf_rank = df["etf_ret21"].rank(pct=True)
    out = []
    for i, row in df.iterrows():
        r = row.to_dict()
        # Stealth accumulation: internals turning up hard while the ETF's
        # price rank is still unremarkable — members firming before the index.
        r["stealth"] = bool(
            row["delta_above_50"] >= 5.0
            and (row["ud_vol_ratio"] or 0) >= 1.2
            and etf_rank.iloc[i] <= 0.5
        )
        div = (row["etf_ret21"] or 0) - row["median_ret21"]
        r["breadth_shape"] = ("NARROW" if div >= 3.0
                              else "BROAD" if row["median_ret21"] >= (row["etf_ret21"] or 0) - 0.5
                              else "MIXED")
        r["verdict"] = ("ACCUMULATING" if row["score"] >= 70
                        else "DISTRIBUTING" if row["score"] <= 30
                        else "NEUTRAL")
        out.append(r)

    out.sort(key=lambda r: r["score"], reverse=True)
    return {"warming": warming, "sectors": out, "as_of": str(close.index[-1].date())}
