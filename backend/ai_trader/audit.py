"""Per-run audit trail for AI Trader.

A non-deterministic ranking can't be trusted as a track record, and a track
record you can't reconstruct can't be debugged. So every generation writes an
audit record: the inputs (budget, risk, ADR, model, temperature), the full
candidate set the model saw, and the raw model output. Kept as newline-delimited
JSON, capped to the most recent runs.
"""

import json
import logging
import os
import threading
from datetime import datetime

logger = logging.getLogger(__name__)

_AUDIT_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "ai_trader_audit.jsonl")
_MAX_RECORDS = 500
_LOCK = threading.Lock()


def record_run(*, inputs: dict, candidates: list, model_output, ideas: list,
               regime: dict | None = None) -> None:
    """Append one audit line. Best-effort — never raise into the request path."""
    try:
        rec = {
            "ts": datetime.now().isoformat(timespec="seconds"),
            "inputs": inputs,
            "regime_level": (regime or {}).get("level"),
            "candidate_tickers": [c.get("ticker") for c in candidates],
            "candidate_count": len(candidates),
            "model_output": model_output,
            "picked": [i.get("ticker") for i in ideas],
        }
        with _LOCK:
            os.makedirs(os.path.dirname(_AUDIT_FILE), exist_ok=True)
            lines = []
            if os.path.exists(_AUDIT_FILE):
                with open(_AUDIT_FILE) as f:
                    lines = f.readlines()
            lines.append(json.dumps(rec, default=str) + "\n")
            with open(_AUDIT_FILE, "w") as f:
                f.writelines(lines[-_MAX_RECORDS:])
    except Exception as e:
        logger.warning("ai_trader audit write failed: %s", e)
