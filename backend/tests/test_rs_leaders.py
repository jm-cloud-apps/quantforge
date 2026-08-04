"""Pure-logic tests for the prep leader scan.

`run()` needs a warmed breadth cache, so it isn't exercised here — these cover
the decision functions it is built from, which are pure and offline.
"""

import numpy as np

from scanners.rs_leaders import (
    BROKEN_FROM_HIGH_PCT,
    EXTENDED_ATR_MULT,
    HORIZONS,
    _is_probable_split,
    _setup_state,
    _trailing_sma,
)


# --- reverse-split guard ----------------------------------------------------

def test_split_flagged_when_a_huge_jump_lands_on_collapsed_volume():
    """A 10:1 reverse split gaps price up on far FEWER shares."""
    rets = np.array([1.0, -0.5, 900.0, 0.3, 0.2])
    vol = np.array([1_000_000, 1_100_000, 90_000, 950_000, 1_050_000], dtype=float)
    assert _is_probable_split(rets, vol) is True


def test_real_move_on_surging_volume_is_not_a_split():
    """The same price jump on a volume SURGE is a genuine move — keep it."""
    rets = np.array([1.0, -0.5, 900.0, 0.3, 0.2])
    vol = np.array([1_000_000, 1_100_000, 8_000_000, 950_000, 1_050_000], dtype=float)
    assert _is_probable_split(rets, vol) is False


def test_ordinary_window_is_never_flagged():
    rets = np.array([2.0, -1.0, 3.5, -2.2, 1.1])
    vol = np.array([1_000_000] * 5, dtype=float)
    assert _is_probable_split(rets, vol) is False


def test_all_nan_window_is_not_a_split():
    assert _is_probable_split(np.array([np.nan, np.nan]), np.array([np.nan, np.nan])) is False


# --- trailing SMA -----------------------------------------------------------

def test_trailing_sma_uses_only_the_last_window():
    row = np.array([1.0, 2.0, 3.0, 10.0, 20.0, 30.0])
    assert _trailing_sma(row, 3) == 20.0


def test_trailing_sma_needs_a_full_window():
    assert _trailing_sma(np.array([1.0, 2.0]), 5) is None


def test_trailing_sma_rejects_a_window_with_holes():
    """A gap in the window would silently bias the rail — better to say None."""
    assert _trailing_sma(np.array([1.0, np.nan, 3.0]), 3) is None


# --- setup_state triage -----------------------------------------------------

def test_broken_outranks_quiet():
    """Quiet while broken is a downtrend resting, not a base."""
    state, _ = _setup_state(from_high_pct=-40.0, ext_adrs=-2.0, above_slow=False, contracting=True)
    assert state == "broken"


def test_off_the_high_but_holding_the_rail_is_not_broken():
    state, _ = _setup_state(from_high_pct=BROKEN_FROM_HIGH_PCT - 5, ext_adrs=0.5,
                            above_slow=True, contracting=True)
    assert state != "broken"


def test_extended_outranks_at_pivot():
    """Near the highs AND stretched is a chase, not a pivot."""
    state, _ = _setup_state(from_high_pct=-1.0, ext_adrs=EXTENDED_ATR_MULT + 1,
                            above_slow=True, contracting=True)
    assert state == "extended"


def test_at_pivot_needs_both_the_high_and_a_quiet_range():
    at_pivot, _ = _setup_state(from_high_pct=-2.0, ext_adrs=1.0, above_slow=True, contracting=True)
    assert at_pivot == "at_pivot"
    # Same distance from the high, still swinging → not a pivot yet.
    still_wide, _ = _setup_state(from_high_pct=-2.0, ext_adrs=1.0, above_slow=True, contracting=False)
    assert still_wide == "basing"


def test_basing_requires_holding_the_slow_rail():
    state, _ = _setup_state(from_high_pct=-15.0, ext_adrs=-1.0, above_slow=False, contracting=True)
    assert state == "watch"


def test_every_state_carries_a_reason():
    cases = [
        (-40.0, -2.0, False, True),
        (-1.0, 9.0, True, True),
        (-2.0, 1.0, True, True),
        (-15.0, 0.5, True, True),
        (-15.0, 0.5, True, False),
        (-15.0, -1.0, False, False),
    ]
    for from_high, ext, above, quiet in cases:
        state, why = _setup_state(from_high, ext, above, quiet)
        assert state in {"broken", "extended", "at_pivot", "basing", "watch"}
        assert why and isinstance(why, str)


def test_missing_extension_does_not_crash_the_triage():
    """ext_adrs is None when the 20-day rail can't be computed yet."""
    state, _ = _setup_state(from_high_pct=-2.0, ext_adrs=None, above_slow=True, contracting=True)
    assert state == "at_pivot"


# --- horizons ---------------------------------------------------------------

def test_horizons_are_the_standard_session_counts():
    assert HORIZONS == {"1M": 21, "3M": 63, "6M": 126}
