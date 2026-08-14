// Risk-management math for the Risk Management page (pages/RiskManagement.jsx).
//
// Everything here is deterministic: the Monte Carlo takes an explicit seed, so
// the same inputs always draw the same fan. A chart that reshuffles on every
// re-render teaches nothing — you can't tell a parameter change from a new
// random draw.
//
// Vocabulary used throughout:
//   R          — one unit of risk. The distance from entry to stop, in dollars.
//                A trade is measured in R, never in dollars, so a $75 loss on a
//                $15k account and a $750 loss on a $150k account are the same
//                event.
//   payoff     — average win expressed in R (a 2.5R winner returns 2.5× what
//                the trade risked).
//   expectancy — expected R per trade: winRate × payoff − (1 − winRate).

// Small, fast, seedable PRNG. Same seed → same sequence, across reloads.
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Expected R per trade. The only number that decides whether an account grows.
export function expectancyR(winRate, payoff) {
  return winRate * payoff - (1 - winRate)
}

// The win rate at which a given payoff exactly breaks even: WR = 1 / (1 + R).
export function breakevenWinRate(payoff) {
  return 1 / (1 + payoff)
}

// The payoff a given win rate needs to break even — the same identity, solved
// the other way: R = (1 − WR) / WR.
export function breakevenPayoff(winRate) {
  return (1 - winRate) / winRate
}

// The breakeven frontier, for plotting. Above the curve you keep money; below
// it you are donating, however good the win rate looks.
export function breakevenCurve(minR = 0.4, maxR = 5, step = 0.05) {
  const out = []
  for (let r = minR; r <= maxR + 1e-9; r += step) {
    out.push({ payoff: +r.toFixed(2), requiredWinRate: +(breakevenWinRate(r) * 100).toFixed(2) })
  }
  return out
}

// What a losing streak costs at a given fixed-fractional risk. Compounding
// works on the way down too, which is the whole argument for a small unit.
export function streakDrawdown(riskPct, losses) {
  return (Math.pow(1 - riskPct / 100, losses) - 1) * 100
}

// The gain required to undo a drawdown. This is the asymmetry people
// underestimate: −5% needs +5.3%, but −40% needs +66.7%. Losses compound
// against you faster than gains compound for you.
export function gainToRecover(ddPct) {
  const d = Math.abs(ddPct) / 100
  if (d >= 1) return Infinity
  return (1 / (1 - d) - 1) * 100
}

// How many consecutive winners it takes to climb back out of a drawdown of
// `ddPct`, at a given payoff.
//
// Note the result is *invariant to risk size* under fixed-fractional sizing —
// bigger risk digs a deeper hole but also fills it faster per win, and the two
// cancel. That is worth knowing precisely because it is not the reassurance it
// sounds like: what changes with size is the dollar hole and whether you are
// still trading the same way at the bottom of it.
export function tradesToRecover(ddPct, riskPct, payoff) {
  const target = 1 / (1 - ddPct / 100)
  const perWin = 1 + (riskPct / 100) * payoff
  if (perWin <= 1) return Infinity
  return Math.ceil(Math.log(target) / Math.log(perWin))
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0
  const idx = (sortedArr.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedArr[lo]
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo)
}

/**
 * Fixed-fractional Monte Carlo.
 *
 * Every trade risks `riskPct` of the CURRENT balance — so the dollar unit
 * grows with the account and shrinks during a drawdown, which is what makes
 * the strategy mathematically un-ruinable (you can approach zero, but a fixed
 * fraction can never quite reach it) and why the median path lands below the
 * naive arithmetic projection: volatility drag is real.
 *
 * Returns per-step p10/p50/p90 bands, three sample paths, and the outcome
 * distribution across all paths.
 */
export function simulate({
  account = 15000,
  riskPct = 0.5,
  winRate = 0.4,
  payoff = 2.5,
  trades = 300,
  paths = 400,
  seed = 20260807,
  sampleCount = 3,
} = {}) {
  const rand = mulberry32(seed)
  const f = riskPct / 100

  // steps[t][i] — balance of path i after t trades.
  const steps = Array.from({ length: trades + 1 }, () => new Float64Array(paths))
  const finals = new Float64Array(paths)
  const maxDDs = new Float64Array(paths)
  const worstStreaks = new Int32Array(paths)

  for (let i = 0; i < paths; i++) {
    let bal = account
    let peak = account
    let maxDD = 0
    let streak = 0
    let worstStreak = 0
    steps[0][i] = bal
    for (let t = 1; t <= trades; t++) {
      const won = rand() < winRate
      bal *= won ? 1 + f * payoff : 1 - f
      if (won) {
        streak = 0
      } else {
        streak += 1
        if (streak > worstStreak) worstStreak = streak
      }
      if (bal > peak) peak = bal
      const dd = (peak - bal) / peak
      if (dd > maxDD) maxDD = dd
      steps[t][i] = bal
    }
    finals[i] = bal
    maxDDs[i] = maxDD * 100
    worstStreaks[i] = worstStreak
  }

  // Per-step percentile bands. Sorting a copy per step keeps path identity
  // intact for the sample lines below.
  const series = []
  const scratch = new Float64Array(paths)
  for (let t = 0; t <= trades; t++) {
    scratch.set(steps[t])
    const sorted = Array.from(scratch).sort((a, b) => a - b)
    const point = {
      trade: t,
      p10: percentile(sorted, 0.1),
      median: percentile(sorted, 0.5),
      p90: percentile(sorted, 0.9),
      band: [percentile(sorted, 0.1), percentile(sorted, 0.9)],
    }
    for (let s = 0; s < sampleCount; s++) point[`sample${s}`] = steps[t][s]
    series.push(point)
  }

  const finalsSorted = Array.from(finals).sort((a, b) => a - b)
  const ddSorted = Array.from(maxDDs).sort((a, b) => a - b)
  const streakSorted = Array.from(worstStreaks).sort((a, b) => a - b)

  return {
    series,
    finals: finalsSorted,
    stats: {
      expectancy: expectancyR(winRate, payoff),
      riskUnit: account * f,
      medianFinal: percentile(finalsSorted, 0.5),
      p10Final: percentile(finalsSorted, 0.1),
      p90Final: percentile(finalsSorted, 0.9),
      bestFinal: finalsSorted[finalsSorted.length - 1],
      worstFinal: finalsSorted[0],
      probProfit: finalsSorted.filter(v => v > account).length / paths,
      probDouble: finalsSorted.filter(v => v >= account * 2).length / paths,
      probDown20: finalsSorted.filter(v => v <= account * 0.8).length / paths,
      medianMaxDD: percentile(ddSorted, 0.5),
      worstMaxDD: ddSorted[ddSorted.length - 1],
      // Probability of EVER touching a given drawdown along the way — the
      // number that decides whether a plan is survivable, since nobody
      // experiences the final balance without first living through the path.
      probDD10: ddSorted.filter(v => v >= 10).length / paths,
      probDD20: ddSorted.filter(v => v >= 20).length / paths,
      probDD30: ddSorted.filter(v => v >= 30).length / paths,
      medianWorstStreak: percentile(streakSorted, 0.5),
      p90WorstStreak: percentile(streakSorted, 0.9),
      maxWorstStreak: streakSorted[streakSorted.length - 1],
      paths,
      trades,
    },
  }
}

// The Kelly fraction for R-multiple betting: f* = expectancy / payoff — the
// risk-per-trade that maximises long-run GEOMETRIC growth.
//
// It is a ceiling, not a target. Kelly assumes the edge is known exactly and
// stationary; both are false for a trading account estimated from a few hundred
// trades. Overbetting Kelly is worse than underbetting by a wide margin (the
// growth curve is steep on the left of the peak and cliff-like on the right),
// so the working convention is a quarter to a half of it.
export function kellyFraction(winRate, payoff) {
  if (payoff <= 0) return 0
  return Math.max(0, expectancyR(winRate, payoff) / payoff)
}

// Lean single-point simulation — same fixed-fractional model as `simulate`
// without materialising the per-step matrix, so a whole sweep of risk levels
// stays cheap.
function leanRun({ riskPct, winRate, payoff, trades, paths, seed }) {
  const rand = mulberry32(seed)
  const f = riskPct / 100
  const finals = new Float64Array(paths)
  const dds = new Float64Array(paths)
  for (let i = 0; i < paths; i++) {
    let bal = 1
    let peak = 1
    let maxDD = 0
    for (let t = 0; t < trades; t++) {
      bal *= rand() < winRate ? 1 + f * payoff : 1 - f
      if (bal > peak) peak = bal
      const dd = (peak - bal) / peak
      if (dd > maxDD) maxDD = dd
    }
    finals[i] = bal
    dds[i] = maxDD * 100
  }
  const fs = Array.from(finals).sort((a, b) => a - b)
  const ds = Array.from(dds).sort((a, b) => a - b)
  return {
    median: percentile(fs, 0.5),
    p10: percentile(fs, 0.1),
    p90: percentile(fs, 0.9),
    probProfit: fs.filter(v => v > 1).length / paths,
    medianMaxDD: percentile(ds, 0.5),
  }
}

// Median growth as a function of risk per trade — the curve that shows size is
// not a dial you turn up. Growth rises to the Kelly peak and then falls off a
// cliff, while the 10th-percentile path starts collapsing long before the
// median does. Returns growth as a MULTIPLE of starting equity (scale-free).
export function riskSweep({
  levels = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25],
  winRate = 0.4,
  payoff = 2.5,
  trades = 300,
  paths = 200,
  seed = 20260807,
} = {}) {
  return levels.map(riskPct => {
    const r = leanRun({ riskPct, winRate, payoff, trades, paths, seed })
    return {
      riskPct,
      median: r.median,
      p10: Math.max(r.p10, 1e-4),   // keep a log axis happy
      p90: r.p90,
      probProfit: r.probProfit,
      medianMaxDD: r.medianMaxDD,
    }
  })
}

/**
 * The realised trade log, re-expressed in R.
 *
 * The workbook almost never records the planned stop, so R is proxied by the
 * AVERAGE LOSS — the size of a typical "I was wrong" outcome. That is the
 * honest substitute: it makes every trade comparable and it is what the
 * expectancy identity is denominated in, but it is an estimate of intent, not
 * the intent itself.
 *
 * Two things this exposes that a win rate cannot:
 *   1. how much of the total came from a handful of outliers, and
 *   2. how much was given away by losses that ran past 1R.
 */
export function analyzeRealizedR(trades, { topN = 10 } = {}) {
  const rows = (trades || [])
    .filter(t => t && Number.isFinite(t.pnl) && t.entry_date)
    .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)))
  if (rows.length < 20) return null

  const losses = rows.filter(t => t.pnl < 0).map(t => t.pnl)
  if (!losses.length) return null
  const rUnit = Math.abs(losses.reduce((s, v) => s + v, 0) / losses.length)
  if (!(rUnit > 0)) return null

  const rs = rows.map(t => t.pnl / rUnit)
  const totalR = rs.reduce((s, v) => s + v, 0)

  // Rank by R so the top-N outliers can be pulled back out of the curve.
  const topIdx = new Set(
    rs.map((r, i) => [r, i]).sort((a, b) => b[0] - a[0]).slice(0, topN).map(x => x[1]),
  )

  let cum = 0
  let cumEx = 0
  const series = rs.map((r, i) => {
    cum += r
    if (!topIdx.has(i)) cumEx += r
    return { i: i + 1, cumR: +cum.toFixed(2), cumRexTop: +cumEx.toFixed(2) }
  })

  const wins = rs.filter(r => r > 0)
  const lossR = rs.filter(r => r <= 0)
  // Everything a loss gave up *past* the 1R it was supposed to cost.
  const beyondStop = rs.filter(r => r < -1)
  const excessLossR = beyondStop.reduce((s, r) => s + (r + 1), 0)

  return {
    rUnit,
    count: rows.length,
    series,
    totalR,
    topR: rs.filter((_, i) => topIdx.has(i)).reduce((s, v) => s + v, 0),
    withoutTopR: totalR - rs.filter((_, i) => topIdx.has(i)).reduce((s, v) => s + v, 0),
    topN,
    bestR: Math.max(...rs),
    worstR: Math.min(...rs),
    over3R: rs.filter(r => r >= 3).length,
    winRate: (wins.length / rs.length) * 100,
    avgWinR: wins.length ? wins.reduce((s, v) => s + v, 0) / wins.length : 0,
    avgLossR: lossR.length ? lossR.reduce((s, v) => s + v, 0) / lossR.length : 0,
    beyondStopCount: beyondStop.length,
    excessLossR,                       // negative
    disciplinedTotalR: totalR - excessLossR,
  }
}

// Bucketed final balances for the outcome histogram.
export function histogram(finalsSorted, buckets = 26) {
  if (!finalsSorted.length) return []
  const lo = finalsSorted[0]
  const hi = finalsSorted[finalsSorted.length - 1]
  const width = (hi - lo) / buckets || 1
  const bins = Array.from({ length: buckets }, (_, i) => ({
    x: lo + width * (i + 0.5),
    from: lo + width * i,
    to: lo + width * (i + 1),
    count: 0,
  }))
  for (const v of finalsSorted) {
    const idx = Math.min(buckets - 1, Math.floor((v - lo) / width))
    bins[idx].count++
  }
  return bins
}

// Position size from the only three inputs that matter: what you'll risk, where
// you're wrong, and what it costs to be wrong per share.
export function positionSize({ account, riskPct, entry, stop }) {
  const riskDollars = account * (riskPct / 100)
  const perShare = entry - stop
  if (!(perShare > 0)) return null
  const shares = Math.floor(riskDollars / perShare)
  return {
    riskDollars,
    perShare,
    shares,
    positionValue: shares * entry,
    positionPctOfAccount: ((shares * entry) / account) * 100,
    stopDistancePct: (perShare / entry) * 100,
  }
}
