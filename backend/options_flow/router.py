"""Options Flow API — Tier-D upgrade to /breakouts/Unusual Volume.

Surfaces the actual "Unusual Whales" signal: institutional positioning visible
in the options market. For a given underlying, we pull the full option chain
snapshot (one Massive API call) and compute:

  - **Premium-weighted P/C ratio**: dollar volume in calls vs. puts. Much more
    meaningful than the contract-count P/C ratio (a single 100-lot at $50 dwarfs
    1,000 retail $0.05 lottos).
  - **Vol/OI per contract**: today's volume vs. total open interest. >1 means
    today's volume alone exceeds the entire existing position — fresh
    institutional positioning.
  - **Top unusual contracts**: sorted by Vol/OI desc, showing strike, expiry,
    side, dollar premium, IV.
  - **Sentiment lean**: net dollar premium direction → bullish/bearish tilt.

Sweep detection (multi-exchange large prints) is a follow-up that requires
per-contract /v3/trades calls.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from market_clock import effective_cache_ttl
from screener.qullamaggie.providers import get_provider
from screener.qullamaggie.providers.base import NoApiKey, NoData, NotEntitled, RateLimited
from .history import baseline, record_snapshot
from .sweeps import detect_sweeps

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/flow", tags=["options-flow"])

# 5-min response cache during active market hours. Options chains drift fast
# but we don't need tick-level freshness for a screener-style view. TTL extends
# to 4 hours on weekends / holidays / after 2pm PT (see market_clock).
_CACHE: dict[str, tuple[float, dict]] = {}
_CACHE_TTL_SEC_ACTIVE = 300


def _summarize_chain(chain: list[dict], underlying_price: float | None) -> dict:
    """Compute flow aggregates from a list of contract snapshots.

    Each contract snapshot is expected to have at minimum:
      - details: {contract_type, strike_price, expiration_date}
      - day: {volume, last_price (or close)}
      - open_interest
      - implied_volatility
    """
    call_premium = 0.0
    put_premium = 0.0
    call_volume = 0
    put_volume = 0
    contracts = []

    for c in chain:
        details = c.get("details") or {}
        day = c.get("day") or {}
        side = (details.get("contract_type") or "").lower()
        vol = int(day.get("volume") or 0)
        if vol <= 0:
            continue
        # Last traded price for the contract — prefer day.close, fall back to
        # last_quote.midpoint, then last_trade.price.
        last_price = (
            day.get("close")
            or day.get("last_price")
            or (c.get("last_trade") or {}).get("price")
            or 0
        )
        try:
            last_price = float(last_price)
        except (TypeError, ValueError):
            last_price = 0.0
        # Options notional: contract price × volume × 100 (multiplier).
        notional = last_price * vol * 100
        oi = int(c.get("open_interest") or 0)
        vol_oi = (vol / oi) if oi > 0 else None
        strike = details.get("strike_price")
        expiry = details.get("expiration_date")
        iv = c.get("implied_volatility")

        if side == "call":
            call_premium += notional
            call_volume += vol
        elif side == "put":
            put_premium += notional
            put_volume += vol

        contracts.append({
            "side": side,
            "strike": strike,
            "expiration": expiry,
            "volume": vol,
            "open_interest": oi,
            "vol_oi": round(vol_oi, 2) if vol_oi is not None else None,
            "last_price": round(last_price, 4),
            "premium": round(notional, 0),
            "iv": round(float(iv), 3) if iv is not None else None,
        })

    total_premium = call_premium + put_premium
    # Premium-weighted P/C — > 1 = bearish lean; < 1 = bullish.
    pc_premium = (put_premium / call_premium) if call_premium > 0 else None
    pc_volume = (put_volume / call_volume) if call_volume > 0 else None
    bullish_pct = (call_premium / total_premium) if total_premium > 0 else None

    # Top "unusual" contracts: rank by vol/OI desc, then by premium desc as
    # tiebreaker (so fresh-positioning AND meaningful dollar size both matter).
    ranked = sorted(
        [c for c in contracts if c["vol_oi"] is not None],
        key=lambda x: (x["vol_oi"], x["premium"]),
        reverse=True,
    )[:25]

    return {
        "underlying_price": underlying_price,
        "call_premium": round(call_premium, 0),
        "put_premium": round(put_premium, 0),
        "total_premium": round(total_premium, 0),
        "call_volume": call_volume,
        "put_volume": put_volume,
        "pc_premium_ratio": round(pc_premium, 3) if pc_premium is not None else None,
        "pc_volume_ratio": round(pc_volume, 3) if pc_volume is not None else None,
        "bullish_pct": round(bullish_pct, 3) if bullish_pct is not None else None,
        "lean": _classify_lean(pc_premium, bullish_pct),
        "contract_count_traded": len(contracts),
        "top_unusual": ranked,
    }


def _classify_lean(pc_premium: float | None, bullish_pct: float | None) -> str:
    if bullish_pct is None:
        return "neutral"
    if bullish_pct >= 0.70:
        return "strong_bullish"
    if bullish_pct >= 0.55:
        return "bullish"
    if bullish_pct <= 0.30:
        return "strong_bearish"
    if bullish_pct <= 0.45:
        return "bearish"
    return "neutral"


@router.get("/{underlying}")
async def get_flow(
    underlying: str,
    min_volume: int = Query(10, ge=0, description="Skip contracts with day volume below this"),
    include_sweeps: bool = Query(False, description="Pull tick-level trades on top contracts + detect multi-exchange sweeps. Expensive."),
    sweep_top_n: int = Query(10, ge=1, le=25, description="Number of top-Vol/OI contracts to scan for sweeps"),
    fresh: bool = Query(False, description="Bypass the 5-minute response cache"),
):
    """Return aggregate options flow for an underlying ticker."""
    underlying = underlying.upper()
    cache_key = f"{underlying}|{min_volume}|{include_sweeps}|{sweep_top_n}"
    ttl = effective_cache_ttl(_CACHE_TTL_SEC_ACTIVE)
    if not fresh:
        entry = _CACHE.get(cache_key)
        if entry and (time.time() - entry[0]) < ttl:
            cached = dict(entry[1])
            cached["cached"] = True
            cached["cache_age_seconds"] = int(time.time() - entry[0])
            return cached

    provider = get_provider()
    if not hasattr(provider, "fetch_option_chain"):
        raise HTTPException(status_code=501, detail={
            "code": "provider_unsupported",
            "message": "The active data provider doesn't support options chains.",
            "hint": "Switch to MassiveProvider by setting QF_DATA_PROVIDER=massive.",
        })

    started = time.time()
    try:
        raw = provider.fetch_option_chain(underlying)
    except NoApiKey as e:
        raise HTTPException(status_code=503, detail={
            "code": "no_api_key",
            "message": "Massive API key is not configured on the server.",
            "hint": e.hint,
        })
    except NotEntitled as e:
        # 402 = "Payment Required" — semantically perfect for this case.
        raise HTTPException(status_code=402, detail={
            "code": "options_not_entitled",
            "message": "Your Massive plan doesn't include the Options data endpoint.",
            "hint": e.hint,
            "endpoint_name": e.endpoint_name,
            "upstream_status": e.status_code,
        })
    except RateLimited as e:
        raise HTTPException(status_code=429, detail={
            "code": "rate_limited",
            "message": "Massive API rate limit reached.",
            "hint": e.hint,
        })
    except Exception as e:
        logger.exception("option chain fetch failed for %s", underlying)
        raise HTTPException(status_code=502, detail={
            "code": "upstream_error",
            "message": f"Options chain fetch failed: {e}",
            "hint": "Check backend logs for details.",
        })

    if not raw:
        raise HTTPException(status_code=404, detail={
            "code": "no_data",
            "message": f"No options data for {underlying}.",
            "hint": "This ticker may not have listed options, or the chain is empty for today's snapshot.",
        })

    chain = raw.get("contracts") or []
    underlying_price = raw.get("underlying_price")
    if min_volume > 0:
        chain = [c for c in chain if int((c.get("day") or {}).get("volume") or 0) >= min_volume]

    summary = _summarize_chain(chain, underlying_price)

    # --- Sweep detection on the top-N most unusual contracts (opt-in) -----
    sweeps_out: list[dict] = []
    sweeps_error: dict | None = None
    if include_sweeps and hasattr(provider, "fetch_option_trades_sample"):
        ticker_by_strike = {}
        for c in chain:
            details = c.get("details") or {}
            t = details.get("ticker")
            if t:
                ticker_by_strike[(
                    (details.get("contract_type") or "").lower(),
                    details.get("strike_price"),
                    details.get("expiration_date"),
                )] = t
        top_n = summary.get("top_unusual", [])[:sweep_top_n]
        for tc in top_n:
            opt_ticker = ticker_by_strike.get((tc["side"], tc["strike"], tc["expiration"]))
            if not opt_ticker:
                continue
            try:
                trades = provider.fetch_option_trades_sample(opt_ticker, max_pages=1, per_page=5000)
            except NotEntitled as e:
                # Don't fail the whole response — record the issue and stop
                # trying. The summary chain is still useful on its own.
                sweeps_error = {
                    "code": "trades_not_entitled",
                    "message": "Sweep detection requires tick-level Options Trades access.",
                    "hint": e.hint,
                    "endpoint_name": e.endpoint_name,
                }
                break
            except RateLimited as e:
                sweeps_error = {"code": "rate_limited", "message": str(e), "hint": e.hint}
                break
            except Exception as e:
                logger.debug("opt trades fetch failed for %s: %s", opt_ticker, e)
                continue
            for sw in detect_sweeps(trades):
                sweeps_out.append({
                    "contract_ticker": opt_ticker,
                    "side": tc["side"],
                    "strike": tc["strike"],
                    "expiration": tc["expiration"],
                    **sw,
                })
        sweeps_out.sort(key=lambda s: s.get("premium", 0), reverse=True)
        sweeps_out = sweeps_out[:50]

    # --- Historical baseline -----------------------------------------------
    try:
        record_snapshot(underlying, summary.get("call_premium") or 0, summary.get("put_premium") or 0)
    except Exception as e:
        logger.debug("history record failed for %s: %s", underlying, e)
    hist = baseline(underlying)
    # Multiple of normal: today_total / avg_total. Only meaningful with ≥5 days.
    today_total = summary.get("total_premium") or 0
    premium_vs_baseline = None
    if hist["sample_days"] >= 5 and hist["avg_total_premium"]:
        premium_vs_baseline = round(today_total / hist["avg_total_premium"], 2)

    elapsed = round(time.time() - started, 2)

    response = {
        "underlying": underlying,
        "as_of": datetime.now().isoformat(timespec="seconds"),
        "elapsed_seconds": elapsed,
        "min_volume": min_volume,
        "cached": False,
        "cache_age_seconds": 0,
        **summary,
        "sweeps": sweeps_out,
        "sweeps_error": sweeps_error,
        "include_sweeps": include_sweeps,
        "baseline": {
            "sample_days": hist["sample_days"],
            "avg_total_premium": hist["avg_total_premium"],
            "median_total_premium": hist["median_total_premium"],
            "history": hist["history"],
        },
        "premium_vs_baseline": premium_vs_baseline,
    }
    _CACHE[cache_key] = (time.time(), response)
    return response
