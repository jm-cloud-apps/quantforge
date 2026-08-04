"""Pure-logic tests for the regime read and the band calibration.

No I/O: `classify` is a pure function of a metric dict, and the calibration
helpers are pure arithmetic. Nothing here needs a warmed breadth cache.
"""

from breadth.calibration import SHRINK_K, suggest_weight
from breadth.regime import BEARISH_SCORE, BULLISH_SCORE, classify
from breadth.regime_backtest import _episodes, _reliability
from breadth.situational import exposure_score, stance_level


# The row that exposed the bug: the old vote-tally called this "neutral / trade
# selectively" while the exposure model scored it 35 (Defensive, no new longs).
SOFT_TAPE = {
    "up_4": 398, "down_4": 346,
    "ratio_5d": 0.88, "ratio_10d": 0.74,
    "qtr_up_25": 657, "qtr_down_25": 733,
    "mo_up_25": 157, "mo_down_25": 523,
    "mo_up_50": 78, "t2108": 45.22,
}

STRONG_TAPE = {
    "up_4": 620, "down_4": 90,
    "ratio_5d": 1.9, "ratio_10d": 2.2,
    "qtr_up_25": 1200, "qtr_down_25": 200,
    "mo_up_25": 400, "mo_down_25": 100,
    "mo_up_50": 10, "t2108": 65.0,
}


def test_soft_tape_is_not_called_neutral():
    """The regression: a 0.74 ten-day ratio with monthly damage is not neutral."""
    read = classify(SOFT_TAPE)
    assert read["score"] == 35
    assert read["level"] == "bearish"


def test_level_never_contradicts_the_exposure_band():
    """Both ladders read the same row off one score, so they can't disagree.

    'Bullish' must never coexist with a defensive band, or vice versa.
    """
    for metrics in (SOFT_TAPE, STRONG_TAPE):
        read = classify(metrics)
        band = stance_level(exposure_score(metrics))
        if read["level"] in ("bullish", "overheated"):
            assert band in ("constructive", "aggressive")
        elif read["level"] in ("bearish", "capitulation"):
            assert band in ("defensive", "cash")
        else:
            assert band == "selective"


def test_score_cuts_align_with_the_stance_bands():
    """The cuts must sit on band edges, else a score could land in two ladders."""
    assert stance_level(BULLISH_SCORE) == "constructive"
    assert stance_level(BEARISH_SCORE) == "defensive"
    assert stance_level(BEARISH_SCORE + 1) == "selective"


def test_stretched_tape_reads_overheated_not_bullish():
    """A strong score with overbought positioning is a warning, not a green light."""
    assert classify(STRONG_TAPE)["level"] == "bullish"
    assert classify({**STRONG_TAPE, "t2108": 85.0})["level"] == "overheated"
    assert classify({**STRONG_TAPE, "mo_up_50": 78})["level"] == "overheated"


def test_washed_out_tape_reads_capitulation_not_bearish():
    assert classify({**SOFT_TAPE, "t2108": 15.0})["level"] == "capitulation"
    assert classify({**SOFT_TAPE, "down_4": 700})["level"] == "capitulation"


def test_classify_tolerates_missing_metrics():
    empty = classify(None)
    assert empty["level"] == "neutral" and empty["score"] is None
    partial = classify({"up_4": 200, "down_4": 180})
    assert partial["level"] in ("bullish", "overheated", "neutral", "bearish", "capitulation")
    assert isinstance(partial["score"], int)


def test_every_ten_day_ratio_gets_described():
    """The old version left 0.7–0.9 and 1.1–1.5 unnamed — that gap was the bug."""
    for r10 in (0.4, 0.6, 0.8, 1.0, 1.3, 1.7, 2.5):
        reasons = classify({**SOFT_TAPE, "ratio_10d": r10})["reasons"]
        assert any("10-day 4% breadth ratio" in x for x in reasons), r10


# --- episodes ---------------------------------------------------------------

def test_episodes_counts_runs_not_days():
    assert _episodes([True] * 10) == 1          # one long regime, not ten events
    assert _episodes([True, False, True]) == 2
    assert _episodes([]) == 0
    assert _episodes([False, False]) == 0
    assert _episodes([False, True, True, False, True]) == 2


def test_reliability_ladder():
    assert _reliability(0) == "insufficient"
    assert _reliability(5) == "tentative"
    assert _reliability(12) == "measured"


# --- calibration shrinkage --------------------------------------------------

def test_no_evidence_leaves_the_current_weight_untouched():
    suggested, conf = suggest_weight(current=0.65, implied=0.0, episodes=0)
    assert suggested == 0.65 and conf == 0.0


def test_shrinkage_is_halfway_at_k_episodes():
    suggested, conf = suggest_weight(current=0.0, implied=1.0, episodes=SHRINK_K)
    assert conf == 0.5
    assert abs(suggested - 0.5) < 1e-9


def test_more_episodes_move_further_toward_the_data():
    a, _ = suggest_weight(0.2, 1.0, episodes=3)
    b, _ = suggest_weight(0.2, 1.0, episodes=30)
    assert 0.2 < a < b < 1.0


def test_suggestion_stays_within_zero_and_one():
    assert suggest_weight(1.0, 5.0, episodes=100)[0] <= 1.0
    assert suggest_weight(0.0, -5.0, episodes=100)[0] >= 0.0
