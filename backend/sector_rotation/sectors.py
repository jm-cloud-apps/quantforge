"""Symbol→sector mapping for the liquid US universe.

Massive's bulk ticker list carries no industry data; only the per-ticker
overview (`/v3/reference/tickers/{ticker}`) returns `sic_code`. So we map the
~1,500 most-liquid common stocks (liquidity computed locally from the grouped
cache — median 20-day dollar volume) and persist the result to
`data/sector_rotation/sector_map.json`. SIC → sector is a static table
(approximate GICS 11-sector scheme; documented inline). Sector membership is
near-static, so entries are fetched once and only *missing* symbols are
topped up on later refreshes.

The first warm is ~1,500 API calls; it runs in a background thread with
progress state so the endpoint can return `warming` instead of blocking.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

from .panel import build_panels

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data" / "sector_rotation"
DATA_DIR.mkdir(parents=True, exist_ok=True)
MAP_PATH = DATA_DIR / "sector_map.json"

BASE_URL = "https://api.massive.com"

DEFAULT_TOP_N = 1500

# The 11-sector scheme every card/ETF maps onto. Kept as an explicit list so
# internals/leaders never invent a sector the UI doesn't know.
SECTOR_ETF: dict[str, str] = {
    "Technology": "XLK",
    "Financials": "XLF",
    "Healthcare": "XLV",
    "Energy": "XLE",
    "Consumer Discretionary": "XLY",
    "Consumer Staples": "XLP",
    "Industrials": "XLI",
    "Materials": "XLB",
    "Real Estate": "XLRE",
    "Utilities": "XLU",
    "Communication Services": "XLC",
}


def sic_to_sector(sic) -> str | None:
    """Approximate GICS sector from a 4-digit SIC code.

    SIC (1987) predates GICS, so this is a pragmatic mapping: specific
    overrides first (pharma inside chemicals, REITs inside holding offices,
    software inside business services…), then the 2-digit major group.
    Unmappable codes return None and the symbol is excluded from sector math.
    """
    try:
        code = int(str(sic).strip()[:4])
    except (ValueError, TypeError):
        return None
    mg = code // 100  # 2-digit major group

    # ── specific overrides (more precise than the major group) ──────────
    if 2833 <= code <= 2836:
        return "Healthcare"                # drugs / biologics inside chemicals
    if 2840 <= code <= 2844:
        return "Consumer Staples"          # soaps / cosmetics
    if 3570 <= code <= 3579:
        return "Technology"                # computers inside machinery
    if 3711 <= code <= 3716:
        return "Consumer Discretionary"    # motor vehicles inside transport eqpt
    if code == 3812:
        return "Industrials"               # defense nav systems inside instruments
    if 3840 <= code <= 3859:
        return "Healthcare"                # medical / dental / ophthalmic devices
    if code == 3630:
        return "Consumer Discretionary"    # household appliances
    if 1520 <= code <= 1540:
        return "Consumer Discretionary"    # homebuilders (GICS: household durables)
    if code == 5412 or code == 5912:
        return "Consumer Staples"          # food & drug stores
    if code == 6798:
        return "Real Estate"               # REITs inside holding offices
    if 7310 <= code <= 7319:
        return "Communication Services"    # advertising inside business services
    if 7370 <= code <= 7379:
        return "Technology"                # software / IT services
    if code == 8731:
        return "Healthcare"                # commercial biological research (CROs)

    # ── major-group defaults ─────────────────────────────────────────────
    table: dict[int, str] = {
        13: "Energy", 29: "Energy",
        10: "Materials", 12: "Materials", 14: "Materials", 24: "Materials",
        26: "Materials", 28: "Materials", 30: "Materials", 32: "Materials", 33: "Materials",
        16: "Industrials", 17: "Industrials", 34: "Industrials", 35: "Industrials",
        37: "Industrials", 40: "Industrials", 41: "Industrials", 42: "Industrials",
        44: "Industrials", 45: "Industrials", 46: "Industrials", 47: "Industrials",
        50: "Industrials", 81: "Industrials", 87: "Industrials",
        1: "Consumer Staples", 2: "Consumer Staples", 20: "Consumer Staples",
        21: "Consumer Staples", 51: "Consumer Staples", 54: "Consumer Staples",
        22: "Consumer Discretionary", 23: "Consumer Discretionary", 25: "Consumer Discretionary",
        31: "Consumer Discretionary", 39: "Consumer Discretionary", 52: "Consumer Discretionary",
        53: "Consumer Discretionary", 55: "Consumer Discretionary", 56: "Consumer Discretionary",
        57: "Consumer Discretionary", 58: "Consumer Discretionary", 59: "Consumer Discretionary",
        70: "Consumer Discretionary", 72: "Consumer Discretionary", 75: "Consumer Discretionary",
        76: "Consumer Discretionary", 79: "Consumer Discretionary", 82: "Consumer Discretionary",
        27: "Communication Services", 48: "Communication Services", 78: "Communication Services",
        36: "Technology", 38: "Technology", 73: "Technology",
        49: "Utilities",
        60: "Financials", 61: "Financials", 62: "Financials", 63: "Financials",
        64: "Financials", 67: "Financials",
        65: "Real Estate",
        80: "Healthcare",
    }
    return table.get(mg)


# ── liquidity ranking (local, from the grouped cache) ────────────────────

def liquid_universe(top_n: int = DEFAULT_TOP_N) -> list[str]:
    """Top-N common stocks by median 20-day dollar volume.

    Intersected with the breadth universe (active US common stocks on major
    exchanges) so ETFs, ADInterims, and junk listings never enter sector math.
    """
    from breadth.universe import load_universe

    uni = set(load_universe().get("symbols") or [])
    if not uni:
        logger.warning("sector_rotation: breadth universe empty — run its refresh first")
        return []

    panels = build_panels(days=20, fields=("close", "volume"))
    close, vol = panels["close"], panels["volume"]
    if close.empty:
        return []
    dollar = (close * vol).median()  # per-symbol median daily $ volume
    dollar = dollar[dollar.index.isin(uni)].dropna()
    return list(dollar.sort_values(ascending=False).head(top_n).index)


# ── persistent sector map + background warm ─────────────────────────────

_lock = threading.Lock()
_state = {"running": False, "done": 0, "total": 0, "error": None}


def load_map() -> dict:
    try:
        with open(MAP_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"as_of": None, "symbols": {}}


def _save_map(payload: dict) -> None:
    tmp = MAP_PATH.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(payload, f)
    tmp.replace(MAP_PATH)


def refresh_progress() -> dict:
    with _lock:
        return dict(_state)


def _fetch_one(client: httpx.Client, symbol: str, key: str) -> dict:
    # Key rides in the Authorization header, NOT the query string — httpx
    # logs request URLs at INFO level and the key must never reach a log.
    r = client.get(
        f"{BASE_URL}/v3/reference/tickers/{symbol}",
        headers={"Authorization": f"Bearer {key}"}, timeout=20.0,
    )
    if r.status_code == 404:
        return {"sector": None, "sic": None, "name": symbol, "mcap": None}
    r.raise_for_status()
    res = (r.json() or {}).get("results") or {}
    sic = res.get("sic_code")
    return {
        "sector": sic_to_sector(sic),
        "sic": sic,
        "name": res.get("name") or symbol,
        "mcap": res.get("market_cap"),
    }


def _warm_worker(missing: list[str]) -> None:
    key = os.getenv("MASSIVE_API_KEY", "")
    payload = load_map()
    fetched_at = int(time.time())
    try:
        with httpx.Client() as client:
            with ThreadPoolExecutor(max_workers=8) as pool:
                futures = {pool.submit(_fetch_one, client, s, key): s for s in missing}
                for i, fut in enumerate(as_completed(futures), 1):
                    sym = futures[fut]
                    try:
                        info = fut.result()
                    except Exception as e:  # noqa: BLE001 — record & continue
                        logger.warning("sector_rotation: %s fetch failed: %s", sym, e)
                        info = None
                    with _lock:
                        _state["done"] = i
                    if info is not None:
                        info["fetched_at"] = fetched_at
                        payload["symbols"][sym] = info
                    if i % 100 == 0:  # partial saves so a crash keeps progress
                        payload["as_of"] = fetched_at
                        _save_map(payload)
        payload["as_of"] = fetched_at
        _save_map(payload)
        logger.info("sector_rotation: sector map warmed — %d symbols fetched", len(missing))
    except Exception as e:  # noqa: BLE001
        logger.exception("sector_rotation: warm failed")
        with _lock:
            _state["error"] = str(e)
    finally:
        with _lock:
            _state["running"] = False


def ensure_map(top_n: int = DEFAULT_TOP_N) -> tuple[dict, bool]:
    """Return (symbol→info map, warming?).

    If a meaningful chunk of the current liquid universe is unmapped, kick off
    a background warm (once) and report warming=True so callers can render a
    progress state instead of blocking for ~1,500 API calls.
    """
    payload = load_map()
    known = payload["symbols"]
    liquid = liquid_universe(top_n)
    missing = [s for s in liquid if s not in known]

    warming = False
    if missing and os.getenv("MASSIVE_API_KEY"):
        with _lock:
            already = _state["running"]
            # Small top-ups (new listings drifting into the liquid set) can
            # block-fetch on a later warm; only background-warm real backfills.
            if not already and len(missing) > 25:
                _state.update({"running": True, "done": 0, "total": len(missing), "error": None})
                threading.Thread(target=_warm_worker, args=(missing,), daemon=True).start()
                already = True
            warming = already
    return known, warming
