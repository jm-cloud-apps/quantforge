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
                   "score_delta_5d": -7,
                   "drivers": [
                       {"label": "Leadership (Qtr ±25%)", "points": 9, "tone": "bull",
                        "detail": "410 up 25%+ this quarter vs 120 down — positive leadership"},
                       {"label": "10-day thrust", "points": -5, "tone": "bear",
                        "detail": "10-day 4% ratio 0.85 — soft"},
                       {"label": "Froth (Mo +50%)", "points": 0, "tone": "neutral", "detail": None},
                   ],
                   "explanation": {"summary": "Exposure scores 46/100 — the Selective band (45–59).",
                                   "baseline": 50, "bull_points": 9, "bear_points": 13,
                                   "to_up": {"level": "constructive", "label": "Constructive",
                                             "threshold": 60, "gain_needed": 14},
                                   "to_down": {"level": "defensive", "label": "Defensive",
                                               "threshold": 45, "drop_to": 45}},
                   "verdict": {"code": "defend", "label": "Defend — no new longs, stalk shorts only",
                               "tone": "warn", "new_long": "no", "new_short": "stalk",
                               "why": "Distribution is underway but the Shorts/Hedges light isn't green yet.",
                               "existing": "Trim laggards.", "avoid": False}},
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


def test_all_lanes_present_even_with_empty_sources():
    b = build_board({})
    assert [l["key"] for l in b["lanes"]] == [
        "ma-reclaim", "stage-analysis", "breakouts", "scanner-9m", "reversal-setup",
        "parabolic-short", "breakdown-short"]
    assert b["confluence"] == []
    assert b["conflicts"] == []
    assert b["regime"] is None


# ── direction awareness (added with the short lanes) ────────────────────────

def _short_sources(**over):
    """Base long sources plus the two short lanes."""
    src = _sources()
    src["parabolic"] = {"as_of": "2026-07-15", "candidates": [
        {"symbol": "PARA", "close": 40, "gain_pct": 120.0, "up_days": 4, "ext_pct": 33.0}]}
    src["breakdown"] = {"as_of": "2026-07-15", "candidates": [
        {"symbol": "PARA", "close": 40, "at_rail": True, "to_ma10_pct": 1.5,
         "slope20_per_week": -3.0, "days_below_50": 20},
        # not at a rail — already flushed, must be filtered out of the lane
        {"symbol": "FLUSHED", "close": 9, "at_rail": False, "to_ma10_pct": 26.0,
         "slope20_per_week": -6.0, "days_below_50": 40}]}
    src.update(over)
    return src


def test_short_lanes_are_present_and_tagged():
    b = build_board(_short_sources())
    by_key = {l["key"]: l for l in b["lanes"]}
    assert by_key["parabolic-short"]["direction"] == "short"
    assert by_key["breakdown-short"]["direction"] == "short"
    assert by_key["ma-reclaim"]["direction"] == "long"


def test_breakdown_lane_keeps_only_at_rail_names():
    b = build_board(_short_sources())
    lane = next(l for l in b["lanes"] if l["key"] == "breakdown-short")
    assert {i["symbol"] for i in lane["items"]} == {"PARA"}, "already-flushed names are squeeze risk"


def test_agreement_within_a_direction_is_confluence():
    b = build_board(_short_sources())
    para = next((c for c in b["confluence"] if c["symbol"] == "PARA"), None)
    assert para is not None and para["direction"] == "short"
    assert len(para["hits"]) == 2


def test_long_and_short_on_the_same_symbol_is_a_conflict_not_conviction():
    # SHARED already hits two LONG lanes; add it to a short lane too.
    src = _short_sources()
    src["parabolic"]["candidates"].append(
        {"symbol": "SHARED", "close": 10, "gain_pct": 90.0, "up_days": 3, "ext_pct": 25.0})
    b = build_board(src)

    assert "SHARED" not in {c["symbol"] for c in b["confluence"]}, \
        "a name both long and short must never read as high conviction"
    conflict = next(c for c in b["conflicts"] if c["symbol"] == "SHARED")
    assert conflict["long"] and conflict["short"]


def test_conflicts_is_empty_when_nothing_contradicts():
    assert build_board(_short_sources())["conflicts"] == []


def test_regime_carries_the_reasoning_not_just_the_verdict():
    """The board banner must be able to answer "why this stance?" — the driver
    ledger and the band edges ride along with the label."""
    reg = build_board(_sources())["regime"]

    # Only factors that actually moved the score; the 0-point one is noise.
    assert [d["label"] for d in reg["drivers"]] == ["Leadership (Qtr ±25%)", "10-day thrust"]
    assert reg["drivers"][0]["points"] == 9
    assert reg["drivers"][0]["detail"]

    ex = reg["explanation"]
    assert ex["baseline"] == 50 and ex["bullPoints"] == 9 and ex["bearPoints"] == 13
    # A stance is a band: both edges are reported so the page can say what flips it.
    assert ex["toUp"]["threshold"] == 60 and ex["toUp"]["gain_needed"] == 14
    assert ex["toDown"]["label"] == "Defensive"


def test_regime_without_an_explanation_still_renders():
    """Older/degraded situational payloads carry no explanation — the banner
    keeps its verdict rather than the whole board losing its regime block."""
    reg = build_board({"regime": {"as_of": "2026-07-14", "score": 46,
                                  "stance": {"level": "selective", "label": "Selective"}}})["regime"]
    assert reg["stance"]["label"] == "Selective"
    assert reg["drivers"] == []
    assert reg["explanation"] is None


def test_regime_carries_per_direction_permission_for_the_lane_books():
    """The board groups lanes long/short, so it gates them on `day_verdict`'s
    per-direction answer — never on the stance label, which doesn't distinguish
    "defensive" from "shorts are actually on"."""
    v = build_board(_sources())["regime"]["verdict"]
    assert v["newLong"] == "no"
    assert v["newShort"] == "stalk"     # defensive ≠ shorts in season
    assert v["code"] == "defend" and v["why"]


def test_regime_without_a_verdict_leaves_the_books_ungated():
    """No verdict → the page must fail open and show both books, so a degraded
    auxiliary read can never hide setups from a trader holding a position."""
    reg = build_board({"regime": {"as_of": "2026-07-14", "score": 46,
                                  "stance": {"level": "selective", "label": "Selective"}}})["regime"]
    assert reg["verdict"] is None
