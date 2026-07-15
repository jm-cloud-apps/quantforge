"""Qullamaggie EP scorer — deterministic, pure. Lock the grade curve, the catalyst
classifier, and a couple of criterion boundaries so scoring can't drift silently.
"""

from ep_scorer import _grade, classify_catalyst, score_gap, score_ep


def test_grade_curve():
    assert _grade(95) == "A+"
    assert _grade(90) == "A+"     # boundary
    assert _grade(89) == "A"
    assert _grade(82) == "A"
    assert _grade(70) == "B"
    assert _grade(55) == "C"
    assert _grade(40) == "D"
    assert _grade(39) == "F"
    assert _grade(0) == "F"


def test_classify_catalyst_matches_and_misses():
    assert classify_catalyst("Company beats estimates on strong earnings") == "Earnings"
    assert classify_catalyst("FDA approval granted for lead drug") == "FDA Approval"
    assert classify_catalyst("Board announces stock split logistics") is None


def test_score_gap_zone_and_bounds():
    # None → 0; the 20–40% band is the ideal EP zone (max 15 pts).
    assert score_gap(None)["points"] == 0
    assert score_gap(25.0)["points"] == 15
    # More gap is never scored below a smaller gap in the sub-ideal range.
    assert score_gap(15.0)["points"] >= score_gap(2.0)["points"]
    # Every result stays within the criterion's cap.
    for g in (None, 2.0, 12.0, 25.0, 45.0, 80.0):
        r = score_gap(g)
        assert 0 <= r["points"] <= 15


def test_score_ep_grade_matches_total_and_rewards_quality():
    strong = score_ep({
        "news": [{"headline": "Q3 earnings blowout, tops expectations"}],
        "eps_surprise": None,
        "gap_pct": 25.0, "volume_ratio": 6.0, "dollar_volume": 30_000_000,
        "float_shares": 40_000_000, "market_cap": 2_000_000_000,
        "adr_pct": 6.0, "prior_move_pct": 5.0,
    })
    assert {"criteria", "total_score", "grade", "verdict"} <= set(strong)
    assert strong["grade"] == _grade(strong["total_score"])
    assert strong["grade"] in ("A+", "A", "B")   # strong inputs → high grade

    weak = score_ep({"news": [], "eps_surprise": None})   # no data anywhere
    assert weak["total_score"] < strong["total_score"]
