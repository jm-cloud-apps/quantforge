"""FastAPI router for Interactive Brokers operations."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from .manager import get_broker
from .connection import ConnectionConfig

router = APIRouter(prefix="/api/broker", tags=["broker"])


class ConnectRequest(BaseModel):
    host: str = "127.0.0.1"
    port: int = 7497
    client_id: int = 1
    is_paper: bool = True


class OrderRequest(BaseModel):
    symbol: str
    action: str
    quantity: int
    order_type: str
    limit_price: Optional[float] = None
    stop_price: Optional[float] = None


@router.post("/connect")
async def connect(request: ConnectRequest):
    """Connect to TWS or IB Gateway."""
    try:
        broker = get_broker()
        config = ConnectionConfig(
            host=request.host,
            port=request.port,
            client_id=request.client_id,
            is_paper=request.is_paper,
        )
        summary = await broker.connect(config)
        return {"status": "connected", "account": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Connection failed: {str(e)}")


@router.post("/disconnect")
async def disconnect():
    """Disconnect from broker."""
    broker = get_broker()
    await broker.disconnect()
    return {"status": "disconnected"}


@router.get("/status")
def connection_status():
    """Check current connection status."""
    broker = get_broker()
    return {
        "connected": broker.connected,
        "is_paper": broker.config.is_paper if broker.config else None,
        "host": broker.config.host if broker.config else None,
        "port": broker.config.port if broker.config else None,
    }


@router.get("/account")
def account_summary():
    """Get account summary (cash, buying power, etc.)."""
    broker = get_broker()
    if not broker.connected:
        raise HTTPException(status_code=400, detail="Not connected to broker")
    return broker.get_account_summary()


@router.get("/positions")
def get_positions():
    """Get all current positions."""
    broker = get_broker()
    if not broker.connected:
        raise HTTPException(status_code=400, detail="Not connected to broker")
    return {"positions": broker.get_positions()}


@router.get("/orders")
def get_orders():
    """Get all open orders."""
    broker = get_broker()
    if not broker.connected:
        raise HTTPException(status_code=400, detail="Not connected to broker")
    return {"orders": broker.get_open_orders()}


@router.post("/orders/place")
async def place_order(request: OrderRequest):
    """Place a new order (US stocks only)."""
    broker = get_broker()
    if not broker.connected:
        raise HTTPException(status_code=400, detail="Not connected to broker")
    try:
        result = await broker.place_order(
            symbol=request.symbol.upper().strip(),
            action=request.action.upper(),
            quantity=request.quantity,
            order_type=request.order_type.upper(),
            limit_price=request.limit_price or 0,
            stop_price=request.stop_price or 0,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Order failed: {str(e)}")


@router.post("/orders/cancel/{order_id}")
async def cancel_order(order_id: int):
    """Cancel an open order."""
    broker = get_broker()
    if not broker.connected:
        raise HTTPException(status_code=400, detail="Not connected to broker")
    try:
        return await broker.cancel_order(order_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
