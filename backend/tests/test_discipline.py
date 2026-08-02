"""Pure-logic tests for the discipline analytics (backend/discipline.py).

Synthetic plans/trades only — no workbook, no network, no breadth cache. The
matching rules and the classification boundaries are the whole product here, so
they're pinned tightly: a silent change to what counts as "followed the plan"
would make the compliance number meaningless without failing anything else.
"""

from datetime import date, timedelta

import pandas as pd
import pytest

import discipline


# --- Fixtures ---------------------------------------------------------------

def _plan(**kw):
    base = {
        "id": "p1", "symbol": "AAPL", "direction": "long", "setup": "HTF - Long Base Break",
        "entry": 100.0, "stop": 95.0, "target": 115.0, "shares": 100,
        "created_at": "2026-03-02T09:00:00", "status": "planned",
    }
    base.update(kw)
    return base


def _trade(**kw):
    base = {
        "symbol": "AAPL", "side": "LONG", "entry_price": 100.0, "quantity": 100,
        "entry_date": "2026-03-02T00:00:00", "exit_date": "2026-03-12T00:00:00",
        "exit_price": 110.0, "pnl": 1000.0, "duration_days": 10, "setup": "HTF - Long Base Break",
    }
    base.update(kw)
    return base


# --- Setup families ---------------------------------------------------------

@pytest.mark.parametrize("label,expected", [
    ("HTF - Long Base Break", "HTF"),
    ("EP - Earnings Gap Up", "EP"),
    ("NA - Random", "RANDOM"),
    ("NA - Mean Reversion / Oversold", "RANDOM"),
    ("", "UNTAGGED"),
    (None, "UNTAGGED"),
])
def test_setup_family(label, expected):
    assert discipline.setup_family(label) == expected


# --- Reconciliation ---------------------------------------------------------

def test_clean_fill_is_classified_planned():
    out = discipline.reconcile([_plan()], [_trade()])
    assert out["summary"]["compliance_pct"] == 100.0
    assert out["rows"][0]["classification"] == "planned"
    assert out["rows"][0]["deviations"] == []


def test_trade_without_a_plan_is_unplanned():
    out = discipline.reconcile([], [_trade(setup="NA - Random")])
    assert out["summary"]["compliance_pct"] == 0.0
    assert out["rows"][0]["classification"] == "unplanned"
    assert out["unplanned_by_family"]["RANDOM"]["n"] == 1


def test_fill_outside_the_match_window_does_not_claim_the_plan():
    late = _trade(entry_date="2026-03-20T00:00:00")
    out = discipline.reconcile([_plan()], [late])
    assert out["rows"][0]["classification"] == "unplanned"
    assert out["summary"]["plans_unexecuted"] == 1


def test_direction_mismatch_does_not_match():
    short_trade = _trade(side="SHORT")
    out = discipline.reconcile([_plan(direction="long")], [short_trade])
    assert out["rows"][0]["classification"] == "unplanned"


def test_one_plan_cannot_be_claimed_by_two_fills():
    t1 = _trade(entry_date="2026-03-02T00:00:00")
    t2 = _trade(entry_date="2026-03-03T00:00:00")
    out = discipline.reconcile([_plan()], [t1, t2])
    classes = sorted(r["classification"] for r in out["rows"])
    assert classes == ["planned", "unplanned"]


def test_chased_entry_is_a_deviation():
    out = discipline.reconcile([_plan()], [_trade(entry_price=104.0)])
    row = out["rows"][0]
    assert row["classification"] == "deviated"
    assert any("chased" in d for d in row["deviations"])


def test_entry_drift_within_tolerance_is_still_planned():
    # 1.5% is inside ENTRY_DRIFT_PCT (2%) — a fill, not a different trade.
    out = discipline.reconcile([_plan()], [_trade(entry_price=101.5)])
    assert out["rows"][0]["classification"] == "planned"


def test_oversize_is_a_deviation():
    out = discipline.reconcile([_plan(shares=100)], [_trade(quantity=200)])
    row = out["rows"][0]
    assert row["classification"] == "deviated"
    assert any("×" in d for d in row["deviations"])


def test_exiting_below_the_stop_flags_the_stop_as_not_honoured():
    # Long planned with a 95 stop but exited at 88 — the position was still on
    # at a price the plan said to be out of.
    out = discipline.reconcile([_plan()], [_trade(exit_price=88.0, pnl=-1200.0)])
    assert any("held past" in d for d in out["rows"][0]["deviations"])


def test_short_stop_breach_uses_the_opposite_side():
    plan = _plan(direction="short", entry=100.0, stop=105.0, target=90.0)
    trade = _trade(side="SHORT", exit_price=112.0, pnl=-1200.0)
    assert any("held past" in d for d in discipline.reconcile([plan], [trade])["rows"][0]["deviations"])


def test_cutting_before_the_planned_hold_is_a_deviation():
    out = discipline.reconcile([_plan(min_hold_days=5)], [_trade(duration_days=1)])
    assert any("exited day 1" in d for d in out["rows"][0]["deviations"])


def test_deviation_reasons_are_tallied_by_cost():
    plans = [_plan(id="p1"), _plan(id="p2", symbol="MSFT")]
    trades = [
        _trade(entry_price=104.0, pnl=-500.0),
        _trade(symbol="MSFT", entry_price=104.0, pnl=-300.0),
    ]
    tally = discipline.reconcile(plans, trades)["deviation_reasons"]
    assert tally[0]["kind"] == "chased entry"
    assert tally[0]["n"] == 2
    assert tally[0]["pnl"] == -800.0


def test_taken_plans_are_not_reported_as_unexecuted():
    out = discipline.reconcile([_plan(status="taken", created_at="2026-01-01T09:00:00")], [])
    assert out["summary"]["plans_unexecuted"] == 0


# --- Hold time --------------------------------------------------------------

def test_hold_buckets_partition_by_duration():
    trades = [
        _trade(duration_days=0, pnl=-100.0),
        _trade(duration_days=2, pnl=-50.0),
        _trade(duration_days=12, pnl=900.0),
    ]
    buckets = {b["label"]: b for b in discipline.hold_time_report(trades)["buckets"]}
    assert buckets["0d — same day"]["n"] == 1
    assert buckets["2-3d"]["n"] == 1
    assert buckets["9d+"]["pnl"] == 900.0


def _bars(prices_by_day):
    """{date: DataFrame} shaped like the breadth grouped cache."""
    return {
        d: pd.DataFrame(
            [{"open": p, "high": p * 1.02, "low": p * 0.98, "close": p, "volume": 1e6}],
            index=pd.Index(["AAPL"], name="ticker"),
        )
        for d, p in prices_by_day.items()
    }


def test_post_exit_uses_the_close_not_the_high_for_the_headline():
    exit_day = date(2026, 3, 12)
    bars = _bars({exit_day + timedelta(days=i): 110.0 + i for i in range(1, 6)})
    out = discipline.post_exit_excursion([_trade()], bars, sessions=5)

    row = out["worst"][0]
    # Last close is 115 vs a 110 exit -> +4.55%; the *high* is higher still and
    # must not be what the dollar figure is built from.
    assert row["held_pct"] == pytest.approx(4.55, abs=0.01)
    assert row["max_pct"] > row["held_pct"]
    assert out["net_if_held"] == pytest.approx(500.0, abs=1.0)


def test_post_exit_counts_a_correct_exit_as_saved():
    exit_day = date(2026, 3, 12)
    bars = _bars({exit_day + timedelta(days=i): 110.0 - i * 2 for i in range(1, 6)})
    out = discipline.post_exit_excursion([_trade()], bars, sessions=5)
    assert out["exits_justified"] == 1
    assert out["exits_too_early"] == 0
    assert out["net_if_held"] < 0


def test_post_exit_drops_split_artefacts():
    # The grouped cache is unadjusted: a reverse split reads as a >90% move and
    # would otherwise dominate the total.
    exit_day = date(2026, 3, 12)
    bars = _bars({exit_day + timedelta(days=1): 1100.0})
    out = discipline.post_exit_excursion([_trade()], bars, sessions=5)
    assert out["analyzed"] == 0


def test_hold_verdict_names_the_selection_confound():
    exit_day = date(2026, 3, 12)
    bars = _bars({exit_day + timedelta(days=i): 108.0 for i in range(1, 6)})
    report = discipline.hold_time_report([_trade()], bars, post_exit_sessions=5)
    verdict = report["verdict"]
    assert verdict["supported"] is False
    assert "confounded" in verdict["detail"]


# --- Setup decay ------------------------------------------------------------

def _series(setup, pnls, start=date(2026, 1, 1)):
    return [
        _trade(setup=setup, pnl=p, exit_date=(start + timedelta(days=i)).isoformat())
        for i, p in enumerate(pnls)
    ]


def test_a_losing_recent_window_is_dead():
    out = discipline.setup_decay(_series("NA - Random", [-100.0] * 12), window=12, min_trades=6)
    entry = out["setups"][0]
    assert entry["verdict"] == "dead"
    assert out["retire"] == ["NA - Random"]


def test_a_deteriorating_setup_is_decaying():
    # Prior 6: 83% win, +950. Recent 6: 33% win, -120. Both measures fall, but
    # the recent win rate stays above the "dead" floor — so this is decay, which
    # is the distinction the two verdicts exist to draw.
    prior = [200.0] * 5 + [-50.0]
    recent = [100.0, 100.0, -80.0, -80.0, -80.0, -80.0]
    out = discipline.setup_decay(_series("HTF - Channel", prior + recent), window=6, min_trades=6)
    assert out["setups"][0]["verdict"] == "decaying"


def test_a_thin_sample_is_not_judged():
    out = discipline.setup_decay(_series("EP - Thematic / Macro", [-100.0] * 3),
                                 window=12, min_trades=6)
    entry = out["setups"][0]
    assert entry["verdict"] == "thin"
    assert entry["setup"] not in out["retire"]


def test_a_winning_setup_is_healthy():
    out = discipline.setup_decay(_series("EP - Earnings Gap Up", [150.0] * 8),
                                 window=8, min_trades=6)
    assert out["setups"][0]["verdict"] == "healthy"


# --- Circuit breaker --------------------------------------------------------

def test_breaker_is_blocked_without_a_plan_today():
    out = discipline.circuit_breaker([], [], today=date(2026, 3, 10))
    assert out["clear"] is False
    assert "No plan logged today" in out["reason"]


def test_breaker_clears_once_a_plan_exists_today():
    plan = _plan(created_at="2026-03-10T09:15:00")
    out = discipline.circuit_breaker([plan], [], today=date(2026, 3, 10))
    assert out["clear"] is True
    assert out["reason"] is None
    assert out["plan_symbols"] == ["AAPL"]


def test_yesterdays_plan_does_not_clear_today():
    plan = _plan(created_at="2026-03-09T09:15:00")
    assert discipline.circuit_breaker([plan], [], today=date(2026, 3, 10))["clear"] is False


def test_breaker_totals_month_to_date_unplanned_cost():
    trades = [
        _trade(setup="NA - Random", entry_date="2026-03-04T00:00:00", pnl=-300.0),
        _trade(setup="HTF - Channel", entry_date="2026-03-05T00:00:00", pnl=200.0),
        # Previous month — must not be counted.
        _trade(setup="NA - Random", entry_date="2026-02-25T00:00:00", pnl=-999.0),
    ]
    out = discipline.circuit_breaker([], trades, today=date(2026, 3, 10))
    assert out["mtd"]["unplanned"]["n"] == 1
    assert out["mtd"]["unplanned"]["pnl"] == -300.0
    assert out["mtd"]["planned"]["pnl"] == 200.0
