"""Missed Book pure logic: the R math and the book summary.

No I/O — these hit the module-level functions directly, so they say nothing
about the store and everything about the arithmetic the page reports.
"""

from missed_router import (
    REASONS,
    VERDICTS,
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


def test_vocabularies_are_the_ones_the_frontend_mirrors():
    assert VERDICTS == ("missed", "passed", "unclear")
    assert "rules said no — correct pass" in REASONS
    assert len(set(REASONS)) == len(REASONS)  # no duplicates across groups
