import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import {
  getBreadthSnapshot,
  getBreadthHistory,
  getSituationalAwareness,
  getRegimeBacktest,
  getBreadthCalibration,
  refreshBreadth,
} from '../api/breadth'
import RefreshControl from '../components/RefreshControl'
import InfoTip from '../components/InfoTip'

// Shared glossary for the forward-return columns. These numbers are the least
// self-evident thing on the page, so every one of them is hoverable.
const TIPS = {
  fwd: 'Average return of the equal-weight universe index — the "average stock" — over the 10 trading sessions AFTER each day that sat in this band. Not your P&L: it is what the market did next.',
  base: 'The base rate: the same 10-session forward return measured across every day in the ledger, whatever the band. A band only has an edge if it beats this number.',
  hit: 'Share of those days where the next 10 sessions finished positive. A high hit rate with a low average means many small wins and a few large losses.',
  n: 'Trading days in this band in the ledger. Fewer than 30 is thin — and because regime days arrive in runs, the number of independent episodes is much smaller than the day count.',
  episodes: 'Separate visits to this band — a run of consecutive days counts once. This is the honest sample size: a fifteen-day constructive stretch is one market event, not fifteen. Amber below 12.',
  score: 'The 0–100 exposure score. Whichever range it falls in decides the band, and the band decides the suggested size.',
  benchmark: 'An equal-weight index of the whole scanned universe, rebuilt daily. Breadth is a statement about the average stock, so the average stock is the fair benchmark — not the cap-weighted S&P.',
}

// ---------------------------------------------------------------------------
// Regime → color/text mappings. Keep these tight so the regime banner and
// the per-tile chips all read from the same source of truth.
// ---------------------------------------------------------------------------
const REGIME_THEME = {
  capitulation: { ring: 'border-cyan-400/40', tint: 'bg-cyan-500/10', text: 'text-cyan-200', label: 'Capitulation' },
  bearish:      { ring: 'border-red-400/40',  tint: 'bg-red-500/10',  text: 'text-red-200',  label: 'Bearish' },
  neutral:      { ring: 'border-surface-600', tint: 'bg-surface-800', text: 'text-surface-200', label: 'Neutral' },
  bullish:      { ring: 'border-emerald-400/40', tint: 'bg-emerald-500/10', text: 'text-emerald-200', label: 'Bullish' },
  overheated:   { ring: 'border-amber-400/40', tint: 'bg-amber-500/10', text: 'text-amber-200', label: 'Overheated' },
}

// Stance colors mirror SituationalAwareness.jsx so the same band reads the same
// on both pages. `hex` is for SVG strokes, which can't take Tailwind classes.
const STANCE_THEME = {
  aggressive:   { text: 'text-emerald-300', ring: 'border-emerald-400/40', bg: 'bg-emerald-500/10', hex: '#34D399' },
  constructive: { text: 'text-success',     ring: 'border-success/40',     bg: 'bg-success/10',     hex: '#10B981' },
  selective:    { text: 'text-amber-300',   ring: 'border-amber-400/40',   bg: 'bg-amber-500/10',   hex: '#FBBF24' },
  defensive:    { text: 'text-orange-300',  ring: 'border-orange-400/40',  bg: 'bg-orange-500/10',  hex: '#FB923C' },
  cash:         { text: 'text-danger',      ring: 'border-danger/40',      bg: 'bg-danger/10',      hex: '#EF4444' },
}
const TONE_TEXT = { bull: 'text-emerald-300', bear: 'text-danger', warn: 'text-amber-300', neutral: 'text-surface-400' }

function fmtInt(n) {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-US')
}
function fmtPct(n, digits = 2) {
  if (n === null || n === undefined) return '—'
  return `${Number(n).toFixed(digits)}%`
}
function fmtRatio(n) {
  if (n === null || n === undefined) return '—'
  return Number(n).toFixed(2)
}

// ---------------------------------------------------------------------------
// Metric tiles. The hints below each value mirror Stockbee's published
// thresholds so the trader doesn't have to remember them.
// ---------------------------------------------------------------------------
// Change vs. the prior session — direction of the metric at a glance. Neutral
// (surface) colour on purpose: up isn't uniformly "good" across metrics (4%-down
// rising is bearish), so we show magnitude/direction without asserting sentiment.
function deltaVsPrev(curr, prev, digits = 0) {
  if (curr == null || prev == null) return null
  const d = curr - prev
  // Flat when the change rounds to zero at the tile's displayed precision, so we
  // never render an arrow next to a "0.0" magnitude.
  if (Math.abs(d) < 0.5 * Math.pow(10, -digits)) return '→ flat vs prev'
  const mag = digits ? Math.abs(d).toFixed(digits) : Math.abs(Math.round(d)).toLocaleString()
  return `${d > 0 ? '▲' : '▼'} ${mag} vs prev`
}

function MetricTile({ label, value, hint, accent, delta, factor }) {
  // `factor` is the matching scoring factor from the exposure model. Showing its
  // point contribution here is what connects a raw count to the gauge above:
  // every tile answers "and what did this do to the number?".
  const pts = factor && factor.available ? factor.points : null
  return (
    <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 p-4">
      <div className="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
        {label}
      </div>
      <div className={`mt-1.5 text-2xl font-mono font-semibold ${accent || 'text-surface-100'}`}>
        {value}
      </div>
      {delta && (
        <div className="mt-1 text-[10px] font-mono text-surface-600">{delta}</div>
      )}
      {hint && (
        <div className="mt-1 text-[11px] text-surface-500 leading-snug">{hint}</div>
      )}
      {factor && factor.available && (
        <div
          className="mt-2 pt-2 border-t border-surface-800/80 flex items-center gap-1.5"
          title={`${factor.label}: ${factor.detail || factor.active_desc || 'neutral'} → ${pts > 0 ? '+' : ''}${pts} points on the exposure score`}
        >
          <span className={`shrink-0 whitespace-nowrap text-[10px] font-mono font-semibold ${pts > 0 ? 'text-emerald-300' : pts < 0 ? 'text-danger' : 'text-surface-500'}`}>
            {pts > 0 ? '+' : ''}{pts} pts
          </span>
          <span className={`text-[10px] truncate ${TONE_TEXT[factor.tone] || 'text-surface-500'}`}>
            {factor.active_desc}
          </span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Conditions gauge
//
// The needle rides the 0–100 exposure score — the SAME number Trade Today
// shows, deliberately, so the two pages can never give contradicting reads.
//
// Why the gauge is NOT driven by the Stockbee regime label further down: that
// ladder isn't monotonic. Its top band ("overheated") is a worse tape to buy
// breakouts in than the band below it ("bullish"), so laying it on a meter
// would point the needle right at the moment you should be trimming. The
// exposure score is monotonic by construction — higher always means more long
// exposure — which is the only thing a gauge can honestly represent.
// ---------------------------------------------------------------------------

const GAUGE = { cx: 140, cy: 132, r: 104, w: 16 }

function gaugePoint(score, radius) {
  const clamped = Math.max(0, Math.min(100, score))
  const t = ((180 - (clamped / 100) * 180) * Math.PI) / 180
  return { x: GAUGE.cx + radius * Math.cos(t), y: GAUGE.cy - radius * Math.sin(t) }
}

function gaugeArc(from, to, radius) {
  const a = gaugePoint(from, radius)
  const b = gaugePoint(to, radius)
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
}

function ConditionsGauge({ score, bands, activeLevel }) {
  const theme = STANCE_THEME[activeLevel] || STANCE_THEME.selective
  const active = (bands || []).find(b => b.level === activeLevel)
  const knob = gaugePoint(score ?? 0, GAUGE.r)
  const knobIn = gaugePoint(score ?? 0, GAUGE.r - GAUGE.w / 2 - 1)
  const knobOut = gaugePoint(score ?? 0, GAUGE.r + GAUGE.w / 2 + 1)
  // Boundary ticks: every band edge, so the reader can see exactly which number
  // flips the stance rather than guessing from the color ramp.
  const ticks = [...new Set([0, ...(bands || []).flatMap(b => [b.min, b.max + 1]).filter(v => v > 0 && v < 100), 100])]
    .sort((a, b) => a - b)

  return (
    <svg viewBox="0 0 280 160" className="w-full max-w-[280px]" role="img" aria-label={`Exposure gauge at ${score ?? 0} of 100`}>
      <defs>
        {/* One continuous ramp for the whole sweep. A score is a continuum, so
            the arc reads as one gradient rather than five stacked blocks —
            only the band you're actually in gets lit. */}
        <linearGradient id="mmGaugeRamp" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#EF4444" />
          <stop offset="30%" stopColor="#FB923C" />
          <stop offset="52%" stopColor="#FBBF24" />
          <stop offset="74%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#34D399" />
        </linearGradient>
        <filter id="mmGaugeGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Recessed track */}
      <path d={gaugeArc(0, 100, GAUGE.r)} fill="none" stroke="#111927" strokeWidth={GAUGE.w + 6} strokeLinecap="round" />
      {/* The full ramp, held back so it reads as context, not as five verdicts */}
      <path d={gaugeArc(0, 100, GAUGE.r)} fill="none" stroke="url(#mmGaugeRamp)" strokeWidth={GAUGE.w} strokeLinecap="round" opacity={0.24} />
      {/* The band you're in, lit */}
      {active && (
        <path
          d={gaugeArc(active.min, active.max + 1, GAUGE.r)}
          fill="none"
          stroke={theme.hex}
          strokeWidth={GAUGE.w}
          opacity={0.95}
          filter="url(#mmGaugeGlow)"
        />
      )}

      {/* Boundary ticks — cut through the arc so the edges are exact */}
      {ticks.map(t => {
        const a = gaugePoint(t, GAUGE.r - GAUGE.w / 2)
        const c = gaugePoint(t, GAUGE.r + GAUGE.w / 2)
        const lbl = gaugePoint(t, GAUGE.r + GAUGE.w / 2 + 12)
        return (
          <g key={t}>
            <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke="#0A0F1A" strokeWidth={1.5} opacity={0.9} />
            <text x={lbl.x} y={lbl.y} fill="#475569" fontSize="9.5" fontFamily="ui-monospace, monospace" textAnchor="middle" dominantBaseline="middle">
              {t}
            </text>
          </g>
        )
      })}

      {/* Knob rides the arc instead of sweeping from a hub — a needle through
          the middle would cut straight across the readout. */}
      {score != null && (
        <>
          <line x1={knobIn.x} y1={knobIn.y} x2={knobOut.x} y2={knobOut.y} stroke="#0A0F1A" strokeWidth={5} strokeLinecap="round" />
          <circle cx={knob.x} cy={knob.y} r={7.5} fill="#0A0F1A" stroke={theme.hex} strokeWidth={4} />
        </>
      )}

      {/* Readout */}
      <text x={GAUGE.cx} y={GAUGE.cy - 40} fill={theme.hex} fontSize="46" fontWeight="700" fontFamily="ui-monospace, monospace" textAnchor="middle">
        {score ?? '—'}
      </text>
      <text x={GAUGE.cx} y={GAUGE.cy - 19} fill="#475569" fontSize="9" letterSpacing="2.5" textAnchor="middle">
        EXPOSURE
      </text>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Why the needle sits where it does — the score build-up, straight from the
// same factor evaluation that produced it. Baseline 50, then every factor that
// moved it, then what it would take to change bands.
// ---------------------------------------------------------------------------
function WhyHere({ explanation, drivers, score }) {
  if (!explanation) return null
  const up = explanation.to_up
  const down = explanation.to_down
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-surface-400 font-semibold">
        Why the needle is here
      </div>
      <div className="mt-2 flex items-center gap-2 text-[12px] font-mono">
        <span className="text-surface-500">50 base</span>
        {explanation.bull_points > 0 && <span className="text-emerald-300">+{explanation.bull_points}</span>}
        {explanation.bear_points > 0 && <span className="text-danger">−{explanation.bear_points}</span>}
        <span className="text-surface-500">=</span>
        <span className="text-surface-100 font-bold">{score}</span>
      </div>

      <div className="mt-2.5 space-y-1">
        {(drivers || []).length === 0 && (
          <div className="text-[12px] text-surface-500">
            No factor cleared a threshold — every input is in its neutral zone, so the score sits at the 50 baseline.
          </div>
        )}
        {(drivers || []).map(d => (
          <div key={d.label} className="flex items-start gap-2">
            <span
              className={`shrink-0 w-9 text-right font-mono text-[11px] font-semibold ${d.points > 0 ? 'text-emerald-300' : 'text-danger'}`}
            >
              {d.points > 0 ? '+' : ''}{d.points}
            </span>
            <span className="text-[12px] text-surface-300 leading-snug">{d.detail || d.label}</span>
          </div>
        ))}
      </div>

      {(up || down) && (
        <div className="mt-3 pt-2.5 border-t border-surface-700/40 text-[11.5px] text-surface-400 leading-relaxed">
          {up && <>Needs <span className="font-mono text-surface-200">+{up.gain_needed}</span> (score ≥ {up.threshold}) to reach <span className="text-surface-200">{up.label}</span>. </>}
          {down && <>Below <span className="font-mono text-surface-200">{down.threshold}</span> it drops to <span className="text-surface-200">{down.label}</span>.</>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Does this band actually pay? — the empirical half of "are conditions
// favourable". Joins the current band to the regime backtest: what the average
// stock did over the next 10 sessions on every past day in this band, against
// the all-days base rate.
//
// The base-rate comparison is the whole point. A band showing +3% forward
// return sounds great until you see every day averaged +3.5% — a filter only
// earns its keep by beating the unconditional number.
// ---------------------------------------------------------------------------
const THIN_SAMPLE = 30

function pct1(x) {
  return x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`
}

function BandEvidence({ backtest, activeLevel, loading }) {
  const h = backtest?.primary_horizon ?? 10
  const block = backtest?.by_level?.[h] || backtest?.by_level?.[String(h)]
  const mine = block?.[activeLevel]
  const base = block?.all

  if (loading) {
    return <div className="text-[12px] text-surface-500">Measuring what this band did historically…</div>
  }
  if (!mine || !base || mine.n === 0) {
    return (
      <div className="text-[12px] text-surface-500 leading-relaxed">
        No forward-return history for this band yet. The ledger fills in one day at a time — the
        evidence panel turns on once this band has been visited.
      </div>
    )
  }

  const beats = mine.avg != null && base.avg != null && mine.avg > base.avg
  const thin = mine.n < THIN_SAMPLE

  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-surface-400 font-semibold">
        Does this band pay?
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
        <InfoTip label={TIPS.fwd} className="text-surface-500 underline decoration-dotted decoration-surface-600 underline-offset-2">
          Next {h}d, this band
        </InfoTip>
        <span className={`font-mono font-semibold text-right ${beats ? 'text-emerald-300' : 'text-danger'}`}>
          {pct1(mine.avg)}
        </span>
        <InfoTip label={TIPS.base} className="text-surface-500 underline decoration-dotted decoration-surface-600 underline-offset-2">
          Next {h}d, all days
        </InfoTip>
        <span className="font-mono text-surface-300 text-right">{pct1(base.avg)}</span>
        <InfoTip label={TIPS.hit} className="text-surface-500 underline decoration-dotted decoration-surface-600 underline-offset-2">
          Hit rate
        </InfoTip>
        <span className="font-mono text-surface-300 text-right">
          {mine.hit_rate == null ? '—' : `${(mine.hit_rate * 100).toFixed(0)}%`}
        </span>
        <InfoTip label={TIPS.n} className="text-surface-500 underline decoration-dotted decoration-surface-600 underline-offset-2">
          Sample
        </InfoTip>
        <span className={`font-mono text-right ${thin ? 'text-amber-300' : 'text-surface-300'}`}>
          {mine.n} days
        </span>
      </div>
      {/* Spelled out rather than "1.67pp" — the arithmetic is right there, so
          the sentence shouldn't need a glossary. */}
      <div className="mt-2.5 pt-2.5 border-t border-surface-700/40 text-[11.5px] leading-relaxed">
        <span className={beats ? 'text-emerald-200' : 'text-amber-100'}>
          {beats
            ? `Over the next ${h} sessions this band has beaten the all-days average by ${((mine.avg - base.avg) * 100).toFixed(2)} percentage points (${pct1(mine.avg)} vs ${pct1(base.avg)}).`
            : `Over the next ${h} sessions this band has trailed the all-days average by ${((base.avg - mine.avg) * 100).toFixed(2)} percentage points (${pct1(mine.avg)} vs ${pct1(base.avg)}) — a below-average tape, not a favourable one.`}
        </span>
        {thin && (
          <span className="text-amber-300"> Thin sample ({mine.n} days) and regime days cluster into runs, so treat it as a hint, not proof.</span>
        )}
      </div>
      <div className="mt-1.5 text-[10.5px] text-surface-600 leading-snug">
        Benchmark:{' '}
        <InfoTip label={TIPS.benchmark} className="underline decoration-dotted decoration-surface-700 underline-offset-2">
          {backtest?.benchmark || 'equal-weight universe index'}
        </InfoTip>{' '}
        · {backtest?.sample_days ?? 0} ledger days.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The five levels, with the score range that defines each and what it did
// historically. This is the answer to "how many levels are there" — and the
// forward-return column keeps the ladder honest rather than assumed.
// ---------------------------------------------------------------------------
function BandLadder({ bands, score, backtest }) {
  const h = backtest?.primary_horizon ?? 10
  const block = backtest?.by_level?.[h] || backtest?.by_level?.[String(h)]
  return (
    <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-700/40 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-surface-100">The five levels</div>
          <div className="text-[11px] text-surface-500 mt-0.5">
            Where the needle can sit, what each band means for size, and what the average stock actually did next.
          </div>
        </div>
        {block?.all?.avg != null && (
          <InfoTip label={TIPS.base} className="text-[11px] text-surface-500 font-mono shrink-0 border-b border-dotted border-surface-700 pb-px">
            base rate {pct1(block.all.avg)} · {block.all.n}d
          </InfoTip>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-[12px]">
          <thead className="bg-surface-950/50 text-[10px] uppercase tracking-wide text-surface-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">
                <InfoTip label={TIPS.score} className="border-b border-dotted border-surface-600 pb-px">Score</InfoTip>
              </th>
              <th className="px-3 py-2 text-left font-semibold">Level</th>
              <th className="px-3 py-2 text-left font-semibold">What it means</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                <InfoTip label={TIPS.fwd} className="border-b border-dotted border-surface-600 pb-px">Next {h}d avg</InfoTip>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <InfoTip label={TIPS.hit} className="border-b border-dotted border-surface-600 pb-px">Hit</InfoTip>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <InfoTip label={TIPS.n} className="border-b border-dotted border-surface-600 pb-px">Days</InfoTip>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <InfoTip label={TIPS.episodes} className="border-b border-dotted border-surface-600 pb-px">Episodes</InfoTip>
              </th>
            </tr>
          </thead>
          <tbody>
            {(bands || []).map(b => {
              const t = STANCE_THEME[b.level] || {}
              const st = block?.[b.level]
              const beats = st?.avg != null && block?.all?.avg != null && st.avg > block.all.avg
              return (
                <tr
                  key={b.level}
                  className={`border-t border-surface-800/60 ${b.active ? t.bg : 'hover:bg-surface-800/30'}`}
                >
                  <td className={`px-3 py-2 font-mono whitespace-nowrap ${b.active ? t.text : 'text-surface-400'}`}>
                    {b.min}–{b.max}
                    {b.active && score != null && (
                      <span className={`ml-2 text-[10px] font-bold ${t.text}`}>← {score}</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 font-semibold whitespace-nowrap ${b.active ? t.text : 'text-surface-300'}`}>
                    {b.label}
                  </td>
                  <td className="px-3 py-2 text-surface-400">{b.exposure}</td>
                  <td className={`px-3 py-2 text-right font-mono ${st?.avg == null ? 'text-surface-600' : beats ? 'text-emerald-300' : 'text-surface-400'}`}>
                    {pct1(st?.avg)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-surface-400">
                    {st?.hit_rate == null ? '—' : `${(st.hit_rate * 100).toFixed(0)}%`}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${st && st.n < THIN_SAMPLE ? 'text-amber-300' : 'text-surface-500'}`}>
                    {st?.n ?? '—'}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${
                      st?.reliability === 'measured' ? 'text-surface-500'
                        : st?.reliability === 'tentative' ? 'text-amber-300' : 'text-danger'
                    }`}
                    title={st?.reliability ? `Reliability: ${st.reliability}` : undefined}
                  >
                    {st?.episodes ?? '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One sparkline. dataKey is the field on each history row.
// `threshold`/`refLines` lets us drop horizontal guides for breadth thresholds.
// ---------------------------------------------------------------------------
function Sparkline({ title, rows, dataKey, valueFmt, refLines = [], strokeColor = '#22d3ee' }) {
  const data = useMemo(() => (rows || []).map(r => ({
    date: r.date.slice(5),  // MM-DD
    value: r[dataKey] ?? null,
  })), [rows, dataKey])

  return (
    <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 p-4">
      <div className="text-[11px] uppercase tracking-wide text-surface-500 font-semibold mb-2">
        {title}
      </div>
      <div className="h-32 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(30, 41, 59, 0.5)" />
            <XAxis
              dataKey="date"
              tick={{ fill: '#64748B', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(51,65,85,0.5)' }}
            />
            <YAxis
              tick={{ fill: '#64748B', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(51,65,85,0.5)' }}
              width={36}
              tickFormatter={valueFmt}
            />
            <Tooltip
              contentStyle={{
                background: 'rgba(15,23,42,0.95)',
                border: '1px solid rgba(51,65,85,0.6)',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: '#94A3B8' }}
              formatter={(v) => [valueFmt ? valueFmt(v) : v, title]}
            />
            {refLines.map((y, i) => (
              <ReferenceLine
                key={i}
                y={y.value}
                stroke={y.color || 'rgba(148,163,184,0.4)'}
                strokeDasharray="4 4"
                label={y.label ? { value: y.label, fill: '#64748B', fontSize: 9, position: 'right' } : undefined}
              />
            ))}
            <Line
              type="monotone"
              dataKey="value"
              stroke={strokeColor}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// History table — green cells when the value is bullish vs. Stockbee's
// thresholds, red when bearish. NOT a buy/sell signal, just a heatmap.
// ---------------------------------------------------------------------------
function cellTone({ kind, value }) {
  if (value === null || value === undefined) return 'text-surface-400'
  if (kind === 'up4') {
    if (value >= 300) return 'text-emerald-300 font-semibold'
    if (value <= 100) return 'text-surface-400'
    return 'text-surface-100'
  }
  if (kind === 'dn4') {
    if (value >= 300) return 'text-red-300 font-semibold'
    if (value <= 100) return 'text-surface-400'
    return 'text-surface-100'
  }
  if (kind === 'ratio') {
    if (value >= 1.5) return 'text-emerald-300 font-semibold'
    if (value <= 0.7) return 'text-red-300 font-semibold'
    return 'text-surface-100'
  }
  if (kind === 'qtr_up' || kind === 'mo_up') {
    if (value >= 1000) return 'text-emerald-300 font-semibold'
    if (value >= 300) return 'text-emerald-200'
    return 'text-surface-100'
  }
  if (kind === 'qtr_dn' || kind === 'mo_dn') {
    if (value >= 500) return 'text-red-300 font-semibold'
    if (value >= 200) return 'text-red-200'
    return 'text-surface-100'
  }
  if (kind === 'mo50') {
    if (value >= 50) return 'text-amber-300 font-semibold'
    if (value >= 20) return 'text-amber-200'
    return 'text-surface-100'
  }
  if (kind === 't2108') {
    if (value >= 80) return 'text-amber-300 font-semibold'
    if (value <= 20) return 'text-cyan-300 font-semibold'
    return 'text-surface-100'
  }
  return 'text-surface-100'
}

// Definitions for each table column. Sourced from backend/breadth/calculator.py
// so the language matches the actual computation (Stockbee methodology).
const COLUMN_META = [
  { key: 'Date',    title: 'Trading session',     body: 'The trading session date (YYYY-MM-DD). Rows are sorted newest first.' },
  { key: '4% Up',   title: '4% Up day',           body: 'Number of stocks in the universe that closed up ≥ 4% versus the previous close. 300+ is notable buying pressure.' },
  { key: '4% Down', title: '4% Down day',         body: 'Number of stocks that closed down ≥ 4% versus the previous close. 300+ is notable selling pressure.' },
  { key: '5d',      title: '5-day ratio',         body: 'sum(4% Up over the last 5 sessions) ÷ sum(4% Down over the last 5 sessions). Short-term thrust indicator. ≥ 1.5 is bullish thrust; ≤ 0.7 is bearish.' },
  { key: '10d',     title: '10-day ratio',        body: 'Same as 5d but over the last 10 sessions. The classic Stockbee primary signal: ≥ 2.0 is a strong bullish thrust; ≤ 0.5 is bearish.' },
  { key: 'Qtr +25', title: 'Quarter up 25%',      body: 'Number of stocks up ≥ 25% over the last ~63 trading days (one quarter). Measures broad participation in any rally.' },
  { key: 'Qtr -25', title: 'Quarter down 25%',    body: 'Number of stocks down ≥ 25% over the last ~63 trading days. High values signal broad damage / bear market.' },
  { key: 'Mo +25',  title: 'Month up 25%',        body: 'Number of stocks up ≥ 25% over the last ~21 trading days (one month). Surges here often mark strong momentum environments.' },
  { key: 'Mo -25',  title: 'Month down 25%',      body: 'Number of stocks down ≥ 25% over the last ~21 trading days. Spikes typically appear during sharp corrections.' },
  { key: 'Mo +50',  title: 'Month up 50%',        body: 'Number of stocks up ≥ 50% over the last ~21 trading days. Readings above ~20 can signal an overheated / blow-off market.' },
  { key: 'T2108',   title: 'T2108 (local)',       body: 'Percent of the universe trading above its 40-day simple moving average. ≥ 80% = overheated; ≤ 20% = oversold / capitulation zone.' },
]

function HeaderCell({ meta }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  const show = () => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ left: r.left + r.width / 2, top: r.bottom + 8 })
  }
  const hide = () => setPos(null)

  return (
    <th
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={0}
      className="px-3 py-2 text-left font-semibold whitespace-nowrap cursor-help outline-none focus:text-surface-200"
    >
      <span className="border-b border-dotted border-surface-600 pb-px">{meta.key}</span>
      {pos && createPortal(
        <div
          style={{ left: pos.left, top: pos.top, transform: 'translateX(-50%)' }}
          className="fixed z-[100] max-w-[280px] px-3 py-2.5 rounded-lg bg-surface-950 border border-surface-700 shadow-2xl pointer-events-none animate-fade-in"
        >
          <div className="text-[11px] font-semibold uppercase tracking-wide text-surface-300 mb-1">
            {meta.title}
          </div>
          <div className="text-[12px] text-surface-400 leading-relaxed normal-case tracking-normal">
            {meta.body}
          </div>
        </div>,
        document.body,
      )}
    </th>
  )
}

function HistoryTable({ rows }) {
  if (!rows || rows.length === 0) return null
  const reversed = [...rows].reverse()  // newest first in the table

  return (
    <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-700/40">
        <div className="text-sm font-semibold text-surface-100">Recent Breadth Rows</div>
        <div className="text-[11px] text-surface-500 mt-0.5">
          Hover any column header for its definition. Green/red follows local MM thresholds, not direct buy/sell orders.
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-[12px]">
          <thead className="bg-surface-950/50 text-[10px] uppercase tracking-wide text-surface-500">
            <tr>
              {COLUMN_META.map(meta => (
                <HeaderCell key={meta.key} meta={meta} />
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {reversed.map(r => (
              <tr key={r.date} className="border-t border-surface-800/60 hover:bg-surface-800/30">
                <td className="px-3 py-2 text-surface-300">{r.date}</td>
                <td className={`px-3 py-2 ${cellTone({ kind: 'up4', value: r.up_4 })}`}>{fmtInt(r.up_4)}</td>
                <td className={`px-3 py-2 ${cellTone({ kind: 'dn4', value: r.down_4 })}`}>{fmtInt(r.down_4)}</td>
                <td className={`px-3 py-2 ${cellTone({ kind: 'ratio', value: r.ratio_5d })}`}>{fmtRatio(r.ratio_5d)}</td>
                <td className={`px-3 py-2 ${cellTone({ kind: 'ratio', value: r.ratio_10d })}`}>{fmtRatio(r.ratio_10d)}</td>
                <td className={`px-3 py-2 ${cellTone({ kind: 'qtr_up', value: r.qtr_up_25 })}`}>{fmtInt(r.qtr_up_25)}</td>
                <td className={`px-3 py-2 ${cellTone({ kind: 'qtr_dn', value: r.qtr_down_25 })}`}>{fmtInt(r.qtr_down_25)}</td>
                <td className={`px-3 py-2 ${cellTone({ kind: 'mo_up', value: r.mo_up_25 })}`}>{fmtInt(r.mo_up_25)}</td>
                <td className={`px-3 py-2 ${cellTone({ kind: 'mo_dn', value: r.mo_down_25 })}`}>{fmtInt(r.mo_down_25)}</td>
                <td className={`px-3 py-2 ${cellTone({ kind: 'mo50', value: r.mo_up_50 })}`}>{fmtInt(r.mo_up_50)}</td>
                <td className={`px-3 py-2 ${cellTone({ kind: 't2108', value: r.t2108 })}`}>{fmtPct(r.t2108)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Is the dial calibrated? — the bands vs. what they actually paid.
//
// Read-only on purpose. The suggested weights are shrunk toward the weights in
// use by how many independent episodes back them, and nothing here rewrites the
// live dial: refitting a sizing rule to a single year of one market is the
// overfitting the Edge Validation page exists to catch.
// ---------------------------------------------------------------------------
const LEVEL_LABEL = {
  aggressive: 'Aggressive', constructive: 'Constructive', selective: 'Selective',
  defensive: 'Defensive', cash: 'Risk-off',
}

function pctWeight(w) {
  return w == null ? '—' : `${Math.round(w * 100)}%`
}

function Calibration({ data, loading, activeLevel }) {
  if (loading) {
    return (
      <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 p-4 text-[12px] text-surface-500">
        Checking the bands against what they paid…
      </div>
    )
  }
  if (!data?.available) return null

  const inv = data.inversions || []
  return (
    <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-700/40">
        <div className="text-sm font-semibold text-surface-100">Is the dial calibrated?</div>
        <div className="text-[11px] text-surface-500 mt-0.5">
          What each band is sized at today vs. what its forward returns argue for, over {data.sample_days} ledger days.
        </div>
      </div>

      <div className={`px-4 py-3 border-b border-surface-700/40 text-[12.5px] leading-relaxed ${inv.length ? 'bg-amber-500/[0.06]' : 'bg-emerald-500/[0.06]'}`}>
        {inv.length === 0 ? (
          <span className="text-emerald-200">
            The ladder is monotonic — every band paid at least as much as the one below it. The dial is ordered correctly.
          </span>
        ) : (
          <span className="text-amber-100">
            The ladder is <span className="font-semibold">not monotonic</span>: {inv.length === 1 ? 'one band' : `${inv.length} bands`} paid
            more than the band above {inv.length === 1 ? 'it' : 'them'} —{' '}
            {inv.map((x, i) => (
              <span key={`${x.higher}-${x.lower}`}>
                {i > 0 && '; '}
                <span className="font-semibold">{LEVEL_LABEL[x.lower]}</span> beat{' '}
                <span className="font-semibold">{LEVEL_LABEL[x.higher]}</span> by {(x.gap * 100).toFixed(2)} points
              </span>
            ))}
            . A size dial whose upper rung underperforms the rung beneath it is mis-ordered, not just mis-weighted.
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-[12px]">
          <thead className="bg-surface-950/50 text-[10px] uppercase tracking-wide text-surface-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Level</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                <InfoTip label={TIPS.fwd} className="border-b border-dotted border-surface-600 pb-px">Paid</InfoTip>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <InfoTip
                  label="Spread of those forward returns (standard deviation). A band can pay little and still be a good place to hold size if it is calm; a band can pay well and be punishing if it swings."
                  className="border-b border-dotted border-surface-600 pb-px"
                >Risk</InfoTip>
              </th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                <InfoTip
                  label="Return per unit of risk — the Paid column divided by the Risk column. Reported but deliberately not used to set the suggested weight: sizing purely by this would hand the calmest band the biggest position, which only works if you can use leverage."
                  className="border-b border-dotted border-surface-600 pb-px"
                >Per risk</InfoTip>
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                <InfoTip label={TIPS.episodes} className="border-b border-dotted border-surface-600 pb-px">Eps</InfoTip>
              </th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                <InfoTip
                  label="The exposure weight this band is sized at today — the midpoint of its published invested-% range, and what the system backtest simulates."
                  className="border-b border-dotted border-surface-600 pb-px"
                >Sized now</InfoTip>
              </th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                <InfoTip
                  label={`What the forward returns argue for, shrunk toward the current weight by evidence: at ${data.shrink_k} episodes the suggestion sits halfway between the two. Nothing is applied automatically.`}
                  className="border-b border-dotted border-surface-600 pb-px"
                >Data implies</InfoTip>
              </th>
            </tr>
          </thead>
          <tbody>
            {(data.bands || []).map(b => {
              const t = STANCE_THEME[b.level] || {}
              const move = b.suggested_weight - b.current_weight
              return (
                <tr key={b.level} className={`border-t border-surface-800/60 ${b.level === activeLevel ? t.bg : ''}`}>
                  <td className={`px-3 py-2 font-semibold whitespace-nowrap ${b.level === activeLevel ? t.text : 'text-surface-300'}`}>
                    {LEVEL_LABEL[b.level]}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-surface-300">{pct1(b.avg)}</td>
                  <td className="px-3 py-2 text-right font-mono text-surface-500">
                    {b.stdev == null ? '—' : `±${(b.stdev * 100).toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-surface-400">
                    {b.return_per_unit_risk == null ? '—' : b.return_per_unit_risk.toFixed(2)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${
                    b.reliability === 'measured' ? 'text-surface-500'
                      : b.reliability === 'tentative' ? 'text-amber-300' : 'text-danger'
                  }`}>
                    {b.episodes}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-surface-300">{pctWeight(b.current_weight)}</td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                    <span className={Math.abs(move) < 0.05 ? 'text-surface-400' : move > 0 ? 'text-emerald-300' : 'text-danger'}>
                      {pctWeight(b.suggested_weight)}
                    </span>
                    {Math.abs(move) >= 0.05 && (
                      <span className="ml-1.5 text-[10px] text-surface-600">
                        {move > 0 ? '▲' : '▼'}{Math.abs(Math.round(move * 100))}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2.5 border-t border-surface-700/40 bg-surface-950/40 text-[11px] text-surface-500 leading-relaxed">
        Nothing here is applied automatically — the live weights are unchanged. One year of one market is not enough to
        refit a sizing rule, which is why every suggestion is pulled back toward the weight already in use in proportion
        to how many independent episodes support it.
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function MarketMonitor() {
  const [snapshot, setSnapshot] = useState(null)
  const [history, setHistory] = useState([])
  const [sa, setSa] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [refreshSummary, setRefreshSummary] = useState(null)
  // Regime backtest replays the whole ledger — kept off the critical path so a
  // slow/cold compute never delays the gauge itself.
  const [backtest, setBacktest] = useState(null)
  const [backtestLoading, setBacktestLoading] = useState(true)
  const [calibration, setCalibration] = useState(null)
  const [calibrationLoading, setCalibrationLoading] = useState(true)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [snap, hist, sit] = await Promise.all([
        getBreadthSnapshot(),
        getBreadthHistory(15),
        // The exposure read is what the gauge needs; if it fails the page still
        // renders the raw breadth below, so it must not reject the whole load.
        getSituationalAwareness(30).catch(() => null),
      ])
      setSnapshot(snap)
      setHistory(hist.rows || [])
      setSa(sit)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    let alive = true
    getRegimeBacktest()
      .then(d => { if (alive) setBacktest(d) })
      .catch(() => {})
      .finally(() => { if (alive) setBacktestLoading(false) })
    getBreadthCalibration()
      .then(d => { if (alive) setCalibration(d) })
      .catch(() => {})
      .finally(() => { if (alive) setCalibrationLoading(false) })
    return () => { alive = false }
  }, [])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const res = await refreshBreadth({ lookbackDays: 130 })
      setSnapshot(res.snapshot)
      setRefreshSummary(res.cache_summary)
      // Re-pull the history table + exposure read since the latest day may have
      // changed underneath both.
      const [hist, sit] = await Promise.all([
        getBreadthHistory(15),
        getSituationalAwareness(30).catch(() => null),
      ])
      setHistory(hist.rows || [])
      setSa(sit)
    } catch (e) {
      setError(e.message)
    } finally {
      setRefreshing(false)
    }
  }, [])

  const metrics = snapshot?.metrics
  const regime = snapshot?.regime
  const theme = REGIME_THEME[regime?.level || 'neutral'] || REGIME_THEME.neutral
  const coverage = snapshot?.coverage
  const empty = !loading && (!metrics || coverage?.universe_size === 0)
  // Prior session (history is oldest→newest) for the per-tile change readouts.
  const prev = history.length >= 2 ? history[history.length - 2] : null

  // Exposure read — the gauge's source of truth, shared with Trade Today.
  const score = sa?.score ?? null
  const stance = sa?.stance || null
  const bands = sa?.criteria?.stance_bands || []
  const stanceTheme = STANCE_THEME[stance?.level] || STANCE_THEME.selective
  // Factor lookup so each metric tile can show its own contribution to the score.
  const factorBy = useMemo(() => {
    const out = {}
    for (const f of sa?.criteria?.factors || []) out[f.key] = f
    return out
  }, [sa])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-surface-50">Market Monitor</h1>
          <p className="text-sm text-surface-500 mt-1">
            Local Stockbee-style breadth from cached OHLCV.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {snapshot?.as_of && (
            <span className="text-xs text-surface-500 font-mono">{snapshot.as_of}</span>
          )}
          <RefreshControl jobId="breadth" onRefresh={handleRefresh} refreshing={refreshing} />
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && !snapshot && (
        <div className="rounded-2xl bg-surface-900/60 border border-surface-700/40 p-12 text-center">
          <div className="inline-flex items-center gap-2 text-surface-300">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Loading breadth snapshot…
          </div>
        </div>
      )}

      {empty && !error && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 border-dashed p-10 text-center">
          <p className="text-surface-100 font-semibold text-base">No breadth data cached yet</p>
          <p className="text-surface-500 text-sm mt-2 max-w-md mx-auto">
            Click <span className="text-accent font-medium">Refresh MM</span> to build the initial cache.
            First run pulls the ~3000-symbol universe and ~130 days of grouped daily OHLCV from Polygon — it takes 3-5 minutes.
            Subsequent refreshes are near-instant.
          </p>
        </div>
      )}

      {metrics && regime && (
        <>
          {/* ── Current read: the gauge, why it's there, and whether it pays ── */}
          {score != null && stance && (
            <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 overflow-hidden">
              <div className="px-5 pt-4 pb-1 flex items-baseline justify-between gap-3 flex-wrap">
                <div className="text-[11px] uppercase tracking-[0.12em] text-surface-500 font-semibold">
                  Current read
                </div>
                <div className="text-[11px] text-surface-600 font-mono">
                  {fmtInt(coverage?.count)}/{fmtInt(coverage?.universe_size)} symbols ({coverage?.pct ?? 0}%) · {snapshot.source}
                </div>
              </div>

              <div className="grid lg:grid-cols-[290px,1fr,1fr] lg:divide-x divide-surface-700/40">
                {/* Gauge + band headline */}
                <div className="px-5 py-4 flex flex-col items-center text-center">
                  <ConditionsGauge score={score} bands={bands} activeLevel={stance.level} />
                  <div className={`-mt-1 text-[17px] font-semibold ${stanceTheme.text}`}>
                    {stance.label}
                  </div>
                  <div className="text-[13px] text-surface-300">{stance.headline}</div>
                  <div className={`mt-2 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium border ${stanceTheme.ring} ${stanceTheme.bg} ${stanceTheme.text}`}>
                    {stance.exposure}
                  </div>
                  {sa?.score_delta_5d != null && (
                    <div className="mt-2 text-[11px] text-surface-500">
                      {sa.score_delta_5d > 0 ? '▲' : sa.score_delta_5d < 0 ? '▼' : '→'}{' '}
                      {sa.score_delta_5d === 0 ? 'flat' : `${sa.score_delta_5d > 0 ? '+' : ''}${sa.score_delta_5d}`} vs last week
                    </div>
                  )}
                </div>

                <div className="px-5 py-4">
                  <WhyHere explanation={sa.explanation} drivers={sa.drivers} score={score} />
                </div>

                <div className="px-5 py-4">
                  <BandEvidence backtest={backtest} activeLevel={stance.level} loading={backtestLoading} />
                </div>
              </div>

              <div className="px-5 py-2.5 border-t border-surface-700/40 bg-surface-950/40 text-[11px] text-surface-500 leading-relaxed">
                Same 0–100 score Trade Today acts on — this page is the measurement, Trade Today is the decision.
                Higher always means more long exposure, so the dial is only ever read one way.
              </div>
            </div>
          )}

          {/* The five levels + what each did historically */}
          {score != null && bands.length > 0 && (
            <BandLadder bands={bands} score={score} backtest={backtest} />
          )}

          {/* Are those levels sized right for what they paid? */}
          <Calibration data={calibration} loading={calibrationLoading} activeLevel={stance?.level} />

          {/* Tape description (Stockbee regime). A *different axis* from the
              gauge: it describes what the tape is doing, and its top band
              (overheated) is a warning rather than a green light — which is why
              it sits below the gauge instead of competing with it. */}
          <div className={`rounded-2xl border ${theme.ring} ${theme.tint} p-5`}>
            <div className="flex items-start gap-4 flex-wrap">
              <div className="flex-1 min-w-[260px]">
                <div className="text-[11px] uppercase tracking-wide text-surface-400 font-semibold">
                  Tape description {score != null && <span className="text-surface-600 normal-case tracking-normal">· descriptive, not a size instruction</span>}
                </div>
                <div className={`mt-1 text-xl font-semibold ${theme.text}`}>
                  {regime.summary}
                </div>
              </div>
              <div className="flex-1 min-w-[260px]">
                <div className="text-[11px] uppercase tracking-wide text-surface-400 font-semibold">
                  Hold posture
                </div>
                <div className="mt-1 text-sm text-surface-200 leading-snug">
                  {regime.posture}
                </div>
              </div>
              {score == null && (
                <div className="text-right shrink-0">
                  <div className="text-[11px] uppercase tracking-wide text-surface-400 font-semibold">
                    Coverage
                  </div>
                  <div className="mt-1 text-sm text-surface-200 font-mono">
                    {fmtInt(coverage?.count)}/{fmtInt(coverage?.universe_size)} ({coverage?.pct ?? 0}%)
                  </div>
                  <div className="text-[11px] text-surface-500 mt-0.5">Source: {snapshot.source}</div>
                </div>
              )}
            </div>

            {(regime.reasons?.length > 0 || regime.warnings?.length > 0) && (
              <div className="grid sm:grid-cols-2 gap-4 mt-4">
                {regime.reasons?.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-surface-400 font-semibold mb-1.5">
                      Reasons
                    </div>
                    <ul className="space-y-1">
                      {regime.reasons.map((r, i) => (
                        <li key={i} className="text-sm text-surface-200 leading-snug">
                          <span className="text-surface-500">•</span> {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {regime.warnings?.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-amber-300/80 font-semibold mb-1.5">
                      Warnings
                    </div>
                    <ul className="space-y-1">
                      {regime.warnings.map((w, i) => (
                        <li key={i} className="text-sm text-amber-100 leading-snug">
                          <span className="text-amber-400/60">⚠</span> {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Metric tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <MetricTile
              label="4% up today"
              value={fmtInt(metrics.up_4)}
              hint="300+ is notable buying"
              accent={metrics.up_4 >= 300 ? 'text-emerald-300' : ''}
              delta={deltaVsPrev(metrics.up_4, prev?.up_4)}
              factor={factorBy.net_4}
            />
            <MetricTile
              label="4% down today"
              value={fmtInt(metrics.down_4)}
              hint="500+ is selling pressure"
              accent={metrics.down_4 >= 300 ? 'text-red-300' : ''}
              delta={deltaVsPrev(metrics.down_4, prev?.down_4)}
            />
            <MetricTile
              label="5-day ratio"
              value={fmtRatio(metrics.ratio_5d)}
              hint="≥1.7 strong · ≤0.8 soft"
              accent={metrics.ratio_5d >= 1.5 ? 'text-emerald-300' : metrics.ratio_5d <= 0.7 ? 'text-red-300' : ''}
              delta={deltaVsPrev(metrics.ratio_5d, prev?.ratio_5d, 2)}
              factor={factorBy.ratio_5d}
            />
            <MetricTile
              label="10-day ratio"
              value={fmtRatio(metrics.ratio_10d)}
              hint="≥1.5 bullish · <0.9 soft · ≤0.5 bearish"
              accent={metrics.ratio_10d >= 2 ? 'text-emerald-300' : metrics.ratio_10d <= 0.5 ? 'text-red-300' : ''}
              delta={deltaVsPrev(metrics.ratio_10d, prev?.ratio_10d, 2)}
              factor={factorBy.ratio_10d}
            />
            <MetricTile
              label="25% quarter up"
              value={fmtInt(metrics.qtr_up_25)}
              hint={`vs ${fmtInt(metrics.qtr_down_25)} down · ±150 matters`}
              delta={deltaVsPrev(metrics.qtr_up_25, prev?.qtr_up_25)}
              factor={factorBy.qtr_diff}
            />
            <MetricTile
              label="25% month up"
              value={fmtInt(metrics.mo_up_25)}
              hint={`vs ${fmtInt(metrics.mo_down_25)} down · ±150 matters`}
              delta={deltaVsPrev(metrics.mo_up_25, prev?.mo_up_25)}
              factor={factorBy.mo_diff}
            />
            <MetricTile
              label="50% month up"
              value={fmtInt(metrics.mo_up_50)}
              hint=">50 is frothy"
              accent={metrics.mo_up_50 > 50 ? 'text-amber-300' : metrics.mo_up_50 > 20 ? 'text-amber-200' : ''}
              delta={deltaVsPrev(metrics.mo_up_50, prev?.mo_up_50)}
              factor={factorBy.mo_up_50}
            />
            <MetricTile
              label="T2108 local"
              value={fmtPct(metrics.t2108)}
              hint="% above SMA40 · ≥80 or ≤20 penalized"
              accent={metrics.t2108 >= 80 ? 'text-amber-300' : metrics.t2108 <= 20 ? 'text-cyan-300' : ''}
              delta={deltaVsPrev(metrics.t2108, prev?.t2108, 1)}
              factor={factorBy.t2108}
            />
          </div>

          {/* Sparklines */}
          <div className="grid sm:grid-cols-2 gap-4">
            <Sparkline
              title="10-Day 4% Ratio"
              rows={history}
              dataKey="ratio_10d"
              valueFmt={(v) => Number(v).toFixed(2)}
              refLines={[
                { value: 2.0, color: 'rgba(52,211,153,0.4)', label: '2.0' },
                { value: 0.5, color: 'rgba(248,113,113,0.4)', label: '0.5' },
              ]}
              strokeColor="#22d3ee"
            />
            <Sparkline
              title="Primary Breadth (Qtr ±25%)"
              rows={history.map(r => ({ ...r, primary_breadth: (r.qtr_up_25 ?? 0) - (r.qtr_down_25 ?? 0) }))}
              dataKey="primary_breadth"
              valueFmt={(v) => Number(v).toLocaleString()}
              refLines={[{ value: 0, color: 'rgba(148,163,184,0.5)' }]}
              strokeColor="#a78bfa"
            />
            <Sparkline
              title="4% Up / Down"
              rows={history.map(r => ({ ...r, net_4: (r.up_4 ?? 0) - (r.down_4 ?? 0) }))}
              dataKey="net_4"
              valueFmt={(v) => Number(v).toLocaleString()}
              refLines={[{ value: 0, color: 'rgba(148,163,184,0.5)' }]}
              strokeColor="#34d399"
            />
            <Sparkline
              title="T2108 Local (% above SMA40)"
              rows={history}
              dataKey="t2108"
              valueFmt={(v) => `${Number(v).toFixed(0)}%`}
              refLines={[
                { value: 80, color: 'rgba(251,191,36,0.4)', label: '80' },
                { value: 20, color: 'rgba(34,211,238,0.4)', label: '20' },
              ]}
              strokeColor="#fbbf24"
            />
          </div>

          {/* History table */}
          <HistoryTable rows={history} />

          {refreshSummary && (
            <div className="text-[11px] text-surface-500 font-mono">
              Last refresh: fetched {refreshSummary.fetched} days, skipped {refreshSummary.skipped} cached, {refreshSummary.empty} holidays, {refreshSummary.failed} failed. Window {refreshSummary.window_start} → {refreshSummary.latest_day}.
            </div>
          )}
        </>
      )}
    </div>
  )
}
