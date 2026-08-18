"""Market-clock helpers — when is the US equity market actively trading?

Per user spec the "market is active" window is:
  * a US weekday (Mon-Fri)
  * NOT a full NYSE holiday
  * BEFORE 2:00 PM Pacific (= 5:00 PM Eastern — covers regular session
    9:30–16:00 ET plus one hour of after-hours grace)

Outside that window the underlying data is effectively frozen, so all the
response/snapshot caches across the app can extend their TTL aggressively
(default 4 hours when closed). Routers and modules import `effective_cache_ttl`
and call it whenever they would have written a `time.time() + TTL` entry.

Single source of truth — DO NOT duplicate the holiday list elsewhere.
"""

from __future__ import annotations

from datetime import datetime, time as dtime, timedelta
from zoneinfo import ZoneInfo

PT = ZoneInfo("America/Los_Angeles")

# NYSE full-day closures, 2025–2027. Keep this list as `YYYY-MM-DD` strings;
# checked against the current PT date so half-day early closes (e.g. day after
# Thanksgiving) intentionally count as "active" up to 2pm PT.
_NYSE_HOLIDAYS = frozenset({
    # 2025
    "2025-01-01",  # New Year's Day
    "2025-01-09",  # Day of mourning (Jimmy Carter)
    "2025-01-20",  # MLK Day
    "2025-02-17",  # Presidents Day
    "2025-04-18",  # Good Friday
    "2025-05-26",  # Memorial Day
    "2025-06-19",  # Juneteenth
    "2025-07-04",  # Independence Day
    "2025-09-01",  # Labor Day
    "2025-11-27",  # Thanksgiving
    "2025-12-25",  # Christmas
    # 2026
    "2026-01-01",
    "2026-01-19",  # MLK Day
    "2026-02-16",
    "2026-04-03",  # Good Friday
    "2026-05-25",
    "2026-06-19",
    "2026-07-03",  # July 4 falls on Saturday
    "2026-09-07",
    "2026-11-26",
    "2026-12-25",
    # 2027
    "2027-01-01",
    "2027-01-18",
    "2027-02-15",
    "2027-03-26",  # Good Friday
    "2027-05-31",
    "2027-06-18",  # Juneteenth falls on Saturday — observed Friday
    "2027-07-05",  # July 4 falls on Sunday — observed Monday
    "2027-09-06",
    "2027-11-25",
    "2027-12-24",  # Christmas falls on Saturday — observed Friday
})

# After this PT hour the market is considered "closed for the day" — covers
# regular close at 13:00 PT plus one hour of after-hours.
_ACTIVE_CUTOFF_PT = dtime(14, 0)


def is_market_active_now() -> bool:
    """True when the underlying market data is actively changing."""
    now_pt = datetime.now(PT)
    # Weekend
    if now_pt.weekday() >= 5:
        return False
    # Full-day NYSE holiday
    if now_pt.date().isoformat() in _NYSE_HOLIDAYS:
        return False
    # Post-close hour cutoff
    if now_pt.time() >= _ACTIVE_CUTOFF_PT:
        return False
    return True


# Default "long" TTL when market is closed: 4 hours. Long enough that weekend
# / overnight / holiday hits never re-fetch, short enough that a slightly stale
# response gets refreshed within a reasonable window of next market open.
DEFAULT_CLOSED_TTL_SEC = 4 * 3600


def effective_cache_ttl(active_ttl: int, closed_ttl: int = DEFAULT_CLOSED_TTL_SEC) -> int:
    """Return TTL based on whether the market is actively trading."""
    return active_ttl if is_market_active_now() else closed_ttl


def last_market_close() -> datetime:
    """PT datetime of the most recent active→closed transition.

    Walks back from now to the most recent trading day (weekday, not an NYSE
    holiday) whose close cutoff has already passed. Used to decide whether a
    market-closed cache still reflects the latest session: anything generated
    at/after this timestamp is current, so weekend/holiday hits never need to
    re-scan until the next session actually closes."""
    now = datetime.now(PT)
    d = now.date()
    for _ in range(10):  # cover long holiday weekends
        is_trading = d.weekday() < 5 and d.isoformat() not in _NYSE_HOLIDAYS
        cutoff = datetime.combine(d, _ACTIVE_CUTOFF_PT, tzinfo=PT)
        if is_trading and now >= cutoff:
            return cutoff
        d -= timedelta(days=1)
    return datetime.combine(d, _ACTIVE_CUTOFF_PT, tzinfo=PT)  # pathological fallback


# Session phase, for surfaces that need to know *where in the day* we are
# rather than just whether the data is moving. The routine differs at 8am,
# 10am and 5pm, and until now nothing in the UI could tell them apart.
ET = ZoneInfo("America/New_York")
_OPEN_ET = dtime(9, 30)
_CLOSE_ET = dtime(16, 0)


def session_phase(now: datetime | None = None) -> dict:
    """Where the clock is in the trading day, in market terms.

    phase is one of: weekend | holiday | premarket | session | postclose.
    Returns the ET wall clock too, so a caller in any timezone reasons about
    the market's day rather than its own.
    """
    now_et = (now or datetime.now(ET)).astimezone(ET)
    date_iso = now_et.date().isoformat()
    weekday = now_et.weekday()

    if weekday >= 5:
        phase = "weekend"
    elif date_iso in _NYSE_HOLIDAYS:
        phase = "holiday"
    elif now_et.time() < _OPEN_ET:
        phase = "premarket"
    elif now_et.time() < _CLOSE_ET:
        phase = "session"
    else:
        phase = "postclose"

    minutes_to_open = None
    if phase == "premarket":
        open_at = now_et.replace(hour=_OPEN_ET.hour, minute=_OPEN_ET.minute,
                                 second=0, microsecond=0)
        minutes_to_open = max(0, int((open_at - now_et).total_seconds() // 60))

    return {
        "phase": phase,
        "date": date_iso,
        "et_time": now_et.strftime("%H:%M"),
        "weekday": weekday,
        "minutes_to_open": minutes_to_open,
        "is_active": is_market_active_now(),
    }
