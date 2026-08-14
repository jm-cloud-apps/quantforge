"""Missed Book HTTP contract — create / list / summary / patch / delete.

Offline and deterministic: the store and the screenshot directory are both
redirected into pytest's tmp_path, so this touches nothing under data/.
Complements test_missed.py, which covers the arithmetic on its own.
"""

import asyncio
import io

import httpx
import pytest
from fastapi import FastAPI

import missed_router

# Smallest valid PNG — 1×1, transparent.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4949484452000000010000000108060000001f15c489"
    "0000000a49444154789c6360000002000100ffff03000006000557bfabd400000000"
    "49454e44ae426082"
)


class _Client:
    """Minimal sync wrapper over httpx's ASGI transport.

    Deliberately not starlette's TestClient: starlette 0.35 hands `app=` to
    httpx.Client, which httpx 0.28 removed, so TestClient raises on
    construction in this environment. Going through ASGITransport keeps the
    real multipart form parsing in the loop — which is the whole point of this
    file, since the bug it exists to catch (a single-file upload rejected by a
    non-sequence `screenshots` field) only appears at that layer.
    """

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

    def patch(self, url, **kw):
        return self.request("PATCH", url, **kw)

    def delete(self, url, **kw):
        return self.request("DELETE", url, **kw)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(missed_router, "MISSED_PATH", str(tmp_path / "missed.json"))
    monkeypatch.setattr(missed_router, "MISSED_SCREENSHOTS_DIR", str(tmp_path / "shots"))
    app = FastAPI()
    app.include_router(missed_router.router)
    return _Client(app)


def _post(client, **overrides):
    body = {
        "symbol": "nvda", "date": "2026-08-03", "setup": "EP - Earnings Gap Up",
        "direction": "long", "verdict": "missed", "reason": "saw it, hesitated",
        "entry": "42.10", "stop": "41.40", "peak": "58.00", "exit_price": "52.00",
        "why_good": "12-month base, guide raised", "lesson": "wouldn't pay up", "tags": "ai, gap",
    }
    body.update(overrides)
    return client.post("/api/missed/entries", data=body)


def test_create_normalizes_and_prices_the_entry(client):
    e = _post(client).json()["entry"]
    assert e["symbol"] == "NVDA"           # upper-cased
    assert e["tags"] == ["ai", "gap"]      # split on commas
    assert e["r_best"] == pytest.approx(22.71, abs=0.01)   # 15.90 / 0.70
    assert e["r_real"] == pytest.approx(14.14, abs=0.01)   # 9.90 / 0.70
    assert e["pct_best"] == pytest.approx(37.77, abs=0.01)


def test_blank_prices_stay_none_rather_than_zero(client):
    e = _post(client, entry="", stop="", peak="", exit_price="").json()["entry"]
    assert e["entry"] is None and e["stop"] is None
    assert e["r_best"] is None and e["r_real"] is None


def test_unknown_verdict_falls_back_to_missed(client):
    assert _post(client, verdict="banana").json()["entry"]["verdict"] == "missed"


def test_list_is_newest_first_and_ships_the_vocabularies(client):
    _post(client, symbol="aaa", date="2026-08-01")
    _post(client, symbol="bbb", date="2026-08-09")
    body = client.get("/api/missed/entries").json()
    assert [e["symbol"] for e in body["entries"]] == ["BBB", "AAA"]
    assert body["verdicts"] == list(missed_router.VERDICTS)
    assert "correct" in body["reason_groups"]


def test_summary_separates_cost_from_correct_passes(client):
    _post(client, symbol="aaa")                                  # missed, priced
    _post(client, symbol="bbb", verdict="passed", reason="rules said no — correct pass")
    s = client.get("/api/missed/summary").json()
    assert s["missed"]["count"] == 1
    assert s["passed"]["count"] == 1
    assert s["missed"]["r_real_n"] == 1
    # The passed entry's R is nowhere in the cost totals.
    assert s["missed"]["r_real_sum"] == pytest.approx(14.14, abs=0.01)


def test_screenshot_round_trip_and_traversal_guard(client):
    e = _post(client).json()["entry"]
    # no files posted yet
    assert e["screenshots"] == []

    r = client.post(
        "/api/missed/entries",
        data={"symbol": "amd", "date": "2026-08-06", "verdict": "missed"},
        files=[("screenshots", ("chart.png", io.BytesIO(PNG), "image/png"))],
    )
    name = r.json()["entry"]["screenshots"][0]
    assert name.endswith(".png") and "chart" not in name  # server-generated name
    assert client.get(f"/api/missed/screenshots/{name}").status_code == 200
    assert client.get("/api/missed/screenshots/..%2F..%2Fmain.py").status_code in (400, 404)


def test_rejects_non_image_uploads(client):
    r = client.post(
        "/api/missed/entries",
        data={"symbol": "amd", "date": "2026-08-06", "verdict": "missed"},
        files=[("screenshots", ("payload.svg", io.BytesIO(b"<svg/>"), "image/svg+xml"))],
    )
    assert r.status_code == 400


def test_patch_reprices_and_can_move_an_entry_out_of_the_cost_bucket(client):
    entry_id = _post(client).json()["entry"]["id"]
    r = client.patch(f"/api/missed/entries/{entry_id}", data={
        "symbol": "NVDA", "date": "2026-08-03", "setup": "EP - Earnings Gap Up",
        "direction": "long", "verdict": "passed", "reason": "rules said no — correct pass",
        "entry": "42.10", "stop": "41.40", "peak": "58.00", "exit_price": "52.00",
    })
    assert r.status_code == 200 and r.json()["entry"]["verdict"] == "passed"
    s = client.get("/api/missed/summary").json()
    assert s["missed"]["count"] == 0
    assert s["missed"]["r_real_sum"] is None
    assert s["passed"]["count"] == 1


def test_delete_removes_the_entry_and_its_screenshot(client):
    r = client.post(
        "/api/missed/entries",
        data={"symbol": "amd", "date": "2026-08-06", "verdict": "missed"},
        files=[("screenshots", ("chart.png", io.BytesIO(PNG), "image/png"))],
    )
    entry = r.json()["entry"]
    name = entry["screenshots"][0]
    assert client.delete(f"/api/missed/entries/{entry['id']}").status_code == 200
    assert client.get("/api/missed/entries").json()["total"] == 0
    assert client.get(f"/api/missed/screenshots/{name}").status_code == 404


def test_missing_entry_is_404_not_500(client):
    assert client.delete("/api/missed/entries/nope").status_code == 404
    assert client.patch("/api/missed/entries/nope",
                        data={"symbol": "X", "date": "2026-08-06"}).status_code == 404
