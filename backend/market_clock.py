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

from datetime import datetime, time as dtime
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
