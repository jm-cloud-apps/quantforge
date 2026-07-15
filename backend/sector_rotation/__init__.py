"""Sector Rotation intelligence — internals, RRG quadrants, and leader drill-down.

Detects institutional accumulation/rotation at the *sector* level using data
the app already has on disk: the breadth engine's grouped-daily OHLCV cache
(full US market, ~126 sessions) plus a cached symbol→sector map built from
Massive's per-ticker reference endpoint (SIC codes).

Three layers, three endpoints (see router.py):
  1. internals — per-sector breadth computed from members, not the ETF:
     %>20/50MA (+deltas), net 4% movers, new highs, up/down dollar-volume,
     median-member vs ETF divergence → verdict + stealth-accumulation flag.
  2. rrg — RS-ratio vs SPY × RS-momentum per sector/industry ETF with a
     weekly trail (the classic Relative Rotation Graph quadrants).
  3. leaders — a sector's member stocks ranked by RS rank, trend, and
     accumulation proxy: the actionable candidates list.
"""
