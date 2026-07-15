"""200-MA-reclaim scanner internals — the vectorised MA + the cross/streak logic
that decide whether a name counts as a fresh reclaim. Pure math, no data needed.
"""

import numpy as np

from scanners.ma_reclaim import (
    _trailing_sma, _last_cross_up, _below_run_before, _fit_windows,
    MA_DAYS, SCAN_H, MIN_MA_DAYS, MIN_SCAN_H,
)


def test_trailing_sma_matches_hand_computation():
    C = np.array([[1.0, 2.0, 3.0, 4.0, 5.0]])
    out = _trailing_sma(C, 2)
    assert np.isnan(out[0, 0])                       # first w-1 cols undefined
    np.testing.assert_allclose(out[0, 1:], [1.5, 2.5, 3.5, 4.5])


def test_trailing_sma_window_three():
    C = np.array([[3.0, 6.0, 9.0, 12.0]])
    out = _trailing_sma(C, 3)
    assert np.isnan(out[0, 0]) and np.isnan(out[0, 1])
    np.testing.assert_allclose(out[0, 2:], [6.0, 9.0])


def test_last_cross_up_picks_most_recent_transition():
    assert _last_cross_up(np.array([False, False, True, True])) == 2
    # Two crosses — the reclaim age must reflect the *most recent* one.
    assert _last_cross_up(np.array([False, True, False, True])) == 3
    # Never above → not a reclaim at all.
    assert _last_cross_up(np.array([False, False, False])) is None


def test_below_run_before_counts_consecutive_below_days():
    assert _below_run_before(np.array([False, False, False, True, True]), 3) == 3
    # A pop above inside the run stops the count — this is what keeps a name that
    # chops across the line from passing the "was below ≥ N sessions" gate.
    assert _below_run_before(np.array([True, False, False, True]), 3) == 2


def test_fit_windows_full_resolution_when_cache_is_deep():
    assert _fit_windows(MA_DAYS + SCAN_H + 10) == (MA_DAYS, SCAN_H, False)


def test_fit_windows_degrades_and_flags_approx_when_shallow():
    ma, scan, approx = _fit_windows(126)
    assert approx is True
    assert MIN_MA_DAYS <= ma <= MA_DAYS
    assert MIN_SCAN_H <= scan <= SCAN_H
    assert ma + scan <= 126               # must actually fit the cache


def test_fit_windows_returns_none_when_too_short():
    ma, scan, approx = _fit_windows(MIN_MA_DAYS + MIN_SCAN_H - 1)
    assert ma is None and scan is None
