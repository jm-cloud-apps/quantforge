"""Trading-tools endpoints (extracted from main.py): the position-size calculator
(fixed-% / Kelly / ATR) and the pre-trade checklist template CRUD. Self-contained;
main.py registers this via app.include_router.
"""

import json
import os
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


# ─── Trading Tools ────────────────────────────────────────────────────────────

class PositionSizeRequest(BaseModel):
    account_size: float
    risk_per_trade_pct: float
    entry_price: float
    stop_loss_price: float
    method: str = "fixed_pct"
    win_rate: float = 0
    avg_win: float = 0
    avg_loss: float = 0
    atr_value: float = 0
    atr_multiplier: float = 2.0


@router.post("/api/tools/position-size")
def calculate_position_size(request: PositionSizeRequest):
    """Calculate position size using Fixed %, Kelly Criterion, or ATR-based method."""
    try:
        account = request.account_size
        risk_pct = request.risk_per_trade_pct
        entry = request.entry_price
        stop = request.stop_loss_price

        risk_amount = account * risk_pct / 100
        risk_per_share = abs(entry - stop)

        if risk_per_share <= 0:
            raise HTTPException(status_code=400, detail="Entry and stop loss cannot be the same price")

        result = {
            "method": request.method,
            "account_size": account,
            "risk_amount": round(risk_amount, 2),
            "risk_per_share": round(risk_per_share, 2),
            "stop_loss_distance_pct": round(risk_per_share / entry * 100, 2),
        }

        if request.method == "fixed_pct":
            shares = int(risk_amount / risk_per_share)
            position_value = shares * entry
            result.update({
                "shares": shares,
                "position_value": round(position_value, 2),
                "position_pct_of_account": round(position_value / account * 100, 1),
            })

        elif request.method == "kelly":
            wr = request.win_rate / 100 if request.win_rate > 1 else request.win_rate
            avg_w = abs(request.avg_win)
            avg_l = abs(request.avg_loss) if request.avg_loss != 0 else 1

            win_loss_ratio = avg_w / avg_l if avg_l > 0 else 0
            kelly = (wr * win_loss_ratio - (1 - wr)) / win_loss_ratio if win_loss_ratio > 0 else 0
            kelly = max(0, min(kelly, 1))
            half_kelly = kelly / 2

            kelly_risk = account * kelly
            half_kelly_risk = account * half_kelly
            shares_kelly = int(kelly_risk / risk_per_share) if risk_per_share > 0 else 0
            shares_half = int(half_kelly_risk / risk_per_share) if risk_per_share > 0 else 0

            result.update({
                "kelly_pct": round(kelly * 100, 2),
                "half_kelly_pct": round(half_kelly * 100, 2),
                "shares_kelly": shares_kelly,
                "shares_half_kelly": shares_half,
                "position_value_kelly": round(shares_kelly * entry, 2),
                "position_value_half_kelly": round(shares_half * entry, 2),
                "shares": shares_half,
                "position_value": round(shares_half * entry, 2),
                "position_pct_of_account": round(shares_half * entry / account * 100, 1) if account > 0 else 0,
            })

        elif request.method == "atr_based":
            atr = request.atr_value
            mult = request.atr_multiplier
            if atr <= 0:
                raise HTTPException(status_code=400, detail="ATR value must be positive")
            stop_distance = atr * mult
            shares = int(risk_amount / stop_distance)
            position_value = shares * entry
            result.update({
                "atr_value": atr,
                "atr_multiplier": mult,
                "atr_stop_distance": round(stop_distance, 2),
                "shares": shares,
                "position_value": round(position_value, 2),
                "position_pct_of_account": round(position_value / account * 100, 1),
            })

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating position size: {str(e)}")


# Pre-Trade Checklist
CHECKLIST_PATH = os.getenv("CHECKLIST_PATH", os.path.join(os.path.dirname(__file__), "data", "checklist_template.json"))

DEFAULT_CHECKLIST = [
    "Is this trade in my playbook/setup?",
    "Is the risk/reward at least 2:1?",
    "Have I set my stop loss?",
    "Is volume above 20-day average?",
    "Am I in the right emotional state? (No FOMO/revenge)",
    "Does this fit my daily loss limit?",
    "Is the market trend aligned? (SPY direction)",
    "Have I sized the position correctly? (1% rule)",
]


@router.get("/api/tools/checklist/template")
def get_checklist_template():
    if os.path.exists(CHECKLIST_PATH):
        with open(CHECKLIST_PATH, "r") as f:
            return json.load(f)
    return {"items": DEFAULT_CHECKLIST}


class ChecklistTemplate(BaseModel):
    items: List[str]


@router.post("/api/tools/checklist/template")
def save_checklist_template(template: ChecklistTemplate):
    os.makedirs(os.path.dirname(CHECKLIST_PATH), exist_ok=True)
    with open(CHECKLIST_PATH, "w") as f:
        json.dump({"items": template.items}, f, indent=2)
    return {"status": "saved", "items": template.items}
