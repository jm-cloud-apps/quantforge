"""Turn watch — inflection detection and the divergence model.

Pure logic over synthetic index frames and score series. The properties that
matter: a follow-through day requires BOTH a decisive gain and heavier volume
(the volume half is what separates a real turn from short covering), and the
divergence model must distinguish a shallow pullback inside an uptrend from a
broken market — the case the old single-SPY boolean got wrong.
"""

import pandas as pd

from breadth.turn import (
    follow_through, index_divergence, FTD_MIN_GAIN_PCT, FTD_MIN_DAY,
)


def _frame(closes, vols=None):
    vols = vols or [1_000_000] * len(closes)
    return pd.DataFrame({"close": closes, "volume": vols})


def _rally(gain_pct, vol_mult, day=FTD_MIN_DAY):
    """A decline to a low, a drift up, then one candidate day on `day`."""
    closes = [100 - i for i in range(12)]          # decline to the low
    vols = [1_000_000] * len(closes)
    for k in range(1, day):                        # quiet drift off the low
        closes.append(closes[-1] * 1.001)
        vols.append(900_000)
    closes.append(closes[-1] * (1 + gain_pct / 100.0))   # the candidate day
    vols.append(int(900_000 * vol_mult))
    return _frame(closes, vols)


# ── follow-through day ──────────────────────────────────────────────────────

def test_ftd_requires_gain_and_heavier_volume():
    r = follow_through(_rally(gain_pct=FTD_MIN_GAIN_PCT + 0.5, vol_mult=1.4))
    assert r["found"] is True
    assert r["day"] >= FTD_MIN_DAY
    assert r["vol_ratio"] > 1.0


def test_big_gain_on_lighter_volume_is_not_a_follow_through():
    # The whole point: a quiet bounce is short covering, not institutions.
    r = follow_through(_rally(gain_pct=FTD_MIN_GAIN_PCT + 2.0, vol_mult=0.7))
    assert r["found"] is False


def test_heavy_volume_without_a_decisive_gain_is_not_a_follow_through():
    r = follow_through(_rally(gain_pct=0.2, vol_mult=2.0))
    assert r["found"] is False


def test_a_bounce_too_soon_after_the_low_does_not_count():
    # Day 1-3 off a low proves nothing; the window starts at FTD_MIN_DAY.
    r = follow_through(_rally(gain_pct=3.0, vol_mult=2.0, day=2))
    assert r["found"] is False


def test_short_frame_returns_none():
    assert follow_through(_frame([100, 101])) is None


# ── divergence model ────────────────────────────────────────────────────────

def _ix(sym, trend, rising50, off_high=-0.02):
    return {"symbol": sym, "available": True, "trend": trend,
            "sma50_rising": rising50, "pct_from_high": off_high}


def test_strong_breadth_with_indices_rolling_is_a_warning():
    d = index_divergence(70, [_ix("SPY", "down", False), _ix("QQQ", "down", False), _ix("IWM", "up", True)])
    assert d["tone"] == "warn" and "confirming" in d["label"].lower()


def test_weak_breadth_with_indices_holding_flags_a_narrow_tape():
    d = index_divergence(30, [_ix("SPY", "up", True), _ix("QQQ", "up", True), _ix("IWM", "down", False)])
    assert d["tone"] == "warn" and "megacap" in d["label"].lower()


def test_shallow_pullback_in_an_intact_uptrend_is_not_read_as_broken():
    # Every index under its 20/50 but the 50-days still RISING — the case the
    # old single-SPY rule reported as "no divergence" and left unexplained.
    d = index_divergence(24, [_ix("SPY", "down", True), _ix("QQQ", "down", True), _ix("IWM", "down", True)])
    assert d is not None
    assert d["tone"] == "good"
    assert "intact" in d["label"].lower() or "intact" in d["text"].lower()


def test_split_50d_slopes_flag_leadership_rotation():
    d = index_divergence(50, [_ix("SPY", "down", True), _ix("QQQ", "down", False), _ix("IWM", "down", True)])
    assert d["label"].lower().startswith("leadership")
    assert "QQQ" in d["text"]


def test_no_indices_or_no_score_returns_none():
    assert index_divergence(None, [_ix("SPY", "up", True)]) is None
    assert index_divergence(50, []) is None
