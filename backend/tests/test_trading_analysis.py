"""Characterization tests for the trading-analysis handlers.

They call each analytics handler with a fixed trade set and assert it returns a
dict (or raises the documented 400 on empty input). This is the safety net for
extracting the routes into trading_analysis_router.py: the handlers do all their
imports at module level, so a missing import after the move raises NameError only
when the handler is *called* — exercising each one here is what proves the move
is clean. The assertions must hold identically before and after the extraction.

`ANALYTICS_MODULE` is the one thing that changes with the move: it's `main` while
the routes live there, and `trading_analysis_router` once they're extracted.
"""

import importlib

import pytest
from fastapi import HTTPException

ANALYTICS_MODULE = "trading_analysis_router"

ta = importlib.import_module(ANALYTICS_MODULE)
TradeDataRequest = ta.TradeDataRequest
RMultipleRequest = ta.RMultipleRequest

# Representative closed trades: winners + losers, varied setups / emotions /
# market caps / dates / times — enough for every analyzer to have something.
TRADES = [
    {"symbol": "AAPL", "side": "long", "quantity": 100, "entry_price": 150.0, "exit_price": 165.0,
     "entry_date": "2026-01-05", "exit_date": "2026-01-12", "entry_time": "09:35", "exit_time": "15:50",
     "pnl": 1500.0, "pnl_pct": 10.0, "setup": "HTF breakout", "emotion": "calm", "conviction": 4,
     "market_cap": 2_500_000_000, "stop_price": 145.0, "target_price": 175.0, "grade": "A", "duration_days": 7},
    {"symbol": "TSLA", "side": "long", "quantity": 50, "entry_price": 240.0, "exit_price": 228.0,
     "entry_date": "2026-01-06", "exit_date": "2026-01-06", "entry_time": "10:05", "exit_time": "11:20",
     "pnl": -600.0, "pnl_pct": -5.0, "setup": "EP", "emotion": "fomo", "conviction": 2,
     "market_cap": 700_000_000_000, "stop_price": 232.0, "target_price": 260.0, "grade": "C", "duration_days": 0},
    {"symbol": "NVDA", "side": "long", "quantity": 30, "entry_price": 500.0, "exit_price": 560.0,
     "entry_date": "2026-01-08", "exit_date": "2026-01-20", "entry_time": "09:40", "exit_time": "15:55",
     "pnl": 1800.0, "pnl_pct": 12.0, "setup": "HTF breakout", "emotion": "calm", "conviction": 5,
     "market_cap": 1_200_000_000_000, "stop_price": 480.0, "target_price": 580.0, "grade": "A", "duration_days": 12},
    {"symbol": "SOFI", "side": "long", "quantity": 500, "entry_price": 9.0, "exit_price": 8.3,
     "entry_date": "2026-01-09", "exit_date": "2026-01-15", "entry_time": "11:00", "exit_time": "14:30",
     "pnl": -350.0, "pnl_pct": -7.8, "setup": "Reversal", "emotion": "revenge", "conviction": 1,
     "market_cap": 8_000_000_000, "stop_price": 8.5, "target_price": 11.0, "grade": "D", "duration_days": 6},
    {"symbol": "AMD", "side": "long", "quantity": 80, "entry_price": 120.0, "exit_price": 132.0,
     "entry_date": "2026-01-12", "exit_date": "2026-01-19", "entry_time": "09:32", "exit_time": "15:45",
     "pnl": 960.0, "pnl_pct": 10.0, "setup": "EP", "emotion": "calm", "conviction": 4,
     "market_cap": 190_000_000_000, "stop_price": 114.0, "target_price": 140.0, "grade": "B", "duration_days": 7},
]

HANDLERS = [
    "analyze_trade_data", "get_trade_statistics", "get_setup_statistics",
    "get_symbol_statistics", "get_drawdown_analysis", "get_time_performance",
    "get_rolling_performance", "get_advanced_metrics", "get_entry_timing_analysis",
    "get_streak_detection", "get_market_cap_performance", "get_benchmark_comparison",
    "get_emotion_performance", "get_calendar_heatmap", "get_edge_insights",
]


@pytest.mark.parametrize("name", HANDLERS)
def test_handler_returns_dict(name):
    result = getattr(ta, name)(TradeDataRequest(trades=TRADES))
    assert isinstance(result, dict)


def test_r_multiple_returns_dict():
    result = ta.get_r_multiple_analysis(RMultipleRequest(trades=TRADES, initial_capital=100000))
    assert isinstance(result, dict)


def test_setup_statistics_has_setups_key():
    assert "setups" in ta.get_setup_statistics(TradeDataRequest(trades=TRADES))


def test_empty_trades_is_rejected():
    # Empty input is refused. (The handler's broad except wraps the inner 400 as a
    # 500 — characterizing current behavior, not asserting it's ideal.)
    with pytest.raises(HTTPException):
        ta.get_setup_statistics(TradeDataRequest(trades=[]))
