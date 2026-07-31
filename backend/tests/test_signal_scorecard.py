"""Signal scorecard — the honesty machinery.

The scorecard's whole value is refusing to overstate what ~200 autocorrelated
daily observations can support, so these tests pin the two things that make it
honest: episode counting (a nine-day run is one observation, not nine) and the
reliability banding that follows from it.
"""

from breadth.signal_scorecard import (
    _episodes, _percentile, MIN_EPISODES_RELIABLE, MIN_EPISODES_TENTATIVE,
)


# ── episodes, not rows ──────────────────────────────────────────────────────

def test_a_single_run_counts_once_however_long():
    # The core correction: regime days cluster, so a 9-session run of the same
    # signal is one observation. Counting days would inflate n ~9x.
    assert _episodes([False, True, True, True, True, True, True, True, True, True]) == 1


def test_separate_runs_count_separately():
    assert _episodes([True, False, True, False, True]) == 3


def test_run_starting_at_index_zero_is_counted():
    assert _episodes([True, True, False]) == 1


def test_no_firings_is_zero_episodes():
    assert _episodes([False, False, False]) == 0


def test_episodes_never_exceed_days():
    flags = [True, True, False, True, True, True]
    assert _episodes(flags) <= sum(flags)


def test_reliability_bands_are_ordered():
    assert MIN_EPISODES_TENTATIVE < MIN_EPISODES_RELIABLE


# ── point-in-time percentile (no lookahead) ─────────────────────────────────

def test_percentile_uses_only_history_up_to_that_point():
    # Ascending scores: the last value seen so far is always the highest yet,
    # regardless of much larger values that appear later in the list.
    scores = list(range(100))
    assert _percentile(scores, 49) == round(49 / 50 * 100, 1)


def test_percentile_returns_none_before_enough_history():
    assert _percentile([1, 2, 3], 2) is None


def test_percentile_low_score_ranks_low():
    scores = [50] * 40 + [10]
    p = _percentile(scores, 40)
    assert p is not None and p < 5
