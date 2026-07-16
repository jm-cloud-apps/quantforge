"""Setups Board aggregation — confluence detection, the Stage "actionable only"
filter, per-source resilience, and as_of normalization. Pure function over
synthetic scanner payloads (no I/O).
"""

from setups_board import build_board


def _sources():
    return {
        "ma_reclaim": {"as_of": "2026-07-15", "candidates": [
            {"symbol": "SHARED", "close": 10, "quality": 60, "reclaim_age": 1,
             "days_below": 30, "signal": "Fresh reclaim · MA turning"},
            {"symbol": "MAONLY", "close": 20, "quality": 50, "reclaim_age": 0,
             "days_below": 25, "signal": "Fresh reclaim"},
        ]},
        "stage": {"as_of": "2026-07-15", "candidates": [
            {"symbol": "SHARED", "close": 10, "quality": 55, "signal": "Stage 1→2 breakout",
             "rs_rank": 70, "pct_vs_ma": 2.0, "entering_stage2": True},
            {"symbol": "STAGEONLY", "close": 30, "quality": 40, "signal": "Stage 1 breakout-watch",
             "rs_rank": 60, "pct_vs_ma": -1.0, "breakout_watch": True},
            # Plain Stage-2 advancer — NOT a fresh transition, must be excluded.
            {"symbol": "IGNORED", "close": 5, "quality": 90, "signal": "Stage 2 advancing",
             "rs_rank": 80, "pct_vs_ma": 5.0},
        ]},
        "breakouts": {"error": "boom"},   # a source that failed to load
        "ep9m": {"as_of": "2026-07-15", "candidates": [
            {"symbol": "LGHL", "close": 5.7, "dcr_pct": 96.5, "expansion_mult": 49.0, "not_late": True}]},
        "reversal": {"as_of": "2026-07-15", "candidates": [
            {"symbol": "ARDX", "close": 5.1, "recovery_pct": 89.5, "tail_body_ratio": None}]},
        "regime": {"as_of": "2026-07-14", "score": 46,
                   "stance": {"level": "selective", "label": "Selective", "headline": "Be picky"},
                   "score_delta_5d": -7},
    }


def test_confluence_surfaces_only_multi_scanner_symbols():
    b = build_board(_sources())
    assert {c["symbol"] for c in b["confluence"]} == {"SHARED"}
    shared = b["confluence"][0]
    assert {h["label"] for h in shared["hits"]} == {"200 MA Reclaim", "Stage 1→2"}
    assert len(shared["hits"]) == 2


def test_stage_lane_keeps_only_actionable_transitions():
    b = build_board(_sources())
    stage = next(l for l in b["lanes"] if l["key"] == "stage-analysis")
    syms = {i["symbol"] for i in stage["items"]}
    assert {"SHARED", "STAGEONLY"} <= syms
    assert "IGNORED" not in syms          # plain Stage-2 advancer filtered out


def test_failed_source_becomes_error_lane_without_sinking_board():
    b = build_board(_sources())
    breakouts = next(l for l in b["lanes"] if l["key"] == "breakouts")
    assert breakouts["error"] == "boom"
    assert breakouts["items"] == []
    # The other four lanes still produced ideas.
    assert sum(l["count"] for l in b["lanes"] if l["key"] != "breakouts") > 0


def test_regime_passthrough_and_board_asof_is_latest():
    b = build_board(_sources())
    assert b["regime"]["stance"]["label"] == "Selective"
    assert b["regime"]["delta5d"] == -7
    assert b["asOf"] == "2026-07-15"       # max across lanes


def test_asof_is_normalized_to_calendar_date():
    b = build_board({"ma_reclaim": {"as_of": "2026-07-15T06:55:15", "candidates": []}})
    lane = next(l for l in b["lanes"] if l["key"] == "ma-reclaim")
    assert lane["asOf"] == "2026-07-15"    # datetime trimmed to date


def test_all_five_lanes_present_even_with_empty_sources():
    b = build_board({})
    assert [l["key"] for l in b["lanes"]] == [
        "ma-reclaim", "stage-analysis", "breakouts", "scanner-9m", "reversal-setup"]
    assert b["confluence"] == []
    assert b["regime"] is None
