"""Parabolic-short scanner — the pure streak/score helpers plus an end-to-end
run() over a synthetic breadth panel exercising every hard gate and the cap-tier
(price-proxy) logic. No network / no real cache: the breadth.cache functions the
module imports are monkeypatched with a hand-built panel.
"""

from datetime import date, timedelta

import numpy as np
import pandas as pd

from scanners import parabolic
from scanners.parabolic import _up_streak, _score, _is_probable_split


# ── Pure helpers ────────────────────────────────────────────────────────────

def test_up_streak_counts_trailing_higher_closes():
    # flat base, then 4 strictly-rising closes → streak of 4 (the flat→ramp step
    # counts, the equal base days stop it).
    closes = np.array([30.0, 30.0, 30.0, 36.0, 42.0, 47.0, 51.0])
    assert _up_streak(closes) == 4


def test_up_streak_stops_on_a_down_close():
    closes = np.array([10.0, 12.0, 14.0, 16.0, 15.0])  # last bar is down
    assert _up_streak(closes) == 0


def test_up_streak_handles_nan_gap():
    closes = np.array([np.nan, 5.0, 6.0, 7.0])
    assert _up_streak(closes) == 2


def test_score_rewards_bigger_stretch():
    # More run-up, more extension, longer streak, both tells → strictly higher.
    small = _score(gain=60.0, ext=25.0, up_days=3, extended=True, accelerating=False)
    big = _score(gain=200.0, ext=80.0, up_days=5, extended=True, accelerating=True)
    assert big > small


def test_is_probable_split_flags_jump_on_collapsed_volume():
    # A 1-for-10 reverse split: +900% one day, share volume collapses that day.
    rets = np.array([1.0, -2.0, 900.0, 0.5, 1.2])
    vols = np.array([1_000_000, 1_100_000, 90_000, 950_000, 1_050_000])
    assert _is_probable_split(rets, vols) is True


def test_is_probable_split_keeps_real_gap_on_volume_surge():
    # A genuine +150% news gap comes with a volume SURGE → not a split.
    rets = np.array([2.0, 1.0, 150.0, 5.0, 3.0])
    vols = np.array([500_000, 600_000, 8_000_000, 4_000_000, 2_000_000])
    assert _is_probable_split(rets, vols) is False


def test_is_probable_split_ignores_modest_moves():
    rets = np.array([5.0, 12.0, 40.0, 8.0])       # nothing above the split threshold
    vols = np.array([100_000, 90_000, 80_000, 95_000])
    assert _is_probable_split(rets, vols) is False


# ── Synthetic-panel end-to-end ──────────────────────────────────────────────

def _path(base: float, ramp: list[float], n: int) -> list[float]:
    """A flat base held for n-len(ramp) sessions, then the ramp closes appended."""
    flat = n - len(ramp)
    return [base] * flat + list(ramp)


def _build_panel(specs: dict[str, dict], n: int = 25):
    """Assemble (days, per-day DataFrame) from per-symbol close paths + volume.

    Each spec is either {base, ramp, volume} (flat base then a ramp) or an
    explicit {closes, vols} pair of length n. Derives a simple OHLC around each
    close (high=+2%, low=-2%, open=prior close).
    """
    days = [date(2026, 1, 1) + timedelta(days=j) for j in range(n)]
    closes = {
        sym: (list(s["closes"]) if "closes" in s else _path(s["base"], s["ramp"], n))
        for sym, s in specs.items()
    }
    frames: dict[date, pd.DataFrame] = {}
    for j, d in enumerate(days):
        rows = {}
        for sym, s in specs.items():
            c = closes[sym][j]
            prev = closes[sym][j - 1] if j > 0 else c
            vol = s["vols"][j] if "vols" in s else s["volume"]
            rows[sym] = {
                "open": prev,
                "high": c * 1.02,
                "low": c * 0.98,
                "close": c,
                "volume": float(vol),
            }
        frames[d] = pd.DataFrame.from_dict(rows, orient="index")
    return days, frames


# BIG   : large-cap proxy (>$20), ~73% run-up, 4 up days, liquid            → PASS large
# TINY  : small-cap proxy (<$20), ~155% run-up, 4 up days, liquid           → PASS small
# MILD  : large-cap proxy, only ~33% run-up (< 50 large bar)                → FAIL gain
# SMLMLD: small-cap proxy, ~53% run-up (≥ large bar but < 100 small bar)    → FAIL gain (tier)
# CHOP  : large-cap proxy, big run-up but last close is DOWN                → FAIL streak
# THIN  : large-cap proxy, big run-up + streak, but dollar-vol < $3M        → FAIL liquidity
_SPECS = {
    "BIG":    {"base": 30.0, "ramp": [36.0, 42.0, 47.0, 51.0], "volume": 500_000},
    "TINY":   {"base": 2.0,  "ramp": [2.8, 3.6, 4.3, 5.0],     "volume": 2_000_000},
    "MILD":   {"base": 40.0, "ramp": [43.0, 47.0, 50.0, 52.0], "volume": 500_000},
    "SMLMLD": {"base": 3.0,  "ramp": [3.4, 3.9, 4.5],          "volume": 2_000_000},
    "CHOP":   {"base": 30.0, "ramp": [40.0, 48.0, 52.0, 49.0], "volume": 500_000},
    "THIN":   {"base": 25.0, "ramp": [30.0, 36.0, 41.0, 45.0], "volume": 10_000},
}


def _patch(monkeypatch, days, frames):
    monkeypatch.setattr(parabolic, "list_cached_days", lambda: days)
    monkeypatch.setattr(parabolic, "load_cached_day", lambda d: frames.get(d))


def test_run_selects_only_valid_parabolics(monkeypatch):
    days, frames = _build_panel(_SPECS)
    _patch(monkeypatch, days, frames)

    out = parabolic.run()
    syms = {c["symbol"] for c in out["candidates"]}
    assert syms == {"BIG", "TINY"}

    assert out["counts"]["universe"] == len(_SPECS)
    assert out["counts"]["passed_liquidity"] == 5      # everyone except THIN
    assert out["counts"]["passed_all"] == 2


def test_run_assigns_cap_tier_by_price_proxy(monkeypatch):
    days, frames = _build_panel(_SPECS)
    _patch(monkeypatch, days, frames)

    out = parabolic.run()
    by_sym = {c["symbol"]: c for c in out["candidates"]}
    assert by_sym["BIG"]["cap_tier"] == "large"
    assert by_sym["BIG"]["required_gain_pct"] == 50
    assert by_sym["TINY"]["cap_tier"] == "small"
    assert by_sym["TINY"]["required_gain_pct"] == 100
    # up-day streak surfaced and correct.
    assert by_sym["BIG"]["up_days"] == 4
    # short stop sits above the close (today's high).
    assert by_sym["BIG"]["stop"] > by_sym["BIG"]["close"]


def test_small_cap_below_its_higher_bar_is_rejected(monkeypatch):
    # SMLMLD clears the 50% large bar but not the 100% small bar → excluded, which
    # is the whole point of tiering by size.
    days, frames = _build_panel(_SPECS)
    _patch(monkeypatch, days, frames)
    out = parabolic.run()
    assert "SMLMLD" not in {c["symbol"] for c in out["candidates"]}


def test_require_extended_soft_gate_can_only_shrink_results(monkeypatch):
    days, frames = _build_panel(_SPECS)
    _patch(monkeypatch, days, frames)
    base = {c["symbol"] for c in parabolic.run()["candidates"]}
    gated = {c["symbol"] for c in parabolic.run(require_extended=True)["candidates"]}
    assert gated <= base


def test_run_filters_reverse_split_artifacts(monkeypatch):
    # SPLIT: flat ~$4 for 21 sessions, then a 1-for-10-style jump to ~$40 on
    # collapsed volume, then 3 up days. Its raw gain is ~1000% but it's a split
    # artifact — must be dropped and counted, not shown as a parabola.
    n = 25
    closes = [4.0] * 21 + [40.0, 41.5, 43.0, 44.5]
    vols = [1_000_000] * 21 + [80_000, 1_000_000, 1_000_000, 1_000_000]
    specs = {
        "GOOD": {"base": 30.0, "ramp": [36.0, 42.0, 47.0, 51.0], "volume": 500_000},
        "SPLIT": {"closes": closes, "vols": vols},
    }
    days, frames = _build_panel(specs, n=n)
    _patch(monkeypatch, days, frames)

    out = parabolic.run()
    syms = {c["symbol"] for c in out["candidates"]}
    assert "GOOD" in syms
    assert "SPLIT" not in syms
    assert out["counts"]["split_filtered"] >= 1


def test_empty_cache_returns_error(monkeypatch):
    monkeypatch.setattr(parabolic, "list_cached_days", lambda: [])
    monkeypatch.setattr(parabolic, "load_cached_day", lambda d: None)
    out = parabolic.run()
    assert out["candidates"] == []
    assert "error" in out
