"""Position-sizing + plan-validation tests — the money path.

These guard trade_plans_router._compute_risk (size is derived from the stop, never
guessed) and the discipline gates (_validate_setup / _validate_levels). A silent
regression here directly changes real order sizes, so it's the highest-value code
in the app to pin down.
"""

import pytest
from fastapi import HTTPException

from trade_plans_router import _compute_risk, _validate_setup, _validate_levels


def test_size_is_derived_from_stop_distance():
    # $25k account @ 0.5% risk = $125 budget; entry 100, stop 95 → $5/sh → 25 sh.
    r = _compute_risk("long", 100.0, 95.0, 110.0, 25_000.0, 0.5)
    assert r["risk_per_share"] == 5.0
    assert r["dollar_budget"] == 125.0
    assert r["shares"] == 25
    assert r["dollar_risk"] == 125.0
    assert r["position_value"] == 2500.0
    assert r["rr_ratio"] == 2.0          # (110-100)/5
    assert r["pct_of_account"] == 10.0


def test_wider_stop_reduces_size():
    # Same budget, wider stop ($10/sh) → fewer shares. Risk drives size.
    r = _compute_risk("long", 100.0, 90.0, 130.0, 25_000.0, 0.5)
    assert r["shares"] == 12             # floor(125 / 10)
    assert r["rr_ratio"] == 3.0


def test_dollar_risk_never_exceeds_budget():
    # floor() must round the share count DOWN so realized risk ≤ budget.
    r = _compute_risk("long", 100.0, 97.3, 110.0, 25_000.0, 0.5)
    assert r["dollar_risk"] <= r["dollar_budget"] + 1e-9


def test_zero_or_inverted_risk_yields_no_position():
    r = _compute_risk("long", 100.0, 100.0, 110.0, 25_000.0, 0.5)
    assert r["shares"] == 0
    assert r["dollar_risk"] == 0.0
    assert r["rr_ratio"] is None         # can't compute R:R with no risk


def test_short_side_uses_absolute_distance():
    # Short: entry 100, stop 105 → $5/sh → 25 sh; target 90 → R:R 2.
    r = _compute_risk("short", 100.0, 105.0, 90.0, 25_000.0, 0.5)
    assert r["shares"] == 25
    assert r["rr_ratio"] == 2.0


@pytest.mark.parametrize("bad", ["", "   ", "Random", "random idea", "YOLO", "fomo trade", "n/a", "none"])
def test_non_playbook_setups_are_rejected(bad):
    # The core behavioral gate — "Random" and friends are the documented leak.
    with pytest.raises(HTTPException) as exc:
        _validate_setup(bad)
    assert exc.value.status_code == 422


def test_real_setup_is_accepted_and_trimmed():
    assert _validate_setup("  HTF breakout ") == "HTF breakout"


def test_long_levels_must_be_correctly_sided():
    _validate_levels("long", 100, 95, 110)  # valid — no raise
    with pytest.raises(HTTPException):
        _validate_levels("long", 100, 101, 110)   # stop above entry
    with pytest.raises(HTTPException):
        _validate_levels("long", 100, 95, 99)      # target below entry


def test_short_levels_must_be_correctly_sided():
    _validate_levels("short", 100, 105, 90)  # valid — no raise
    with pytest.raises(HTTPException):
        _validate_levels("short", 100, 99, 90)     # stop below entry
    with pytest.raises(HTTPException):
        _validate_levels("short", 100, 105, 101)   # target above entry


def test_levels_reject_nonpositive_prices():
    with pytest.raises(HTTPException):
        _validate_levels("long", 100, -1, 110)
