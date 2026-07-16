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


# Lane config: which source payload, how to pull its actionable rows, how to
# normalize each. Order here is the order lanes appear on the board.
LANES = [
    {"key": "ma-reclaim", "label": "200 MA Reclaim", "route": "/ma-reclaim", "accent": "emerald",
     "src": "ma_reclaim", "rows": lambda d: d.get("candidates") or [], "norm": _ma_reclaim_norm},
    {"key": "stage-analysis", "label": "Stage 1→2", "route": "/stage-analysis", "accent": "sky",
     "src": "stage",
     # Only the actionable transitions belong on a board — not the whole Stage-2 herd.
     "rows": lambda d: [c for c in (d.get("candidates") or [])
                        if c.get("entering_stage2") or c.get("breakout_watch")],
     "norm": _stage_norm},
    {"key": "breakouts", "label": "Breakouts", "route": "/breakouts", "accent": "violet",
     "src": "breakouts", "rows": lambda d: d.get("results") or [], "norm": _breakout_norm},
    {"key": "scanner-9m", "label": "$9M Scanner", "route": "/scanner-9m", "accent": "amber",
     "src": "ep9m", "rows": lambda d: d.get("candidates") or [], "norm": _ep9m_norm},
    {"key": "reversal-setup", "label": "Reversal", "route": "/reversal-setup", "accent": "rose",
     "src": "reversal", "rows": lambda d: d.get("candidates") or [], "norm": _reversal_norm},
]


def _date_only(s):
    """Scanners report as_of as either a date or a datetime; keep the calendar date."""
    return s[:10] if isinstance(s, str) else s


def build_board(sources: dict, per_lane: int = 8, confluence_scan: int = 40) -> dict:
    """Assemble the board payload from each scanner's raw response.

    `per_lane` rows are shown per lane; confluence is computed over the top
    `confluence_scan` of each lane (a wider net than we display) so overlaps just
    outside the visible top-N still surface.
    """
    lanes = []
    for lane in LANES:
        payload = sources.get(lane["src"]) or {}
        base = {"key": lane["key"], "label": lane["label"], "route": lane["route"], "accent": lane["accent"]}
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
    by_symbol: dict = {}
    for lane in lanes:
        for it in lane["scanRows"]:
            by_symbol.setdefault(it["symbol"], []).append({
                "key": lane["key"], "label": lane["label"], "accent": lane["accent"],
                "score": it.get("score"), "close": it.get("close"),
            })
    confluence = []
    for symbol, hits in by_symbol.items():
        if len(hits) < 2:
            continue
        close = next((h["close"] for h in hits if h.get("close") is not None), None)
        best = max([h.get("score") or 0 for h in hits] or [0])
        confluence.append({"symbol": symbol, "hits": hits, "close": close, "bestScore": best})
    confluence.sort(key=lambda c: (-len(c["hits"]), -(c["bestScore"] or 0)))

    # Trim the wide scan set out of the returned lanes to keep the payload lean.
    lane_out = [{k: v for k, v in lane.items() if k != "scanRows"} for lane in lanes]

    regime = None
    reg = sources.get("regime") or {}
    if reg and not reg.get("error"):
        regime = {
            "score": reg.get("score"),
            "stance": reg.get("stance"),
            "asOf": _date_only(reg.get("as_of")),
            "delta5d": reg.get("score_delta_5d"),
        }

    as_ofs = sorted([l["asOf"] for l in lane_out if l.get("asOf")])
    as_of = as_ofs[-1] if as_ofs else (regime.get("asOf") if regime else None)

    return {"asOf": as_of, "regime": regime, "lanes": lane_out, "confluence": confluence}
