"""The next-action decision table.

The app has 36 pages grouped by category, and categories are a filing system
rather than a routine — standing in "Find Setups" still leaves you choosing
between twelve things. This module picks one step from the clock and from what
has actually been done, so the whole point is that the choice is predictable.

Pure: every input is a plain value, so none of this needs a clock or a workbook.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

import market_clock
import routine

ET = ZoneInfo("America/New_York")
TODAY = "2026-08-17"


def _phase(name, minutes_to_open=None, day=TODAY):
    return {"phase": name, "date": day, "minutes_to_open": minutes_to_open}


# --- the clock ---------------------------------------------------------------

def test_session_phase_covers_the_whole_week():
    def at(s):
        return market_clock.session_phase(datetime.fromisoformat(s).replace(tzinfo=ET))["phase"]

    assert at("2026-08-17 08:45") == "premarket"
    assert at("2026-08-17 09:30") == "session"
    assert at("2026-08-17 15:59") == "session"
    assert at("2026-08-17 16:00") == "postclose"
    assert at("2026-08-15 11:00") == "weekend"       # Saturday
    assert at("2026-12-25 11:00") == "holiday"


def test_minutes_to_open_only_exists_before_the_open():
    def p(s):
        return market_clock.session_phase(datetime.fromisoformat(s).replace(tzinfo=ET))

    assert p("2026-08-17 08:45")["minutes_to_open"] == 45
    assert p("2026-08-17 10:00")["minutes_to_open"] is None


def test_the_countdown_is_dropped_when_the_open_is_hours_away():
    # "Opens in 553m" is true and useless at half past midnight.
    assert routine._premarket_label(553) == "Pre-market"
    assert routine._premarket_label(95) == "Opens in 1h 35m"
    assert routine._premarket_label(45) == "Opens in 45m"
    assert routine._premarket_label(None) == "Pre-market"


# --- precedence --------------------------------------------------------------

def test_a_stale_cache_outranks_everything_else():
    """Every scan reads that cache, so a stale one makes the other steps wrong."""
    a = routine.next_action(_phase("session"), plans_today=3,
                            last_prep=TODAY, cache_as_of="2026-08-01")
    assert "cache" in a["headline"].lower()
    assert a["to"] == "/market-monitor"


def test_a_fresh_cache_does_not_trigger_the_warning():
    a = routine.next_action(_phase("session"), plans_today=1,
                            last_prep=TODAY, cache_as_of="2026-08-16")
    assert "cache" not in a["headline"].lower()


# --- the session day ---------------------------------------------------------

def test_no_plan_before_the_open_sends_you_to_the_gate():
    a = routine.next_action(_phase("premarket", 45), plans_today=0, last_prep=TODAY)
    assert a["to"] == "/situational-awareness"
    assert "45m" in a["headline"]
    assert a["tone"] == "act"


def test_a_logged_plan_before_the_open_reads_as_on_track():
    a = routine.next_action(_phase("premarket", 20), plans_today=2, last_prep=TODAY)
    assert a["tone"] == "ok"
    assert a["to"] == "/setups"
    assert "2 plans" in a["headline"]


def test_stale_prep_outranks_the_plan_prompt_before_the_open():
    a = routine.next_action(_phase("premarket", 30), plans_today=0, last_prep="2026-08-01")
    assert a["to"] == "/prep"


def test_trading_without_a_plan_intraday_is_called_what_it_is():
    a = routine.next_action(_phase("session"), plans_today=0, last_prep=TODAY)
    assert a["to"] == "/situational-awareness"
    assert "unplanned" in a["detail"].lower()


# --- after the close ---------------------------------------------------------

def test_untagged_exits_come_before_anything_else_after_the_close():
    a = routine.next_action(_phase("postclose"), untagged_exits=3,
                            open_suggestions=5, last_prep=TODAY)
    assert a["to"] == "/review"
    assert "3 exits" in a["headline"]


def test_suggested_misses_are_next_once_exits_are_tagged():
    a = routine.next_action(_phase("postclose"), untagged_exits=0,
                            open_suggestions=2, last_prep=TODAY)
    assert a["to"] == "/missed"


def test_a_quiet_close_says_so_rather_than_inventing_work():
    a = routine.next_action(_phase("postclose"), last_prep=TODAY)
    assert a["tone"] == "idle"
    assert "nothing outstanding" in a["headline"].lower()


# --- the weekend -------------------------------------------------------------

def test_no_prep_on_record_is_the_weekend_headline():
    a = routine.next_action(_phase("weekend", day="2026-08-15"), last_prep=None)
    assert a["to"] == "/prep"
    assert "no prep" in a["headline"].lower()


def test_stale_prep_names_how_stale():
    a = routine.next_action(_phase("weekend", day="2026-08-15"), last_prep="2026-08-01")
    assert "14 days ago" in a["headline"]


def test_current_prep_moves_the_weekend_on_to_the_review():
    a = routine.next_action(_phase("weekend", day="2026-08-15"), last_prep="2026-08-14")
    assert a["to"] == "/discipline"
    assert a["tone"] == "ok"


def test_unclear_misses_are_surfaced_before_the_weekly_review():
    a = routine.next_action(_phase("weekend", day="2026-08-15"),
                            last_prep="2026-08-14", unclear_misses=3)
    assert a["to"] == "/missed"


def test_a_holiday_behaves_like_a_weekend():
    a = routine.next_action(_phase("holiday", day="2026-12-25"), last_prep=None)
    assert a["to"] == "/prep"
    assert "holiday" in a["headline"].lower()


# --- shape -------------------------------------------------------------------

def test_every_branch_returns_a_complete_card():
    cases = [
        _phase("weekend", day="2026-08-15"), _phase("holiday", day="2026-12-25"),
        _phase("premarket", 30), _phase("session"), _phase("postclose"),
    ]
    for ph in cases:
        for plans in (0, 2):
            a = routine.next_action(ph, plans_today=plans, last_prep=TODAY)
            assert set(a) == {"headline", "detail", "to", "cta", "tone", "phase"}
            assert a["to"].startswith("/")
            assert a["tone"] in {"act", "ok", "idle"}
            assert a["headline"] and a["detail"] and a["cta"]


def test_unparseable_dates_do_not_crash_the_strip():
    a = routine.next_action(_phase("session"), plans_today=1,
                            last_prep="not-a-date", cache_as_of="also-not")
    assert a["to"].startswith("/")
    assert routine._to_date("nonsense") is None
    assert routine._to_date(date(2026, 8, 17)) == date(2026, 8, 17)
