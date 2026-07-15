"""Trade-workbook parsing + metrics (trade_data.py) — characterization tests.

The headline case is `read_trades_excel` re-evaluating the scale-out (multi-fill)
exit formulas that pandas reads as NaN. If that ever regresses, every scaled-out
trade silently disappears from the analytics — so it's pinned hard here.
"""

import pandas as pd
import pytest
from openpyxl import Workbook

from trade_data import (
    read_trades_excel,
    normalize_trade_data,
    calculate_trade_metrics,
    _eval_arith_formula,
)


def _workbook(tmp_path, rows, headers=("Symbol", "Qty", "Entry Price", "Exit Price")):
    wb = Workbook()
    ws = wb.active
    ws.title = "Trades"
    ws.append(list(headers))
    for r in rows:
        ws.append(list(r))
    path = tmp_path / "trades.xlsx"
    wb.save(path)
    return str(path)


def test_read_evaluates_scaleout_formula_that_pandas_drops(tmp_path):
    formula = "=((100*49.401)+(125*54.61))/225"          # weighted-avg scale-out exit
    path = _workbook(tmp_path, [["AAPL", 225, 50.0, formula]])
    # Precondition: a plain read drops the formula cell to NaN (the bug).
    assert pd.isna(pd.read_excel(path).iloc[0]["Exit Price"])
    # read_trades_excel recovers the true weighted-average price.
    got = read_trades_excel(path).iloc[0]["Exit Price"]
    assert got == pytest.approx(((100 * 49.401) + (125 * 54.61)) / 225)


def test_read_leaves_plain_numbers_untouched(tmp_path):
    path = _workbook(tmp_path, [["MSFT", 100, 300.0, 315.5]])
    assert read_trades_excel(path).iloc[0]["Exit Price"] == 315.5


def test_eval_arith_formula_only_accepts_self_contained_arithmetic():
    assert _eval_arith_formula("=1+2") == 3.0
    assert _eval_arith_formula("=((132.2*18)+(2*108.88))/20") == pytest.approx((132.2 * 18 + 2 * 108.88) / 20)
    assert _eval_arith_formula("=A1+B2") is None          # cell references → refuse
    assert _eval_arith_formula("plain text") is None
    assert _eval_arith_formula(None) is None


def test_normalize_keeps_only_closed_trades():
    df = pd.DataFrame([
        {"Symbol": "AAA", "Qty": 10, "Entry Price": 10.0, "Exit Price": 12.0, "Profit / Loss": 20.0},
        {"Symbol": "BBB", "Qty": 5, "Entry Price": 20.0, "Exit Price": None, "Profit / Loss": None},
    ])
    trades = normalize_trade_data(df)
    assert [t["symbol"] for t in trades] == ["AAA"]        # open BBB dropped


def test_normalize_cleans_missing_fields_by_column_type():
    df = pd.DataFrame([
        {"Symbol": "AAA", "Qty": 10, "Entry Price": 10.0, "Exit Price": 12.0,
         "Setup": None, "Stop Price": None, "Profit / Loss": 20.0},
    ])
    t = normalize_trade_data(df)[0]
    assert t["setup"] == ""            # text column → empty string, not a stray 0
    assert t["stop_price"] is None      # nullable numeric → None


def test_normalize_computes_pnl_when_missing():
    df = pd.DataFrame([{"Symbol": "AAA", "Qty": 10, "Entry Price": 10.0, "Exit Price": 12.0}])
    t = normalize_trade_data(df)[0]
    assert t["pnl"] == pytest.approx(20.0)                 # (12 - 10) * 10


def test_metrics_win_rate_profit_factor_and_averages():
    trades = [{"pnl": 100.0}, {"pnl": -50.0}, {"pnl": 50.0}, {"pnl": -25.0}]
    m = calculate_trade_metrics(trades)
    assert m["total_trades"] == 4
    assert m["winning_trades"] == 2
    assert m["win_rate"] == 50.0
    assert m["total_pnl"] == pytest.approx(75.0)
    assert m["avg_win"] == pytest.approx(75.0)             # (100 + 50) / 2
    assert m["avg_loss"] == pytest.approx(-37.5)           # (-50 - 25) / 2
    assert m["profit_factor"] == pytest.approx(2.0)        # gross 150 / gross-loss 75


def test_metrics_empty_is_all_zero():
    m = calculate_trade_metrics([])
    assert m["total_trades"] == 0 and m["win_rate"] == 0 and m["profit_factor"] == 0
