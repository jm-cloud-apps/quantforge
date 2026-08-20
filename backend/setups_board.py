"""Setups Board aggregation — pure functions over the five setup-scanner payloads.

The board is a read-only *aggregation* over the scanners in section 2 · Find
Setups. Given each scanner's already-computed payload (fetched and cached by its
own endpoint), this returns the board model: per-setup top-N lanes plus the
*confluence* set — the symbols flagged by 2+ scanners at once, the one signal no
single scanner page can show. No I/O here; the caller (main.py) fetches the
sources and owns the cache, so this stays a deterministic pure function.

Each source payload keys into `sources` by name; a source that failed to load is
passed through as `{"error": "..."}` and its lane renders an error without taking
the rest of the board down.
"""

from __future__ import annotations


def _num(v):
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def _pct(v) -> str:
    n = _num(v)
    return "—" if n is None else f"{'+' if n >= 0 else ''}{v}%"


# --- Per-scanner row → common board shape { symbol, close, score, headline, detail }
def _ma_reclaim_norm(c):
    age = c.get("reclaim_age")
    turning = "turning" in (c.get("signal") or "")
    return {
        "symbol": c.get("symbol"),
        "close": c.get("close"),
        "score": c.get("quality"),
        "headline": "crossed today" if age == 0 else f"reclaimed {age}d ago",
        "detail": f"below {c.get('days_below')}d · " + ("MA turning up" if turning else "200d flat/down"),
    }


def _stage_norm(c):
    rs = c.get("rs_rank")
    return {
        "symbol": c.get("symbol"),
        "close": c.get("close"),
        "score": c.get("quality"),
        "headline": c.get("signal"),
        "detail": f"RS {rs if rs is not None else '—'} · {_pct(c.get('pct_vs_ma'))} vs 30wk",
    }


def _breakout_norm(r):
    dist = _num(r.get("distance_pct"))
    adr = _num(r.get("adr_pct"))
    detail = f"{dist * 100:.1f}% to pivot" if dist is not None else "—"
    if adr is not None:
        detail += f" · ADR {adr * 100:.1f}%"
    return {
        "symbol": r.get("symbol"),
        "close": r.get("last_close"),
        "score": r.get("score"),
        "headline": r.get("status") or "Breakout",
        "detail": detail,
    }


def _ep9m_norm(c):
    return {
        "symbol": c.get("symbol"),
        "close": c.get("close"),
        "score": None,  # no native 0–100; DCR% is the headline quality read
        "headline": f"{c.get('dcr_pct')}% DCR",
        "detail": f"{c.get('expansion_mult')}× expansion · " + ("not late" if c.get("not_late") else "late"),
    }


def _reversal_norm(c):
    tbr = c.get("tail_body_ratio")
    return {
        "symbol": c.get("symbol"),
        "close": c.get("close"),
        "score": None,
        "headline": f"{c.get('recovery_pct')}% recovery",
        "detail": "doji / hammer tail" if tbr is None else f"{tbr}× tail",
    }


def _parabolic_norm(c):
    return {
        "symbol": c.get("symbol"),
        "close": c.get("close"),
        "score": None,
        "headline": f"+{c.get('gain_pct')}% run",
        "detail": f"{c.get('up_days')}d up · {c.get('ext_pct')}% over the 10",
    }


def _breakdown_norm(c):
    return {
        "symbol": c.get("symbol"),
        "close": c.get("close"),
        "score": None,
        "headline": "at a declining rail" if c.get("at_rail") else f"{c.get('to_ma10_pct')}% under the 10",
        "detail": f"20d {c.get('slope20_per_week')}%/wk · {c.get('days_below_50')}d below the 50",
    }


# Lane config: which source payload, how to pull its actionable rows, how to
# normalize each. Order here is the order lanes appear on the board.
#
# `direction` is load-bearing, not decoration: it groups the board into long and
# short blocks AND keeps confluence honest. A symbol appearing in a long lane and
# a short lane is a CONTRADICTION, not conviction — see build_board.
LANES = [
    {"key": "ma-reclaim", "label": "200 MA Reclaim", "route": "/ma-reclaim", "accent": "emerald",
     "direction": "long",
     "src": "ma_reclaim", "rows": lambda d: d.get("candidates") or [], "norm": _ma_reclaim_norm},
    {"key": "stage-analysis", "label": "Stage 1→2", "route": "/stage-analysis", "accent": "sky",
     "direction": "long", "src": "stage",
     # Only the actionable transitions belong on a board — not the whole Stage-2 herd.
     "rows": lambda d: [c for c in (d.get("candidates") or [])
                        if c.get("entering_stage2") or c.get("breakout_watch")],
     "norm": _stage_norm},
    {"key": "breakouts", "label": "Breakouts", "route": "/breakouts", "accent": "violet",
     "direction": "long",
     "src": "breakouts", "rows": lambda d: d.get("results") or [], "norm": _breakout_norm},
    {"key": "scanner-9m", "label": "$9M Scanner", "route": "/scanner-9m", "accent": "amber",
     "direction": "long",
     "src": "ep9m", "rows": lambda d: d.get("candidates") or [], "norm": _ep9m_norm},
    {"key": "reversal-setup", "label": "Reversal", "route": "/reversal-setup", "accent": "rose",
     "direction": "long",
     "src": "reversal", "rows": lambda d: d.get("candidates") or [], "norm": _reversal_norm},
    # ── Short side ──────────────────────────────────────────────────────────
    {"key": "parabolic-short", "label": "Parabolic Short", "route": "/parabolic-short", "accent": "rose",
     "direction": "short",
     "src": "parabolic", "rows": lambda d: d.get("candidates") or [], "norm": _parabolic_norm},
    {"key": "breakdown-short", "label": "Breakdown Short", "route": "/breakdown-short", "accent": "rose",
     "direction": "short",
     # The board wants the tradeable ones: price back at a declining rail, not
     # names that already flushed 25% and are prime squeeze candidates.
     "rows": lambda d: [c for c in (d.get("candidates") or []) if c.get("at_rail")],
     "src": "breakdown", "norm": _breakdown_norm},
]


def _date_only(s):
    """Scanners report as_of as either a date or a datetime; keep the calendar date."""
    return s[:10] if isinstance(s, str) else s


# The banner used to show only the stance label and the score, which states the
# conclusion without the argument: "Aggressive · 82/100" gives no way to tell a
# tape carried by broad leadership from one riding a single thrust reading, and
# no sense of how close the read sits to flipping. `situational.assess` already
# computes both — the per-factor driver ledger and the band arithmetic — so the
# board passes them through rather than deriving a second explanation of its own
# (there is exactly one exposure score; there should be exactly one story about
# why). Kept lean: only the factors that actually moved the score off 50.
_MAX_DRIVERS = 6


def _regime_view(reg: dict) -> dict | None:
    """Board-shaped view of the situational read, including *why* it says that."""
    if not reg or reg.get("error"):
        return None

    drivers = [
        {"label": d.get("label"), "points": d.get("points"),
         "detail": d.get("detail"), "tone": d.get("tone")}
        for d in (reg.get("drivers") or []) if d.get("points")
    ][:_MAX_DRIVERS]

    ex = reg.get("explanation") or {}
    explanation = {
        "summary": ex.get("summary"),
        "baseline": ex.get("baseline", 50),
        "bullPoints": ex.get("bull_points"),
        "bearPoints": ex.get("bear_points"),
        # What would move the stance — the read is a band, not a point.
        "toUp": ex.get("to_up"),
        "toDown": ex.get("to_down"),
    } if ex else None

    # The board groups its lanes long / short, so it needs to know which book is
    # in season — and `day_verdict` already answers exactly that, per direction,
    # as the thing Trade Today acts on. Passing it through means the board gates
    # on the same call rather than inferring a second one from the stance label:
    # "defensive" does NOT imply shorts are on (the verdict only says yes once
    # the Shorts/Hedges family has its own green), and that distinction is the
    # whole point of the rule ladder in `situational.day_verdict`.
    v = reg.get("verdict") or {}
    verdict = {
        "code": v.get("code"),
        "label": v.get("label"),
        "why": v.get("why"),
        # "yes" | "stalk" | "no" — per-direction permission for NEW risk.
        "newLong": v.get("new_long"),
        "newShort": v.get("new_short"),
    } if v else None

    return {
        "score": reg.get("score"),
        "stance": reg.get("stance"),
        "asOf": _date_only(reg.get("as_of")),
        "delta5d": reg.get("score_delta_5d"),
        "drivers": drivers,
        "explanation": explanation,
        "verdict": verdict,
    }


def build_board(sources: dict, per_lane: int = 8, confluence_scan: int = 40) -> dict:
    """Assemble the board payload from each scanner's raw response.

    `per_lane` rows are shown per lane; confluence is computed over the top
    `confluence_scan` of each lane (a wider net than we display) so overlaps just
    outside the visible top-N still surface.
    """
    lanes = []
    for lane in LANES:
        payload = sources.get(lane["src"]) or {}
        base = {"key": lane["key"], "label": lane["label"], "route": lane["route"],
                "accent": lane["accent"], "direction": lane.get("direction", "long")}
        # A source that outright failed (error and no data) → error lane.
        if payload.get("error") and not (payload.get("candidates") or payload.get("results")):
            lanes.append({**base, "asOf": None, "count": 0, "items": [], "scanRows": [],
                          "error": str(payload.get("error"))})
            continue
        try:
            rows = [lane["norm"](r) for r in lane["rows"](payload)]
            rows = [r for r in rows if r.get("symbol")]
        except Exception:
            lanes.append({**base, "asOf": _date_only(payload.get("as_of")), "count": 0, "items": [],
                          "scanRows": [], "error": "Unexpected response shape"})
            continue
        lanes.append({
            **base,
            "asOf": _date_only(payload.get("as_of")),
            "count": len(rows),
            "items": rows[:per_lane],
            "scanRows": rows[:confluence_scan],  # wider net for confluence
            "error": payload.get("error"),
        })

    # Confluence: a symbol surfacing across ≥ 2 scanners is the board's headline
    # signal — high conviction, and invisible on any single scanner page.
    #
    # Direction matters here. Once short lanes exist, a naive count would treat a
    # name that is BOTH a long setup and a short setup as the highest-conviction
    # idea on the board, when it's the opposite: two scanners disagreeing about
    # which way it goes. So agreement is counted WITHIN a direction, and
    # cross-direction overlaps are reported separately as `conflicts` — useful to
    # see (usually a violently extended name), but never presented as conviction.
    by_symbol: dict = {}
    for lane in lanes:
        for it in lane["scanRows"]:
            by_symbol.setdefault(it["symbol"], []).append({
                "key": lane["key"], "label": lane["label"], "accent": lane["accent"],
                "direction": lane.get("direction", "long"),
                "score": it.get("score"), "close": it.get("close"),
            })

    confluence, conflicts = [], []
    for symbol, hits in by_symbol.items():
        close = next((h["close"] for h in hits if h.get("close") is not None), None)
        by_dir = {"long": [h for h in hits if h["direction"] == "long"],
                  "short": [h for h in hits if h["direction"] == "short"]}

        if by_dir["long"] and by_dir["short"]:
            conflicts.append({
                "symbol": symbol, "close": close,
                "long": by_dir["long"], "short": by_dir["short"],
            })
            continue    # contradictory — never counted as conviction

        for direction, dir_hits in by_dir.items():
            if len(dir_hits) < 2:
                continue
            best = max([h.get("score") or 0 for h in dir_hits] or [0])
            confluence.append({"symbol": symbol, "direction": direction, "hits": dir_hits,
                               "close": close, "bestScore": best})

    confluence.sort(key=lambda c: (-len(c["hits"]), -(c["bestScore"] or 0)))
    conflicts.sort(key=lambda c: c["symbol"])

    # Trim the wide scan set out of the returned lanes to keep the payload lean.
    lane_out = [{k: v for k, v in lane.items() if k != "scanRows"} for lane in lanes]

    regime = _regime_view(sources.get("regime") or {})

    as_ofs = sorted([l["asOf"] for l in lane_out if l.get("asOf")])
    as_of = as_ofs[-1] if as_ofs else (regime.get("asOf") if regime else None)

    return {"asOf": as_of, "regime": regime, "lanes": lane_out,
            "confluence": confluence, "conflicts": conflicts}
