"""Wealthsimple margin-account analysis.

The source data is a set of monthly CSV statements (one file per month) that
Wealthsimple exports — a raw cash-flow ledger, not a clean trade log:

    date, transaction, description, amount, balance, currency

`transaction` is one of: BUY, SELL, TRFIN, TRFOUT, INTCHARGED, DIV, NRT.
For BUY/SELL the ticker, name, share count and (newer rows) per-share price are
embedded in `description`, e.g.:

    "ETHX.B - CI Galaxy Ethereum ETF CAD Unhedged: Bought 150.0000 shares
     at $11.68 per share (executed at 2026-04-14)"

This router reconstructs trades from that ledger and computes realized P&L
(average-cost basis), current holdings, per-ticker and monthly activity, and
the cash-flow rollup (deposits, margin interest, dividends, tax). It's a
lighter analysis than the IBKR Trading Analysis page on purpose.
"""

from __future__ import annotations

import csv
import glob
import os
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/wealthsimple", tags=["wealthsimple"])

WS_DIR = os.getenv(
    "WEALTHSIMPLE_DIR",
    "/Users/michaeljacinto/Library/CloudStorage/OneDrive-Personal/Desktop - onedrive/trades/wealthsimple",
)

# "TICKER - Name: Bought/Sold 123.0000 shares [at $1.23 per share] (executed at 2026-04-14)"
_TRADE_RE = re.compile(
    r"^(?P<ticker>[A-Z0-9.]+)\s*-\s*(?P<name>.+?)\s*:\s*"
    r"(?P<side>Bought|Sold)\s+(?P<shares>[\d,]*\.?\d+)\s+shares"
    r"(?:\s+at\s+\$(?P<price>[\d,]*\.?\d+)\s+per\s+share)?",
    re.IGNORECASE,
)
_EXEC_RE = re.compile(r"executed at (\d{4}-\d{2}-\d{2})")
_TICKER_RE = re.compile(r"^(?P<ticker>[A-Z0-9.]+)\s*-\s*(?P<name>.+?)\s*:")


def _f(v) -> float:
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return 0.0


def _load_rows() -> list[dict]:
    """Parse every monthly CSV into a flat, chronologically-sorted list."""
    if not os.path.isdir(WS_DIR):
        return []
    rows: list[dict] = []
    for path in glob.glob(os.path.join(WS_DIR, "*.csv")):
        try:
            with open(path, newline="") as fh:
                for i, r in enumerate(csv.DictReader(fh)):
                    date = (r.get("date") or "").strip()
                    if not date:
                        continue
                    ttype = (r.get("transaction") or "").strip().upper()
                    desc = (r.get("description") or "").strip()
                    amount = _f(r.get("amount"))
                    balance = _f(r.get("balance"))

                    ticker = name = side = None
                    shares = price = None
                    exec_date = None
                    em = _EXEC_RE.search(desc)
                    if em:
                        exec_date = em.group(1)

                    if ttype in ("BUY", "SELL"):
                        m = _TRADE_RE.match(desc)
                        if m:
                            ticker = m.group("ticker").upper()
                            name = m.group("name").strip()
                            side = "BUY" if m.group("side").lower() == "bought" else "SELL"
                            shares = _f(m.group("shares"))
                            if m.group("price"):
                                price = _f(m.group("price"))
                            elif shares:
                                price = round(abs(amount) / shares, 4)
                    else:
                        # DIV / NRT etc. may still carry a ticker prefix.
                        tm = _TICKER_RE.match(desc)
                        if tm:
                            ticker = tm.group("ticker").upper()
                            name = tm.group("name").strip()

                    rows.append({
                        "date": date,
                        "type": ttype,
                        "ticker": ticker,
                        "name": name,
                        "side": side,
                        "shares": shares,
                        "price": price,
                        "amount": round(amount, 2),
                        "balance": round(balance, 2),
                        "executed_at": exec_date,
                        "description": desc,
                        "_src_order": i,
                    })
        except Exception:
            continue

    rows.sort(key=lambda r: (r["date"], r["_src_order"]))
    return rows


def _analyze(rows: list[dict]) -> dict:
    # Per-ticker running position + cost basis (average cost) for realized P&L.
    pos: dict[str, dict] = {}

    def slot(tk, nm):
        s = pos.get(tk)
        if not s:
            s = {
                "ticker": tk, "name": nm,
                "position": 0.0, "cost_basis": 0.0,
                "bought_shares": 0.0, "sold_shares": 0.0,
                "buy_value": 0.0, "sell_value": 0.0,
                "realized": 0.0,
                # Current open cycle — reset each time the position returns to flat.
                "cyc_bought": 0.0, "cyc_sold": 0.0,
                "cyc_buy_value": 0.0, "cyc_sell_value": 0.0, "cyc_realized": 0.0,
                # Aggregated over COMPLETED round-trips (position hit 0). A ticker
                # can have closed cycles AND a current open position — both count.
                "cl_bought": 0.0, "cl_sold": 0.0,
                "cl_buy_value": 0.0, "cl_sell_value": 0.0, "cl_realized": 0.0,
                "cycles": 0, "cycle_wins": 0, "cycle_losses": 0,
            }
            pos[tk] = s
        if nm and not s.get("name"):
            s["name"] = nm
        return s

    realized_total = 0.0
    by_month: dict[str, dict] = {}

    def month_slot(d):
        key = d[:7]  # YYYY-MM
        m = by_month.get(key)
        if not m:
            m = {"month": key, "buy_value": 0.0, "sell_value": 0.0,
                 "buy_count": 0, "sell_count": 0, "realized": 0.0,
                 "deposits": 0.0, "withdrawals": 0.0, "interest": 0.0,
                 "dividends": 0.0, "tax": 0.0}
            by_month[key] = m
        return m

    deposits = withdrawals = interest = dividends = tax = 0.0
    buy_count = sell_count = 0

    for r in rows:
        ttype = r["type"]
        amt = r["amount"]
        ms = month_slot(r["date"])

        if ttype == "BUY" and r["ticker"] and r["shares"]:
            s = slot(r["ticker"], r["name"])
            cost = abs(amt)
            s["position"] += r["shares"]
            s["cost_basis"] += cost
            s["bought_shares"] += r["shares"]
            s["buy_value"] += cost
            s["cyc_bought"] += r["shares"]
            s["cyc_buy_value"] += cost
            ms["buy_value"] += cost
            ms["buy_count"] += 1
            buy_count += 1

        elif ttype == "SELL" and r["ticker"] and r["shares"]:
            s = slot(r["ticker"], r["name"])
            proceeds = amt
            sh = r["shares"]
            # Average-cost realized P&L on the matched (held) shares.
            matched = min(sh, s["position"]) if s["position"] > 0 else 0.0
            avg = (s["cost_basis"] / s["position"]) if s["position"] > 0 else 0.0
            realized = (proceeds / sh - avg) * matched if sh else 0.0
            s["realized"] += realized
            realized_total += realized
            s["cost_basis"] -= avg * matched
            s["position"] -= matched
            s["sold_shares"] += sh
            s["sell_value"] += proceeds
            s["cyc_sold"] += sh
            s["cyc_sell_value"] += proceeds
            s["cyc_realized"] += realized
            ms["sell_value"] += proceeds
            ms["sell_count"] += 1
            ms["realized"] += realized
            sell_count += 1

            # Position back to flat → a round-trip just completed. Bank the
            # cycle as "closed" and reset the open-cycle accumulators, so its
            # realized P&L counts as closed even if the ticker is re-opened later.
            if s["position"] <= 1e-6:
                s["position"] = 0.0
                s["cost_basis"] = 0.0
                s["cl_bought"] += s["cyc_bought"]
                s["cl_sold"] += s["cyc_sold"]
                s["cl_buy_value"] += s["cyc_buy_value"]
                s["cl_sell_value"] += s["cyc_sell_value"]
                s["cl_realized"] += s["cyc_realized"]
                s["cycles"] += 1
                if s["cyc_realized"] > 0:
                    s["cycle_wins"] += 1
                elif s["cyc_realized"] < 0:
                    s["cycle_losses"] += 1
                s["cyc_bought"] = s["cyc_sold"] = 0.0
                s["cyc_buy_value"] = s["cyc_sell_value"] = s["cyc_realized"] = 0.0

        elif ttype == "TRFIN":
            deposits += amt; ms["deposits"] += amt
        elif ttype == "TRFOUT":
            withdrawals += amt; ms["withdrawals"] += amt
        elif ttype == "INTCHARGED":
            interest += amt; ms["interest"] += amt
        elif ttype == "DIV":
            dividends += amt; ms["dividends"] += amt
        elif ttype == "NRT":
            tax += amt; ms["tax"] += amt

    # Build holdings (open positions) and closed positions (completed
    # round-trips). A ticker can appear in BOTH — e.g. round-tripped years ago
    # and re-bought today: the old cycle's realized P&L still counts as closed.
    holdings = []
    closed_positions = []
    cycle_wins = cycle_losses = total_cycles = 0
    realized_closed = 0.0
    for s in pos.values():
        open_shares = round(s["position"], 4)
        is_open = open_shares > 1e-6
        if is_open:
            avg_cost = round(s["cost_basis"] / s["position"], 4) if s["position"] > 1e-6 else None
            holdings.append({
                "ticker": s["ticker"], "name": s["name"],
                "shares": open_shares,
                "avg_cost": avg_cost,
                "book_value": round(s["cost_basis"], 2),
                # Realized banked so far on the CURRENT open cycle — in progress,
                # not a final result. Shown as context, not as "closed".
                "open_realized": round(s["cyc_realized"], 2),
            })
        if s["cycles"] > 0:
            closed_positions.append({
                "ticker": s["ticker"], "name": s["name"],
                "cycles": s["cycles"],
                "bought_shares": round(s["cl_bought"], 2),
                "sold_shares": round(s["cl_sold"], 2),
                "buy_value": round(s["cl_buy_value"], 2),
                "sell_value": round(s["cl_sell_value"], 2),
                "realized_pnl": round(s["cl_realized"], 2),
                "avg_buy": round(s["cl_buy_value"] / s["cl_bought"], 4) if s["cl_bought"] else None,
                "avg_sell": round(s["cl_sell_value"] / s["cl_sold"], 4) if s["cl_sold"] else None,
                # True when the ticker also has a current open position.
                "still_open": is_open,
            })
            realized_closed += s["cl_realized"]
            cycle_wins += s["cycle_wins"]
            cycle_losses += s["cycle_losses"]
            total_cycles += s["cycles"]

    closed_positions.sort(key=lambda t: t["realized_pnl"], reverse=True)
    holdings.sort(key=lambda h: h["book_value"], reverse=True)
    months = sorted(by_month.values(), key=lambda m: m["month"])
    cum = 0.0
    for m in months:
        for k in ("buy_value", "sell_value", "realized", "deposits", "withdrawals", "interest", "dividends", "tax"):
            m[k] = round(m[k], 2)
        cum += m["realized"]
        m["cum_realized"] = round(cum, 2)

    decided = cycle_wins + cycle_losses
    win_rate = round(cycle_wins / decided * 100, 1) if decided else None
    realized_closed = round(realized_closed, 2)

    latest_balance = rows[-1]["balance"] if rows else 0.0
    last_date = rows[-1]["date"] if rows else None

    realized_total = round(realized_total, 2)
    # The true bottom line for a margin account: realized + dividends, net of
    # margin interest and tax (interest/tax are already negative).
    net_result = round(realized_total + dividends + interest + tax, 2)

    return {
        "summary": {
            "latest_balance": round(latest_balance, 2),
            "last_date": last_date,
            "realized_pnl": realized_total,
            "realized_closed": realized_closed,                       # from completed round-trips
            "realized_open": round(realized_total - realized_closed, 2),  # banked on still-open cycles
            "net_result": net_result,
            "closed_cycles": total_cycles,
            "closed_tickers": len(closed_positions),
            "closed_winners": cycle_wins,
            "closed_losers": cycle_losses,
            "win_rate": win_rate,
            "net_deposits": round(deposits + withdrawals, 2),  # withdrawals are negative
            "deposits": round(deposits, 2),
            "withdrawals": round(withdrawals, 2),
            "interest_paid": round(interest, 2),
            "dividends": round(dividends, 2),
            "tax": round(tax, 2),
            "total_buy_value": round(sum(s["buy_value"] for s in pos.values()), 2),
            "total_sell_value": round(sum(s["sell_value"] for s in pos.values()), 2),
            "buy_count": buy_count,
            "sell_count": sell_count,
            "trade_count": buy_count + sell_count,
            "ticker_count": len(pos),
            "holdings_book_value": round(sum(h["book_value"] for h in holdings), 2),
            "months_active": len([m for m in months if m["buy_count"] or m["sell_count"]]),
            "currency": "CAD",
        },
        "holdings": holdings,
        "closed_positions": closed_positions,
        "by_month": months,
    }


@router.get("/summary")
def get_summary():
    rows = _load_rows()
    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"No Wealthsimple statements found in {WS_DIR}",
        )
    result = _analyze(rows)
    result["as_of"] = datetime.now().isoformat(timespec="seconds")
    result["source_dir"] = WS_DIR
    result["row_count"] = len(rows)
    return result


@router.get("/transactions")
def get_transactions(limit: int = 200):
    """Flat, newest-first transaction list for the activity table."""
    rows = _load_rows()
    rows = list(reversed(rows))[:limit]
    for r in rows:
        r.pop("_src_order", None)
    return {"transactions": rows, "total": len(rows)}
