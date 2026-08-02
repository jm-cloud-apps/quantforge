"""Pre-trade discipline gate — a trade *plan* must exist before the fill.

The per-trade review sidecar (review_notes_router) keys on the executed
fill price + quantity, so it can only describe a trade *after* it happens.
This store is the opposite: it captures the plan *before* entry — setup,
stop, target — and computes position size off the stop (risk drives size).

It operationalizes the user's own rules from tradingRules.js:
  - "Always know your stop before you enter. No stop, no trade."
  - "Position size off the stop, not the conviction. Risk drives size."
  - "Risk 0.25-1% of account per trade. Never more, no exceptions."

A plan cannot be saved without a real setup (blank / "random" is rejected),
a stop on the correct side of entry, and a target — so the act of logging a
plan forces the discipline. Size, dollar risk, and reward:risk are derived
server-side and stored on the plan.

Storage: backend/data/trade_plans.json  ({config, plans: {id: plan}}).
"""

from __future__ import annotations

import json
import math
import os
import threading
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/trade-plans", tags=["trade-plans"])

STORE_PATH = os.path.join(os.path.dirname(__file__), "data", "trade_plans.json")
_lock = threading.Lock()

# Defaults used until the user sets their own on the config panel.
_DEFAULT_CONFIG = {"account_size": 25000.0, "risk_pct": 0.5}

# Setups that are definitionally *not* a plan. Mirrors the Playbook taxonomy,
# which only sanctions HTF/EP families — everything else is a probe with no edge.
_BANNED_SETUP_TOKENS = ("random", "na -", "n/a", "none", "yolo", "fomo")

_VALID_STATUSES = ("planned", "taken", "skipped")


# --- Store I/O --------------------------------------------------------------

def _load() -> dict:
    if not os.path.exists(STORE_PATH):
        return {"version": 1, "config": dict(_DEFAULT_CONFIG), "plans": {}}
    try:
        with open(STORE_PATH, "r") as f:
            data = json.load(f) or {}
    except Exception:
        data = {}
    data.setdefault("version", 1)
    data.setdefault("plans", {})
    cfg = {**_DEFAULT_CONFIG, **(data.get("config") or {})}
    data["config"] = cfg
    return data


def _save(data: dict) -> None:
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    tmp = STORE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, STORE_PATH)


# --- Risk math (the whole point) -------------------------------------------

def _compute_risk(direction: str, entry: float, stop: float, target: Optional[float],
                  account_size: float, risk_pct: float) -> dict:
    """Position size off the stop. Everything derived, nothing guessed."""
    risk_per_share = abs(entry - stop)
    dollar_budget = account_size * (risk_pct / 100.0)
    shares = int(math.floor(dollar_budget / risk_per_share)) if risk_per_share > 0 else 0
    shares = max(shares, 0)
    position_value = round(shares * entry, 2)
    dollar_risk = round(shares * risk_per_share, 2)
    rr = None
    if target is not None and risk_per_share > 0:
        rr = round(abs(target - entry) / risk_per_share, 2)
    return {
        "risk_per_share": round(risk_per_share, 4),
        "dollar_budget": round(dollar_budget, 2),
        "shares": shares,
        "position_value": position_value,
        "dollar_risk": dollar_risk,
        "rr_ratio": rr,
        "pct_of_account": round(position_value / account_size * 100, 2) if account_size > 0 else None,
    }


def _validate_setup(setup: Optional[str]) -> str:
    s = (setup or "").strip()
    if not s:
        raise HTTPException(status_code=422, detail="No setup — no trade. Pick a real setup from your playbook.")
    low = s.lower()
    if any(tok in low for tok in _BANNED_SETUP_TOKENS):
        raise HTTPException(
            status_code=422,
            detail=f'"{s}" is not a playbook setup. This is the leak — if it is not a planned HTF/EP setup, do not take it.',
        )
    return s


def _validate_levels(direction: str, entry: float, stop: float, target: float) -> None:
    if entry <= 0 or stop <= 0 or target <= 0:
        raise HTTPException(status_code=422, detail="Entry, stop, and target must all be positive prices.")
    if direction == "long":
        if stop >= entry:
            raise HTTPException(status_code=422, detail="Long stop must be BELOW entry (that is where you're wrong).")
        if target <= entry:
            raise HTTPException(status_code=422, detail="Long target must be ABOVE entry.")
    else:  # short
        if stop <= entry:
            raise HTTPException(status_code=422, detail="Short stop must be ABOVE entry (that is where you're wrong).")
        if target >= entry:
            raise HTTPException(status_code=422, detail="Short target must be BELOW entry.")


# --- API models -------------------------------------------------------------

class ConfigPayload(BaseModel):
    account_size: float = Field(..., gt=0)
    risk_pct: float = Field(..., gt=0, le=5)


class PlanPayload(BaseModel):
    symbol: str
    setup: str
    direction: str = "long"  # long | short
    entry: float
    stop: float
    target: float
    conviction: Optional[float] = None  # 1-5, optional
    regime: Optional[str] = None        # regime label at plan time, if known
    # Minimum intended holding period. Swing edges are horizon-dependent — a
    # setup that needs a week to work cannot be judged on day one — so the plan
    # commits to a floor, and `discipline._deviations` flags exits taken before
    # it as a departure from the plan rather than a neutral outcome.
    min_hold_days: Optional[int] = Field(None, ge=0, le=90)
    # Today's day-verdict code (breadth.situational.day_verdict) at plan time,
    # and whether the trader logged this plan against that read. Recorded so the
    # cost of overrides is measurable later instead of anecdotal — "what did my
    # no-trade-day trades actually return?" is answerable only if we store it.
    verdict_code: Optional[str] = None
    override: bool = False
    notes: Optional[str] = None
    # Optional per-plan overrides; fall back to saved config.
    account_size: Optional[float] = None
    risk_pct: Optional[float] = None


class StatusPayload(BaseModel):
    status: str  # planned | taken | skipped


# --- Config endpoints -------------------------------------------------------

@router.get("/config")
def get_config() -> dict:
    with _lock:
        return _load()["config"]


@router.put("/config")
def put_config(payload: ConfigPayload) -> dict:
    with _lock:
        data = _load()
        data["config"] = {"account_size": payload.account_size, "risk_pct": payload.risk_pct}
        _save(data)
        return data["config"]


# --- Plan endpoints ---------------------------------------------------------

@router.get("")
def list_plans(status: Optional[str] = Query(None), date: Optional[str] = Query(None)) -> dict:
    with _lock:
        data = _load()
    plans = list((data.get("plans") or {}).values())
    if status:
        plans = [p for p in plans if p.get("status") == status]
    if date:
        plans = [p for p in plans if (p.get("created_at") or "").startswith(date)]
    plans.sort(key=lambda p: p.get("created_at") or "", reverse=True)
    return {"plans": plans, "count": len(plans), "config": data["config"]}


@router.post("")
def create_plan(payload: PlanPayload) -> dict:
    symbol = (payload.symbol or "").upper().strip()
    if not symbol:
        raise HTTPException(status_code=422, detail="Symbol is required.")
    direction = (payload.direction or "long").lower()
    if direction not in ("long", "short"):
        raise HTTPException(status_code=422, detail="Direction must be 'long' or 'short'.")

    setup = _validate_setup(payload.setup)
    _validate_levels(direction, payload.entry, payload.stop, payload.target)

    with _lock:
        data = _load()
        cfg = data["config"]
        account_size = payload.account_size if payload.account_size and payload.account_size > 0 else cfg["account_size"]
        risk_pct = payload.risk_pct if payload.risk_pct and payload.risk_pct > 0 else cfg["risk_pct"]

        risk = _compute_risk(direction, payload.entry, payload.stop, payload.target, account_size, risk_pct)
        if risk["shares"] <= 0:
            raise HTTPException(status_code=422, detail="Computed size is 0 — stop is too wide for your risk budget. Tighten the stop or raise risk %.")

        now = datetime.now().isoformat(timespec="seconds")
        plan_id = uuid.uuid4().hex[:12]
        plan = {
            "id": plan_id,
            "symbol": symbol,
            "setup": setup,
            "direction": direction,
            "entry": payload.entry,
            "stop": payload.stop,
            "target": payload.target,
            "conviction": payload.conviction,
            "min_hold_days": payload.min_hold_days,
            "regime": payload.regime,
            "verdict_code": payload.verdict_code,
            "override": bool(payload.override),
            "notes": payload.notes,
            "account_size": account_size,
            "risk_pct": risk_pct,
            **risk,
            "status": "planned",
            "created_at": now,
            "updated_at": now,
        }
        data["plans"][plan_id] = plan
        _save(data)
        return plan


@router.patch("/{plan_id}")
def update_status(plan_id: str, payload: StatusPayload) -> dict:
    status = (payload.status or "").lower()
    if status not in _VALID_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {list(_VALID_STATUSES)}")
    with _lock:
        data = _load()
        plan = (data.get("plans") or {}).get(plan_id)
        if not plan:
            raise HTTPException(status_code=404, detail="plan not found")
        plan["status"] = status
        plan["updated_at"] = datetime.now().isoformat(timespec="seconds")
        _save(data)
        return plan


@router.delete("/{plan_id}")
def delete_plan(plan_id: str) -> dict:
    with _lock:
        data = _load()
        plans = data.get("plans") or {}
        if plan_id not in plans:
            raise HTTPException(status_code=404, detail="plan not found")
        del plans[plan_id]
        _save(data)
    return {"deleted": plan_id}
