"""Suggested misses — shortlist vs fills.

Pure: the price lookup is injected, so nothing here reads the cache or the disk.
"""

from datetime import date

from missed_suggest import shortlisted, suggest


def _session(day, *symbols, **candidate_extras):
    return {
        "date": day,
        "candidates": [{"symbol": s, **candidate_extras} for s in symbols],
    }


def _priced(ref=100.0, peak=130.0, trail=118.0, hit=True):
    """A forward() stub that prices every symbol the same way."""
    def _f(symbol, day):
        return {
            "ref_close": ref, "peak": peak, "peak_date": "2026-08-10",
            "trail_exit": trail, "trail_exit_date": "2026-08-12",
            "trail_hit": hit, "sessions_used": 12,
        }
    return _f


# --- shortlisted -------------------------------------------------------------

def test_shortlisted_keeps_the_earliest_appearance_of_each_symbol():
    sessions = [
        _session("2026-08-05", "AMD", setup_state="basing"),
        _session("2026-08-03", "AMD", setup_state="at_pivot"),
        _session("2026-08-07", "STX"),
    ]
    first = shortlisted(sessions)
    assert first["AMD"]["prep_date"] == date(2026, 8, 3)
    assert first["AMD"]["setup_state"] == "at_pivot"   # context from that night
    assert set(first) == {"AMD", "STX"}


def test_shortlisted_respects_the_since_cutoff_and_ignores_junk_rows():
    sessions = [
        _session("2026-06-01", "OLD"),
        _session("2026-08-03", "AMD", ""),
        {"date": "not-a-date", "candidates": [{"symbol": "BAD"}]},
        {"date": "2026-08-04"},                        # no candidates key
    ]
    first = shortlisted(sessions, since=date(2026, 8, 1))
    assert set(first) == {"AMD"}


# --- suggest -----------------------------------------------------------------

def test_a_shortlisted_name_you_never_traded_is_suggested():
    rows = suggest([_session("2026-08-03", "AMD")], [], [], _priced())
    assert len(rows) == 1
    assert rows[0]["symbol"] == "AMD"
    assert rows[0]["prep_date"] == "2026-08-03"
    assert rows[0]["pct_to_rail"] == 18.0     # 118 vs a 100 reference
    assert rows[0]["pct_to_peak"] == 30.0


def test_a_name_you_actually_traded_is_never_suggested():
    trades = [{"symbol": "AMD", "entry_date": "2026-08-06"}]
    assert suggest([_session("2026-08-03", "AMD")], trades, [], _priced()) == []


def test_a_trade_long_after_the_prep_date_does_not_launder_the_miss():
    trades = [{"symbol": "AMD", "entry_date": "2026-11-20"}]
    rows = suggest([_session("2026-08-03", "AMD")], trades, [], _priced())
    assert [r["symbol"] for r in rows] == ["AMD"]


def test_anything_already_in_the_book_is_suppressed_whatever_its_verdict():
    for verdict in ("missed", "passed", "unclear"):
        logged = [{"symbol": "AMD", "date": "2026-08-04", "verdict": verdict}]
        assert suggest([_session("2026-08-03", "AMD")], [], logged, _priced()) == [], verdict


def test_an_old_book_entry_does_not_suppress_a_fresh_shortlist():
    logged = [{"symbol": "AMD", "date": "2026-01-04", "verdict": "missed"}]
    rows = suggest([_session("2026-08-03", "AMD")], [], logged, _priced())
    assert [r["symbol"] for r in rows] == ["AMD"]


def test_a_move_under_the_threshold_is_not_a_miss():
    rows = suggest([_session("2026-08-03", "AMD")], [], [],
                   _priced(ref=100.0, peak=103.0, trail=101.0), min_move_pct=5.0)
    assert rows == []


def test_the_screen_is_the_peak_so_a_failed_first_trigger_still_surfaces():
    # The commonest shape of a real miss: it triggered, stopped you out, then
    # ran. Screening on rail capture scores this near zero and hides it — which
    # is exactly what happened on live data before the screen was changed.
    rows = suggest([_session("2026-08-03", "AMD")], [], [],
                   _priced(ref=100.0, peak=116.0, trail=96.0), min_move_pct=5.0)
    assert len(rows) == 1
    assert rows[0]["pct_to_peak"] == 16.0
    assert rows[0]["pct_to_rail"] == -4.0   # the failed attempt stays visible


def test_ranking_is_a_review_queue_biggest_move_first():
    sessions = [_session("2026-08-03", "AAA", "BBB")]

    def forward(symbol, day):
        if symbol == "AAA":
            return {"ref_close": 100, "peak": 200, "peak_date": "d", "trail_exit": 108,
                    "trail_exit_date": "d", "trail_hit": True, "sessions_used": 5}
        return {"ref_close": 100, "peak": 130, "peak_date": "d", "trail_exit": 125,
                "trail_exit_date": "d", "trail_hit": True, "sessions_used": 5}

    rows = suggest(sessions, [], [], forward)
    assert [r["symbol"] for r in rows] == ["AAA", "BBB"]


def test_unpriceable_names_are_dropped_rather_than_guessed():
    rows = suggest([_session("2026-08-03", "AMD", "STX")], [], [],
                   lambda s, d: None if s == "AMD" else _priced()(s, d))
    assert [r["symbol"] for r in rows] == ["STX"]


def test_a_priced_row_with_no_reference_close_is_dropped():
    rows = suggest([_session("2026-08-03", "AMD")], [], [],
                   lambda s, d: {"ref_close": None, "peak": 130, "trail_exit": 118})
    assert rows == []


def test_no_prep_sessions_means_no_suggestions():
    assert suggest([], [{"symbol": "AMD", "entry_date": "2026-08-06"}], [], _priced()) == []


def test_the_row_carries_the_context_needed_to_prefill_the_form():
    sessions = [_session("2026-08-03", "AMD", setup_state="at_pivot", note="base 1", adr_pct=6.2)]
    row = suggest(sessions, [], [], _priced())[0]
    assert row["setup_state"] == "at_pivot"
    assert row["note"] == "base 1"
    assert row["adr_pct"] == 6.2
    assert row["ref_close"] == 100.0
    assert row["trail_hit"] is True
