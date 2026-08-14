"""Missed Book pure logic: the R math and the book summary.

No I/O — these hit the module-level functions directly, so they say nothing
about the store and everything about the arithmetic the page reports.
"""

from datetime import date

from missed_router import (
    REASONS,
    VERDICTS,
    forward_prices,
    price_fields,
    pct_move,
    r_multiple,
    summarize,
)


# --- r_multiple -------------------------------------------------------------

def test_long_r_is_reward_over_risk():
    # risk 1.00, reward 4.00
    assert r_multiple("long", entry=50.0, stop=49.0, price=54.0) == 4.0


def test_short_r_flips_both_sides():
    # short at 50, stop 51 (risk 1.00), covers at 46 (reward 4.00)
    assert r_multiple("short", entry=50.0, stop=51.0, price=46.0) == 4.0


def test_r_is_negative_when_it_went_the_wrong_way():
    assert r_multiple("long", entry=50.0, stop=49.0, price=49.5) == -0.5


def test_stop_on_the_wrong_side_is_undefined_not_zero():
    # A long whose stop sits above the entry is a data-entry error. Returning 0
    # would quietly enter it in the sums as a free trade.
    assert r_multiple("long", entry=50.0, stop=51.0, price=54.0) is None
    assert r_multiple("short", entry=50.0, stop=49.0, price=46.0) is None


def test_missing_or_unparseable_inputs_are_none():
    assert r_multiple("long", None, 49.0, 54.0) is None
    assert r_multiple("long", 50.0, 49.0, None) is None
    assert r_multiple("long", "abc", 49.0, 54.0) is None


def test_pct_move_is_signed_in_the_trades_favour():
    assert pct_move("long", 50.0, 55.0) == 10.0
    assert pct_move("short", 50.0, 45.0) == 10.0
    assert pct_move("long", 50.0, 45.0) == -10.0
    assert pct_move("long", 0, 45.0) is None


def test_price_fields_prices_both_horizons_independently():
    f = price_fields("long", entry=50.0, stop=49.0, peak=58.0, exit_price=54.0)
    assert f["r_best"] == 8.0     # to the high you would not have caught
    assert f["r_real"] == 4.0     # to the exit you'd actually have taken
    assert f["pct_best"] == 16.0


def test_price_fields_leaves_r_real_none_when_no_exit_given():
    f = price_fields("long", entry=50.0, stop=49.0, peak=58.0, exit_price=None)
    assert f["r_best"] == 8.0
    assert f["r_real"] is None


# --- summarize --------------------------------------------------------------

def _entry(**kw):
    base = {
        "verdict": "missed", "reason": "saw it, hesitated", "setup": "HTF - Down Flat Flag",
        "date": "2026-08-03", "r_best": 4.0, "r_real": 2.0,
    }
    base.update(kw)
    return base


def test_only_missed_entries_accrue_cost():
    book = [
        _entry(),
        _entry(verdict="passed", reason="rules said no — correct pass", r_best=9.0, r_real=6.0),
        _entry(verdict="unclear", r_best=3.0, r_real=1.0),
    ]
    s = summarize(book)
    assert s["missed"]["count"] == 1
    assert s["missed"]["r_real_sum"] == 2.0   # the passed 6R is not a loss
    assert s["passed"]["count"] == 1
    assert s["unclear"]["count"] == 1


def test_sums_carry_their_own_n_so_partial_pricing_is_visible():
    # Three misses, only two of them priced to an exit.
    book = [_entry(), _entry(), _entry(r_real=None)]
    s = summarize(book)
    assert s["missed"]["count"] == 3
    assert s["missed"]["r_real_n"] == 2
    assert s["missed"]["r_real_sum"] == 4.0
    assert s["missed"]["r_best_n"] == 3


def test_best_and_real_are_never_mixed_into_one_number():
    # r_best must not stand in for a missing r_real — that would inflate the
    # cost with a high nobody would have sold.
    s = summarize([_entry(r_real=None, r_best=12.0)])
    assert s["missed"]["r_real_sum"] is None
    assert s["missed"]["r_best_sum"] == 12.0


def test_by_reason_ranks_the_most_expensive_failure_mode_first():
    book = [
        _entry(reason="saw it, hesitated", r_real=1.0),
        _entry(reason="not on the watchlist", r_real=5.0),
        _entry(reason="not on the watchlist", r_real=4.0),
    ]
    s = summarize(book)
    assert s["by_reason"][0]["reason"] == "not on the watchlist"
    assert s["by_reason"][0]["r_real_sum"] == 9.0
    assert s["by_reason"][0]["count"] == 2


def test_reasons_are_tagged_with_the_group_that_names_the_fix():
    s = summarize([
        _entry(reason="not on the watchlist"),
        _entry(reason="saw it, hesitated"),
        _entry(reason="at max positions"),
    ])
    groups = {g["group"]: g["count"] for g in s["by_group"]}
    assert groups == {"process": 1, "execution": 1, "capacity": 1}


def test_unknown_reason_falls_into_other_rather_than_vanishing():
    s = summarize([_entry(reason="something bespoke")])
    assert s["by_reason"][0]["group"] == "other"
    assert s["by_reason"][0]["count"] == 1


def test_by_setup_and_by_month_bucket_the_same_book():
    book = [
        _entry(setup="EP - Earnings Gap Up", date="2026-07-14"),
        _entry(setup="EP - Earnings Gap Up", date="2026-08-03"),
        _entry(setup="HTF - Channel", date="2026-08-19"),
    ]
    s = summarize(book)
    assert s["by_setup"][0] == {
        "setup": "EP - Earnings Gap Up", "count": 2,
        "r_best_sum": 8.0, "r_best_n": 2, "r_real_sum": 4.0, "r_real_n": 2,
    }
    assert [m["month"] for m in s["by_month"]] == ["2026-07", "2026-08"]


def test_empty_book_summarizes_without_blowing_up():
    s = summarize([])
    assert s["total"] == 0
    assert s["missed"]["count"] == 0
    assert s["missed"]["r_real_sum"] is None
    assert s["by_reason"] == []


# --- forward_prices ---------------------------------------------------------
# Bars are plain dicts; the function accepts those as well as the pandas frames
# breadth.cache returns, so the pricing logic is testable without DataFrames.

def _bars(closes, symbol="STX", start_day=1, spread=0.5):
    """One session per entry, highs/lows a fixed spread around the close."""
    return {
        date(2026, 8, start_day + i): {symbol: {
            "high": c + spread, "low": c - spread, "close": c,
        }}
        for i, c in enumerate(closes)
    }


def test_peak_is_the_best_high_after_the_entry_date():
    bars = _bars([100, 104, 109, 106, 103])
    r = forward_prices("STX", date(2026, 8, 1), bars, ma_period=3)
    # Day 1 is the entry date itself, so the window starts at day 2.
    assert r["peak"] == 109.5
    assert r["peak_date"] == "2026-08-03"
    assert r["sessions_used"] == 4


def test_short_peak_is_the_lowest_low():
    bars = _bars([100, 96, 91, 94])
    r = forward_prices("STX", date(2026, 8, 1), bars, direction="short", ma_period=3)
    assert r["peak"] == 90.5
    assert r["peak_date"] == "2026-08-03"


def test_trail_exit_is_the_first_close_through_the_rail():
    # Rises, then breaks back under its own 3-day average on the last bar.
    bars = _bars([100, 104, 108, 112, 100])
    r = forward_prices("STX", date(2026, 8, 1), bars, ma_period=3)
    assert r["trail_hit"] is True
    assert r["trail_exit"] == 100
    assert r["trail_exit_date"] == "2026-08-05"
    # And the peak is well above it — the two numbers must not collapse.
    assert r["peak"] > r["trail_exit"]


def test_trail_falls_back_to_the_last_close_when_the_rail_never_breaks():
    bars = _bars([100, 102, 104, 106, 108])
    r = forward_prices("STX", date(2026, 8, 1), bars, ma_period=3)
    assert r["trail_hit"] is False
    assert r["trail_exit"] == 108
    assert r["trail_exit_date"] == "2026-08-05"


def test_window_is_capped_at_the_session_limit():
    bars = _bars(list(range(100, 130)))
    r = forward_prices("STX", date(2026, 8, 1), bars, sessions=3, ma_period=3)
    assert r["sessions_used"] == 3
    assert r["last_close"] == 103


def test_prior_closes_seed_the_rail_so_the_first_bars_can_break_it():
    # Entry on day 4: the three sessions before it prime the average, so a drop
    # on day 5 is catchable instead of waiting for the window to fill.
    bars = _bars([110, 112, 114, 116, 100])
    r = forward_prices("STX", date(2026, 8, 4), bars, ma_period=3)
    assert r["trail_hit"] is True
    assert r["trail_exit_date"] == "2026-08-05"


def test_a_split_sized_move_is_refused_rather_than_returned():
    bars = _bars([100, 500])   # unadjusted-cache artefact, not a 400% day
    assert forward_prices("STX", date(2026, 8, 1), bars, ma_period=3) is None


def test_missing_symbol_or_empty_window_returns_none():
    bars = _bars([100, 104])
    assert forward_prices("NVDA", date(2026, 8, 1), bars) is None
    assert forward_prices("STX", date(2026, 9, 1), bars) is None
    assert forward_prices("STX", date(2026, 8, 1), {}) is None
    assert forward_prices("", date(2026, 8, 1), bars) is None


def test_gaps_in_coverage_are_skipped_not_counted():
    bars = _bars([100, 104, 108])
    bars[date(2026, 8, 2)] = {}           # a session with no row for the symbol
    r = forward_prices("STX", date(2026, 8, 1), bars, ma_period=2)
    assert r["sessions_used"] == 1
    assert r["peak"] == 108.5


def test_vocabularies_are_the_ones_the_frontend_mirrors():
    assert VERDICTS == ("missed", "passed", "unclear")
    assert "rules said no — correct pass" in REASONS
    assert len(set(REASONS)) == len(REASONS)  # no duplicates across groups
