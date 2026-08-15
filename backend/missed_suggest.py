"""Suggested misses — shortlist vs fills.

`discipline.reconcile` matches logged plans against fills and calls what's left
over *unplanned*. This is the mirror image: it matches prep shortlists against
fills and calls what's left over **untaken**, then prices it off the cache.

Why it exists: a hand-kept missed book records what you remember to record,
which is the worst possible sample of exactly the events you are least motivated
to write down. Worse, the reason gets typed hours later, by which point "I
hesitated" has quietly become "the setup wasn't clean enough". Every ingredient
needed to *detect* the miss instead is already on disk — the prep shortlist with
its date, the trade workbook, and the grouped price cache — so the book can
propose entries and let you supply only the part a machine can't know: why.

Deliberately conservative about what it proposes:

- A name is only untaken if no trade opened in it inside the follow-up window.
  Suggesting something you actually traded destroys trust in the whole list.
- Anything already in the book is suppressed, whatever its verdict. Logging a
  shortlisted name as a *correct pass* is how you tell the suggester to stop
  offering it — which means dismissing and recording are the same gesture, and
  the page needs no separate dismissal state.
- Screening and ranking use the **peak**, while the rail capture is reported
  beside it. That is the opposite of how cost is accounted everywhere else in
  this feature, and the distinction is deliberate: a sum of maxima is a
  fictional *loss*, but triage is not a loss — it asks "is this worth a look?".
  Screening on the rail was the first design and real data killed it. A name
  that triggers, fails, and then runs — which is the single most common shape
  of a real miss — scores near zero on first-trigger capture and would never
  surface at all. Both numbers ride on every row so the failed first attempt
  stays visible, and actual cost is still computed only from an entry and stop
  you supply when you log it.
- One suggestion per symbol, anchored to the *earliest* prep date it appeared
  on: the first night you looked at it is when the decision actually happened.

Pure — the price lookup arrives as a callable, so nothing here touches the cache
or the filesystem, and the tests need neither.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Callable, Optional

# A trade opening this many days after the prep date still counts as "you took
# it". Wide enough to cover a setup that needed a week to trigger, narrow enough
# that an unrelated trade months later doesn't launder a genuine miss.
TAKEN_WITHIN_DAYS = 14

# Suppress a suggestion when the book already holds that symbol anywhere in this
# window around the prep date.
LOGGED_NEAR_DAYS = 30

# Below this, it isn't a miss — it's noise you were right to ignore.
MIN_MOVE_PCT = 5.0


def _to_date(value: Any) -> Optional[date]:
    """The several date shapes that flow through the trade pipeline."""
    if value in (None, "", 0):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "")).date()
        except ValueError:
            return None
    return None


def _pct(ref: float, price: float) -> Optional[float]:
    if not ref or price is None:
        return None
    return round((price - ref) / ref * 100, 2)


def shortlisted(sessions: list[dict], since: Optional[date] = None) -> dict[str, dict]:
    """symbol → the earliest prep appearance, with whatever context came with it."""
    first: dict[str, dict] = {}
    for session in sessions or []:
        day = _to_date(session.get("date"))
        if not day or (since and day < since):
            continue
        for cand in session.get("candidates") or []:
            symbol = str(cand.get("symbol") or "").upper().strip()
            if not symbol:
                continue
            prior = first.get(symbol)
            if prior is None or day < prior["prep_date"]:
                first[symbol] = {
                    "symbol": symbol,
                    "prep_date": day,
                    "setup_state": cand.get("setup_state"),
                    "note": cand.get("note"),
                    "adr_pct": cand.get("adr_pct"),
                }
    return first


def _traded_symbols(trades: list[dict], within_days: int) -> list[tuple[str, date]]:
    rows = []
    for t in trades or []:
        symbol = str(t.get("symbol") or "").upper().strip()
        entered = _to_date(t.get("entry_date"))
        if symbol and entered:
            rows.append((symbol, entered))
    return rows


def suggest(sessions: list[dict],
            trades: list[dict],
            logged: list[dict],
            forward: Callable[[str, date], Optional[dict]],
            *,
            since: Optional[date] = None,
            min_move_pct: float = MIN_MOVE_PCT,
            taken_within_days: int = TAKEN_WITHIN_DAYS,
            logged_near_days: int = LOGGED_NEAR_DAYS) -> list[dict]:
    """Shortlisted, not traded, and it went somewhere.

    `forward(symbol, prep_date)` returns the forward_prices block (or None when
    the cache can't price it).
    """
    candidates = shortlisted(sessions, since=since)
    if not candidates:
        return []

    traded = _traded_symbols(trades, taken_within_days)
    logged_rows = [(str(e.get("symbol") or "").upper(), _to_date(e.get("date")))
                   for e in logged or []]

    out = []
    for symbol, meta in candidates.items():
        prep_day = meta["prep_date"]

        # Did you take it? Any fill inside the follow-up window counts.
        if any(s == symbol and prep_day <= d <= prep_day + timedelta(days=taken_within_days)
               for s, d in traded):
            continue

        # Already in the book — including as a correct pass, which is how you
        # tell this list to stop offering it.
        if any(s == symbol and d is not None
               and prep_day - timedelta(days=logged_near_days) <= d
               <= prep_day + timedelta(days=logged_near_days)
               for s, d in logged_rows):
            continue

        priced = forward(symbol, prep_day)
        if not priced:
            continue
        ref = priced.get("ref_close")
        if not ref:
            continue

        pct_rail = _pct(ref, priced.get("trail_exit"))
        pct_peak = _pct(ref, priced.get("peak"))
        if pct_peak is None or pct_peak < min_move_pct:
            continue

        out.append({
            "symbol": symbol,
            "prep_date": prep_day.isoformat(),
            # Where the measurement actually starts: the first session the name
            # was buyable, which is rarely the night you shortlisted it.
            "anchor_date": priced.get("anchor_date"),
            "setup_state": meta.get("setup_state"),
            "note": meta.get("note"),
            "adr_pct": meta.get("adr_pct"),
            "ref_close": ref,
            "peak": priced.get("peak"),
            "peak_date": priced.get("peak_date"),
            "trail_exit": priced.get("trail_exit"),
            "trail_exit_date": priced.get("trail_exit_date"),
            "trail_hit": priced.get("trail_hit"),
            "sessions_used": priced.get("sessions_used"),
            "pct_to_rail": pct_rail,
            "pct_to_peak": pct_peak,
        })

    # Ranked as a review queue — biggest move first. Not a cost ranking.
    out.sort(key=lambda r: -(r["pct_to_peak"] or 0))
    return out
