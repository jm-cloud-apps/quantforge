"""The attention ledger: which leaders you keep seeing and never trade.

Every scanner here measures the stock. This measures the gap between what the
scan surfaced and what got acted on — the signal that would have said "SNDK has
been on your list for forty sessions" while that was still worth hearing.

Pure: the ledger is a dict and the trades are a list, so none of this touches
disk or the cache.
"""

import prep_ledger as PL


def _ledger(days: dict) -> dict:
    return {"days": days}


def test_a_symbol_listed_on_many_sessions_accumulates_them():
    led = _ledger({
        "2026-01-05": {"RS": ["AAA", "BBB"]},
        "2026-01-06": {"RS": ["AAA"]},
        "2026-01-07": {"RS": ["AAA", "BBB"]},
    })
    att = PL.attention(led, [])
    assert att["AAA"]["sessions_listed"] == 3
    assert att["BBB"]["sessions_listed"] == 2
    assert att["AAA"]["first_listed"] == "2026-01-05"
    assert att["AAA"]["last_listed"] == "2026-01-07"


def test_appearing_in_several_lanes_on_one_day_counts_once():
    # Otherwise a confluence name would inflate its own attention score simply
    # by qualifying in more ways on the same session.
    led = _ledger({"2026-01-05": {"RS": ["AAA"], "6M": ["AAA"], "confluence": ["AAA"]}})
    assert PL.attention(led, [])["AAA"]["sessions_listed"] == 1


def test_lanes_are_recorded_so_you_can_see_why_it_qualified():
    led = _ledger({"2026-01-05": {"RS": ["AAA"], "6M": ["AAA"]},
                   "2026-01-06": {"1M": ["AAA"]}})
    assert PL.attention(led, [])["AAA"]["lanes"] == ["1M", "6M", "RS"]


def test_a_lane_filter_narrows_what_counts_as_listed():
    led = _ledger({"2026-01-05": {"RS": ["AAA"], "1M": ["BBB"]},
                   "2026-01-06": {"RS": ["AAA"], "1M": ["BBB"]}})
    att = PL.attention(led, [], lanes=["RS"])
    assert "AAA" in att and "BBB" not in att


# --- the join against the trade log ----------------------------------------

def test_a_trade_after_it_started_listing_counts_as_acted_on():
    led = _ledger({"2026-01-05": {"RS": ["AAA"]}, "2026-02-05": {"RS": ["AAA"]}})
    trades = [{"symbol": "AAA", "entry_date": "2026-01-20"}]
    rec = PL.attention(led, trades)["AAA"]
    assert rec["ever_traded"] is True
    assert rec["traded_since_listed"] is True


def test_an_older_position_does_not_count_as_acting_on_the_signal():
    """STX is the live case: traded months before it became a leader, then
    listed for 29 sessions without being touched — and logged in the Missed
    Book as 'not on the watchlist'."""
    led = _ledger({"2026-02-03": {"RS": ["STX"]}, "2026-03-03": {"RS": ["STX"]}})
    trades = [{"symbol": "STX", "entry_date": "2025-11-11"}]
    rec = PL.attention(led, trades)["STX"]
    assert rec["ever_traded"] is True
    assert rec["traded_since_listed"] is False


def test_ignored_leaders_needs_both_length_and_silence():
    led = _ledger({f"2026-01-{d:02d}": {"RS": ["LONG", "SHORTLY", "TRADED"]}
                   for d in range(1, 26)})
    # SHORTLY only appears on one session
    led["days"]["2026-01-01"]["RS"] = ["LONG", "SHORTLY", "TRADED"]
    for d in range(2, 26):
        led["days"][f"2026-01-{d:02d}"]["RS"] = ["LONG", "TRADED"]
    trades = [{"symbol": "TRADED", "entry_date": "2026-01-10"}]

    rows = PL.ignored_leaders(led, trades, long_listed=20)
    syms = [r["symbol"] for r in rows]
    assert "LONG" in syms            # long-listed and untouched
    assert "TRADED" not in syms      # long-listed but acted on
    assert "SHORTLY" not in syms     # untouched but barely listed


def test_ignored_leaders_ranks_the_longest_ignored_first():
    days = {}
    for d in range(1, 41):
        day = f"2026-01-{d:02d}" if d <= 31 else f"2026-02-{d-31:02d}"
        syms = ["OLDEST"] + (["NEWER"] if d > 15 else [])
        days[day] = {"RS": syms}
    rows = PL.ignored_leaders(_ledger(days), [], long_listed=5)
    assert [r["symbol"] for r in rows][:2] == ["OLDEST", "NEWER"]


def test_an_empty_ledger_or_no_trades_is_not_an_error():
    assert PL.attention({"days": {}}, []) == {}
    assert PL.ignored_leaders({"days": {}}, []) == []
    # No workbook → everything reads as never-traded, which over-reports rather
    # than silently hiding a name that was skipped.
    led = _ledger({f"2026-01-{d:02d}": {"RS": ["AAA"]} for d in range(1, 26)})
    assert [r["symbol"] for r in PL.ignored_leaders(led, [], long_listed=20)] == ["AAA"]


def test_symbols_are_normalised_and_bad_rows_ignored():
    led = _ledger({"2026-01-05": {"RS": ["aaa", " bbb "]}})
    att = PL.attention(led, [{"symbol": None, "entry_date": "x"},
                             {"symbol": "AAA", "entry_date": "not-a-date"}])
    assert "AAA" in att
    assert att["AAA"]["ever_traded"] is False     # unparseable date is not a trade


# --- payload shredding ------------------------------------------------------

def test_lanes_from_payload_picks_up_every_lane_including_confluence():
    payload = {
        "horizons": [
            {"key": "RS", "rows": [{"symbol": "AAA"}, {"symbol": "BBB"}]},
            {"key": "1M", "rows": [{"symbol": "CCC"}]},
        ],
        "confluence": [{"symbol": "AAA"}],
    }
    lanes = PL.lanes_from_payload(payload)
    assert lanes == {"RS": ["AAA", "BBB"], "1M": ["CCC"], "confluence": ["AAA"]}


def test_lanes_from_payload_survives_an_error_payload():
    assert PL.lanes_from_payload({"error": "cache empty"}) == {}


def test_record_is_idempotent_per_date(tmp_path):
    path = tmp_path / "ledger.json"
    PL.record("2026-01-05", {"RS": ["AAA"]}, path=path)
    PL.record("2026-01-05", {"RS": ["AAA", "BBB"]}, path=path)
    led = PL.load(path)
    assert list(led["days"]) == ["2026-01-05"]
    assert led["days"]["2026-01-05"]["RS"] == ["AAA", "BBB"]
    # re-running the scan on one day must not double-count that session
    assert PL.attention(led, [])["AAA"]["sessions_listed"] == 1
