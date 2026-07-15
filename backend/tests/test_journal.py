"""Trade Journal aggregation + search (now in journal_router). Exercised against a
temp journal file so no real data is touched.
"""

import journal_router as jr


def test_stats_aggregate_ratings_emotions_and_tags(tmp_path, monkeypatch):
    monkeypatch.setattr(jr, "JOURNAL_PATH", str(tmp_path / "journal.json"))
    jr._save_journal({"entries": {
        "T1": {"trade_id": "T1", "rating": 4, "emotion_entry": "calm", "tags": ["A", "B"]},
        "T2": {"trade_id": "T2", "rating": 2, "emotion_entry": "fomo", "tags": ["A"]},
        "T3": {"trade_id": "T3", "rating": 0, "emotion_entry": "", "tags": []},  # unrated
    }})
    stats = jr.get_journal_stats()
    assert stats["total"] == 3
    assert stats["rated_entries"] == 2            # rating > 0 only
    assert stats["avg_rating"] == 3.0             # (4 + 2) / 2, ignores the 0
    assert {t["tag"]: t["count"] for t in stats["top_tags"]} == {"A": 2, "B": 1}


def test_search_is_case_insensitive_and_empty_query_returns_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(jr, "JOURNAL_PATH", str(tmp_path / "journal.json"))
    jr._save_journal({"entries": {
        "T1": {"trade_id": "T1", "lessons_learned": "Held too long", "tags": []},
        "T2": {"trade_id": "T2", "lessons_learned": "clean entry", "tags": []},
    }})
    hits = jr.search_journal(q="HELD")
    assert [e["trade_id"] for e in hits["entries"]] == ["T1"]
    assert jr.search_journal(q="")["total"] == 0   # empty query is a no-op, not a dump
