"""Day-verdict logic — the "what do I do today?" branch table.

Pure decision logic over (score, stance level, setup lights, breadth row): no
data files, no network. The properties worth protecting here are the two that
aren't intuitive:

  * a weak long tape is NOT a short signal — shorts need their own green;
  * short risk is non-monotonic — the washed-out floor must never say "short".
"""

from breadth.situational import day_verdict, CHOP_RATIO_LO, CHOP_RATIO_HI


def _setups(**lights):
    """Build the setups list the verdict reads (key → light)."""
    return [{"key": k, "light": v} for k, v in lights.items()]


def _row(ratio=1.0, **kw):
    return {"ratio_10d": ratio, **kw}


# ── the washed-out floor: never initiate shorts here ────────────────────────

def test_washed_out_never_says_short_even_with_short_green():
    # The short family can legitimately read green on breadth at the lows —
    # this is exactly the trap the band is meant to prevent.
    v = day_verdict(15, "cash", _setups(short="green", breakout="red"), _row(0.4))
    assert v["code"] == "washed_out"
    assert v["new_short"] == "no"
    assert v["new_long"] == "no"
    assert v["avoid"] is True


def test_washed_out_explains_the_squeeze_risk():
    v = day_verdict(10, "cash", _setups(short="green"), _row(0.35))
    assert "bounce" in v["why"].lower() or "capitulation" in v["why"].lower()


# ── the real short window ───────────────────────────────────────────────────

def test_defensive_with_short_green_is_the_short_window():
    v = day_verdict(38, "defensive", _setups(short="green", breakout="red"), _row(0.6))
    assert v["code"] == "short_on"
    assert v["new_short"] == "yes"
    assert v["new_long"] == "no"


def test_defensive_without_short_green_only_stalks():
    # A weak long tape alone must never authorise new shorts.
    v = day_verdict(38, "defensive", _setups(short="amber", breakout="red"), _row(0.9))
    assert v["code"] == "defend"
    assert v["new_short"] == "stalk"
    assert v["new_long"] == "no"


# ── chop ────────────────────────────────────────────────────────────────────

def test_no_thrust_and_nothing_green_is_a_stand_down_day():
    v = day_verdict(52, "selective", _setups(breakout="amber", short="red"), _row(1.05))
    assert v["code"] == "chop"
    assert v["avoid"] is True
    assert v["new_long"] == "no" and v["new_short"] == "no"


def test_chop_bounds_are_inclusive():
    for ratio in (CHOP_RATIO_LO, CHOP_RATIO_HI):
        v = day_verdict(50, "selective", _setups(breakout="amber"), _row(ratio))
        assert v["code"] == "chop", ratio


def test_selective_with_a_green_family_still_trades_a_plus():
    v = day_verdict(52, "selective", _setups(breakout="amber", pullback="green"), _row(1.05))
    assert v["code"] == "selective_long"
    assert v["new_long"] == "selective"


# ── risk-on ─────────────────────────────────────────────────────────────────

def test_aggressive_with_breakouts_green_presses():
    v = day_verdict(82, "aggressive", _setups(breakout="green"), _row(1.9))
    assert v["code"] == "press_long"
    assert v["new_long"] == "yes"
    assert v["new_short"] == "no"


def test_constructive_hunts_at_normal_size():
    v = day_verdict(65, "constructive", _setups(breakout="green"), _row(1.5))
    assert v["code"] == "hunt_long"
    assert v["new_long"] == "yes"


# ── invariants across every branch ──────────────────────────────────────────

def test_no_branch_ever_authorises_long_and_short_together():
    cases = [
        (15, "cash", _setups(short="green")),
        (38, "defensive", _setups(short="green")),
        (38, "defensive", _setups(short="amber")),
        (52, "selective", _setups(breakout="amber")),
        (52, "selective", _setups(pullback="green")),
        (65, "constructive", _setups(breakout="green")),
        (82, "aggressive", _setups(breakout="green")),
        (78, "aggressive", _setups(breakout="amber")),
    ]
    for score, level, setups in cases:
        v = day_verdict(score, level, setups, _row(1.0))
        assert not (v["new_long"] == "yes" and v["new_short"] == "yes"), v["code"]


def test_every_branch_answers_both_axes():
    cases = [
        (15, "cash", _setups(short="green")),
        (38, "defensive", _setups(short="green")),
        (38, "defensive", _setups()),
        (52, "selective", _setups(breakout="amber")),
        (52, "selective", _setups(pullback="green")),
        (65, "constructive", _setups()),
        (82, "aggressive", _setups(breakout="green")),
        (78, "aggressive", _setups()),
    ]
    for score, level, setups in cases:
        v = day_verdict(score, level, setups, _row(1.0))
        assert v["new_long"] in {"yes", "selective", "no"}
        assert v["new_short"] in {"yes", "stalk", "no"}
        assert v["existing"] and v["why"] and v["label"]
        assert v["tone"] in {"good", "info", "warn", "bad", "neutral"}


def test_shorts_are_only_ever_authorised_by_the_short_light():
    # Sweep every level with the short family NOT green — nothing may return yes.
    for level, score in (("cash", 15), ("defensive", 38), ("selective", 52),
                         ("constructive", 65), ("aggressive", 82)):
        for light in ("red", "amber", None):
            setups = _setups(**({"short": light} if light else {}))
            v = day_verdict(score, level, setups, _row(0.9))
            assert v["new_short"] != "yes", (level, light)


def test_missing_ratio_does_not_crash():
    v = day_verdict(52, "selective", _setups(breakout="amber"), {"ratio_10d": None})
    assert v["label"] and v["new_long"] in {"yes", "selective", "no"}
