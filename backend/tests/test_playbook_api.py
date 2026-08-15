"""Playbook store — id minting and the write path.

The router had no tests at all. This covers the bug that prompted them: entry
ids are millisecond stamps and the store keys on them, so two writes inside the
same millisecond made the second overwrite the first, losing a saved setup and
its screenshot with no error anywhere.

Uses httpx's ASGI transport rather than starlette's TestClient, which raises on
construction here (starlette 0.35 passes `app=` to httpx, removed in 0.28).
"""

import asyncio
from datetime import datetime as real_dt

import httpx
import pytest
from fastapi import FastAPI

import playbook_router


class _Client:
    def __init__(self, app):
        self._app = app

    def request(self, method, url, **kw):
        async def go():
            transport = httpx.ASGITransport(app=self._app)
            async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
                return await c.request(method, url, **kw)
        return asyncio.run(go())

    def get(self, url, **kw):
        return self.request("GET", url, **kw)

    def post(self, url, **kw):
        return self.request("POST", url, **kw)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(playbook_router, "PLAYBOOK_PATH", str(tmp_path / "playbook.json"))
    monkeypatch.setattr(playbook_router, "PLAYBOOK_SCREENSHOTS_DIR", str(tmp_path / "shots"))
    app = FastAPI()
    app.include_router(playbook_router.router)
    return _Client(app)


@pytest.fixture
def frozen_clock(monkeypatch):
    """Every call to now() returns the same millisecond — the collision case."""
    stopped = real_dt(2026, 8, 3, 9, 30, 0, 0)

    class _Frozen(real_dt):
        @classmethod
        def now(cls, tz=None):
            return stopped

    monkeypatch.setattr(playbook_router, "dt", _Frozen)
    return stopped


def test_new_id_never_collides_with_an_existing_entry(frozen_clock):
    store: dict = {}
    for _ in range(5):
        new = playbook_router._new_id(store)
        assert new not in store, "id collided with an existing entry"
        store[new] = {}
    assert len(store) == 5


def test_two_saves_in_the_same_millisecond_both_survive(client, frozen_clock):
    for symbol in ("nvda", "amd"):
        r = client.post("/api/playbook/entries",
                        data={"symbol": symbol, "date": "2026-08-03", "setup": "HTF - Channel"})
        assert r.status_code == 200

    body = client.get("/api/playbook/entries").json()
    assert body["total"] == 2
    assert sorted(e["symbol"] for e in body["entries"]) == ["AMD", "NVDA"]


def test_create_normalizes_the_entry(client):
    e = client.post("/api/playbook/entries", data={
        "symbol": " nvda ", "date": "2026-08-03", "setup": "EP - Earnings Gap Up",
        "pnl": "1250.5", "tags": "ai, gap ,",
    }).json()["entry"]
    assert e["symbol"] == "NVDA"
    assert e["tags"] == ["ai", "gap"]
    assert e["pnl"] == 1250.5
    assert e["screenshot"] is None


def test_entries_come_back_newest_first(client):
    for day in ("2026-07-01", "2026-08-09", "2026-08-02"):
        client.post("/api/playbook/entries", data={"symbol": "x", "date": day})
    dates = [e["date"] for e in client.get("/api/playbook/entries").json()["entries"]]
    assert dates == ["2026-08-09", "2026-08-02", "2026-07-01"]
