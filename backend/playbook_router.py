"""Playbook endpoints (extracted from main.py) — 5-star trade examples with
screenshots, persisted to data/playbook.json (+ data/playbook_screenshots/).
Upload-size and path-traversal guards come from security.py. main.py registers
this via app.include_router.
"""

import json
import os
import threading
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from security import _enforce_upload_limit, _safe_within

router = APIRouter()


# Playbook — 5-star trade examples
# ──────────────────────────────────────────────────────────────────────

PLAYBOOK_PATH = os.getenv("PLAYBOOK_PATH", os.path.join(os.path.dirname(__file__), "data", "playbook.json"))
PLAYBOOK_SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), "data", "playbook_screenshots")
_playbook_lock = threading.Lock()


def _load_playbook() -> dict:
    with _playbook_lock:
        if os.path.exists(PLAYBOOK_PATH):
            with open(PLAYBOOK_PATH, "r") as f:
                return json.load(f)
        return {"entries": {}}


def _save_playbook(data: dict):
    with _playbook_lock:
        os.makedirs(os.path.dirname(PLAYBOOK_PATH), exist_ok=True)
        with open(PLAYBOOK_PATH, "w") as f:
            json.dump(data, f, indent=2)


@router.get("/api/playbook/entries")
def list_playbook_entries():
    playbook = _load_playbook()
    entries = list(playbook["entries"].values())
    entries.sort(key=lambda e: e.get("date", ""), reverse=True)
    return {"entries": entries, "total": len(entries)}


@router.post("/api/playbook/entries")
async def create_playbook_entry(
    symbol: str = Form(...),
    date: str = Form(...),
    setup: str = Form(""),
    pnl: float = Form(0),
    pnl_pct: float = Form(0),
    notes: str = Form(""),
    tags: str = Form(""),
    screenshot: Optional[UploadFile] = File(None),
):
    from datetime import datetime as dt

    entry_id = str(int(dt.now().timestamp() * 1000))
    screenshot_filename = None

    if screenshot and screenshot.filename:
        os.makedirs(PLAYBOOK_SCREENSHOTS_DIR, exist_ok=True)
        ext = os.path.splitext(screenshot.filename)[1] or ".png"
        screenshot_filename = f"{entry_id}{ext}"
        filepath = os.path.join(PLAYBOOK_SCREENSHOTS_DIR, screenshot_filename)
        contents = await screenshot.read()
        _enforce_upload_limit(contents, "Screenshot")
        with open(filepath, "wb") as f:
            f.write(contents)

    entry = {
        "id": entry_id,
        "symbol": symbol.upper().strip(),
        "date": date,
        "setup": setup,
        "pnl": pnl,
        "pnl_pct": pnl_pct,
        "notes": notes,
        "tags": [t.strip() for t in tags.split(",") if t.strip()] if tags else [],
        "screenshot": screenshot_filename,
        "created_at": dt.now().isoformat(),
    }

    playbook = _load_playbook()
    playbook["entries"][entry_id] = entry
    _save_playbook(playbook)

    return {"status": "created", "entry": entry}


@router.patch("/api/playbook/entries/{entry_id}")
async def update_playbook_entry(
    entry_id: str,
    symbol: str = Form(...),
    date: str = Form(...),
    setup: str = Form(""),
    pnl: float = Form(0),
    pnl_pct: float = Form(0),
    notes: str = Form(""),
    tags: str = Form(""),
    screenshot: Optional[UploadFile] = File(None),
    remove_screenshot: str = Form(""),
):
    playbook = _load_playbook()
    if entry_id not in playbook["entries"]:
        raise HTTPException(status_code=404, detail="Playbook entry not found")

    entry = playbook["entries"][entry_id]

    if remove_screenshot == "1" and entry.get("screenshot"):
        old_path = os.path.join(PLAYBOOK_SCREENSHOTS_DIR, entry["screenshot"])
        if os.path.exists(old_path):
            os.remove(old_path)
        entry["screenshot"] = None

    if screenshot and screenshot.filename:
        if entry.get("screenshot"):
            old_path = os.path.join(PLAYBOOK_SCREENSHOTS_DIR, entry["screenshot"])
            if os.path.exists(old_path):
                os.remove(old_path)
        os.makedirs(PLAYBOOK_SCREENSHOTS_DIR, exist_ok=True)
        ext = os.path.splitext(screenshot.filename)[1] or ".png"
        screenshot_filename = f"{entry_id}{ext}"
        filepath = os.path.join(PLAYBOOK_SCREENSHOTS_DIR, screenshot_filename)
        contents = await screenshot.read()
        _enforce_upload_limit(contents, "Screenshot")
        with open(filepath, "wb") as f:
            f.write(contents)
        entry["screenshot"] = screenshot_filename

    entry["symbol"] = symbol.upper().strip()
    entry["date"] = date
    entry["setup"] = setup
    entry["pnl"] = pnl
    entry["pnl_pct"] = pnl_pct
    entry["notes"] = notes
    entry["tags"] = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    playbook["entries"][entry_id] = entry
    _save_playbook(playbook)

    return {"status": "updated", "entry": entry}


@router.delete("/api/playbook/entries/{entry_id}")
def delete_playbook_entry(entry_id: str):
    playbook = _load_playbook()
    if entry_id not in playbook["entries"]:
        raise HTTPException(status_code=404, detail="Playbook entry not found")

    entry = playbook["entries"][entry_id]
    if entry.get("screenshot"):
        filepath = os.path.join(PLAYBOOK_SCREENSHOTS_DIR, entry["screenshot"])
        if os.path.exists(filepath):
            os.remove(filepath)

    del playbook["entries"][entry_id]
    _save_playbook(playbook)
    return {"status": "deleted", "id": entry_id}


@router.get("/api/playbook/screenshots/{filename}")
def get_playbook_screenshot(filename: str):
    filepath = _safe_within(PLAYBOOK_SCREENSHOTS_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(filepath)
