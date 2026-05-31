"""Sweep detection — multi-exchange large prints in a tight time window.

A "sweep" in options trading is a single urgent order that gets routed across
multiple exchanges simultaneously (usually within a few hundred milliseconds)
because the originating trader wants the entire position filled NOW, before
the market can move. Sweeps are a hallmark of urgent institutional positioning
— a fund taking a directional bet large enough that it can't sit on the bid.

Detection logic:
  - Group trades into clusters by `sip_timestamp` within `time_window_ns`.
  - A cluster is a sweep when:
      * ≥ `min_exchanges` distinct exchange IDs participated
      * total cluster size ≥ `min_total_size` contracts
  - Cluster aggressor side is inferred from price action: rising prices across
    the cluster → bid-lift (bullish); falling → ask-hit (bearish). Heuristic
    only — true side requires bid/ask quote matching which we skip for cost.

Output per sweep:
  {
    "timestamp_ms": int,
    "exchanges": [int,...],
    "total_size": int,
    "avg_price": float,
    "premium": float,        # size * avg_price * 100
    "side_hint": "bullish" | "bearish" | "neutral",
  }
"""

from __future__ import annotations


def detect_sweeps(
    trades: list[dict],
    time_window_ns: int = 500_000_000,  # 500ms
    min_exchanges: int = 2,
    min_total_size: int = 50,           # 50 contracts = 5,000 underlying shares
) -> list[dict]:
    """Return sweep clusters from a sorted-by-time trade list."""
    if not trades:
        return []
    # Ensure ascending by sip_timestamp.
    trades = sorted(trades, key=lambda t: t.get("sip_timestamp") or 0)
    sweeps: list[dict] = []
    i = 0
    n = len(trades)
    while i < n:
        cluster = [trades[i]]
        j = i + 1
        cluster_start = trades[i].get("sip_timestamp") or 0
        while j < n:
            t = trades[j]
            ts = t.get("sip_timestamp") or 0
            if ts - cluster_start > time_window_ns:
                break
            cluster.append(t)
            j += 1
        # Evaluate cluster.
        exchanges = {t.get("exchange") for t in cluster if t.get("exchange") is not None}
        total_size = sum(int(t.get("size") or 0) for t in cluster)
        if len(exchanges) >= min_exchanges and total_size >= min_total_size:
            prices = [float(t.get("price") or 0) for t in cluster if t.get("price")]
            avg_price = sum(prices) / len(prices) if prices else 0.0
            # Direction heuristic: compare first vs last price.
            first_px = prices[0] if prices else 0.0
            last_px = prices[-1] if prices else 0.0
            if last_px > first_px * 1.005:
                side_hint = "bullish"
            elif last_px < first_px * 0.995:
                side_hint = "bearish"
            else:
                side_hint = "neutral"
            sweeps.append({
                "timestamp_ms": int(cluster_start // 1_000_000),
                "exchanges": sorted(exchanges),
                "num_exchanges": len(exchanges),
                "total_size": total_size,
                "avg_price": round(avg_price, 4),
                "premium": round(total_size * avg_price * 100, 0),
                "side_hint": side_hint,
            })
            i = j  # skip the cluster
        else:
            i += 1
    return sweeps
