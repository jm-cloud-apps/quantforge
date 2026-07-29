"""Breakdown-short scanner — the stage-4 gate and its entry-quality ranking.

Pure logic over a synthetic breadth panel (the cache functions are monkeypatched),
so no data files and no network. The properties worth protecting:

  * the stack must be INVERTED and DECLINING, not merely "price is under an MA";
  * a forward split must not read as the cleanest breakdown on the board;
  * ranking favours the rally back INTO a rail over the name that already flushed.
"""

from datetime import date, timedelta

import numpy as np
import pandas as pd

from scanners import breakdown
from scanners.breakdown import _is_probable_split, _score, _days_below


# ── forward-split guard ─────────────────────────────────────────────────────

def test_forward_split_is_flagged():
    # A clean 2-for-1: −50% in one session.
    assert _is_probable_split(np.array([1.0, -0.5, -50.0, 0.4, 1.1])) is True


def test_three_for_one_split_is_flagged():
    rets = np.array([0.5, -66.67, 1.0])      # 1/3 ratio
    assert _is_probable_split(rets) is True


def test_real_crash_is_not_flagged():
    # A brutal but non-ratio drop is a real breakdown, not a split.
    assert _is_probable_split(np.array([1.0, -37.0, -8.0])) is False
    assert _is_probable_split(np.array([1.0, -57.3, -8.0])) is False


def test_ordinary_weakness_is_not_flagged():
    assert _is_probable_split(np.array([-2.0, -3.5, -1.0, -4.0])) is False


# ── ranking: entries beat decliners ─────────────────────────────────────────

def test_at_rail_outranks_already_flushed():
    at_rail = _score(at_rail=True, extended=False, below_200=True, s20=-2.0, s50=-1.0, d10=1.0)
    flushed = _score(at_rail=False, extended=True, below_200=True, s20=-4.0, s50=-3.0, d10=25.0)
    assert at_rail > flushed


def test_nearer_the_rail_scores_higher():
    near = _score(at_rail=False, extended=False, below_200=False, s20=-1.0, s50=-1.0, d10=5.0)
    far = _score(at_rail=False, extended=False, below_200=False, s20=-1.0, s50=-1.0, d10=18.0)
    assert near > far


def test_days_below_counts_the_trailing_run():
    # Steadily declining closes — every recent bar sits under its own trailing SMA.
    closes = np.linspace(100, 60, 60)
    assert _days_below(closes, 50) > 0


# ── end-to-end over a synthetic panel ───────────────────────────────────────

def _panel(specs: dict[str, list[float]], vol=2_000_000):
    n = len(next(iter(specs.values())))
    days = [date(2026, 1, 1) + timedelta(days=j) for j in range(n)]
    frames = {}
    for j, d in enumerate(days):
        rows = {}
        for sym, closes in specs.items():
            c = closes[j]
            prev = closes[j - 1] if j else c
            rows[sym] = {"open": prev, "high": c * 1.02, "low": c * 0.98,
                         "close": c, "volume": float(vol)}
        frames[d] = pd.DataFrame.from_dict(rows, orient="index")
    return days, frames


def _patch(monkeypatch, days, frames):
    monkeypatch.setattr(breakdown, "list_cached_days", lambda: days)
    monkeypatch.setattr(breakdown, "load_cached_day", lambda d: frames.get(d))


N = 90
# DOWN  : steady markdown — below an inverted, declining stack.
# UPTR  : steady uptrend — rails stacked the right way up, must never appear.
# DIPUP : uptrend with a shallow dip at the end; price may slip under the 10 but
#         the 50 is still RISING, so it must be rejected (the key discriminator).
_DOWN = list(np.linspace(100, 55, N))
_UPTR = list(np.linspace(55, 100, N))
_DIPUP = list(np.linspace(55, 100, N - 5)) + [97, 95, 93, 92, 91]


def test_only_the_declining_inverted_stack_qualifies(monkeypatch):
    days, frames = _panel({"DOWN": _DOWN, "UPTR": _UPTR, "DIPUP": _DIPUP})
    _patch(monkeypatch, days, frames)
    out = breakdown.run()
    syms = {c["symbol"] for c in out["candidates"]}
    assert "DOWN" in syms
    assert "UPTR" not in syms
    assert "DIPUP" not in syms, "a dip under a RISING 50 is not a breakdown"


def test_qualifying_name_reports_inverted_declining_rails(monkeypatch):
    days, frames = _panel({"DOWN": _DOWN})
    _patch(monkeypatch, days, frames)
    c = breakdown.run()["candidates"][0]
    assert c["close"] < c["ma10"] < c["ma20"] < c["ma50"]     # inverted stack
    assert c["slope20_per_week"] < 0 and c["slope50_per_week"] < 0
    assert c["stop"] > c["close"]                              # short stop sits above
    assert c["risk_pct"] > 0


def test_soft_gates_only_shrink_results(monkeypatch):
    days, frames = _panel({"DOWN": _DOWN})
    _patch(monkeypatch, days, frames)
    base = {c["symbol"] for c in breakdown.run()["candidates"]}
    for gate in ({"require_at_rail": True}, {"require_below_200": True}):
        assert {c["symbol"] for c in breakdown.run(**gate)["candidates"]} <= base


def test_liquidity_floor_excludes_thin_names(monkeypatch):
    days, frames = _panel({"DOWN": _DOWN}, vol=100)   # ~$5.5k/day
    _patch(monkeypatch, days, frames)
    out = breakdown.run()
    assert out["candidates"] == []
    assert out["counts"]["passed_liquidity"] == 0


def test_empty_cache_returns_error(monkeypatch):
    monkeypatch.setattr(breakdown, "list_cached_days", lambda: [])
    monkeypatch.setattr(breakdown, "load_cached_day", lambda d: None)
    out = breakdown.run()
    assert out["candidates"] == [] and "error" in out
