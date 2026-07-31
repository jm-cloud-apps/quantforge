"""Turn watch — is the tape *inflecting*, not just where does it sit.

The exposure score is a state machine: it says, with real rigour, where the tape
is right now. What it cannot do is tell you it's about to stop being there — and
for a momentum trader that's the expensive half. The score reads "cash" at the
exact low and only reaches "constructive" once the first leg of the new advance
is already gone. This module watches for the turn so the page can say "something
is changing" while it's still early.

Three independent reads, deliberately kept separate rather than blended into one
number — they fire at different times and mean different things:

  1. WASHED OUT BUT HOLDING — breadth in the bottom quintile while the indices
     are only a few percent off their highs with a rising 50-day. Selling has
     been broad but price structure never broke: the classic shallow-correction
     bottom. This is the one a pure breadth gauge misses completely, because
     breadth looks apocalyptic exactly when the setup is best.

  2. BREADTH UPTURN — the score is lifting off a recent floor. Not "it's high
     again" (that's the old signal, and it's late) but "it stopped falling and
     has come up off the low", which is days-to-weeks earlier.

  3. FOLLOW-THROUGH DAY — O'Neil's confirmation, and the only one of the three
     that is a genuine *trigger* rather than a heads-up. After a correction low,
     the market attempts a rally; somewhere from day 4 onward one of the indices
     posts a decisive up-day on HEAVIER volume than the prior session. Volume is
     the whole point: a quiet bounce is short covering, a loud one is
     institutions re-entering. Rallies without an FTD overwhelmingly fail, which
     is why it's the standard re-entry gate.

Everything is computed from the shared grouped-daily cache. Pure, no network.
"""

from __future__ import annotations

import logging

import pandas as pd

from .cache import list_cached_days, load_cached_day

logger = logging.getLogger(__name__)

INDEX_ETFS = ("SPY", "QQQ", "IWM")

SMA_FAST = 20
SMA_SLOW = 50

# --- Follow-through day -----------------------------------------------------
# O'Neil's original spec is ~1.7% on the Nasdaq; that was calibrated on a more
# volatile index in a different era, and modern practice on SPY-like ETFs uses
# roughly 1.0-1.5%. We take 1.0% and REQUIRE the volume expansion, which is the
# part that actually separates a real FTD from a dead-cat bounce.
FTD_MIN_GAIN_PCT = 1.0
FTD_MIN_DAY = 4        # before day 4 a bounce hasn't proven anything
FTD_MAX_DAY = 15       # past ~3 weeks it's not "the turn" any more
RALLY_LOOKBACK = 45    # sessions searched for the correction low

# --- Washed-out-but-holding -------------------------------------------------
BOTTOM_PCTL = 25           # breadth in its bottom quartile vs its own history
SHALLOW_OFF_HIGH_PCT = 8.0  # indices still within this % of the window high

# --- Breadth upturn ---------------------------------------------------------
UPTURN_LOOKBACK = 10       # window in which we look for the score's floor
UPTURN_MIN_RISE = 8        # score points off that floor to count as lifting


def _load_bars(lookback: int = 120) -> dict[str, pd.DataFrame]:
    """Close+volume series per index ETF from the grouped-daily cache."""
    days = list_cached_days()
    if not days:
        return {}
    days = days[-lookback:]
    rows: dict[str, list] = {s: [] for s in INDEX_ETFS}
    dates: list = []
    for d in days:
        df = load_cached_day(d)
        if df is None or df.empty:
            continue
        dates.append(d)
        for sym in INDEX_ETFS:
            try:
                rows[sym].append((float(df.at[sym, "close"]), float(df.at[sym, "volume"])))
            except (KeyError, ValueError, TypeError):
                rows[sym].append((None, None))
    out = {}
    for sym in INDEX_ETFS:
        frame = pd.DataFrame(rows[sym], columns=["close", "volume"], index=dates).dropna()
        if len(frame) >= FTD_MIN_DAY + 2:
            out[sym] = frame
    return out


def load_bars(lookback: int = 600) -> dict[str, pd.DataFrame]:
    """Public wrapper — the scorecard needs the same bars to replay history."""
    return _load_bars(lookback)


def posture_at(frames: dict[str, pd.DataFrame], upto: int) -> list[dict]:
    """Index posture AS OF a historical bar index, in index_trend's row shape.

    `index_trend()` only ever describes today. Measuring whether a divergence
    call actually predicted anything means reconstructing what it would have
    said on each past date, which is what this does — same fields, computed off
    a truncated series.
    """
    out = []
    for sym, frame in frames.items():
        s = frame["close"].iloc[: upto + 1]
        if len(s) < SMA_SLOW + 11:
            out.append({"symbol": sym, "available": False})
            continue
        last = float(s.iloc[-1])
        sma20 = float(s.rolling(SMA_FAST).mean().iloc[-1])
        sma50_series = s.rolling(SMA_SLOW).mean()
        sma50 = float(sma50_series.iloc[-1])
        above20, above50 = last > sma20, last > sma50
        trend = "up" if (above20 and above50) else ("down" if not (above20 or above50) else "mixed")
        hi = float(s.max())
        out.append({
            "symbol": sym, "available": True, "trend": trend,
            "above_sma20": above20, "above_sma50": above50,
            "sma50_rising": bool(sma50_series.iloc[-1] > sma50_series.iloc[-11]),
            "pct_from_high": (last / hi - 1.0) if hi else None,
        })
    return out


def follow_through(frame: pd.DataFrame) -> dict | None:
    """Look for a follow-through day in the current rally attempt.

    Anchors on the lowest close of the lookback window, counts sessions from
    there (the low itself is day 0), and reports the first qualifying day: a gain
    of at least FTD_MIN_GAIN_PCT on volume above the prior session, landing
    between FTD_MIN_DAY and FTD_MAX_DAY.
    """
    if frame is None or len(frame) < FTD_MIN_DAY + 2:
        return None
    window = frame.iloc[-RALLY_LOOKBACK:]
    closes = window["close"].to_numpy(dtype=float)
    vols = window["volume"].to_numpy(dtype=float)
    low_i = int(closes.argmin())

    # The rally has to still be young enough to be "the turn".
    days_since_low = len(closes) - 1 - low_i
    if days_since_low < FTD_MIN_DAY or days_since_low > FTD_MAX_DAY + 5:
        return {"found": False, "days_since_low": days_since_low,
                "low_close": round(float(closes[low_i]), 2)}

    for i in range(low_i + FTD_MIN_DAY, len(closes)):
        day_n = i - low_i
        if day_n > FTD_MAX_DAY:
            break
        gain = (closes[i] / closes[i - 1] - 1.0) * 100.0
        heavier = vols[i] > vols[i - 1]
        if gain >= FTD_MIN_GAIN_PCT and heavier:
            return {
                "found": True,
                "day": day_n,
                "gain_pct": round(gain, 2),
                "vol_ratio": round(float(vols[i] / vols[i - 1]), 2),
                "sessions_ago": len(closes) - 1 - i,
                "low_close": round(float(closes[low_i]), 2),
                "days_since_low": days_since_low,
            }
    return {"found": False, "days_since_low": days_since_low,
            "low_close": round(float(closes[low_i]), 2)}


def assess_turn(score, percentile, trend, indices) -> dict:
    """Build the turn-watch payload.

    `trend` is the situational score series (oldest→newest, [{date, score}]);
    `indices` is the index_trend `indices` list (posture + distance off high).
    """
    signals: list[dict] = []
    bars = _load_bars()
    avail = [i for i in (indices or []) if i.get("available")]

    # 1 · Washed out but holding — breadth capitulating while price holds.
    if score is not None and percentile is not None and avail:
        offs = [abs((i.get("pct_from_high") or 0) * 100.0) for i in avail]
        rising = [i for i in avail if i.get("sma50_rising")]
        shallow = offs and max(offs) <= SHALLOW_OFF_HIGH_PCT
        if percentile <= BOTTOM_PCTL and shallow and len(rising) >= 2:
            signals.append({
                "key": "washed_out_holding", "tone": "good",
                "label": "Washed out, but price is holding",
                "detail": (
                    f"Breadth is in its bottom quartile ({percentile}th pct) while the indices are at most "
                    f"{max(offs):.1f}% off their highs with {len(rising)} of {len(avail)} 50-days still rising. "
                    "Broad selling that never broke price structure — where shallow-correction bottoms form."
                ),
                "action": "Build the watchlist now and size the first entries small. Don't wait for the score to recover — by then the first leg is gone.",
            })

    # 2 · Breadth upturn — the score lifting off a recent floor.
    if trend and len(trend) >= UPTURN_LOOKBACK:
        recent = [t.get("score") for t in trend[-UPTURN_LOOKBACK:] if t.get("score") is not None]
        if recent and score is not None:
            floor = min(recent)
            rise = score - floor
            floor_idx = recent.index(floor)
            if rise >= UPTURN_MIN_RISE and floor_idx < len(recent) - 1:
                signals.append({
                    "key": "breadth_upturn", "tone": "good",
                    "label": "Breadth is lifting off its floor",
                    "detail": (
                        f"The exposure score has come up {rise} points from a floor of {floor} within the last "
                        f"{UPTURN_LOOKBACK} sessions. Not 'strong' yet — but it stopped falling, which is the part "
                        "that happens first."
                    ),
                    "action": "Treat the next A+ setup as a probe rather than a pass. Confirmation is a follow-through day.",
                })

    # 3 · Follow-through day — the actual trigger.
    ftds = {sym: follow_through(f) for sym, f in bars.items()}
    confirmed = {s: r for s, r in ftds.items() if r and r.get("found")}
    if confirmed:
        best = min(confirmed.items(), key=lambda kv: kv[1]["sessions_ago"])
        sym, r = best
        others = [s for s in confirmed if s != sym]
        signals.append({
            "key": "follow_through", "tone": "good",
            "label": f"Follow-through day — {sym}",
            "detail": (
                f"{sym} gained {r['gain_pct']}% on {r['vol_ratio']}x the prior session's volume, day {r['day']} of the "
                f"rally attempt off the low"
                + (f" ({r['sessions_ago']} sessions ago)" if r["sessions_ago"] else " (today)")
                + (f". Confirmed on {', '.join(others)} too." if others else ".")
                + " Rallies without one overwhelmingly fail; this is the standard re-entry gate."
            ),
            "action": "The confirmation has printed. Re-engage on quality setups at planned size — this is the signal, not the score.",
        })
    elif bars:
        attempts = [r for r in ftds.values() if r and not r.get("found")]
        young = [r for r in attempts if FTD_MIN_DAY <= (r.get("days_since_low") or 0) <= FTD_MAX_DAY]
        if young:
            d = min(r["days_since_low"] for r in young)
            signals.append({
                "key": "rally_attempt", "tone": "info",
                "label": f"Rally attempt underway — day {d}, no follow-through yet",
                "detail": (
                    "The indices are bouncing off a low but no session has yet posted a decisive gain on heavier "
                    "volume. Without that, the bounce is short covering rather than institutions re-entering."
                ),
                "action": "Watch, don't commit. Have the list ready so the follow-through day finds you prepared.",
            })

    return {
        "signals": signals,
        "ftd": ftds,
        "watching": bool(signals),
    }


def index_divergence(score, indices) -> dict | None:
    """Breadth-vs-price disagreement, read across all three indices.

    Replaces a single SPY boolean. The cases that matter to a breakout trader are
    narrowness (megacaps carrying a weak tape), distribution (breadth strong,
    price rolling), and leadership rotation (growth cracking while the broad
    market holds, or the reverse).
    """
    avail = [i for i in (indices or []) if i.get("available")]
    if score is None or not avail:
        return None

    up = [i["symbol"] for i in avail if i.get("trend") == "up"]
    down = [i["symbol"] for i in avail if i.get("trend") == "down"]
    rising50 = [i["symbol"] for i in avail if i.get("sma50_rising")]
    falling50 = [i["symbol"] for i in avail if i.get("sma50_rising") is False]

    if score >= 60 and len(down) >= 2:
        return {"tone": "warn", "label": "Price isn't confirming",
                "text": f"Breadth reads risk-on ({score}) but {', '.join(down)} sit below their 20- and 50-day. "
                        "Distribution under a healthy-looking average stock — treat longs as guilty until proven."}
    if score < 45 and len(up) >= 2:
        return {"tone": "warn", "label": "Narrow, megacap-led tape",
                "text": f"Breadth is cautious ({score}) while {', '.join(up)} hold their trend — the index is being "
                        "carried by a few names. Trade only the leaders, or wait for breadth to catch up."}
    # Leadership rotation — same posture, different engines.
    if falling50 and rising50 and len(falling50) < len(avail):
        return {"tone": "info", "label": "Leadership is rotating",
                "text": f"{', '.join(falling50)} has a falling 50-day while {', '.join(rising50)} is still rising. "
                        "The averages agree on direction but not on who's driving — check Sector Scan before "
                        "assuming your usual names are the right ones."}
    if score < 45 and len(down) == len(avail) and len(rising50) >= 2:
        return {"tone": "good", "label": "Weak breadth, intact structure",
                "text": f"Breadth is soft ({score}) and every index is under its 20/50 — but {len(rising50)} of "
                        f"{len(avail)} 50-days are still rising. A pullback inside an uptrend, not a broken market."}
    return None
