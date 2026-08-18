"""What to do next — one action, chosen from the clock and from what you've done.

The app has 36 pages grouped by category. Categories are a filing system, not a
routine: "Find Setups" holds twelve pages, so standing in it still leaves you
choosing between twelve things. And nothing was time-aware — the right surface
at 8:45am, 10:30am and 4:30pm are completely different, and all 36 were
presented identically at every moment.

This picks the next step. It is deliberately opinionated and deliberately
*one* step: a list of six suggestions is the same problem in a smaller box.

Pure — every input arrives as a plain value, so the whole decision table is
testable without a clock, a workbook, or a network.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

# Prep older than this is stale enough that the shortlist is last week's.
PREP_STALE_DAYS = 4
# The breadth cache behind every scan; past this the "leaders" are last week's.
CACHE_STALE_DAYS = 3


def _to_date(value: Any) -> Optional[date]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "")).date()
    except ValueError:
        return None


def _days_since(value: Any, today: date) -> Optional[int]:
    d = _to_date(value)
    return None if d is None else (today - d).days


def _premarket_label(minutes: Optional[int]) -> str:
    """How near the open is, in words a person uses.

    A countdown is only information when the open is close. "Opens in 553m" is
    both true and useless at half past midnight, so beyond a couple of hours
    this says the part that matters — that the session hasn't started — and
    drops the number.
    """
    if minutes is None:
        return "Pre-market"
    if minutes > 120:
        return "Pre-market"
    if minutes >= 60:
        h, m = divmod(minutes, 60)
        return f"Opens in {h}h{f' {m}m' if m else ''}"
    return f"Opens in {minutes}m"


def next_action(phase: dict,
                *,
                plans_today: int = 0,
                last_prep: Any = None,
                cache_as_of: Any = None,
                untagged_exits: int = 0,
                open_suggestions: int = 0,
                unclear_misses: int = 0) -> dict:
    """The single next step, plus the reason it is that one.

    Returns {headline, detail, to, cta, tone, phase}. `tone` is advisory:
    'act' when something is waiting on you, 'ok' when the routine is on track,
    'idle' when the honest answer is that there is nothing to do.
    """
    today = _to_date(phase.get("date")) or date.today()
    p = phase.get("phase", "session")
    prep_age = _days_since(last_prep, today)
    cache_age = _days_since(cache_as_of, today)

    def out(headline, detail, to, cta, tone="act"):
        return {"headline": headline, "detail": detail, "to": to,
                "cta": cta, "tone": tone, "phase": p}

    # A scan running on a stale cache is the one problem that makes every other
    # step wrong, so it outranks the routine wherever we are in the day.
    if cache_age is not None and cache_age > CACHE_STALE_DAYS:
        return out(
            f"Breadth cache is {cache_age} days old",
            "Every scan reads this cache, so the leader lists are last week's until it's refreshed.",
            "/market-monitor", "Refresh breadth",
        )

    if p in ("weekend", "holiday"):
        label = "Weekend" if p == "weekend" else "Market holiday"
        if prep_age is None:
            return out(f"{label} — no prep on record",
                       "Prep is the only step that creates a record of what you looked at. "
                       "Without it the missed-trade and discipline views have nothing to read.",
                       "/prep", "Start prep")
        if prep_age > PREP_STALE_DAYS:
            return out(f"{label} — last prep was {prep_age} days ago",
                       "Rebuild the shortlist while nothing is moving; Monday's version of the "
                       "same decision costs more.",
                       "/prep", "Run prep")
        if unclear_misses:
            return out(f"{label} — {unclear_misses} entr{'y' if unclear_misses == 1 else 'ies'} still unclear",
                       "The verdict decides whether a row is a cost or a process win, so leaving them "
                       "undecided makes every number on the page wrong at once.",
                       "/missed", "Decide them")
        return out(f"{label} — prep is current",
                   "Good time for the weekly read: compliance, setup decay, and what the holding "
                   "period is actually paying.",
                   "/discipline", "Weekly review", tone="ok")

    if p == "premarket":
        when = _premarket_label(phase.get("minutes_to_open"))
        if prep_age is not None and prep_age > PREP_STALE_DAYS:
            return out(f"{when} — prep is {prep_age} days old",
                       "Trading off a stale shortlist is how a name you never researched becomes a position.",
                       "/prep", "Refresh prep")
        if plans_today == 0:
            return out(f"{when} — no plan logged",
                       "Trade Today withholds the verdict until a plan exists. Set the gate, then write "
                       "entry, stop and size before the bell.",
                       "/situational-awareness", "Read the tape → log a plan")
        return out(f"{when} — {plans_today} plan{'s' if plans_today != 1 else ''} logged",
                   "The work is done. The market's only job now is to reach a trigger you already wrote down.",
                   "/setups", "Setups board", tone="ok")

    if p == "session":
        if plans_today == 0:
            return out("Session live — no plan logged",
                       "The circuit breaker is holding today's verdict back. Anything taken now is "
                       "unplanned by definition, and unplanned is where the month's losses live.",
                       "/situational-awareness", "Log a plan first")
        return out(f"Session live — {plans_today} plan{'s' if plans_today != 1 else ''} in play",
                   "Watch the triggers you wrote, not the tape. Exits are prices you already set.",
                   "/setups", "Setups board", tone="ok")

    # post-close
    if untagged_exits:
        return out(f"Closed — {untagged_exits} exit{'s' if untagged_exits != 1 else ''} untagged",
                   "Tag them now while you remember why. An exit reason typed next week is a story, "
                   "not a record.",
                   "/review", "Tag exits")
    if open_suggestions:
        return out(f"Closed — {open_suggestions} suggested miss{'es' if open_suggestions != 1 else ''}",
                   "Names you shortlisted, never traded, that went somewhere. Logging one as a correct "
                   "pass is how you dismiss it.",
                   "/missed", "Review them")
    if prep_age is not None and prep_age >= 1:
        return out("Closed — set up tomorrow",
                   "The shortlist is worth more written tonight than remembered in the morning.",
                   "/prep", "Run prep", tone="ok")
    return out("Closed — nothing outstanding",
               "Prep is current, exits are tagged, nothing is waiting on a verdict.",
               "/discipline", "Check the scorecard", tone="idle")
