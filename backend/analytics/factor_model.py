"""Cross-sectional price/volume factor model.

Ranks the whole liquid US universe on a handful of standard, academically-grounded
*style* factors — all computable from OHLCV, which is what the breadth cache holds:

  • Momentum      — 12-1 style total return (the window, skipping the last month).
  • Trend quality — smoothness of the advance: sign(slope) × R² of a log-price fit.
  • Rel. strength — return vs SPY over ~3 months (leadership, not just absolute move).
  • Low volatility— negative of trailing realized vol (the defensive/low-vol factor).
  • Short reversal— negative of the last month's return (the 1-month reversal effect).
  • Liquidity     — log dollar-volume (a tradability / size proxy).

Each factor is winsorised then turned into a cross-sectional z-score and a 1-100
percentile rank. A **composite** blends the four "leadership" factors (momentum,
trend, relative strength, low-vol) into one score so a pile of separate screens
becomes a single coherent relative-value ranking, and you can ask factor-neutral
questions ("is this name's move idiosyncratic or just its factor?").

Two desk-level extras: a **"what's working now"** read (top-minus-bottom quintile
return of each factor over the last month — factor rotation) and a **factor
correlation** matrix (which factors are really the same bet).

Deliberately *not* included: value and quality. Those need fundamentals (P/E, P/B,
ROE, margins) which the OHLCV pipeline doesn't carry — surfacing a fake "value"
score from price alone would be dishonest. Flagged in the UI as a known extension.
"""

from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd

from analytics.panel import load_panel

# Windows (trading days)
MOM_LOOKBACK = 126      # ~6 months
MOM_SKIP = 21           # skip the most recent month (12-1 momentum)
RS_LOOKBACK = 63        # ~3 months vs SPY
VOL_LOOKBACK = 63       # realized-vol window
TREND_LOOKBACK = 63     # log-price regression window
STR_LOOKBACK = 21       # short-term reversal window
LIQ_LOOKBACK = 21       # dollar-volume averaging window

MIN_DAYS = VOL_LOOKBACK + 2          # hard floor to compute anything meaningful
RETURN_LIMIT = 300                   # rows returned (top by composite)

# Composite = the "leadership" blend. Short reversal + liquidity are shown as
# separate lenses (reversal is contrarian to momentum; liquidity is a filter).
COMPOSITE_WEIGHTS = {"mom": 0.30, "trend": 0.25, "rs": 0.25, "lvol": 0.20}

FACTORS = [
    {"key": "mom",   "label": "Momentum",     "desc": "12-1 total return (window minus the last month). The classic trend factor."},
    {"key": "trend", "label": "Trend quality", "desc": "sign(slope) × R² of a log-price fit — how smooth/clean the advance is, not just how big."},
    {"key": "rs",    "label": "Rel. strength", "desc": "Return vs SPY over ~3 months. Leadership relative to the market."},
    {"key": "lvol",  "label": "Low volatility", "desc": "Negative trailing realized vol — the defensive low-vol factor (higher = calmer)."},
    {"key": "str",   "label": "Short reversal", "desc": "Negative of the last month's return — the 1-month mean-reversion effect (contrarian to momentum)."},
    {"key": "liq",   "label": "Liquidity",     "desc": "Log dollar-volume — a tradability / size proxy."},
]


def run(
    min_price: float = 5.0,
    min_dollar_volume: float = 3_000_000.0,
) -> dict:
    """Compute the cross-sectional factor model off the breadth cache."""
    panel = load_panel(
        max_days=MOM_LOOKBACK + MOM_SKIP + 5,
        min_price=min_price,
        min_dollar_volume=min_dollar_volume,
        require_full_coverage=True,
    )
    if panel is None:
        return _empty(error="Breadth cache is empty. Run Market Monitor → Refresh first.")
    if panel.n_days < MIN_DAYS:
        return _empty(
            as_of=panel.as_of.isoformat(),
            error=(
                f"Not enough history for the factor windows — need ≥ {MIN_DAYS} trading "
                f"days, have {panel.n_days}. Backfill a bigger lookback in Market Monitor → Refresh."
            ),
        )

    raw = _raw_factors(panel)                     # DataFrame: symbols × factor keys
    raw = raw.drop(index="SPY", errors="ignore")  # don't rank the benchmark against itself
    raw = raw.dropna(how="any")
    if raw.empty:
        return _empty(as_of=panel.as_of.isoformat(),
                      error="No names had complete factor data.")

    z = pd.DataFrame({k: _winsor_z(raw[k]) for k in raw.columns})
    pct = pd.DataFrame({k: raw[k].rank(pct=True) * 100.0 for k in raw.columns})

    composite_z = sum(z[k] * w for k, w in COMPOSITE_WEIGHTS.items())
    composite_pct = composite_z.rank(pct=True) * 100.0

    order = composite_z.sort_values(ascending=False).index
    rows: list[dict] = []
    for sym in order[:RETURN_LIMIT]:
        rec = {
            "symbol": sym,
            "close": _f(panel.close.loc[sym].iloc[-1]),
            "composite_z": round(float(composite_z[sym]), 2),
            "composite_pct": round(float(composite_pct[sym])),
        }
        for k in raw.columns:
            rec[f"{k}_z"] = round(float(z.loc[sym, k]), 2)
            rec[f"{k}_pct"] = round(float(pct.loc[sym, k]))
        rows.append(rec)

    return {
        "as_of": panel.as_of.isoformat(),
        "factors": FACTORS,
        "composite_weights": COMPOSITE_WEIGHTS,
        "rows": rows,
        "factor_rotation": _rotation(panel),
        "factor_correlation": _correlation(z),
        "counts": {
            "universe": panel.universe_size,
            "passed_liquidity": panel.passed_liquidity,
            "ranked": int(len(raw)),
            "returned": int(min(len(order), RETURN_LIMIT)),
        },
        "thresholds": {"min_price": min_price, "min_dollar_volume": min_dollar_volume,
                       "days_available": panel.n_days},
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


def _raw_factors(panel, end: int | None = None) -> pd.DataFrame:
    """Raw factor values for every symbol, computed as-of column index `end`
    (default: the latest day). `end` lets the rotation study rank names in the
    past and then measure their forward return."""
    C = panel.close.to_numpy()
    V = panel.volume.to_numpy()
    T = C.shape[1]
    e = T if end is None else end            # exclusive upper bound (slice end)
    idx = panel.close.index

    def col(offset):                          # column `offset` days before `e-1`
        return C[:, e - 1 - offset]

    mom = col(MOM_SKIP) / col(min(MOM_LOOKBACK, e - 1)) - 1.0
    str_ = -(col(0) / col(STR_LOOKBACK) - 1.0)

    rs_lb = min(RS_LOOKBACK, e - 1)
    stock_ret = col(0) / col(rs_lb) - 1.0
    if "SPY" in idx:
        spy = panel.close.loc["SPY"].to_numpy()
        spy_ret = spy[e - 1] / spy[e - 1 - rs_lb] - 1.0
        rs = (1.0 + stock_ret) / (1.0 + spy_ret) - 1.0
    else:
        rs = stock_ret

    vlb = min(VOL_LOOKBACK, e - 1)
    window = C[:, e - vlb:e]
    rets = window[:, 1:] / window[:, :-1] - 1.0
    lvol = -np.nanstd(rets, axis=1) * np.sqrt(252.0)

    trend = _trend_quality(C[:, e - min(TREND_LOOKBACK, e):e])

    llb = min(LIQ_LOOKBACK, e)
    addv = np.nanmean(C[:, e - llb:e] * V[:, e - llb:e], axis=1)
    liq = np.log10(np.where(addv > 0, addv, np.nan))

    return pd.DataFrame(
        {"mom": mom, "trend": trend, "rs": rs, "lvol": lvol, "str": str_, "liq": liq},
        index=idx,
    )


def _trend_quality(logblock_prices: np.ndarray) -> np.ndarray:
    """sign(slope) × R² of an OLS fit of log(price) vs time, per row (vectorised)."""
    y = np.log(np.where(logblock_prices > 0, logblock_prices, np.nan))
    w = y.shape[1]
    x = np.arange(w, dtype=float)
    xm = x.mean()
    ym = np.nanmean(y, axis=1, keepdims=True)
    xd = x - xm
    yd = y - ym
    sxx = np.nansum(xd * xd)
    sxy = np.nansum(xd * yd, axis=1)
    syy = np.nansum(yd * yd, axis=1)
    slope = np.divide(sxy, sxx, out=np.zeros_like(sxy), where=sxx != 0)
    r2 = np.divide(sxy ** 2, sxx * syy, out=np.zeros_like(sxy), where=(sxx * syy) > 0)
    return np.sign(slope) * r2


def _winsor_z(s: pd.Series) -> pd.Series:
    lo, hi = s.quantile(0.01), s.quantile(0.99)
    w = s.clip(lo, hi)
    sd = w.std()
    if not sd or np.isnan(sd):
        return pd.Series(0.0, index=s.index)
    return (w - w.mean()) / sd


def _rotation(panel) -> list[dict]:
    """What's working now: top-minus-bottom quintile forward return of each factor
    over the last month. Ranks each factor a month ago, then measures the spread the
    quintiles actually delivered since — a read on factor rotation."""
    T = panel.n_days
    fwd = STR_LOOKBACK                              # 1-month forward window
    if T < MIN_DAYS + fwd:
        return []
    end_past = T - fwd
    past = _raw_factors(panel, end=end_past).drop(index="SPY", errors="ignore").dropna(how="any")
    if past.empty:
        return []
    C = panel.close
    fwd_ret = (C.iloc[:, -1] / C.iloc[:, end_past - 1] - 1.0)      # return over the last month
    out = []
    for f in FACTORS:
        k = f["key"]
        s = past[k]
        try:
            q = pd.qcut(s.rank(method="first"), 5, labels=False)
        except ValueError:
            continue
        top = fwd_ret.reindex(s.index[q == 4]).mean()
        bot = fwd_ret.reindex(s.index[q == 0]).mean()
        if pd.isna(top) or pd.isna(bot):
            continue
        out.append({
            "key": k, "label": f["label"],
            "spread_pct": round(float((top - bot) * 100.0), 2),
            "top_q_pct": round(float(top * 100.0), 2),
            "bottom_q_pct": round(float(bot * 100.0), 2),
        })
    return out


def _correlation(z: pd.DataFrame) -> dict:
    """Spearman correlation between the factor z-scores — which factors are the
    same bet (e.g. momentum vs relative strength usually run high)."""
    keys = [f["key"] for f in FACTORS if f["key"] in z.columns]
    corr = z[keys].corr(method="spearman")
    return {a: {b: round(float(corr.loc[a, b]), 2) for b in keys} for a in keys}


def _empty(as_of: str | None = None, error: str | None = None) -> dict:
    out = {
        "as_of": as_of, "factors": FACTORS, "composite_weights": COMPOSITE_WEIGHTS,
        "rows": [], "factor_rotation": [], "factor_correlation": {},
        "counts": {"universe": 0, "passed_liquidity": 0, "ranked": 0, "returned": 0},
    }
    if error:
        out["error"] = error
    return out


def _f(v) -> float | None:
    try:
        if v is None or pd.isna(v):
            return None
    except (TypeError, ValueError):
        return None
    return round(float(v), 4)
