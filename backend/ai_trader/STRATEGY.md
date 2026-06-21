# AI Trader — Strategy Summary

A living description of what the AI Trader actually does, end to end. If you
change the engine, update this doc — it is also the spec for the backtester
(what we replay must match what we trade).

## 1. Goal

Each session, surface the day's best **0–5 actionable LONG setups** in the
Qullamaggie (Kristjan Kullamägi) momentum style, each with a concrete trade plan
(entry / stop / target), sized to a fixed risk budget, ranked deterministically,
and tracked over time so the strategy's realized edge is measurable.

## 2. Pipeline (one generation)

```
universe → scan/score → compact → regime read → LLM selection (or rule-based
fallback) → risk sizing → composite re-rank → portfolio aggregation → audit + ledger
```

### 2a. Universe
`get_universe(include_movers=True)` — the static screener universe **plus** today's
top gainers ("movers"). Movers make the live product timely but are a
**point-in-time, look-ahead-biased** input (see §6).

### 2b. Scan & score (`screener.qullamaggie`)
`rank_candidates(mode="breakout")` with hard gates:
- **Dollar volume ≥ $5M** (liquidity)
- **ADR ≥ min_adr** (default **3%**) — enough daily range to reach a target
- **RVOL ≥ 1.5** (in play today)

Each surviving name is scored (leader / thrust / base / pivot components) and the
top **20** (`SCAN_LIMIT`) are handed forward. The top slice is enriched with
**news + earnings dates** (best-effort; live data only).

### 2c. Compaction
Each candidate is reduced to the few numbers that matter for a Qullamaggie
judgment: price, today's change, ADR, RVOL, $vol, 1/3/6-month returns, status,
tags, screener score, pivot + distance to pivot, base length/top/bottom, news,
earnings date. The model only ever sees these — it cannot invent tickers or prices.

### 2d. The two setups
1. **Breakout (continuation)** — a liquid, high-ADR leader that already made a big
   move, consolidated tight, and is breaking out on volume. Entry on the range
   high; stop under the consolidation low / low of day.
2. **Episodic Pivot (EP)** — a gap up on a fresh catalyst (earnings, guidance,
   FDA, contract). Entry on the opening-range high; stop below the opening range.

## 3. Selection

- **Primary:** Claude (`claude-sonnet-4-6`, **temperature 0**) acts as a
  disciplined Qullamaggie trader: it ranks/annotates the scanned candidates and
  returns the best 0–5 with entry/stop/target, a one-line rationale, a 3–5
  sentence thesis, key points, and a risk note. It is told the market regime and
  to raise its bar in hostile tapes. It never sizes positions.
- **Fallback (deterministic, zero future knowledge):** if the API key/credits are
  missing or the call fails, `_fallback_ideas` builds rule-based ideas straight
  from the scan: entry at the pivot, stop at the tighter of (consolidation low,
  entry − ~1 ADR), first target at **2R**, conviction from the screener score.

## 4. Position sizing (`portfolio.py`)

Fixed-fractional risk, capped by per-idea buying power:

```
shares = min( account × risk% / (entry − stop) ,  budget / entry )
```

Defaults: **account $25,000**, **risk 1% per idea**, **per-idea budget $500**.
Each idea reports its share count, cost, $-at-risk, % of account at risk, and
which constraint bound the size (`risk` vs `budget`).

## 5. Post-processing

- **Composite ranking (`ranking.py`)** — a reproducible 0–100 score from
  qs_score (40%), R:R (20%), ADR sweet-spot (15%), RVOL (15%), pivot proximity
  (10%). The final list is sorted by this, so ordering is auditable and testable
  independent of the LLM.
- **Portfolio risk (`portfolio.py`)** — aggregate heat (total $-at-risk if every
  stop hits), capital deployed, and a regime-scaled suggested-max-heat. Pairwise
  **return correlation** flags ideas that move together (ρ ≥ 0.7) — five names
  from one theme are one bet, not five.
- **Regime gate (`regime.py`)** — pulls the breadth snapshot → `classify()`;
  attaches the regime, feeds selectivity guidance into the prompt, and scales
  suggested heat (bullish 1.0 → capitulation 0.2).

## 6. Track record (`history.py`)

One ledger entry per day (first generation wins; suggested prices are frozen).
The history endpoint **replays the OHLC path** of each idea from the day after
suggestion:

- Entry modeled as a **stop-buy** at `entry`; the trade goes live only once a bar
  trades up through it (else `no_entry`).
- Then whichever of stop/target is reached first decides the outcome; ties within
  a single daily bar resolve to the **stop** (conservative).
- Scored in **R-multiples**: target = +planned R, stop = −1R, still-running =
  marked-to-market R.

Aggregated into **hit rate, avg win/loss, expectancy (R/trade), profit factor,
total R**, plus a per-day **SPY benchmark and alpha**.

## 7. Determinism & audit

`temperature = 0` and a per-run JSONL audit (`data/ai_trader_audit.jsonl`):
inputs, the full candidate set the model saw, raw model output, and the picks —
so any day's ranking can be reconstructed.

## 8. Caching

Ideas cached ~30 min while the market is open (longer when closed), keyed by
`budget|min_adr|account|risk_pct`. History re-pricing cached ~5 min.

## 9. Known limitations / biases

These matter most for backtesting — a backtest is only honest if it respects them:

- **Survivorship & look-ahead in the universe.** The universe is *today's*
  membership, and live runs fold in *today's* movers. A point-in-time backtest
  must drop movers (`include_movers=False`) and accept that the static universe
  still omits names delisted since.
- **No point-in-time news/earnings.** Enrichment fetches *current* data, so it
  cannot be used in a historical run without leaking the future. Backtests run
  price/volume-only.
- **LLM future knowledge.** Claude's training data extends past some historical
  dates; for those, its "judgment" can be contaminated by knowing what happened.
  The **rule-based engine has zero future knowledge** and is the clean choice for
  strategy validation.
- **Daily-bar resolution.** Intraday sequencing is unknown; both-touched bars are
  scored as stops.
- **Slippage/fees/fills not modeled.** Entries assume the stop-buy filled at the
  planned price.
