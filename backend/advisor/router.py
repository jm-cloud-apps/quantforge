import threading
from datetime import datetime

from fastapi import APIRouter, HTTPException

from .screener import (
    CACHE_TTL,
    _progress,
    _progress_lock,
    _results_cache,
    get_history,
    run_screening_job,
)

router = APIRouter(prefix="/api/advisor", tags=["advisor"])

_screening_thread: threading.Thread | None = None

VALID_PERSONAS = {"qullamaggie", "adam_khoo"}


@router.get("/progress")
def get_progress():
    with _progress_lock:
        return dict(_progress)


@router.get("/screen/{persona}")
def start_or_get_screening(persona: str, force: bool = False):
    global _screening_thread

    if persona not in VALID_PERSONAS:
        raise HTTPException(status_code=400, detail=f"Unknown persona '{persona}'. Use 'qullamaggie' or 'adam_khoo'.")

    if not force:
        cached = _results_cache.get(persona)
        if cached and cached["data"] and cached["timestamp"]:
            age = (datetime.now() - cached["timestamp"]).total_seconds()
            if age < CACHE_TTL:
                return {**cached["data"], "from_cache": True, "cache_age_minutes": round(age / 60)}

    with _progress_lock:
        if _progress["status"] == "running":
            return {"status": "running", "progress": dict(_progress)}

    _screening_thread = threading.Thread(
        target=run_screening_job,
        args=(persona,),
        daemon=True,
    )
    _screening_thread.start()

    return {"status": "running", "progress": dict(_progress)}


@router.get("/screen/{persona}/result")
def get_cached_result(persona: str):
    if persona not in VALID_PERSONAS:
        raise HTTPException(status_code=400, detail=f"Unknown persona '{persona}'.")

    cached = _results_cache.get(persona)
    if cached and cached["data"]:
        return cached["data"]
    raise HTTPException(status_code=404, detail="No results available yet. Call /screen/{persona} first.")


@router.get("/history/{persona}")
def get_persona_history(persona: str):
    if persona not in VALID_PERSONAS:
        raise HTTPException(status_code=400, detail=f"Unknown persona '{persona}'.")
    return {"persona": persona, "records": get_history(persona)}
