"""Discipline analytics — does the executed trade log match the stated plan?

Every other analytics module in this app measures *outcomes* (what the trades
returned). This one measures **process**: whether the trade that happened was
the trade that was planned, whether it was held for the horizon the edge
actually needs, and whether a setup family still works.

Four pure reports, all computed over the closed-trade dicts from
`trade_data.normalize_trade_data` plus the plan store from
`trade_plans_router`. No I/O — the router loads the inputs and hands them in
(the post-exit price bars come from the breadth grouped cache, passed as a
plain dict so this module stays testable offline).

  1. `reconcile`        — matches plans to fills and classifies every trade as
                          planned / deviated / unplanned. The compliance number.
  2. `hold_time_report` — performance by holding period, plus what the exits
                          left on the table (post-exit favourable excursion).
  3. `setup_decay`      — rolling per-family health so a dead edge retires
                          itself instead of being rediscovered trade by trade.
  4. `circuit_breaker`  — the cheap "is there a plan for today, and what have
                          the unplanned trades cost this month" read.

Why classify rather than just total: an unplanned trade and a planned one that
lost are the same dollar figure but completely different problems. Only one of
them is fixable by changing behaviour.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Optional

# --- Tolerances -------------------------------------------------------------
# A plan is a hypothesis about a price, not a limit order. These bands decide
# how far the fill can drift before it stops being "the trade you planned".

# How many calendar days after a plan is logged it can still claim a fill.
# Plans are same-day-to-a-few-days intent; beyond this the setup has changed.
MATCH_WINDOW_DAYS = 5

# Entry drift past this % of the planned entry is a different trade — usually
# chasing. 2% is roughly a normal open-range wiggle on a liquid mid-cap.
ENTRY_DRIFT_PCT = 2.0

# Size drift. Oversize is the dangerous direction (it's how a planned risk
# budget becomes an unplanned one), so it gets the tighter band.
SIZE_OVER_RATIO = 1.25
SIZE_UNDER_RATIO = 0.50

# Exiting beyond the planned stop means the stop was not honoured — the single
# most expensive deviation there is. Small tolerance for slippage/gaps.
STOP_BREACH_TOL_PCT = 0.5

# Holding-period buckets (calendar days, matching `duration_days` elsewhere).
HOLD_BUCKETS = (
    (0, 0, "0d — same day"),
    (1, 1, "1d"),
    (2, 3, "2-3d"),
    (4, 8, "4-8d"),
    (9, 10_000, "9d+"),
)

# Sessions after the exit to measure what holding would have produced.
POST_EXIT_SESSIONS = 10

# Rolling window (trades per family) for the decay monitor.
DECAY_WINDOW = 12
DECAY_MIN_TRADES = 6


# --- Small helpers ----------------------------------------------------------

def _to_date(value: Any) -> Optional[date]:
    """Parse the several date shapes that flow through the trade pipeline."""
    if value in (None, "", 0):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "")).date()
        except ValueError:
            try:
                return datetime.strptime(value[:10], "%Y-%m-%d").date()
            except ValueError:
                return None
    return None


def _num(value: Any) -> Optional[float]:
    """Coerce to float, treating the pipeline's 0-for-missing sentinel as real.

    `normalize_trade_data` fills missing numerics with 0 for most columns and
    None for stop/target — so callers must decide what 0 means per field.
    """
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f:  # NaN
        return None
    return f


def _direction_of(trade: dict) -> str:
    side = str(trade.get("side") or "").strip().upper()
    return "short" if side.startswith("S") else "long"


def setup_family(setup: Any) -> str:
    """Bucket a setup label into its playbook family.

    The taxonomy is `FAMILY - variant`. Anything outside HTF/EP is not a
    sanctioned setup — "NA - Random" and blanks both collapse to UNPLANNED
    families because for edge purposes they are the same thing: a trade with
    no thesis recorded before the fill.
    """
    s = str(setup or "").strip()
    if not s:
        return "UNTAGGED"
    upper = s.upper()
    if upper.startswith("HTF"):
        return "HTF"
    if upper.startswith("EP"):
        return "EP"
    return "RANDOM"


def _stats(trades: Iterable[dict]) -> dict:
    """Count / pnl / win-rate / expectancy for a group of trades."""
    rows = list(trades)
    n = len(rows)
    if n == 0:
        return {"n": 0, "pnl": 0.0, "win_rate": None, "avg": None,
                "avg_win": None, "avg_loss": None}
    pnls = [_num(t.get("pnl")) or 0.0 for t in rows]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]
    return {
        "n": n,
        "pnl": round(sum(pnls), 2),
        "win_rate": round(len(wins) / n * 100, 1),
        "avg": round(sum(pnls) / n, 2),
        "avg_win": round(sum(wins) / len(wins), 2) if wins else None,
        "avg_loss": round(sum(losses) / len(losses), 2) if losses else None,
    }


# --- 1. Plan <-> execution reconciliation -----------------------------------

def _deviations(plan: dict, trade: dict) -> list[str]:
    """Every way this fill departed from its plan, in plain language."""
    out: list[str] = []
    direction = plan.get("direction", "long")

    planned_entry = _num(plan.get("entry"))
    actual_entry = _num(trade.get("entry_price"))
    if planned_entry and actual_entry:
        drift = (actual_entry - planned_entry) / planned_entry * 100
        if abs(drift) > ENTRY_DRIFT_PCT:
            # For a long, paying *up* is chasing; for a short, selling lower is.
            chasing = drift > 0 if direction == "long" else drift < 0
            out.append(
                f"entered {abs(drift):.1f}% {'above' if drift > 0 else 'below'} plan"
                + (" — chased" if chasing else "")
            )

    planned_shares = _num(plan.get("shares"))
    actual_shares = abs(_num(trade.get("quantity")) or 0)
    if planned_shares and actual_shares:
        ratio = actual_shares / planned_shares
        if ratio > SIZE_OVER_RATIO:
            out.append(f"size {ratio:.1f}× the planned {planned_shares:.0f}sh")
        elif ratio < SIZE_UNDER_RATIO:
            out.append(f"size {ratio:.1f}× plan — under-committed")

    # Did the exit happen beyond the stop? That means the stop was not honoured:
    # the position was still on at a price the plan said to be out of.
    planned_stop = _num(plan.get("stop"))
    exit_price = _num(trade.get("exit_price"))
    if planned_stop and exit_price:
        tol = planned_stop * STOP_BREACH_TOL_PCT / 100
        breached = (exit_price < planned_stop - tol) if direction == "long" \
            else (exit_price > planned_stop + tol)
        if breached:
            out.append(f"held past the {planned_stop:g} stop (exited {exit_price:g})")

    # Bailed before the plan's own minimum horizon.
    min_hold = _num(plan.get("min_hold_days"))
    duration = _num(trade.get("duration_days"))
    if min_hold and duration is not None and duration < min_hold:
        out.append(f"exited day {duration:.0f} of a planned {min_hold:.0f}-day hold")

    return out


def reconcile(plans: list[dict], trades: list[dict],
              match_window_days: int = MATCH_WINDOW_DAYS) -> dict:
    """Match logged plans to executed fills; classify every trade.

    Matching is symbol + direction + "the fill happened in the days after the
    plan was logged". Where several plans could claim a fill, the closest
    planned entry price wins, and each plan can only be claimed once.

    Returns per-trade rows plus the summary that answers the only question
    that matters here: what fraction of trades were planned at all?
    """
    # Index plans by (symbol, direction), newest first, so the most recent
    # relevant plan is considered before a stale one for the same name.
    by_key: dict[tuple, list[dict]] = defaultdict(list)
    for p in plans:
        key = (str(p.get("symbol") or "").upper(), str(p.get("direction") or "long").lower())
        by_key[key].append(p)
    for bucket in by_key.values():
        bucket.sort(key=lambda p: str(p.get("created_at") or ""))

    claimed: set[str] = set()
    rows: list[dict] = []

    # Oldest fill first so earlier trades claim the earlier plans.
    ordered = sorted(trades, key=lambda t: (_to_date(t.get("entry_date")) or date.min,
                                            str(t.get("entry_time") or "")))

    for trade in ordered:
        symbol = str(trade.get("symbol") or "").upper()
        direction = _direction_of(trade)
        entry_day = _to_date(trade.get("entry_date"))
        actual_entry = _num(trade.get("entry_price"))

        match, best_gap = None, None
        for plan in by_key.get((symbol, direction), []):
            if plan.get("id") in claimed:
                continue
            plan_day = _to_date(plan.get("created_at"))
            if not plan_day or not entry_day:
                continue
            if not (plan_day <= entry_day <= plan_day + timedelta(days=match_window_days)):
                continue
            planned_entry = _num(plan.get("entry")) or 0
            gap = abs((actual_entry or 0) - planned_entry)
            if best_gap is None or gap < best_gap:
                match, best_gap = plan, gap

        family = setup_family(trade.get("setup"))
        if match is None:
            klass = "unplanned"
            devs: list[str] = []
        else:
            claimed.add(match["id"])
            devs = _deviations(match, trade)
            klass = "deviated" if devs else "planned"

        rows.append({
            "symbol": symbol,
            "direction": direction,
            "entry_date": entry_day.isoformat() if entry_day else None,
            "exit_date": (_to_date(trade.get("exit_date")) or date.min).isoformat()
            if _to_date(trade.get("exit_date")) else None,
            "entry_price": actual_entry,
            "exit_price": _num(trade.get("exit_price")),
            "quantity": abs(_num(trade.get("quantity")) or 0),
            "pnl": round(_num(trade.get("pnl")) or 0.0, 2),
            "duration_days": _num(trade.get("duration_days")),
            "setup": str(trade.get("setup") or "").strip(),
            "family": family,
            "classification": klass,
            "plan_id": match.get("id") if match else None,
            "planned_setup": match.get("setup") if match else None,
            "deviations": devs,
        })

    groups = defaultdict(list)
    for r in rows:
        groups[r["classification"]].append(r)

    total = len(rows)
    planned_n = len(groups["planned"]) + len(groups["deviated"])

    # Plans that never became a trade. `skipped` is a deliberate decision and a
    # good outcome, so it is reported separately from silent abandonment.
    unexecuted = [
        {"id": p.get("id"), "symbol": p.get("symbol"), "setup": p.get("setup"),
         "direction": p.get("direction"), "created_at": p.get("created_at"),
         "status": p.get("status")}
        for p in plans
        if p.get("id") not in claimed and p.get("status") != "taken"
    ]

    # The unplanned bucket broken out by family — this is the "Random tax" line.
    unplanned_by_family = {
        fam: _stats([r for r in groups["unplanned"] if r["family"] == fam])
        for fam in ("HTF", "EP", "RANDOM", "UNTAGGED")
    }

    return {
        "summary": {
            "total_trades": total,
            "planned_trades": planned_n,
            "compliance_pct": round(planned_n / total * 100, 1) if total else None,
            "followed": _stats(groups["planned"]),
            "deviated": _stats(groups["deviated"]),
            "unplanned": _stats(groups["unplanned"]),
            "plans_logged": len(plans),
            "plans_unexecuted": len(unexecuted),
        },
        "unplanned_by_family": unplanned_by_family,
        "deviation_reasons": _deviation_tally(groups["deviated"]),
        "rows": rows,
        "unexecuted_plans": unexecuted,
    }


def _deviation_tally(rows: list[dict]) -> list[dict]:
    """Which deviations recur, and what each has cost. Ranked by damage."""
    tally: dict[str, dict] = {}
    for r in rows:
        for dev in r["deviations"]:
            # Collapse the numeric specifics to a kind so they aggregate.
            kind = ("chased entry" if "chased" in dev
                    else "entry drift" if "entered" in dev
                    else "oversized" if "×" in dev and "under" not in dev
                    else "undersized" if "under-committed" in dev
                    else "stop not honoured" if "held past" in dev
                    else "cut before planned hold" if "exited day" in dev
                    else "other")
            slot = tally.setdefault(kind, {"kind": kind, "n": 0, "pnl": 0.0})
            slot["n"] += 1
            slot["pnl"] += r["pnl"]
    out = list(tally.values())
    for slot in out:
        slot["pnl"] = round(slot["pnl"], 2)
    out.sort(key=lambda s: s["pnl"])
    return out


# --- 2. Hold-time discipline ------------------------------------------------

def hold_time_report(trades: list[dict],
                     bars_by_date: Optional[dict] = None,
                     post_exit_sessions: int = POST_EXIT_SESSIONS) -> dict:
    """Performance by holding period + what the exits left on the table.

    The bucket table answers "how long does my edge need?". The post-exit
    excursion answers the harder question: of the trades I closed, what would
    holding `post_exit_sessions` more sessions have produced? That converts
    "I exit too early" from a feeling into a dollar figure.

    `bars_by_date` is {date: DataFrame indexed by ticker with OHLCV} straight
    from the breadth grouped cache. Omit it to get the buckets only.
    """
    buckets = []
    for lo, hi, label in HOLD_BUCKETS:
        group = [t for t in trades
                 if (_num(t.get("duration_days")) is not None
                     and lo <= (_num(t.get("duration_days")) or 0) <= hi)]
        buckets.append({"label": label, "min_days": lo, **_stats(group)})

    # The best bucket by total pnl, among those with enough trades to mean it.
    ranked = [b for b in buckets if b["n"] >= 5]
    best = max(ranked, key=lambda b: b["pnl"]) if ranked else None

    report = {
        "buckets": buckets,
        "best_bucket": best,
        "median_hold_days": _median([_num(t.get("duration_days")) for t in trades]),
    }

    if bars_by_date:
        post = post_exit_excursion(trades, bars_by_date, post_exit_sessions)
        report["post_exit"] = post
        report["verdict"] = _hold_verdict(best, post, post_exit_sessions)
    return report


def _hold_verdict(best_bucket: Optional[dict], post: dict, sessions: int) -> dict:
    """Reconcile the bucket table against the causal test — they disagree.

    The bucket table is **confounded by selection**: a trade only lands in the
    "9d+" bucket if it was still worth holding on day 9. Winners get held and
    losers get cut, so long holds look profitable no matter what the holding
    period is actually worth. Reading it as "hold longer to make money" inverts
    cause and effect.

    `post_exit_excursion` is the unconfounded test, because it asks the
    counterfactual on *every* closed trade regardless of outcome: would holding
    `sessions` longer have made money? That is the number to act on, and it can
    (and here does) disagree with the buckets.
    """
    net = post.get("net_if_held")
    if net is None or not post.get("analyzed"):
        return {"supported": None, "headline": "Not enough price history to test.", "detail": ""}

    supported = net > 0
    bucket_label = best_bucket["label"] if best_bucket else "—"
    return {
        "supported": supported,
        "sessions": sessions,
        "net_if_held": net,
        "headline": (
            f"Holding {sessions} more sessions would have made {net:+,.0f}."
            if supported else
            f"Holding {sessions} more sessions would have cost {abs(net):,.0f}."
        ),
        "detail": (
            f"The bucket table shows {bucket_label} as the best holding period, but that table is "
            f"confounded — a trade only reaches a long bucket if it was still working, so winners "
            f"sort themselves into it. Tested against every closed trade instead, holding "
            f"{sessions} more sessions came out "
            + ("ahead" if supported else "behind")
            + f" by {abs(net):,.0f} "
            f"({post['exits_too_early']} exits gave money up, {post['exits_justified']} saved it). "
            + ("The long-hold read survives the test."
               if supported else
               "So the exits are not the leak at this horizon — entry selection is.")
        ),
    }


def _median(values: Iterable[Any]) -> Optional[float]:
    nums = sorted(v for v in (_num(x) for x in values) if v is not None)
    if not nums:
        return None
    mid = len(nums) // 2
    return float(nums[mid]) if len(nums) % 2 else round((nums[mid - 1] + nums[mid]) / 2, 1)


def post_exit_excursion(trades: list[dict], bars_by_date: dict,
                        sessions: int = POST_EXIT_SESSIONS) -> dict:
    """What the trade did in the `sessions` after it was closed.

    Two different numbers, and the distinction matters more than the analysis:

    - **held_pct / held_dollars** — the price at the *close* of the last session
      in the window vs the exit price. This is a decision you could actually
      have taken ("hold N more sessions, then sell"), so it is the headline.
    - **max_pct** — the best price touched anywhere in the window. A maximum is
      structurally biased upward: over ten sessions almost any volatile name
      prints a good high somewhere, and nobody exits there. Reported only as an
      upper bound, never as money "lost".

    Summing maxima across trades would produce a large, motivating, and entirely
    fictional number. The honest question is whether *holding* beat *exiting*.

    NOTE the grouped cache is **unadjusted**, so a split inside the window reads
    as a huge move. Moves beyond ±90% are dropped rather than trusted (the same
    hazard `parabolic._is_probable_split` guards, applied bluntly here because a
    single artefact would dominate the totals).
    """
    session_days = sorted(bars_by_date.keys())
    rows: list[dict] = []

    for trade in trades:
        exit_day = _to_date(trade.get("exit_date"))
        exit_price = _num(trade.get("exit_price"))
        symbol = str(trade.get("symbol") or "").upper()
        qty = abs(_num(trade.get("quantity")) or 0)
        if not exit_day or not exit_price or not symbol or not qty:
            continue

        forward = [d for d in session_days if d > exit_day][:sessions]
        if not forward:
            continue

        direction = _direction_of(trade)
        best_price, best_day, last_close = None, None, None
        for d in forward:
            frame = bars_by_date.get(d)
            if frame is None or symbol not in frame.index:
                continue
            try:
                hi = float(frame.at[symbol, "high"])
                lo = float(frame.at[symbol, "low"])
                last_close = float(frame.at[symbol, "close"])
            except (KeyError, TypeError, ValueError):
                continue
            candidate = hi if direction == "long" else lo
            if best_price is None or (candidate > best_price if direction == "long"
                                      else candidate < best_price):
                best_price, best_day = candidate, d
        if best_price is None or last_close is None:
            continue

        def _move(price: float) -> float:
            return ((price - exit_price) / exit_price * 100) if direction == "long" \
                else ((exit_price - price) / exit_price * 100)

        max_pct, held_pct = _move(best_price), _move(last_close)
        if abs(max_pct) > 90 or abs(held_pct) > 90:  # unadjusted-cache artefact
            continue

        rows.append({
            "symbol": symbol,
            "exit_date": exit_day.isoformat(),
            "exit_price": exit_price,
            "held_price": round(last_close, 4),
            "held_pct": round(held_pct, 2),
            "held_dollars": round(held_pct / 100 * exit_price * qty, 2),
            "max_price": round(best_price, 4),
            "max_pct": round(max_pct, 2),
            "max_date": best_day.isoformat() if best_day else None,
            "pnl": round(_num(trade.get("pnl")) or 0.0, 2),
            "duration_days": _num(trade.get("duration_days")),
            "setup": str(trade.get("setup") or "").strip(),
            "exit_reason": str(trade.get("exit_reason") or "").strip() or None,
        })

    # Split on the achievable number, not the maximum.
    gave_up = [r for r in rows if r["held_dollars"] > 0]
    saved = [r for r in rows if r["held_dollars"] <= 0]
    worst = sorted(gave_up, key=lambda r: -r["held_dollars"])[:12]
    n = len(rows)

    return {
        "sessions": sessions,
        "analyzed": n,
        # Net effect of a blanket "hold `sessions` longer" rule. Positive means
        # exiting cost money on aggregate; negative means the exits were right.
        "net_if_held": round(sum(r["held_dollars"] for r in rows), 2),
        "gave_up": round(sum(r["held_dollars"] for r in gave_up), 2),
        "saved": round(-sum(r["held_dollars"] for r in saved), 2),
        "exits_too_early": len(gave_up),
        "exits_justified": len(saved),
        "median_held_pct": _median([r["held_pct"] for r in rows]),
        # Upper bound only — see the docstring. Kept so the UI can show the gap
        # between "held to the close" and "sold the high" without conflating them.
        "median_max_pct": _median([r["max_pct"] for r in rows]),
        "worst": worst,
        "by_reason": _excursion_by_reason(rows),
    }


def _excursion_by_reason(rows: list[dict]) -> list[dict]:
    """Which *kind* of exit gives up the most — the point of tagging exits.

    An exit that leaves money behind is not automatically a mistake: a stop that
    fires before a reversal did its job. Grouping by reason separates the exits
    worth changing ("took profit early") from the ones worth keeping.
    """
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        groups[r["exit_reason"] or "(untagged)"].append(r)

    out = []
    for reason, group in groups.items():
        held = sum(r["held_dollars"] for r in group)
        out.append({
            "reason": reason,
            "n": len(group),
            "held_dollars": round(held, 2),
            "avg_held_dollars": round(held / len(group), 2),
            "median_held_pct": _median([r["held_pct"] for r in group]),
            "pnl": round(sum(r["pnl"] for r in group), 2),
        })
    out.sort(key=lambda g: -g["held_dollars"])
    return out


# --- 3. Setup decay ---------------------------------------------------------

def setup_decay(trades: list[dict], window: int = DECAY_WINDOW,
                min_trades: int = DECAY_MIN_TRADES) -> dict:
    """Rolling per-setup health: is this edge still working, or is it done?

    For each setup label we compare the most recent `window` trades against the
    `window` before them. A setup is only judged once it has `min_trades`
    recent samples — below that the sample says nothing and we say so rather
    than printing a number that invites action.

    Verdicts:
      dead     — recent window is losing with a win rate under 20%
      decaying — recent window is worse than the prior window on both pnl and
                 win rate (the edge is directionally deteriorating)
      thin     — not enough recent trades to judge
      healthy  — everything else
    """
    by_setup: dict[str, list[dict]] = defaultdict(list)
    for t in trades:
        label = str(t.get("setup") or "").strip() or "(untagged)"
        by_setup[label].append(t)

    out = []
    for label, group in by_setup.items():
        group.sort(key=lambda t: (_to_date(t.get("exit_date")) or date.min))
        recent = group[-window:]
        prior = group[-2 * window:-window]
        r_stats, p_stats = _stats(recent), _stats(prior)

        if r_stats["n"] < min_trades:
            plural = "" if r_stats["n"] == 1 else "s"
            verdict, why = "thin", f"only {r_stats['n']} recent trade{plural} — not enough to judge"
        elif r_stats["pnl"] < 0 and (r_stats["win_rate"] or 0) < 20:
            verdict, why = "dead", (
                f"last {r_stats['n']} trades: {r_stats['win_rate']:.0f}% win, "
                f"{r_stats['pnl']:+,.0f}"
            )
        elif (p_stats["n"] >= min_trades
              and r_stats["pnl"] < p_stats["pnl"]
              and (r_stats["win_rate"] or 0) < (p_stats["win_rate"] or 0)):
            verdict, why = "decaying", (
                f"win rate {p_stats['win_rate']:.0f}% → {r_stats['win_rate']:.0f}%, "
                f"pnl {p_stats['pnl']:+,.0f} → {r_stats['pnl']:+,.0f}"
            )
        else:
            verdict, why = "healthy", (
                f"last {r_stats['n']} trades: {r_stats['win_rate']:.0f}% win, "
                f"{r_stats['pnl']:+,.0f}"
            )

        out.append({
            "setup": label,
            "family": setup_family(label),
            "verdict": verdict,
            "why": why,
            "recent": r_stats,
            "prior": p_stats,
            "all_time": _stats(group),
            "last_traded": (_to_date(group[-1].get("exit_date")) or date.min).isoformat()
            if _to_date(group[-1].get("exit_date")) else None,
        })

    order = {"dead": 0, "decaying": 1, "healthy": 2, "thin": 3}
    out.sort(key=lambda s: (order[s["verdict"]], s["recent"]["pnl"]))

    families = {
        fam: _stats([t for t in trades if setup_family(t.get("setup")) == fam])
        for fam in ("HTF", "EP", "RANDOM", "UNTAGGED")
    }

    return {
        "window": window,
        "setups": out,
        "families": families,
        "retire": [s["setup"] for s in out if s["verdict"] == "dead"],
    }


# --- 4. Circuit breaker -----------------------------------------------------

def circuit_breaker(plans: list[dict], trades: list[dict],
                    today: Optional[date] = None) -> dict:
    """The cheap per-day read that gates the Trade Today verdict.

    Deliberately narrow: has a plan been logged today, and what have the
    unplanned trades cost this month. The gate is *withholding*, not blocking —
    it refuses to hand over a green verdict until a plan exists, because the
    verdict is what gets used to justify the trade.
    """
    today = today or date.today()
    today_iso = today.isoformat()
    month_start = today.replace(day=1)

    todays_plans = [p for p in plans if str(p.get("created_at") or "").startswith(today_iso)]

    mtd = [t for t in trades
           if (_to_date(t.get("entry_date")) or date.min) >= month_start]
    mtd_unplanned = [t for t in mtd if setup_family(t.get("setup")) in ("RANDOM", "UNTAGGED")]
    mtd_planned = [t for t in mtd if setup_family(t.get("setup")) in ("HTF", "EP")]

    exits = [d for d in (_to_date(t.get("exit_date")) for t in trades) if d]

    return {
        "date": today_iso,
        "plans_today": len(todays_plans),
        "plan_symbols": [p.get("symbol") for p in todays_plans],
        "clear": len(todays_plans) > 0,
        "reason": None if todays_plans else
                  "No plan logged today. The day's verdict stays hidden until one exists — "
                  "a green light you did not plan against is how a Random trade starts.",
        "mtd": {
            "unplanned": _stats(mtd_unplanned),
            "planned": _stats(mtd_planned),
            "total": _stats(mtd),
        },
        # The workbook lags live trading (the formatter runs after the session),
        # so the UI can caveat month-to-date figures that don't include today.
        "trades_through": max(exits).isoformat() if exits else None,
    }
