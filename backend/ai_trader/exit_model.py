"""Trade-exit simulator — how a suggested setup actually plays out, bar by bar.

Shared by the live ledger and the backtester so realized R is defined identically
everywhere. Replaces the old fixed-2R target (which capped every winner at +2R)
with the management plan the user actually trades:

  * Entry is a stop-buy at `entry` — fills at the open on a gap up through it.
  * A hard stop protects the position — fills at the open on a gap *down* through
    it (so gaps are penalised, not assumed to fill at the stop).
  * Scale out 1/3 at the close of the SCALE_BARS-th bar held ("sell into strength").
  * Trail the remaining 2/3 under the TRAIL_MA-day SMA; exit the remainder on the
    first daily *close* below it.

Because the remainder rides the trend, winners now realize their true R (a runner
can score far more than 2R), while the stop still caps losers near -1R. Every fill
takes a small slippage haircut. Returns realized R (weighted across the partials),
MFE/MAE in R, exit date/price, realized %, and holding period.
"""

from __future__ import annotations

import logging
import math

logger = logging.getLogger(__name__)

TRAIL_MA = 20          # SMA window the remainder trails under
SCALE_BARS = 4         # bars held before scaling out the first third
SCALE_FRACTION = 1 / 3
SLIPPAGE_BPS = 5       # 0.05% haircut on every fill (entry + each exit)


def _slip(price: float, side: str) -> float:
    f = SLIPPAGE_BPS / 10_000.0
    return price * (1 + f) if side == "buy" else price * (1 - f)


def _blank(current_price=None) -> dict:
    return {
        "triggered": False, "outcome": "untracked", "realized": False,
        "r_multiple": None, "entry_date": None, "exit_date": None,
        "exit_price": None, "realized_return_pct": None, "mfe_r": None,
        "mae_r": None, "holding_bars": None, "scaled": False,
        "current_price": current_price,
    }


def simulate_exit(df, entry, stop, suggested_on: str) -> dict:
    """Replay `df` (full OHLC frame) forward from the day after `suggested_on`
    under the scale-out + MA-trail plan. Returns the outcome dict described in
    the module docstring. `entry`/`stop` are the planned breakout/stop prices;
    R is measured against the planned risk (entry - stop)."""
    cur = None
    try:
        if df is not None and len(df):
            cur = round(float(df["close"].iloc[-1]), 2)
    except Exception:
        cur = None
    res = _blank(cur)

    if not (entry and stop and entry > stop) or df is None or not len(df):
        return res
    try:
        fwd = df[df.index > suggested_on]
    except Exception:
        fwd = None
    if fwd is None or not len(fwd):
        return res  # suggested today / no forward bars yet

    risk = entry - stop
    ma = df["close"].rolling(TRAIL_MA).mean()

    buy = None
    remaining = 1.0
    realized_r = 0.0
    realized_ret = 0.0           # capital-weighted % return across tranches
    mfe = mae = 0.0
    entered = False
    held = -1
    last_close = None

    for row in fwd.itertuples():
        idx = row.Index
        o, h, l, c = float(row.open), float(row.high), float(row.low), float(row.close)
        last_close = c

        if not entered:
            if h >= entry:
                entered = True
                fill = o if o > entry else entry         # gap up → pay the open
                buy = _slip(fill, "buy")
                res["triggered"] = True
                res["entry_date"] = idx.strftime("%Y-%m-%d")
                held = 0
            else:
                continue
        else:
            held += 1

        mfe = max(mfe, (h - entry) / risk)
        mae = min(mae, (l - entry) / risk)
        m = ma.get(idx)
        m = float(m) if (m is not None and not (isinstance(m, float) and math.isnan(m))) else None

        # 1) hard stop, intrabar (gap down → fill the open, worse than the stop)
        if l <= stop:
            sell = _slip(o if o < stop else stop, "sell")
            realized_r += remaining * (sell - buy) / risk
            realized_ret += remaining * (sell - buy) / buy
            remaining = 0.0
            res.update(outcome="stop", exit_date=idx.strftime("%Y-%m-%d"), exit_price=round(sell, 2))
            break

        # 2) scale out 1/3 into strength at the close of bar SCALE_BARS
        if held == SCALE_BARS and not res["scaled"] and remaining > SCALE_FRACTION / 2:
            sell = _slip(c, "sell")
            realized_r += SCALE_FRACTION * (sell - buy) / risk
            realized_ret += SCALE_FRACTION * (sell - buy) / buy
            remaining -= SCALE_FRACTION
            res["scaled"] = True

        # 3) trail the remainder: first close below the MA exits it
        if m is not None and c < m:
            sell = _slip(c, "sell")
            realized_r += remaining * (sell - buy) / risk
            realized_ret += remaining * (sell - buy) / buy
            remaining = 0.0
            res.update(outcome="trail", exit_date=idx.strftime("%Y-%m-%d"), exit_price=round(sell, 2))
            break

    if not entered:
        res["outcome"] = "no_entry"
        return res

    res["holding_bars"] = held + 1
    res["mfe_r"] = round(mfe, 2)
    res["mae_r"] = round(mae, 2)

    if remaining > 0:  # still open — mark the remainder to the latest close
        total_r = realized_r + remaining * (last_close - buy) / risk
        total_ret = realized_ret + remaining * (last_close - buy) / buy
        res.update(outcome="open", realized=False,
                   r_multiple=round(total_r, 2), realized_return_pct=round(total_ret * 100, 1))
    else:
        res.update(realized=True,
                   r_multiple=round(realized_r, 2), realized_return_pct=round(realized_ret * 100, 1))
    return res
