"""Pipeline verifier — prove the breadth numbers trace back to raw vendor data.

This is a deliberately *independent* recount of the headline 4%-up/down counts,
written as a separate code path from `calculator.py`. Given the same cached
grouped-daily pickles, it re-derives the figures from scratch (load two days of
raw closes → restrict to the universe → count close-to-close moves ≥ ±4%) and
returns a handful of sample tickers with their exact prev_close → close move.

If this recount matches what the Situational Awareness / Market Monitor pages
display, the user can trust that nothing between the vendor's end-of-day bars
and the on-screen number is fabricated or fudged — and can spot-check the sample
names on any charting tool.
"""

from __future__ import annotations

from .cache import list_cached_days, load_cached_day
from .universe import load_universe

PCT_UP = 0.04
PCT_DOWN = -0.04


def _latest_two_nonempty() -> list[tuple[str, object]]:
    """Return [(iso_date, df), ...] for the two most recent non-empty cached
    days, newest last. Empty (holiday sentinel) files are skipped."""
    chosen: list[tuple[str, object]] = []
    for d in reversed(list_cached_days()):
        df = load_cached_day(d)
        if df is None or df.empty:
            continue
        chosen.append((d.isoformat(), df))
        if len(chosen) >= 2:
            break
    chosen.reverse()
    return chosen


def recount_4pct(sample_size: int = 5) -> dict:
    """Independently recompute today's 4%-up / 4%-down counts from raw closes."""
    universe = load_universe().get("symbols", [])
    universe_set = set(universe)

    days = _latest_two_nonempty()
    if len(days) < 2:
        return {
            "available": False,
            "reason": "Need at least two cached trading days to compute a 1-day move.",
            "universe_size": len(universe),
        }

    (prev_date, prev_df), (cur_date, cur_df) = days[0], days[1]

    # Restrict both days to universe membership, then to symbols present in BOTH
    # (a 1-day move needs a close on each side). This mirrors the calculator's
    # pct_change(fill_method=None) over consecutive non-empty days.
    cur_syms = cur_df.index.intersection(universe_set)
    common = cur_syms.intersection(prev_df.index)

    cur_close = cur_df.loc[common, "close"]
    prev_close = prev_df.loc[common, "close"]
    pct = (cur_close / prev_close) - 1.0
    pct = pct.dropna()

    up_mask = pct >= PCT_UP
    down_mask = pct <= PCT_DOWN

    def _samples(mask, ascending):
        s = pct[mask].sort_values(ascending=ascending).head(sample_size)
        out = []
        for sym, mv in s.items():
            out.append({
                "ticker": sym,
                "prev_close": round(float(prev_close[sym]), 2),
                "close": round(float(cur_close[sym]), 2),
                "pct": round(float(mv) * 100, 2),
            })
        return out

    return {
        "available": True,
        "date": cur_date,
        "prev_date": prev_date,
        "universe_size": len(universe),
        "compared_symbols": int(len(pct)),
        "up_4_recount": int(up_mask.sum()),
        "down_4_recount": int(down_mask.sum()),
        "sample_up": _samples(up_mask, ascending=False),
        "sample_down": _samples(down_mask, ascending=True),
        "source": "Massive grouped-daily EOD (cached pickles)",
    }
