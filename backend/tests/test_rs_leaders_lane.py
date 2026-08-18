"""The RS-leadership lane: sustained relative strength, not the biggest move.

Why the lane exists: the 6M/3M/1M scans rank by raw return, and over any window
the top 25 by percentage are low-priced violent names. A heavy liquid leader
compounding against the market never appears. SNDK sat at RS rank 99-100 for
eight months while it went from $219 to $2,100 and was in none of the three
lists, because +9% over a month doesn't compete with +171%.

These are pure-math tests over synthetic panels — no cache, no network.
"""

import numpy as np
import pytest

from scanners import rs_leaders as RL


def _panel(n_symbols=40, n_days=220, seed=7):
    """A benchmark plus a spread of symbols, some leading and some lagging."""
    rng = np.random.default_rng(seed)
    spy = 100 * np.cumprod(1 + rng.normal(0.0003, 0.008, n_days))
    closes = np.empty((n_symbols, n_days))
    for i in range(n_symbols):
        drift = 0.0035 if i < 5 else (0.0003 if i < 20 else -0.0010)
        closes[i] = 50 * np.cumprod(1 + rng.normal(drift, 0.02, n_days))
    return closes, spy


# --- rs_persistence ---------------------------------------------------------

def test_a_persistent_leader_scores_more_top_decile_days_than_a_laggard():
    closes, spy = _panel()
    out = RL.rs_persistence(closes, spy, ma_days=60, window=63)
    assert out is not None
    leaders = out["days_top"][:5]
    laggards = out["days_top"][20:]
    assert leaders.mean() > laggards.mean() + 10


def test_rank_is_a_cross_sectional_percentile():
    closes, spy = _panel()
    out = RL.rs_persistence(closes, spy, ma_days=60, window=63)
    rank = out["rank"][np.isfinite(out["rank"])]
    assert rank.min() >= 0 and rank.max() <= 100
    # A percentile over ~40 names should span most of the range.
    assert rank.max() - rank.min() > 50


def test_days_top_can_never_exceed_the_window():
    closes, spy = _panel()
    out = RL.rs_persistence(closes, spy, ma_days=60, window=63)
    assert out["window"] <= 63
    assert (out["days_top"] <= out["window"]).all()


def test_a_short_panel_is_refused_rather_than_approximated():
    closes, spy = _panel(n_days=30)
    assert RL.rs_persistence(closes, spy, ma_days=150) is None


def test_it_shortens_the_ma_when_the_cache_is_shallow_and_says_so():
    closes, spy = _panel(n_days=120)
    out = RL.rs_persistence(closes, spy, ma_days=150, window=30)
    assert out is not None
    assert out["ma_days"] < 150
    assert out["approx"] is True


def test_a_flat_benchmark_still_ranks_the_cross_section():
    closes, _ = _panel()
    spy = np.full(closes.shape[1], 100.0)
    out = RL.rs_persistence(closes, spy, ma_days=60, window=63)
    assert out is not None
    assert np.isfinite(out["rank"]).sum() > 0


def test_missing_bars_do_not_poison_the_ranking():
    closes, spy = _panel()
    closes[3, 10:20] = np.nan          # a listing gap
    out = RL.rs_persistence(closes, spy, ma_days=60, window=63)
    assert out is not None
    assert np.isfinite(out["rank"]).sum() >= closes.shape[0] - 1


# --- the ranking the lane applies ------------------------------------------

def test_the_score_blends_persistence_with_current_standing():
    """Sorting on days_top alone is what hid SNDK.

    With a hard cap, a lexicographic sort means any name at 63/63 outranks
    every name at 62/63 whatever its RS today — which selects for the least
    volatile leader rather than the strongest one.
    """
    w = RL.RS_PERSIST_WEIGHT

    def score(days_top, window, rs_rank):
        return w * (days_top / window * 100.0) + (1 - w) * rs_rank

    steady_but_weak = score(63, 63, 70)      # never wobbled, middling RS
    wobbled_but_strong = score(52, 63, 99)   # SNDK's shape

    assert wobbled_but_strong > steady_but_weak, (
        "a strong name that corrected should beat a permanently mediocre one"
    )
    # And persistence still carries the larger weight of the two.
    assert score(63, 63, 90) > score(30, 63, 100)


def test_the_qualifying_floor_is_about_a_month():
    assert RL.RS_MIN_DAYS_TOP >= 20
    assert RL.RS_TOP_PCT >= 90.0


# --- the drift guard --------------------------------------------------------

def test_the_mansfield_formula_matches_stage_analysis():
    """One RS definition, two surfaces.

    stage_analysis computes Mansfield RS as (ratio / ratio_ma - 1) * 100 where
    ratio is close/SPY. If this lane ever diverges, the Stage page and the Prep
    lane would report different relative strength for the same name on the same
    day, which is the drift CLAUDE.md warns about for the exposure score.
    """
    closes, spy = _panel(n_symbols=12, n_days=200)
    ma = 60
    out = RL.rs_persistence(closes, spy, ma_days=ma, window=20)

    ratio = closes / spy
    expected = (ratio[:, -1] / ratio[:, -ma:].mean(axis=1) - 1.0) * 100.0

    np.testing.assert_allclose(out["mansfield"], expected, rtol=1e-9, atol=1e-9)


def test_stage_analysis_still_defines_rs_the_way_this_lane_assumes():
    """A canary on the source of truth, not a re-test of it."""
    import inspect

    from scanners import stage_analysis as SA

    src = inspect.getsource(SA._compute_features)
    assert "rs_mansfield = (ratio_now / ratio_ma - 1.0) * 100.0" in src, (
        "stage_analysis changed its RS formula — update rs_leaders.rs_persistence to match"
    )


@pytest.mark.parametrize("bad", [np.zeros(5), np.full(5, np.nan)])
def test_a_useless_benchmark_returns_none_rather_than_garbage(bad):
    closes = np.ones((3, 5)) * 10
    assert RL.rs_persistence(closes, bad, ma_days=150) is None


# --- stage_analysis leaders lane -------------------------------------------
# The Stage page's per-stage cap plus a turn-first sort is what hid SNDK there:
# classified Stage 2 at RS 99-100 the whole way from $219 to $2,100, visible in
# the returned table on 27 of 177 replayed sessions. The leaders lane is drawn
# before the cap so "who is leading" is always answerable.

def test_stage_leaders_lane_is_exempt_from_the_per_stage_cap():
    from scanners import stage_analysis as SA

    payload = SA.run(per_stage_limit=5)
    leaders = payload.get("leaders") or []
    if not leaders:
        import pytest as _pytest
        _pytest.skip("breadth cache not populated in this environment")

    shown = {c["symbol"] for c in payload["candidates"]}
    # With a cap of 5 per stage, most of the top-RS names cannot be in the table.
    assert len(leaders) > len([c for c in leaders if c["symbol"] in shown])


def test_stage_leaders_are_stage_2_ranked_by_rs():
    from scanners import stage_analysis as SA

    leaders = (SA.run().get("leaders") or [])
    if not leaders:
        import pytest as _pytest
        _pytest.skip("breadth cache not populated in this environment")

    assert all(c["stage"] == 2 for c in leaders)
    ranks = [c["rs_rank"] for c in leaders]
    assert ranks == sorted(ranks, reverse=True)
    assert len(leaders) <= SA.LEADERS_LIMIT


def test_stage_leaders_do_not_leak_internal_sort_fields():
    from scanners import stage_analysis as SA

    for c in (SA.run().get("leaders") or []):
        assert "_sort_bucket" not in c and "_score" not in c
