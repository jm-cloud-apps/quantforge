import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ComposedChart, LineChart, BarChart, Line, Area, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, Cell,
} from 'recharts'
import { loadDefaultTrades } from '../api/tradingAnalysis'
import {
  simulate, histogram, breakevenCurve, expectancyR, breakevenPayoff,
  streakDrawdown, gainToRecover, tradesToRecover, positionSize,
  kellyFraction, riskSweep, analyzeRealizedR,
} from '../utils/riskMath'

// ---------------------------------------------------------------------------
// "Risk Management" — the page that explains why the win rate on the Trading
// Analysis page is the least interesting number on it.
//
// Everything else in section 4 reports what happened. This one is the model
// behind it: expectancy in R, the breakeven frontier, and a fixed-fractional
// Monte Carlo that shows what a sub-50% win rate actually does to a $15,000
// account when every trade risks half a percent.
//
// The simulation is seeded (utils/riskMath.js) so the fan only changes when an
// input changes — otherwise you can't tell a parameter effect from a new draw.
// It also loads the real trade log, so the abstract math gets anchored to the
// user's own measured edge rather than a textbook example.
// ---------------------------------------------------------------------------

const COLORS = {
  accent: '#10B981',
  danger: '#EF4444',
  cyan: '#06B6D4',
  warning: '#F59E0B',
  purple: '#8B5CF6',
  axis: '#64748B',
  grid: 'rgba(30, 41, 59, 0.5)',
}

const TOOLTIP_STYLE = {
  backgroundColor: 'rgba(15, 22, 35, 0.95)',
  border: '0.5px solid rgba(30, 41, 59, 0.5)',
  borderRadius: '12px',
  backdropFilter: 'blur(40px)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  fontFamily: 'Inter',
  fontSize: '12px',
}

const fmt$ = (n, digits = 0) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const v = Number(n)
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: digits })}`
}
const fmtPct = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : `${Number(n).toFixed(digits)}%`
const fmtR = (n, digits = 2) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(digits)}R`

// A sampled probability of exactly 0 or 100 is an artefact of a finite number
// of paths, never a certainty. Say so.
const fmtProb = (p) => {
  const v = p * 100
  if (v >= 99.5) return '>99%'
  if (v < 0.5) return '<1%'   // 0 of 400 paths is "rare", not "impossible"
  return `${v.toFixed(0)}%`
}

// The four profiles worth comparing. "The tax" is deliberately included: it is
// the most common real-world result and it is a losing strategy despite a win
// rate that feels respectable.
const PRESETS = [
  { key: 'swing', label: 'Momentum swing', winRate: 35, payoff: 3.0, note: 'Lose most of the time, let the winners run' },
  { key: 'even', label: 'Coin flip, 2R', winRate: 50, payoff: 2.0, note: 'Half right, twice the payoff' },
  { key: 'grinder', label: 'High win rate, 0.7R', winRate: 65, payoff: 0.7, note: 'Feels great, barely breaks even' },
  { key: 'tax', label: 'The tax', winRate: 45, payoff: 1.0, note: 'Cutting winners early — negative edge' },
]

function Stat({ label, value, sub, tone = 'text-surface-100', border = 'border-surface-700/50' }) {
  return (
    <div className={`rounded-xl border ${border} bg-surface-900/50 px-4 py-3`}>
      <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase">{label}</div>
      <div className={`mt-1 text-[20px] font-display font-bold leading-none ${tone}`}>{value}</div>
      {sub && <div className="mt-1 text-[10.5px] text-surface-500 leading-snug">{sub}</div>}
    </div>
  )
}

function Slider({ label, value, onChange, min, max, step, format }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-[10px] font-bold tracking-widest text-surface-400 uppercase">{label}</label>
        <span className="font-mono text-[12px] text-surface-100 tabular-nums">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-accent"
      />
    </div>
  )
}

// Settings survive a reload — this page is meant to be returned to with your
// own numbers already dialled in.
const SETTINGS_KEY = 'qf:risk:params:v1'

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {}
}

export default function RiskManagement() {
  const [saved] = useState(loadSettings)   // read localStorage once, not per render
  const [account, setAccount] = useState(saved.account ?? 15000)
  const [riskPct, setRiskPct] = useState(saved.riskPct ?? 0.5)
  const [winRate, setWinRate] = useState(saved.winRate ?? 35)
  const [payoff, setPayoff] = useState(saved.payoff ?? 3.0)
  const [trades, setTrades] = useState(saved.trades ?? 300)
  const [seed, setSeed] = useState(20260807)
  const [live, setLive] = useState(null)
  const [realized, setRealized] = useState(null)

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ account, riskPct, winRate, payoff, trades }))
    } catch { /* ignore */ }
  }, [account, riskPct, winRate, payoff, trades])

  // Anchor the math to the real trade log when it's available — the page is
  // far more useful comparing the model against your own measured numbers than
  // against a textbook example. Failure is silent: this is a teaching page and
  // must render fine with no backend.
  useEffect(() => {
    let cancelled = false
    loadDefaultTrades()
      .then(d => {
        if (cancelled || !d?.metrics) return
        const m = d.metrics
        const realPayoff = m.avg_loss ? Math.abs(m.avg_win / m.avg_loss) : null
        setLive({
          winRate: m.win_rate,
          payoff: realPayoff,
          totalTrades: m.total_trades,
          expectancy: realPayoff != null ? expectancyR(m.win_rate / 100, realPayoff) : null,
          avgWin: m.avg_win,
          avgLoss: m.avg_loss,
        })
        setRealized(analyzeRealizedR(d.trades))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const sim = useMemo(
    () => simulate({ account, riskPct, winRate: winRate / 100, payoff, trades, paths: 400, seed }),
    [account, riskPct, winRate, payoff, trades, seed],
  )
  const bins = useMemo(() => histogram(sim.finals), [sim])
  const frontier = useMemo(() => breakevenCurve(), [])
  const sweep = useMemo(
    () => riskSweep({ winRate: winRate / 100, payoff, trades, paths: 200, seed }),
    [winRate, payoff, trades, seed],
  )

  // Counterfactuals — the same account run again with one thing changed. Cheap
  // to compute, and far more persuasive than describing the effect in prose.
  const variants = useMemo(() => {
    const base = { account, riskPct, trades, paths: 200, seed }
    const runs = [
      { key: 'payoff', label: `Payoff ${payoff.toFixed(1)}R → ${(payoff + 0.5).toFixed(1)}R`,
        hint: 'Hold winners half a risk-unit longer', tone: 'accent',
        sim: simulate({ ...base, winRate: winRate / 100, payoff: payoff + 0.5 }) },
      { key: 'winrate', label: `Win rate ${winRate}% → ${winRate + 5}%`,
        hint: 'Five points more accurate — the hard lever', tone: 'cyan',
        sim: simulate({ ...base, winRate: (winRate + 5) / 100, payoff }) },
      { key: 'size', label: `Risk ${riskPct.toFixed(1)}% → ${(riskPct * 2).toFixed(1)}%`,
        hint: 'Same edge, double the size', tone: 'danger',
        sim: simulate({ ...base, riskPct: riskPct * 2, winRate: winRate / 100, payoff }) },
    ]
    return runs.map(r => ({
      ...r,
      median: r.sim.stats.medianFinal,
      dd: r.sim.stats.medianMaxDD,
      probProfit: r.sim.stats.probProfit,
    }))
  }, [account, riskPct, winRate, payoff, trades, seed])

  const exp = expectancyR(winRate / 100, payoff)
  const riskUnit = account * (riskPct / 100)
  const perTradePct = exp * (riskPct / 100) * 100
  const requiredPayoff = breakevenPayoff(winRate / 100)
  const s = sim.stats
  const edgeTone = exp > 0 ? 'text-accent' : 'text-danger'
  const kelly = kellyFraction(winRate / 100, payoff) * 100
  const kellyShare = kelly > 0 ? riskPct / kelly : null

  // Where each curve tops out. The gap between them is the argument: the
  // unlucky path stops improving at a far smaller size than the median does,
  // and you only ever get to live on one path.
  const peaks = useMemo(() => {
    let med = sweep[0], p10 = sweep[0]
    for (const row of sweep) {
      if (row.median > med.median) med = row
      if (row.p10 > p10.p10) p10 = row
    }
    return { median: med, p10 }
  }, [sweep])

  // Chart data is downsampled for readability on long runs — the bands are
  // smooth, so plotting every single trade adds pixels, not information.
  const fanData = useMemo(() => {
    const stride = Math.max(1, Math.floor(sim.series.length / 220))
    return sim.series.filter((_, i) => i % stride === 0 || i === sim.series.length - 1)
  }, [sim])

  const applyPreset = (p) => { setWinRate(p.winRate); setPayoff(p.payoff) }
  const applyLive = () => {
    if (!live?.payoff) return
    setWinRate(Math.round(live.winRate * 10) / 10)
    setPayoff(Math.round(live.payoff * 100) / 100)
  }

  // The position-size worked example, driven by the same risk unit.
  const sizing = [
    { entry: 50, stop: 46 },
    { entry: 50, stop: 47.5 },
    { entry: 120, stop: 110 },
    { entry: 12, stop: 11.4 },
  ].map(x => ({ ...x, ...positionSize({ account, riskPct, entry: x.entry, stop: x.stop }) }))

  return (
    <div className="space-y-6">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-2xl border border-surface-700/50 bg-gradient-to-br from-surface-900 via-surface-900/80 to-surface-950">
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-cyan/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-16 w-64 h-64 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
        <div className="relative px-5 sm:px-6 py-5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold tracking-widest text-cyan bg-cyan/10 border border-cyan/30 uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan animate-pulse-soft" />
              Survival math
            </span>
            <h1 className="text-[20px] sm:text-[22px] font-display font-bold text-surface-50 tracking-tight leading-tight">
              Risk Management
            </h1>
          </div>
          <p className="mt-2 text-[13px] text-surface-300 leading-relaxed max-w-3xl">
            You do not need to be right. You need to be <span className="text-surface-100 font-semibold">paid more when you are right
            than you pay when you are wrong</span>, and you need to still be here when it happens. Win rate measures
            neither. This page is the arithmetic behind that sentence, run against a{' '}
            <span className="font-mono text-surface-100">{fmt$(account)}</span> account risking{' '}
            <span className="font-mono text-surface-100">{fmtPct(riskPct, 2)}</span> a trade.
          </p>
        </div>
      </div>

      {/* THE IDENTITY */}
      <section className="rounded-2xl border border-surface-700/50 bg-surface-900/40 px-5 sm:px-6 py-5">
        <h2 className="text-[13px] font-bold tracking-widest text-surface-300 uppercase">Why win rate is the wrong question</h2>
        <p className="mt-2 text-[13px] text-surface-400 leading-relaxed">
          A trading account is not moved by how often you are right. It is moved by one identity:
        </p>
        <div className="mt-3 rounded-xl border border-cyan/25 bg-cyan/[0.05] px-4 py-4 text-center">
          <div className="font-mono text-[14px] sm:text-[16px] text-surface-100">
            expectancy = (win% × avg&nbsp;win) − (loss% × avg&nbsp;loss)
          </div>
          <div className="mt-2 font-mono text-[12px] sm:text-[13px] text-cyan">
            in R: E = W × payoff − (1 − W)
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-surface-700/40 bg-surface-900/50 px-4 py-3">
            <div className="text-[11px] font-bold tracking-widest text-surface-400 uppercase">Everything is R</div>
            <p className="mt-1.5 text-[12px] text-surface-400 leading-snug">
              <span className="text-surface-200">1R = the distance from your entry to your stop, in dollars.</span> Not
              the position size, not the share count — the amount you lose if you are wrong. Once every trade is
              measured in R, a $75 loss and a $750 loss on a ten-times-bigger account are the same event, and your
              results become comparable across time, price and instrument.
            </p>
          </div>
          <div className="rounded-xl border border-surface-700/40 bg-surface-900/50 px-4 py-3">
            <div className="text-[11px] font-bold tracking-widest text-surface-400 uppercase">The frontier</div>
            <p className="mt-1.5 text-[12px] text-surface-400 leading-snug">
              Breakeven win rate is <span className="font-mono text-surface-200">1 / (1 + R)</span>. At 3R you only need
              to be right <span className="text-accent font-semibold">25%</span> of the time. At 1R you need{' '}
              <span className="text-warning font-semibold">50%</span>. At 0.5R you need{' '}
              <span className="text-danger font-semibold">67%</span> — which is why cutting winners early is the most
              expensive habit in trading: it moves the bar you have to clear.
            </p>
          </div>
          <div className="rounded-xl border border-surface-700/40 bg-surface-900/50 px-4 py-3">
            <div className="text-[11px] font-bold tracking-widest text-surface-400 uppercase">A 35% winner, paid</div>
            <p className="mt-1.5 text-[12px] text-surface-400 leading-snug">
              Win 35 of 100 at 3R, lose 65 at 1R: <span className="font-mono text-surface-200">+105R − 65R = +40R</span>.
              You were wrong about two out of every three trades and the account still grew 40 risk units. That is the
              entire game — and it is unavailable to anyone who does not know where their stop is before they enter.
            </p>
          </div>
        </div>
      </section>

      {/* YOUR MEASURED EDGE */}
      {live?.payoff != null && (
        <section className="rounded-2xl border border-purple/25 bg-purple/[0.04] px-5 sm:px-6 py-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-[13px] font-bold tracking-widest text-purple uppercase">Your measured edge</h2>
              <p className="mt-1 text-[12px] text-surface-400">
                From the {live.totalTrades} closed trades in your log — the model, priced with your own numbers.
              </p>
            </div>
            <button
              onClick={applyLive}
              className="text-[11px] font-semibold text-purple hover:text-purple/80 bg-purple/10 hover:bg-purple/20 border border-purple/30 rounded-lg px-3 py-1.5"
            >
              Load into the simulator
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Win rate" value={fmtPct(live.winRate)} sub={`${live.totalTrades} closed trades`} />
            <Stat label="Payoff" value={`${live.payoff.toFixed(2)}R`} sub={`${fmt$(live.avgWin)} avg win / ${fmt$(Math.abs(live.avgLoss))} avg loss`} />
            <Stat
              label="Expectancy"
              value={fmtR(live.expectancy)}
              sub="per trade, in risk units"
              tone={live.expectancy > 0 ? 'text-accent' : 'text-danger'}
              border={live.expectancy > 0 ? 'border-accent/30' : 'border-danger/30'}
            />
            <Stat
              label="Breakeven payoff"
              value={`${breakevenPayoff(live.winRate / 100).toFixed(2)}R`}
              sub={`what ${fmtPct(live.winRate)} needs to clear`}
            />
          </div>
          <p className="mt-3 text-[12px] text-surface-400 leading-snug">
            {live.expectancy > 0.2 ? (
              <>Your payoff is carrying a sub-50% win rate comfortably — the edge is in the size of the winners, exactly
              where it should be. Protect it by not shrinking them.</>
            ) : live.expectancy > 0 ? (
              <>The edge is <span className="text-surface-200">positive but thin</span>. At {fmtR(live.expectancy)} per
              trade you are being paid, but a thin edge needs volume and patience to show up, and it is one habit change
              away from negative. The lever with the most room is the payoff, not the win rate — see what happens below
              when you drag it up half a point.</>
            ) : (
              <>The edge is <span className="text-danger">negative</span>: at {fmtPct(live.winRate)} you need at least{' '}
              {breakevenPayoff(live.winRate / 100).toFixed(2)}R and you are averaging {live.payoff.toFixed(2)}R. No
              position-sizing rule fixes this — sizing decides how fast a negative expectancy drains, never whether it
              does. Fix the exit first; the sizing math below only pays off on the other side of that.</>
            )}
          </p>
        </section>
      )}

      {/* THE REAL LOG, IN R — the two findings a win rate cannot show */}
      {realized && (
        <section className="rounded-2xl border border-surface-700/50 bg-surface-900/40 px-5 sm:px-6 py-5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-[13px] font-bold tracking-widest text-surface-300 uppercase">Your log, re-priced in R</h2>
            <span className="text-[11px] text-surface-500">
              {realized.count} trades · 1R proxied at {fmt$(realized.rUnit)} (your average loss)
            </span>
          </div>

          <div className="mt-3 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={realized.series} margin={{ top: 8, right: 10, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                <XAxis
                  dataKey="i"
                  tick={{ fill: COLORS.axis, fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(30, 41, 59, 0.4)' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={44}
                  label={{ value: 'trade #', position: 'insideBottomRight', offset: -2, fill: COLORS.axis, fontSize: 10 }}
                />
                <YAxis
                  tick={{ fill: COLORS.axis, fontSize: 11 }}
                  tickFormatter={(v) => `${v}R`}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: '#E2E8F0' }}
                  labelFormatter={(l) => `After ${l} trades`}
                  formatter={(v, name) => [
                    `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}R`,
                    name === 'cumR' ? 'Actual' : `Without your top ${realized.topN}`,
                  ]}
                />
                <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" />
                <Line dataKey="cumR" stroke={COLORS.accent} strokeWidth={2.2} dot={false} isAnimationActive={false} />
                <Line dataKey="cumRexTop" stroke={COLORS.danger} strokeWidth={1.6} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-warning/30 bg-warning/[0.05] px-4 py-3.5">
              <div className="text-[11px] font-bold tracking-widest text-warning uppercase">
                Finding 1 · the tail is the account
              </div>
              <p className="mt-1.5 text-[12.5px] text-surface-300 leading-snug">
                Your best {realized.topN} trades — <span className="font-mono">{(realized.topN / realized.count * 100).toFixed(1)}%</span> of
                the log — made <span className="font-mono text-accent">{fmtR(realized.topR, 1)}</span>. Everything else
                combined made <span className="font-mono text-danger">{fmtR(realized.withoutTopR, 1)}</span>. That is
                the red dashed line: remove a handful of outliers and the whole curve inverts.
              </p>
              <p className="mt-2 text-[11.5px] text-surface-400 leading-snug">
                This is why the exit rule matters more than the entry rule, and why cutting a winner at +1R to "lock it
                in" is not risk management — it is edge destruction. You cannot know in advance which trade is one of
                the {realized.topN}; you can only refuse to cap it. Biggest winner so far:{' '}
                <span className="font-mono text-surface-200">{fmtR(realized.bestR, 1)}</span>, with{' '}
                <span className="font-mono text-surface-200">{realized.over3R}</span> trades over 3R.
              </p>
            </div>

            <div className="rounded-xl border border-danger/30 bg-danger/[0.05] px-4 py-3.5">
              <div className="text-[11px] font-bold tracking-widest text-danger uppercase">
                Finding 2 · the losses that ran
              </div>
              <p className="mt-1.5 text-[12.5px] text-surface-300 leading-snug">
                <span className="font-mono">{realized.beyondStopCount}</span> trades lost more than 1R, giving up{' '}
                <span className="font-mono text-danger">{fmtR(realized.excessLossR, 1)}</span> beyond what a 1R stop
                would have cost. Worst single loss:{' '}
                <span className="font-mono text-danger">{fmtR(realized.worstR, 1)}</span>.
              </p>
              <p className="mt-2 text-[11.5px] text-surface-400 leading-snug">
                Every number on this page assumes a loss costs exactly 1R. Yours do not — so the model has been
                describing a stricter trader than the log does. Had each of those stopped at −1R with everything else
                identical, the log would read{' '}
                <span className="font-mono text-accent">{fmtR(realized.disciplinedTotalR, 1)}</span> instead of{' '}
                <span className="font-mono text-surface-200">{fmtR(realized.totalR, 1)}</span> — the same entries, the
                same winners, {(realized.disciplinedTotalR / Math.max(realized.totalR, 0.1)).toFixed(1)}× the result.
              </p>
            </div>
          </div>

          <p className="mt-3 text-[11.5px] text-surface-500 leading-snug">
            R is proxied by your average loss ({fmt$(realized.rUnit)}) because the log records a planned stop on almost
            no trades — so treat these as close estimates of intent, not measurements of it. Recording the stop on the{' '}
            <Link to="/situational-awareness" className="text-surface-300 hover:text-surface-100 underline underline-offset-2">Trade Plan</Link>{' '}
            is what turns them into measurements.
          </p>
        </section>
      )}

      {/* SIMULATOR */}
      <section className="rounded-2xl border border-surface-700/50 bg-surface-900/40 px-5 sm:px-6 py-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-[13px] font-bold tracking-widest text-surface-300 uppercase">The account, simulated</h2>
            <p className="mt-1 text-[12px] text-surface-500">
              400 fixed-fractional paths — every trade risks {fmtPct(riskPct, 2)} of the balance <em>at that moment</em>.
            </p>
          </div>
          <button
            onClick={() => setSeed(Math.floor(Math.random() * 1e9))}
            className="text-[11px] text-surface-300 hover:text-surface-100 px-2.5 py-1.5 rounded-lg border border-surface-700 hover:border-surface-600 bg-surface-900/60 flex items-center gap-1.5"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            New draw
          </button>
        </div>

        {/* Controls */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <Slider label="Account" value={account} onChange={setAccount} min={2000} max={200000} step={1000} format={(v) => fmt$(v)} />
          <Slider label="Risk / trade" value={riskPct} onChange={setRiskPct} min={0.1} max={5} step={0.1} format={(v) => `${v.toFixed(1)}% · ${fmt$(account * v / 100)}`} />
          <Slider label="Win rate" value={winRate} onChange={setWinRate} min={10} max={90} step={1} format={(v) => `${v}%`} />
          <Slider label="Payoff" value={payoff} onChange={setPayoff} min={0.3} max={6} step={0.1} format={(v) => `${v.toFixed(1)}R`} />
          <Slider label="Trades" value={trades} onChange={setTrades} min={50} max={1000} step={25} format={(v) => `${v}`} />
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold tracking-widest text-surface-500 uppercase">Profiles</span>
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => applyPreset(p)}
              title={p.note}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                winRate === p.winRate && Math.abs(payoff - p.payoff) < 0.001
                  ? 'bg-cyan/15 text-cyan border-cyan/40'
                  : 'bg-surface-900/60 text-surface-400 border-surface-700 hover:text-surface-200 hover:border-surface-600'
              }`}
            >
              {p.label} · {p.winRate}% / {p.payoff}R
            </button>
          ))}
        </div>

        {/* KPI row */}
        <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Stat
            label="Risk unit (1R)"
            value={fmt$(riskUnit)}
            sub={`${fmtPct(riskPct, 2)} of ${fmt$(account)}`}
            tone="text-cyan"
            border="border-cyan/30"
          />
          <Stat
            label="Expectancy"
            value={fmtR(exp)}
            sub={`${perTradePct >= 0 ? '+' : ''}${perTradePct.toFixed(3)}% of equity per trade`}
            tone={edgeTone}
            border={exp > 0 ? 'border-accent/30' : 'border-danger/30'}
          />
          <Stat
            label={`Median after ${trades}`}
            value={fmt$(s.medianFinal)}
            sub={`${s.medianFinal >= account ? '+' : ''}${(((s.medianFinal - account) / account) * 100).toFixed(0)}% · p10 ${fmt$(s.p10Final)} / p90 ${fmt$(s.p90Final)}`}
            tone={s.medianFinal >= account ? 'text-accent' : 'text-danger'}
          />
          <Stat label="Odds of profit" value={fmtProb(s.probProfit)} sub={`${fmtProb(s.probDouble)} chance of doubling`} />
          <Stat
            label="Median max drawdown"
            value={fmtPct(s.medianMaxDD, 0)}
            sub={`worst path ${fmtPct(s.worstMaxDD, 0)} · longest losing run ${s.maxWorstStreak}`}
            tone="text-warning"
          />
        </div>

        {/* Equity fan */}
        <div className="mt-4 h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={fanData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
              <XAxis
                dataKey="trade"
                tick={{ fill: COLORS.axis, fontSize: 11 }}
                axisLine={{ stroke: 'rgba(30, 41, 59, 0.4)' }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={44}
                label={{ value: 'trades', position: 'insideBottomRight', offset: -2, fill: COLORS.axis, fontSize: 10 }}
              />
              {/* A range Area anchors its own domain at 0, which squashes the
                  whole fan into the top third. Pin the scale to the data. */}
              <YAxis
                domain={[(min) => Math.max(0, min * 0.9), (max) => max * 1.04]}
                tick={{ fill: COLORS.axis, fontSize: 11 }}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: '#E2E8F0' }}
                labelFormatter={(l) => `After ${l} trades`}
                formatter={(value, name) => {
                  if (Array.isArray(value)) return [`${fmt$(value[0])} – ${fmt$(value[1])}`, '10th–90th percentile']
                  const labels = { median: 'Median path', sample0: 'Sample path A', sample1: 'Sample path B', sample2: 'Sample path C' }
                  return [fmt$(value), labels[name] || name]
                }}
              />
              <Area dataKey="band" stroke="none" fill={COLORS.accent} fillOpacity={0.12} isAnimationActive={false} />
              <Line dataKey="sample0" stroke={COLORS.purple} strokeWidth={1} dot={false} strokeOpacity={0.55} isAnimationActive={false} />
              <Line dataKey="sample1" stroke={COLORS.cyan} strokeWidth={1} dot={false} strokeOpacity={0.55} isAnimationActive={false} />
              <Line dataKey="sample2" stroke={COLORS.warning} strokeWidth={1} dot={false} strokeOpacity={0.55} isAnimationActive={false} />
              <Line dataKey="median" stroke={COLORS.accent} strokeWidth={2.4} dot={false} isAnimationActive={false} />
              <ReferenceLine y={account} stroke="#475569" strokeDasharray="4 4" strokeOpacity={0.8} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-[11px] text-surface-500 leading-snug">
          Green band = the middle 80% of outcomes; heavy green = the median. The three thin lines are individual
          paths — same edge, same rules, wildly different rides. <span className="text-surface-300">That spread is
          the point:</span> a real edge still delivers losing stretches long enough to make you abandon it.
        </p>
      </section>

      {/* HOW MUCH SHOULD YOU RISK — Kelly + the growth-vs-size curve */}
      <section className="rounded-2xl border border-purple/25 bg-surface-900/40 px-5 sm:px-6 py-5">
        <h2 className="text-[13px] font-bold tracking-widest text-purple uppercase">So why not just risk more?</h2>
        <p className="mt-2 text-[13px] text-surface-400 leading-relaxed max-w-4xl">
          Because growth is <span className="text-surface-200">geometric</span>, not additive. Doubling the risk does
          not double the outcome — past a point it <em>reduces</em> it, because a bigger loss removes more compounding
          capital than the equivalent win adds back. The optimum is the Kelly fraction,{' '}
          <span className="font-mono text-surface-200">f* = expectancy ÷ payoff</span>, and the honest use of it is as
          a ceiling you stay well under.
        </p>

        {kelly > 0 ? (
          <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Full Kelly" value={fmtPct(kelly, 1)} sub="growth-optimal, and unlivable" tone="text-danger" border="border-danger/30" />
            <Stat label="Half Kelly" value={fmtPct(kelly / 2, 1)} sub="~75% of the growth, half the swings" tone="text-warning" />
            <Stat label="Quarter Kelly" value={fmtPct(kelly / 4, 1)} sub="the working professional range" tone="text-accent" border="border-accent/30" />
            <Stat
              label="You are risking"
              value={fmtPct(riskPct, 2)}
              sub={`${(kellyShare * 100).toFixed(0)}% of full Kelly`}
              tone="text-cyan"
              border="border-cyan/30"
            />
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-danger/30 bg-danger/[0.06] px-4 py-3.5">
            <div className="text-[11px] font-bold tracking-widest text-danger uppercase">Kelly is zero here</div>
            <p className="mt-1.5 text-[12.5px] text-surface-300 leading-snug">
              At {winRate}% and {payoff.toFixed(1)}R the expectancy is {fmtR(exp)}, so the growth-optimal bet size is{' '}
              <span className="text-surface-100 font-semibold">nothing</span>. With a negative edge there is no correct
              position size — every level below only changes how fast the account drains, and the curve has no peak to
              aim at. Sizing is a multiplier on the edge; multiplying a negative number never fixes its sign.
            </p>
          </div>
        )}

        <div className="mt-4 h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sweep} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
              {/* Log X as well as log Y: on a linear axis the entire practical
                  range (0.25–2%) collapses into the left margin. */}
              <XAxis
                dataKey="riskPct"
                type="number"
                scale="log"
                domain={[0.25, 25]}
                ticks={[0.25, 0.5, 1, 2, 5, 10, 25]}
                tick={{ fill: COLORS.axis, fontSize: 11 }}
                tickFormatter={(v) => `${v}%`}
                axisLine={{ stroke: 'rgba(30, 41, 59, 0.4)' }}
                tickLine={false}
                label={{ value: 'risk per trade', position: 'insideBottomRight', offset: -2, fill: COLORS.axis, fontSize: 10 }}
              />
              <YAxis
                scale="log"
                domain={['auto', 'auto']}
                tick={{ fill: COLORS.axis, fontSize: 11 }}
                tickFormatter={(v) => {
                  if (v >= 10) return `${v.toFixed(0)}×`
                  if (v >= 1) return `${v.toFixed(1)}×`
                  if (v >= 0.01) return `${v.toFixed(2)}×`
                  return `${Number(v.toPrecision(1))}×`   // keep sub-1% wipeouts distinguishable
                }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: '#E2E8F0' }}
                labelFormatter={(l) => `Risking ${l}% per trade`}
                formatter={(v, name) => [
                  `${Number(v).toFixed(2)}× · ${fmt$(account * Number(v))}`,
                  name === 'median' ? 'Median account' : 'Unlucky (10th pct) account',
                ]}
              />
              <ReferenceLine y={1} stroke="#475569" strokeDasharray="4 4"
                label={{ value: 'break even', position: 'insideTopLeft', fill: COLORS.axis, fontSize: 10 }} />
              {kelly > 0 && kelly < 25 && (
                <ReferenceLine x={+kelly.toFixed(2)} stroke={COLORS.danger} strokeDasharray="3 3" strokeOpacity={0.8}
                  label={{ value: 'full Kelly', position: 'top', fill: COLORS.danger, fontSize: 10 }} />
              )}
              <ReferenceLine x={riskPct} stroke={COLORS.cyan} strokeWidth={1.4}
                label={{ value: 'you', position: 'top', fill: COLORS.cyan, fontSize: 10 }} />
              <Line dataKey="median" stroke={COLORS.accent} strokeWidth={2.4} dot={{ r: 2 }} isAnimationActive={false} />
              <Line dataKey="p10" stroke={COLORS.danger} strokeWidth={1.8} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-[11.5px] text-surface-400 leading-snug">
          Green = the median account after {trades} trades, as a multiple of where it started. Red dashed = the unlucky
          (10th percentile) account. Both axes are logarithmic — without that, the entire practical range collapses
          into the left margin, and the paper gains near the peak are large enough to be misleading.
        </p>
        {kelly > 0 ? (
          <p className="mt-2 text-[12px] text-surface-400 leading-snug">
            <span className="text-surface-200">The two peaks are the whole lesson.</span> The median tops out around{' '}
            <span className="font-mono text-accent">{fmtPct(peaks.median.riskPct, 2)}</span> risk per trade, but the
            unlucky path stops improving at just{' '}
            <span className="font-mono text-danger">{fmtPct(peaks.p10.riskPct, 2)}</span> — and past there, taking more
            risk makes the bad outcome strictly worse while the median is still climbing. You do not get to trade the
            median. You get one path, and you find out which one afterwards.
          </p>
        ) : (
          <p className="mt-2 text-[12px] text-surface-400 leading-snug">
            <span className="text-surface-200">There is no peak.</span> With a negative edge both curves fall
            monotonically: the smallest size on the chart is the best one, and the only winning move is to stop taking
            the trade until the expectancy changes sign.
          </p>
        )}
        {kelly > 0 && (
          <p className="mt-2 text-[12px] text-surface-400 leading-snug">
            At {winRate}% and {payoff.toFixed(1)}R, full Kelly is <span className="font-mono text-danger">{fmtPct(kelly, 1)}</span>{' '}
            per trade — a number that comes with routine 50%+ drawdowns and assumes you know your edge exactly. You
            don't: {winRate}% and {payoff.toFixed(1)}R are estimates from a finite sample, and Kelly punishes
            overestimation far more harshly than underestimation. {fmtPct(riskPct, 2)} is{' '}
            {kellyShare < 0.35 ? 'comfortably inside the conservative band' : kellyShare < 0.6 ? 'around half Kelly — aggressive but defensible' : 'above half Kelly, which is more size than the estimate can support'}.
          </p>
        )}
      </section>

      {/* COUNTERFACTUALS */}
      <section className="rounded-2xl border border-surface-700/50 bg-surface-900/40 px-5 sm:px-6 py-5">
        <h2 className="text-[13px] font-bold tracking-widest text-surface-300 uppercase">Change one thing</h2>
        <p className="mt-1 text-[12px] text-surface-500">
          The same {fmt$(account)} account and the same {trades} trades, re-run with a single input moved. Baseline
          median: <span className="font-mono text-surface-300">{fmt$(s.medianFinal)}</span>.
        </p>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          {variants.map(v => {
            const delta = v.median - s.medianFinal
            const border = v.tone === 'accent' ? 'border-accent/30' : v.tone === 'cyan' ? 'border-cyan/30' : 'border-danger/30'
            const text = v.tone === 'accent' ? 'text-accent' : v.tone === 'cyan' ? 'text-cyan' : 'text-danger'
            return (
              <div key={v.key} className={`rounded-xl border ${border} bg-surface-900/50 px-4 py-3`}>
                <div className={`text-[12px] font-bold ${text}`}>{v.label}</div>
                <div className="text-[10.5px] text-surface-500 mt-0.5">{v.hint}</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-[19px] font-display font-bold text-surface-100">{fmt$(v.median)}</span>
                  <span className={`text-[12px] font-mono ${delta >= 0 ? 'text-accent' : 'text-danger'}`}>
                    {delta >= 0 ? '+' : ''}{fmt$(delta)}
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] text-surface-500">
                  median drawdown {fmtPct(v.dd, 0)} · {fmtProb(v.probProfit)} of paths profitable
                </div>
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-[12px] text-surface-400 leading-snug">
          Read the third card against its drawdown: doubling the size multiplies the median by{' '}
          <span className="font-mono text-surface-200">{(variants[2].median / s.medianFinal).toFixed(2)}×</span> and the
          median drawdown by <span className="font-mono text-danger">{(variants[2].dd / Math.max(s.medianMaxDD, 0.01)).toFixed(2)}×</span>.
          The first two cards buy growth with skill and the third buys it with risk — and only one of those keeps
          working when the edge turns out to be smaller than you measured.
        </p>
      </section>

      {/* FRONTIER + DISTRIBUTION */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-2xl border border-surface-700/50 bg-surface-900/40 px-5 py-5">
          <h2 className="text-[13px] font-bold tracking-widest text-surface-300 uppercase">The breakeven frontier</h2>
          <p className="mt-1 text-[12px] text-surface-500">
            Win rate needed to break even at each payoff. Above the curve you keep money; below it you are paying to trade.
          </p>
          <div className="mt-3 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={frontier} margin={{ top: 8, right: 10, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
                <XAxis
                  dataKey="payoff"
                  type="number"
                  domain={[0.4, 5]}
                  tick={{ fill: COLORS.axis, fontSize: 11 }}
                  tickFormatter={(v) => `${v}R`}
                  axisLine={{ stroke: 'rgba(30, 41, 59, 0.4)' }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 80]}
                  tick={{ fill: COLORS.axis, fontSize: 11 }}
                  tickFormatter={(v) => `${v}%`}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: '#E2E8F0' }}
                  labelFormatter={(l) => `Payoff ${l}R`}
                  formatter={(v) => [`${v}%`, 'Breakeven win rate']}
                />
                <ReferenceLine y={50} stroke="#475569" strokeDasharray="4 4" strokeOpacity={0.7}
                  label={{ value: '50%', position: 'insideTopLeft', fill: COLORS.axis, fontSize: 10 }} />
                <Line dataKey="requiredWinRate" stroke={COLORS.warning} strokeWidth={2.2} dot={false} isAnimationActive={false} />
                <ReferenceDot
                  x={Math.min(5, Math.max(0.4, payoff))}
                  y={Math.min(80, winRate)}
                  r={5}
                  fill={exp > 0 ? COLORS.accent : COLORS.danger}
                  stroke="#0B1220"
                  strokeWidth={1.5}
                  isFront
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[12px] text-surface-400 leading-snug">
            The dot is your current setting: <span className="font-mono text-surface-200">{winRate}% at {payoff.toFixed(1)}R</span>.
            You need <span className="font-mono text-surface-200">{(requiredPayoff).toFixed(2)}R</span> to break even at
            that win rate, so you are running{' '}
            <span className={exp > 0 ? 'text-accent' : 'text-danger'}>{fmtR(exp)}</span> per trade.
          </p>
        </section>

        <section className="rounded-2xl border border-surface-700/50 bg-surface-900/40 px-5 py-5">
          <h2 className="text-[13px] font-bold tracking-widest text-surface-300 uppercase">Where the 400 accounts ended</h2>
          <p className="mt-1 text-[12px] text-surface-500">
            Same edge, same rules, {trades} trades each. Red bars finished below the {fmt$(account)} they started with.
          </p>
          <div className="mt-3 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bins} margin={{ top: 8, right: 10, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tick={{ fill: COLORS.axis, fontSize: 11 }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  axisLine={{ stroke: 'rgba(30, 41, 59, 0.4)' }}
                  tickLine={false}
                />
                <YAxis tick={{ fill: COLORS.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: '#E2E8F0' }}
                  labelFormatter={(l) => `≈ ${fmt$(l)} final balance`}
                  formatter={(v) => [`${v} of ${s.paths} paths`, 'Outcomes']}
                />
                <ReferenceLine x={account} stroke="#94A3B8" strokeDasharray="4 4" />
                <Bar dataKey="count" isAnimationActive={false}>
                  {bins.map((b, i) => (
                    <Cell key={i} fill={b.x >= account ? COLORS.accent : COLORS.danger} fillOpacity={0.75} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[12px] text-surface-400 leading-snug">
            <span className="text-surface-200">{fmtPct(s.probProfit * 100, 0)}</span> of paths finished ahead, median{' '}
            <span className="text-surface-200">{fmt$(s.medianFinal)}</span>, worst {fmt$(s.worstFinal)}, best{' '}
            {fmt$(s.bestFinal)}. A positive edge is a distribution, not a promise — which is the reason the risk unit
            has to be small enough that the left tail is survivable.
          </p>
        </section>
      </div>

      {/* WHY HALF A PERCENT */}
      <section className="rounded-2xl border border-warning/25 bg-warning/[0.04] px-5 sm:px-6 py-5">
        <h2 className="text-[13px] font-bold tracking-widest text-warning uppercase">Why half a percent</h2>
        <p className="mt-2 text-[13px] text-surface-300 leading-relaxed max-w-4xl">
          At a 35% win rate, a run of ten losers is not bad luck — it is a{' '}
          <span className="text-surface-100">Tuesday</span>. Over {trades} trades this simulation's worst path strung{' '}
          <span className="font-mono text-surface-100">{s.maxWorstStreak}</span> losses together, and the median path
          still hit a <span className="font-mono text-surface-100">{fmtPct(s.medianMaxDD, 0)}</span> drawdown. Your risk
          per trade decides whether that stretch is an inconvenience or the end of the account. Sizing does not create
          the edge — it decides whether you are still around to collect it.
        </p>

        {/* The path, not the destination — nobody experiences a final balance
            without first living through the worst point along the way. */}
        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Ever down 10%" value={fmtProb(s.probDD10)} sub="at some point in the run" />
          <Stat label="Ever down 20%" value={fmtProb(s.probDD20)} sub="the level most people quit at" tone="text-warning" />
          <Stat label="Ever down 30%" value={fmtProb(s.probDD30)} sub="strategy-abandonment territory" tone={s.probDD30 > 0.2 ? 'text-danger' : 'text-surface-100'} />
          <Stat
            label="Losing streak"
            value={`${Math.round(s.medianWorstStreak)} typical`}
            sub={`${Math.round(s.p90WorstStreak)} in the 90th-percentile run · ${s.maxWorstStreak} worst seen`}
          />
        </div>
        <p className="mt-2 text-[12px] text-surface-400 leading-snug">
          These are probabilities of <em>ever touching</em> that drawdown, not of ending there — and they are the
          numbers to plan around, because nobody experiences a final balance without living through the worst point on
          the way to it. Decide now what you will do at each level; the middle of a drawdown is the worst possible time
          to invent a policy.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[12px] min-w-[540px]">
            <thead>
              <tr className="text-surface-500 border-b border-surface-700/60">
                <th className="text-left font-bold tracking-widest uppercase text-[9.5px] py-2 pr-3">Risk / trade</th>
                <th className="text-right font-bold tracking-widest uppercase text-[9.5px] py-2 px-3">1R on {fmt$(account)}</th>
                <th className="text-right font-bold tracking-widest uppercase text-[9.5px] py-2 px-3">5 losses</th>
                <th className="text-right font-bold tracking-widest uppercase text-[9.5px] py-2 px-3">10 losses</th>
                <th className="text-right font-bold tracking-widest uppercase text-[9.5px] py-2 px-3">15 losses</th>
                <th className="text-right font-bold tracking-widest uppercase text-[9.5px] py-2 pl-3">Gain to undo 10</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {[0.25, 0.5, 1, 2, 3, 5].map(r => {
                const dd10 = streakDrawdown(r, 10)
                const isCurrent = Math.abs(r - riskPct) < 0.001
                const tone = r <= 0.5 ? 'text-accent' : r <= 1 ? 'text-surface-200' : r <= 2 ? 'text-warning' : 'text-danger'
                return (
                  <tr key={r} className={`border-b border-surface-800/60 ${isCurrent ? 'bg-cyan/[0.06]' : ''}`}>
                    <td className={`py-2 pr-3 font-semibold ${tone}`}>
                      {r}%{isCurrent && <span className="ml-2 text-[9px] font-sans tracking-widest text-cyan uppercase">current</span>}
                    </td>
                    <td className="py-2 px-3 text-right text-surface-300">{fmt$(account * r / 100)}</td>
                    <td className="py-2 px-3 text-right text-surface-400">{fmtPct(streakDrawdown(r, 5))}</td>
                    <td className={`py-2 px-3 text-right ${tone}`}>{fmtPct(dd10)}</td>
                    <td className="py-2 px-3 text-right text-surface-400">{fmtPct(streakDrawdown(r, 15))}</td>
                    <td className={`py-2 pl-3 text-right ${tone}`}>+{gainToRecover(dd10).toFixed(1)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11.5px] text-surface-400 leading-snug">
          Read the last column: <span className="text-surface-200">recovery is asymmetric</span>. Ten losses at 0.5%
          costs {fmtPct(Math.abs(streakDrawdown(0.5, 10)))} and needs{' '}
          <span className="text-accent">+{gainToRecover(streakDrawdown(0.5, 10)).toFixed(1)}%</span> to undo. At 5% the
          same ten losses cost {fmtPct(Math.abs(streakDrawdown(5, 10)))} and need{' '}
          <span className="text-danger">+{gainToRecover(streakDrawdown(5, 10)).toFixed(1)}%</span> — a different
          category of problem, from an identical run of trades.
        </p>
        <p className="mt-2 text-[11.5px] text-surface-500 leading-snug">
          The counterintuitive part: measured in <em>winners</em>, recovery is the same either way — about{' '}
          {tradesToRecover(Math.abs(streakDrawdown(0.5, 10)), 0.5, payoff)} wins at {payoff.toFixed(1)}R at both risk
          levels, because a bigger unit digs the hole and fills it at the same rate. That is not the reassurance it
          sounds like. What changes with size is the dollar hole, and whether you are still taking the setup the same
          way at the bottom of it — the drawdown that ends accounts is the behavioural one, not the arithmetic one.
        </p>
      </section>

      {/* THE RISK UNIT IN PRACTICE */}
      <section className="rounded-2xl border border-surface-700/50 bg-surface-900/40 px-5 sm:px-6 py-5">
        <h2 className="text-[13px] font-bold tracking-widest text-surface-300 uppercase">The unit, in practice</h2>
        <p className="mt-2 text-[13px] text-surface-400 leading-relaxed max-w-4xl">
          {fmtPct(riskPct, 2)} of {fmt$(account)} is <span className="font-mono text-cyan">{fmt$(riskUnit)}</span>. That
          is the only number you carry into the trade — position size is then arithmetic, not a decision:{' '}
          <span className="font-mono text-surface-200">shares = {fmt$(riskUnit)} ÷ (entry − stop)</span>. Note what
          this does: a <span className="text-surface-200">tighter stop buys a bigger position for the same risk</span>.
          The stop is not a tax on the trade, it is what sets its size.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12px] min-w-[560px]">
            <thead>
              <tr className="text-surface-500 border-b border-surface-700/60">
                <th className="text-left font-bold tracking-widest uppercase text-[9.5px] py-2 pr-3">Entry</th>
                <th className="text-right font-bold tracking-widest uppercase text-[9.5px] py-2 px-3">Stop</th>
                <th className="text-right font-bold tracking-widest uppercase text-[9.5px] py-2 px-3">Stop distance</th>
                <th className="text-right font-bold tracking-widest uppercase text-[9.5px] py-2 px-3">Risk / share</th>
                <th className="text-right font-bold tracking-widest uppercase text-[9.5px] py-2 px-3">Shares</th>
                <th className="text-right font-bold tracking-widest uppercase text-[9.5px] py-2 pl-3">Position</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {sizing.map((row, i) => (
                <tr key={i} className="border-b border-surface-800/60">
                  <td className="py-2 pr-3 text-surface-200">${row.entry.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right text-surface-400">${row.stop.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right text-surface-400">{fmtPct(row.stopDistancePct)}</td>
                  <td className="py-2 px-3 text-right text-surface-400">${row.perShare.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right text-cyan font-semibold">{row.shares}</td>
                  <td className="py-2 pl-3 text-right text-surface-300">
                    {fmt$(row.positionValue)} <span className="text-surface-500">({fmtPct(row.positionPctOfAccount, 0)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11.5px] text-surface-500 leading-snug">
          Same {fmt$(riskUnit)} at risk in every row, positions from {fmt$(Math.min(...sizing.map(r => r.positionValue)))} to{' '}
          {fmt$(Math.max(...sizing.map(r => r.positionValue)))}. Size follows the chart, never the conviction. The{' '}
          <Link to="/tools" className="text-accent hover:text-accent-bright underline underline-offset-2">Position Sizer</Link>{' '}
          does this for a live trade; the <Link to="/rules" className="text-accent hover:text-accent-bright underline underline-offset-2">Rules</Link>{' '}
          page decides where the stop belongs.
        </p>
      </section>

      {/* THE THREE LEVERS */}
      <section className="rounded-2xl border border-surface-700/50 bg-surface-900/40 px-5 sm:px-6 py-5">
        <h2 className="text-[13px] font-bold tracking-widest text-surface-300 uppercase">Three levers, one of them lethal</h2>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
            <div className="text-[12px] font-bold text-accent">1 · Expectancy</div>
            <p className="mt-1.5 text-[12px] text-surface-400 leading-snug">
              Raise the payoff before you chase the win rate — it is the cheaper lever and it moves the breakeven bar in
              your favour. Going from 2R to 3R at a 35% win rate takes expectancy from{' '}
              <span className="font-mono text-surface-200">{fmtR(expectancyR(0.35, 2))}</span> to{' '}
              <span className="font-mono text-accent">{fmtR(expectancyR(0.35, 3))}</span>: a 60% improvement without
              being right any more often.
            </p>
          </div>
          <div className="rounded-xl border border-cyan/30 bg-cyan/[0.04] px-4 py-3">
            <div className="text-[12px] font-bold text-cyan">2 · Frequency</div>
            <p className="mt-1.5 text-[12px] text-surface-400 leading-snug">
              Expectancy is per trade; the account grows per <em>year</em>. {fmtR(exp)} × {trades} trades ={' '}
              <span className="font-mono text-surface-200">{fmtR(exp * trades, 0)}</span>. But frequency only helps
              while the edge holds — more trades on a thin edge mostly buys more commissions and more chances to
              improvise. Quality first, then volume.
            </p>
          </div>
          <div className="rounded-xl border border-danger/30 bg-danger/[0.04] px-4 py-3">
            <div className="text-[12px] font-bold text-danger">3 · Size — handle carefully</div>
            <p className="mt-1.5 text-[12px] text-surface-400 leading-snug">
              Doubling risk doubles expectancy per trade <em>and</em> the drawdown, and past a point it reduces the
              median outcome outright: volatility drag. Compounding punishes big losses more than it rewards big wins —
              a −50% needs +100% to undo. Size is the lever that feels like growth and behaves like risk.
            </p>
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-surface-700/40 bg-surface-950/40 px-4 py-3">
          <p className="text-[12.5px] text-surface-300 leading-relaxed">
            <span className="font-semibold text-surface-100">The whole answer, in one line:</span> at {winRate}% and{' '}
            {payoff.toFixed(1)}R you earn {fmtR(exp)} per trade, worth{' '}
            <span className="font-mono">{perTradePct >= 0 ? '+' : ''}{perTradePct.toFixed(3)}%</span> of the account
            each time at {fmtPct(riskPct, 2)} risk. Repeat it {trades} times and the median account goes{' '}
            {fmt$(account)} → <span className="font-mono text-surface-100">{fmt$(s.medianFinal)}</span>, having been
            wrong {(100 - winRate).toFixed(0)}% of the time and never risking more than {fmt$(riskUnit)} on any single
            idea. Nothing in that sentence requires predicting anything.
          </p>
        </div>
      </section>

      {/* CAVEATS */}
      <section className="rounded-2xl border border-surface-700/50 bg-surface-900/30 px-5 sm:px-6 py-5">
        <h2 className="text-[13px] font-bold tracking-widest text-surface-400 uppercase">What this model does not know</h2>
        <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {[
            'Every trade here is independent and identically distributed. Real trades cluster — the same regime that kills one setup kills the next four.',
            'Payoff is fixed at exactly R. Real winners are a fat-tailed distribution: a handful of outliers usually carry the year, and missing them changes everything.',
            'No slippage, commissions, borrow costs, gaps through stops or taxes. Each of those is a small permanent haircut on expectancy.',
            'It assumes you take every signal at full size and honour every stop. Deviating from that is the single largest source of real-world underperformance — which is what the Discipline page measures.',
            'Past win rate and payoff are estimates from a finite sample. With a few hundred trades the error bars on both are wide.',
            'Fixed-fractional sizing means you can approach zero but never mathematically reach it — real accounts have minimum position sizes and a psychological floor well above that.',
          ].map((t, i) => (
            <li key={i} className="flex gap-2 text-[12px] text-surface-400 leading-snug">
              <span className="mt-[6px] w-1 h-1 rounded-full bg-surface-500 shrink-0" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11.5px] text-surface-500 leading-snug">
          Illustrative simulation of your own strategy parameters — not a projection, and not advice. Check the model
          against your own log in{' '}
          <Link to="/trading-analysis" className="text-surface-300 hover:text-surface-100 underline underline-offset-2">Trading Analysis</Link>{' '}
          and{' '}
          <Link to="/discipline" className="text-surface-300 hover:text-surface-100 underline underline-offset-2">Discipline</Link>.
        </p>
      </section>
    </div>
  )
}
