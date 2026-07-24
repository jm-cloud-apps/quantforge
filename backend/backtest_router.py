"""Backtesting endpoints (extracted from main.py).

Single-symbol, multi-symbol, and previous-day-breakout backtests over the
`backtester` engine, plus the strategy catalog. Pure engine calls (the engine
fetches its own OHLCV). main.py registers this via app.include_router.
"""

import numpy as np
import pandas as pd
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backtester import BacktestEngine, get_available_strategies
from backtester.breakout_engine import run_breakout_backtest

router = APIRouter()


class BacktestRequest(BaseModel):
    symbol: str
    strategy_id: str
    start_date: str
    end_date: str
    initial_capital: float = 100_000
    params: Optional[dict] = None


class MultiBacktestRequest(BaseModel):
    symbols: list[str]
    strategy_id: str
    start_date: str
    end_date: str
    initial_capital: float = 100_000
    params: Optional[dict] = None


class BreakoutBacktestRequest(BaseModel):
    """Ticker + allocation. E.g. [{"symbol": "AAPL", "allocation_pct": 100}] or [{"symbol": "AAPL", "allocation_pct": 60}, {"symbol": "MSFT", "allocation_pct": 40}]"""
    holdings: list[dict]  # [{"symbol": "AAPL", "allocation_pct": 100}]
    start_date: str
    end_date: str
    initial_capital: float = 100_000
    risk_pct: float = 1.0
    max_position_pct: float = 25.0


@router.get("/api/strategies")
def list_strategies():
    """Return available backtesting strategies."""
    return get_available_strategies()


@router.post("/api/backtest/run")
def run_backtest(request: BacktestRequest):
    """Run a single backtest."""
    try:
        engine = BacktestEngine(initial_capital=request.initial_capital)
        result = engine.run(
            symbol=request.symbol,
            strategy_id=request.strategy_id,
            start_date=request.start_date,
            end_date=request.end_date,
            params=request.params,
        )
        return {
            "symbol": result.symbol,
            "strategy_id": result.strategy_id,
            "start_date": result.start_date,
            "end_date": result.end_date,
            "initial_capital": result.initial_capital,
            "final_value": result.final_value,
            "total_return_pct": result.total_return_pct,
            "cagr": result.cagr,
            "sharpe_ratio": result.sharpe_ratio,
            "max_drawdown_pct": result.max_drawdown_pct,
            "total_trades": result.total_trades,
            "winning_trades": result.winning_trades,
            "losing_trades": result.losing_trades,
            "win_rate_pct": result.win_rate_pct,
            "avg_win_pct": result.avg_win_pct,
            "avg_loss_pct": result.avg_loss_pct,
            "profit_factor": result.profit_factor,
            "equity_curve": result.equity_curve,
            "trades": result.trades,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backtest failed: {str(e)}")


@router.post("/api/backtest/run-multi")
def run_multi_backtest(request: MultiBacktestRequest):
    """Run backtests for multiple symbols and aggregate results."""
    results = []
    engine = BacktestEngine(initial_capital=request.initial_capital)

    for symbol in request.symbols:
        try:
            result = engine.run(
                symbol=symbol.strip().upper(),
                strategy_id=request.strategy_id,
                start_date=request.start_date,
                end_date=request.end_date,
                params=request.params,
            )
            results.append({
                "symbol": result.symbol,
                "strategy_id": result.strategy_id,
                "start_date": result.start_date,
                "end_date": result.end_date,
                "initial_capital": result.initial_capital,
                "final_value": result.final_value,
                "total_return_pct": result.total_return_pct,
                "cagr": result.cagr,
                "sharpe_ratio": result.sharpe_ratio,
                "max_drawdown_pct": result.max_drawdown_pct,
                "total_trades": result.total_trades,
                "winning_trades": result.winning_trades,
                "losing_trades": result.losing_trades,
                "win_rate_pct": result.win_rate_pct,
                "avg_win_pct": result.avg_win_pct,
                "avg_loss_pct": result.avg_loss_pct,
                "profit_factor": result.profit_factor,
                "equity_curve": result.equity_curve,
                "trades": result.trades,
            })
        except Exception as e:
            results.append({
                "symbol": symbol,
                "error": str(e),
                "total_trades": 0,
                "equity_curve": [],
                "trades": [],
            })

    # Aggregate metrics across symbols
    successful = [r for r in results if "error" not in r]
    if successful:
        avg_return = sum(r["total_return_pct"] for r in successful) / len(successful)
        total_trades = sum(r["total_trades"] for r in successful)
        wins = sum(r["winning_trades"] for r in successful)
        win_rate = (wins / total_trades * 100) if total_trades > 0 else 0
    else:
        avg_return = 0
        total_trades = 0
        win_rate = 0

    return {
        "results": results,
        "aggregate": {
            "symbols_run": len(results),
            "successful": len(successful),
            "failed": len(results) - len(successful),
            "avg_return_pct": round(avg_return, 2) if successful else 0,
            "total_trades": total_trades,
            "win_rate_pct": round(win_rate, 1),
        },
    }


@router.post("/api/backtest/breakout")
def run_breakout_backtest_endpoint(request: BreakoutBacktestRequest):
    """
    Run previous day breakout strategy.
    Rules: Buy when price > prev day high, sell when price < prev day low.
    Risk 1% per trade, max 25% in any position.
    """
    if not request.holdings:
        raise HTTPException(status_code=400, detail="At least one holding required")
    
    total_pct = sum(h.get("allocation_pct", 0) for h in request.holdings)
    if abs(total_pct - 100) > 0.1:
        raise HTTPException(status_code=400, detail="Allocation percentages must sum to 100")

    results = []
    equity_curves = []

    for h in request.holdings:
        symbol = str(h.get("symbol", "")).strip().upper()
        alloc_pct = float(h.get("allocation_pct", 0))
        alloc_capital = request.initial_capital * (alloc_pct / 100)

        try:
            r = run_breakout_backtest(
                symbol=symbol,
                start_date=request.start_date,
                end_date=request.end_date,
                allocation_capital=alloc_capital,
                risk_pct=request.risk_pct,
                max_position_pct=request.max_position_pct,
            )
            results.append({
                "symbol": r.symbol,
                "allocation_pct": alloc_pct,
                "strategy_id": "previous_day_breakout",
                "start_date": r.start_date,
                "end_date": r.end_date,
                "initial_capital": r.initial_capital,
                "final_value": r.final_value,
                "total_return_pct": r.total_return_pct,
                "cagr": r.cagr,
                "sharpe_ratio": r.sharpe_ratio,
                "max_drawdown_pct": r.max_drawdown_pct,
                "total_trades": r.total_trades,
                "winning_trades": r.winning_trades,
                "losing_trades": r.losing_trades,
                "win_rate_pct": r.win_rate_pct,
                "avg_win_pct": r.avg_win_pct,
                "avg_loss_pct": r.avg_loss_pct,
                "profit_factor": r.profit_factor,
                "equity_curve": r.equity_curve,
                "trades": r.trades,
            })
            equity_curves.append((symbol, r.equity_curve))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # Combine equity curves by date (forward-fill each, then sum)
    all_dates = set()
    for _, curve in equity_curves:
        for p in curve:
            all_dates.add(p["date"])
    all_dates = sorted(all_dates)

    filled_by_symbol = {}
    for symbol, curve in equity_curves:
        d = {p["date"]: p["value"] for p in curve}
        last = 0
        filled = {}
        for dt in all_dates:
            last = d.get(dt, last)
            filled[dt] = last
        filled_by_symbol[symbol] = filled

    combined = [{"date": dt, "value": round(sum(filled_by_symbol[sym][dt] for sym, _ in equity_curves), 2)} for dt in all_dates]

    total_final = sum(r["final_value"] for r in results)
    total_return = (total_final / request.initial_capital - 1) * 100
    all_trades = [t for r in results for t in r["trades"]]
    total_trades = len(all_trades)
    wins = sum(r["winning_trades"] for r in results)
    losses = sum(r["losing_trades"] for r in results)
    win_rate = (wins / total_trades * 100) if total_trades > 0 else 0

    winning_trades_list = [t for t in all_trades if t["pnl"] > 0]
    losing_trades_list = [t for t in all_trades if t["pnl"] <= 0]
    avg_win_pct = np.mean([t["pnl_pct"] for t in winning_trades_list]) if winning_trades_list else 0
    avg_loss_pct = np.mean([t["pnl_pct"] for t in losing_trades_list]) if losing_trades_list else 0
    gross_profit = sum(t["pnl"] for t in winning_trades_list)
    gross_loss = abs(sum(t["pnl"] for t in losing_trades_list))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (gross_profit if gross_profit > 0 else 0)

    equity_series = pd.Series([p["value"] for p in combined])
    returns = equity_series.pct_change().dropna()
    sharpe = (returns.mean() / returns.std()) * np.sqrt(252) if len(returns) > 1 and returns.std() > 0 else 0.0
    cummax = equity_series.cummax()
    drawdown = (equity_series - cummax) / cummax * 100
    max_dd = round(drawdown.min(), 2)
    days = (pd.to_datetime(request.end_date) - pd.to_datetime(request.start_date)).days
    years = max(days / 365.25, 0.01)
    cagr = (total_final / request.initial_capital) ** (1 / years) - 1
    cagr *= 100

    return {
        "symbol": "+".join(r["symbol"] for r in results),
        "strategy_id": "previous_day_breakout",
        "start_date": request.start_date,
        "end_date": request.end_date,
        "initial_capital": request.initial_capital,
        "final_value": round(total_final, 2),
        "total_return_pct": round(total_return, 2),
        "cagr": round(cagr, 2),
        "sharpe_ratio": round(sharpe, 2),
        "max_drawdown_pct": max_dd,
        "total_trades": total_trades,
        "winning_trades": wins,
        "losing_trades": losses,
        "win_rate_pct": round(win_rate, 1),
        "avg_win_pct": round(avg_win_pct, 2),
        "avg_loss_pct": round(avg_loss_pct, 2),
        "profit_factor": round(profit_factor, 2),
        "equity_curve": combined,
        "trades": all_trades,
        "results": results,
    }
