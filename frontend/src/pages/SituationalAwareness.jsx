import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { Link } from 'react-router-dom'
import { getSituationalAwareness, getSituationalHistory, getRegimeBacktest, refreshBreadth } from '../api/breadth'

// ---------------------------------------------------------------------------
// Situational Awareness — the actionable layer on top of market breadth.
//
// Market Monitor shows the Stockbee breadth numbers; this page answers the
// trader's real question: *how aggressive should I be right now, and which
// setups are in season?* It reads the same local breadth cache and renders an
// exposure stance, statistical context vs the trailing year, a full "how & why"
// of the decision (score build-up, band ladder, live ✓/✗ criteria), a light per
// setup family, and the exposure trend off the persistent daily ledger.
// ---------------------------------------------------------------------------

const STANCE_THEME = {
  aggressive:   { ring: 'border-emerald-400/40', bg: 'bg-emerald-500/10', text: 'text-emerald-300', bar: 'bg-emerald-400' },
  constructive: { ring: 'border-success/40',     bg: 'bg-success/10',     text: 'text-success',     bar: 'bg-success' },
  selective:    { ring: 'border-amber-400/40',   bg: 'bg-amber-500/10',   text: 'text-amber-300',   bar: 'bg-amber-400' },
  defensive:    { ring: 'border-orange-400/40',  bg: 'bg-orange-500/10',  text: 'text-orange-300',  bar: 'bg-orange-400' },
  cash:         { ring: 'border-danger/40',      bg: 'bg-danger/10',      text: 'text-danger',      bar: 'bg-danger' },
  neutral:      { ring: 'border-surface-600',    bg: 'bg-surface-800/40', text: 'text-surface-200', bar: 'bg-surface-500' },
}

const LIGHT = {
  green: { dot: 'bg-emerald-400', ring: 'border-emerald-400/40', bg: 'bg-emerald-500/[0.07]', text: 'text-emerald-300', label: 'In season' },
  amber: { dot: 'bg-amber-400',   ring: 'border-amber-400/40',   bg: 'bg-amber-500/[0.07]',   text: 'text-amber-300',   label: 'Mixed' },
  red:   { dot: 'bg-danger',      ring: 'border-danger/40',      bg: 'bg-danger/[0.07]',      text: 'text-danger',      label: 'Out of season' },
}

// Tone → text/chip colors for drivers + scoring-criteria tiers.
const TONE_TEXT = { bull: 'text-emerald-300', bear: 'text-danger', warn: 'text-amber-300', neutral: 'text-surface-400' }
const TONE_CHIP = {
  bull: 'border-emerald-400/30 text-emerald-300',
  bear: 'border-danger/30 text-danger',
  warn: 'border-amber-400/30 text-amber-300',
  neutral: 'border-surface-600 text-surface-400',
}

const LOOKBACKS = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
]

// ─── Exposure dial (0–100) ──────────────────────────────────────────────────

function ScoreDial({ score, theme }) {
  const pct = Math.max(0, Math.min(100, score ?? 0))
  return (
    <div className="w-full">
      <div className="flex items-baseline gap-2">
        <span className={`font-mono font-bold text-4xl ${theme.text}`}>{score ?? '—'}</span>
        <span className="text-[11px] text-surface-500 uppercase tracking-wider">/ 100 exposure</span>
      </div>
      <div className="mt-2 h-2 w-full rounded-full bg-surface-800 overflow-hidden">
        <div className={`h-full rounded-full ${theme.bar} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wider text-surface-600">
        <span>Cash</span><span>Defensive</span><span>Selective</span><span>Lean long</span><span>Aggressive</span>
      </div>
    </div>
  )
}

function DeltaPill({ delta }) {
  if (delta == null) return null
  const up = delta > 0
  const flat = delta === 0
  const cls = flat ? 'text-surface-400 bg-surface-800/60 border-surface-600'
    : up ? 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30'
      : 'text-danger bg-danger/10 border-danger/30'
  const arrow = flat ? '→' : up ? '▲' : '▼'
  const word = flat ? 'flat vs last week' : `${up ? '+' : ''}${delta} vs last week`
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${cls}`}>
      {arrow} {word} {!flat && <span className="text-surface-500">· {up ? 'improving' : 'deteriorating'}</span>}
    </span>
  )
}

function StatBadge({ label, value, hint }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border border-surface-600 bg-surface-800/50 text-surface-300"
      title={hint}
    >
      <span className="text-surface-500">{label}</span>
      <span className="font-mono text-surface-100">{value}</span>
    </span>
  )
}

// ─── How & why: explanation + stance-band ladder ────────────────────────────

const ORDINAL = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function BandLadder({ bands, score }) {
  return (
    <div className="space-y-1">
      {bands.map((b) => {
        const theme = STANCE_THEME[b.level] || STANCE_THEME.neutral
        return (
          <div
            key={b.level}
            className={`flex items-center gap-3 rounded-lg border px-3 py-1.5 ${
              b.active ? `${theme.ring} ${theme.bg}` : 'border-surface-800/60 bg-surface-900/30'
            }`}
          >
            <span className={`font-mono text-[11px] w-14 shrink-0 ${b.active ? theme.text : 'text-surface-500'}`}>
              {b.min}–{b.max}
            </span>
            <span className={`text-[12.5px] font-semibold w-24 shrink-0 ${b.active ? theme.text : 'text-surface-300'}`}>
              {b.label}
            </span>
            <span className="text-[11px] text-surface-500 truncate hidden sm:block">{b.exposure}</span>
            {b.active && score != null && (
              <span className={`ml-auto shrink-0 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${theme.bg} ${theme.text}`}>
                now {score}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function HowAndWhy({ explanation, bands, score }) {
  if (!explanation) return null
  return (
    <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 p-4">
      <div className="text-[11px] uppercase tracking-wide text-surface-500 font-semibold mb-2">
        How the stance is decided
      </div>
      <p className="text-[13px] text-surface-200 leading-relaxed">{explanation.summary}</p>

      {/* bull/bear tally */}
      <div className="flex items-center gap-4 mt-3 text-[12px]">
        <span className="text-surface-500">Baseline <span className="font-mono text-surface-300">50</span></span>
        <span className="text-emerald-300">Bullish <span className="font-mono font-semibold">+{explanation.bull_points}</span></span>
        <span className="text-danger">Drag <span className="font-mono font-semibold">−{explanation.bear_points}</span></span>
        <span className="text-surface-300">= <span className="font-mono font-bold">{score}</span></span>
      </div>

      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wide text-surface-600 font-semibold mb-1.5">Stance bands</div>
        <BandLadder bands={bands} score={score} />
      </div>
    </div>
  )
}

// ─── Setup light card (with live decision criteria) ─────────────────────────

function CriteriaRow({ c }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className={`shrink-0 w-3.5 text-center text-[11px] ${c.met ? 'text-emerald-400' : 'text-surface-600'}`}>
        {c.met ? '✓' : '✗'}
      </span>
      <span className={`text-[11.5px] ${c.met ? 'text-surface-200' : 'text-surface-500'}`}>{c.label}</span>
      <span className="ml-auto font-mono text-[11px] text-surface-400 shrink-0">{c.value}</span>
    </div>
  )
}

function SetupCard({ s }) {
  const [open, setOpen] = useState(false)
  const l = LIGHT[s.light] || LIGHT.amber
  const crit = s.criteria
  const greenMode = crit?.green_mode === 'any' ? 'any' : 'all'
  return (
    <div className={`rounded-2xl border ${l.ring} ${l.bg} p-4 flex flex-col`}>
      <div className="flex items-center gap-2">
        <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${l.dot}`} aria-hidden="true" />
        <h3 className="text-sm font-semibold text-surface-100 leading-tight">{s.name}</h3>
        <span className={`ml-auto text-[10px] font-bold uppercase tracking-wider ${l.text}`}>{s.verdict}</span>
      </div>
      <p className="text-[11px] text-surface-500 mt-1 leading-snug">{s.blurb}</p>
      <p className="text-[12.5px] text-surface-300 mt-2.5 leading-snug">{s.why}</p>

      {crit && (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-3 self-start text-[11px] font-medium text-surface-400 hover:text-surface-200 inline-flex items-center gap-1"
          >
            <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
            {open ? 'Hide criteria' : 'Show criteria'}
          </button>
          {open && (
            <div className="mt-2 pt-2 border-t border-surface-700/40 space-y-2">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-emerald-300/80 font-semibold mb-0.5">
                  In season — {greenMode === 'any' ? 'any of' : 'all of'}
                </div>
                {crit.green.map((c, i) => <CriteriaRow key={i} c={c} />)}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-danger/80 font-semibold mb-0.5">
                  Out of season — any of
                </div>
                {crit.red.map((c, i) => <CriteriaRow key={i} c={c} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Drivers + scoring criteria ladder ──────────────────────────────────────

function DriverRow({ d }) {
  const tone = TONE_TEXT[d.tone] || 'text-surface-300'
  const pos = d.points > 0
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className={`font-mono text-[12px] font-bold w-9 text-right shrink-0 ${pos ? 'text-emerald-300' : d.points < 0 ? 'text-danger' : 'text-surface-400'}`}>
        {pos ? '+' : ''}{d.points}
      </span>
      <span className={`text-[12px] font-semibold w-40 shrink-0 ${tone}`}>{d.label}</span>
      <span className="text-[12px] text-surface-400 leading-snug">{d.detail}</span>
    </div>
  )
}

function FactorLadder({ factors }) {
  return (
    <div className="space-y-2.5">
      {factors.map((f) => (
        <div key={f.key} className="border-t border-surface-800/60 pt-2 first:border-0 first:pt-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-surface-200">{f.label}</span>
            <span className="font-mono text-[11px] text-surface-400">{f.available ? f.value : 'no data'}</span>
            <span className="text-[11px] text-surface-500 truncate">· {f.active_desc}</span>
            <span className={`ml-auto font-mono text-[11px] font-bold ${f.points > 0 ? 'text-emerald-300' : f.points < 0 ? 'text-danger' : 'text-surface-500'}`}>
              {f.points > 0 ? '+' : ''}{f.points}
            </span>
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {f.tiers.map((t, i) => (
              <span
                key={i}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${TONE_CHIP[t.tone] || TONE_CHIP.neutral} ${
                  t.active ? 'ring-1 ring-inset ring-current bg-surface-800/60' : 'opacity-50'
                }`}
                title={t.desc}
              >
                {t.label} {t.points > 0 ? '+' : ''}{t.points}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Exposure history (off the persistent ledger) ───────────────────────────

const LEVEL_DOT = {
  aggressive: 'bg-emerald-400', constructive: 'bg-success', selective: 'bg-amber-400',
  defensive: 'bg-orange-400', cash: 'bg-danger',
}

function HistoryChart({ rows, lookback, setLookback, loading, median }) {
  const data = useMemo(() => (rows || []).map((r) => ({ date: r.date.slice(5), score: r.score, level: r.level })), [rows])
  return (
    <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
          Exposure history {data.length ? `· ${data.length} sessions` : ''}
        </div>
        <div className="flex items-center gap-1">
          {LOOKBACKS.map((lb) => (
            <button
              key={lb.label}
              onClick={() => setLookback(lb.days)}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded border transition ${
                lookback === lb.days
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-surface-700 text-surface-500 hover:text-surface-300'
              }`}
            >
              {lb.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-44 w-full">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[12px] text-surface-500">
            {loading ? 'Loading history…' : 'No history recorded yet — it builds up one day at a time.'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="saHist" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(30, 41, 59, 0.5)" />
              <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'rgba(51,65,85,0.5)' }} minTickGap={24} />
              <YAxis domain={[0, 100]} ticks={[0, 30, 45, 60, 75, 100]} tick={{ fill: '#64748B', fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'rgba(51,65,85,0.5)' }} width={28} />
              <Tooltip
                contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(51,65,85,0.6)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#94A3B8' }}
                formatter={(v, _n, p) => [`${v} · ${p?.payload?.level || ''}`, 'Exposure']}
              />
              <ReferenceLine y={75} stroke="rgba(52,211,153,0.3)" strokeDasharray="4 4" label={{ value: 'aggressive', fill: '#64748B', fontSize: 9, position: 'right' }} />
              <ReferenceLine y={45} stroke="rgba(251,191,36,0.3)" strokeDasharray="4 4" label={{ value: 'selective', fill: '#64748B', fontSize: 9, position: 'right' }} />
              <ReferenceLine y={30} stroke="rgba(248,113,113,0.3)" strokeDasharray="4 4" label={{ value: 'defensive', fill: '#64748B', fontSize: 9, position: 'right' }} />
              {median != null && (
                <ReferenceLine y={median} stroke="rgba(148,163,184,0.5)" strokeDasharray="2 2" label={{ value: `median ${median}`, fill: '#94A3B8', fontSize: 9, position: 'insideTopLeft' }} />
              )}
              <Area type="monotone" dataKey="score" stroke="#22d3ee" strokeWidth={2} fill="url(#saHist)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

// ─── Regime edge (does the filter work?) ────────────────────────────────────

const HORIZON_OPTS = [
  { label: '1d', h: 1 },
  { label: '5d', h: 5 },
  { label: '10d', h: 10 },
  { label: '20d', h: 20 },
]

const STANCE_ROW_TEXT = {
  aggressive: 'text-emerald-300', constructive: 'text-success', selective: 'text-amber-300',
  defensive: 'text-orange-300', cash: 'text-danger', all: 'text-surface-300',
}
const STANCE_LABEL = {
  aggressive: 'Aggressive', constructive: 'Constructive', selective: 'Selective',
  defensive: 'Defensive', cash: 'Risk-off', all: 'All sessions',
}

const fmtPctSigned = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`)
const fmtPct0 = (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`)
const retTone = (v) => (v == null ? 'text-surface-500' : v > 0 ? 'text-emerald-300' : v < 0 ? 'text-danger' : 'text-surface-300')
// Small samples are noise — dim anything under ~5 observations.
const nClass = (n) => (n >= 5 ? 'text-surface-400' : 'text-surface-600')

function RegimeEdge({ data, loading, error, horizon, setHorizon }) {
  const hkey = String(horizon)
  const byLevel = data?.by_level?.[hkey]
  const setups = data?.setups
  const thin = data && data.sample_days < 60

  return (
    <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
            Regime edge — does the filter work?
          </div>
          <div className="text-[11px] text-surface-600 mt-0.5 max-w-xl">
            Each past day's stance/lights joined to the forward return of the {data?.benchmark || 'average stock'}.
            Shorts are direction-adjusted, so a positive number is always a profitable edge.
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {HORIZON_OPTS.map((o) => (
            <button
              key={o.h}
              onClick={() => setHorizon(o.h)}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded border transition ${
                horizon === o.h ? 'border-accent/40 bg-accent/10 text-accent' : 'border-surface-700 text-surface-500 hover:text-surface-300'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="text-[12px] text-warning/90 py-2">{error}</div>}
      {loading && !data && <div className="text-[12px] text-surface-500 py-3">Running backtest…</div>}

      {data && (
        <>
          {thin && (
            <div className="mt-1 mb-2 text-[11px] text-amber-200/90 bg-amber-500/5 border border-amber-400/20 rounded-lg px-3 py-1.5">
              Thin sample — {data.sample_days} sessions on record (forward windows consume recent days). Read as
              directional only; the edges firm up as the ledger deepens toward a year.
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
            {/* Forward return by stance */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-surface-600 font-semibold mb-1.5">
                Forward return by stance ({horizon}d)
              </div>
              <table className="w-full text-[12px]">
                <thead className="text-[10px] uppercase tracking-wide text-surface-500">
                  <tr className="border-b border-surface-800/60">
                    <th className="text-left font-semibold py-1">Stance</th>
                    <th className="text-right font-semibold py-1">Avg</th>
                    <th className="text-right font-semibold py-1">Hit</th>
                    <th className="text-right font-semibold py-1">N</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {['aggressive', 'constructive', 'selective', 'defensive', 'cash', 'all'].map((lv) => {
                    const b = byLevel?.[lv] || {}
                    return (
                      <tr key={lv} className={`border-b border-surface-800/40 ${lv === 'all' ? 'bg-surface-800/20' : ''}`}>
                        <td className={`py-1 font-sans font-medium ${STANCE_ROW_TEXT[lv]}`}>{STANCE_LABEL[lv]}</td>
                        <td className={`py-1 text-right font-semibold ${retTone(b.avg)}`}>{fmtPctSigned(b.avg)}</td>
                        <td className="py-1 text-right text-surface-400">{fmtPct0(b.hit_rate)}</td>
                        <td className={`py-1 text-right ${nClass(b.n || 0)}`}>{b.n ?? 0}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Setup edge: green vs red */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-surface-600 font-semibold mb-1.5">
                Setup edge — green vs red ({horizon}d)
              </div>
              <table className="w-full text-[12px]">
                <thead className="text-[10px] uppercase tracking-wide text-surface-500">
                  <tr className="border-b border-surface-800/60">
                    <th className="text-left font-semibold py-1">Setup</th>
                    <th className="text-right font-semibold py-1">Green</th>
                    <th className="text-right font-semibold py-1">Red</th>
                    <th className="text-right font-semibold py-1">Edge</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {Object.values(setups || {}).map((s) => {
                    const ph = s.by_horizon?.[hkey] || {}
                    const g = ph.lights?.green || {}
                    const r = ph.lights?.red || {}
                    return (
                      <tr key={s.key} className="border-b border-surface-800/40">
                        <td className="py-1 font-sans text-surface-200">
                          {s.name}
                          {s.direction === 'short' && <span className="text-[9px] text-surface-500 ml-1">(short)</span>}
                        </td>
                        <td className="py-1 text-right">
                          <span className={retTone(g.avg)}>{fmtPctSigned(g.avg)}</span>
                          <span className={`text-[10px] ml-1 ${nClass(g.n || 0)}`}>n{g.n ?? 0}</span>
                        </td>
                        <td className="py-1 text-right">
                          <span className={retTone(r.avg)}>{fmtPctSigned(r.avg)}</span>
                          <span className={`text-[10px] ml-1 ${nClass(r.n || 0)}`}>n{r.n ?? 0}</span>
                        </td>
                        <td className={`py-1 text-right font-bold ${retTone(ph.edge)}`}>{fmtPctSigned(ph.edge)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="text-[10px] text-surface-600 mt-1.5 leading-snug">
                Edge = green avg − red avg. Positive ⇒ the light has historically marked better forward returns.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SituationalAwareness() {
  const [sa, setSa] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [showScoring, setShowScoring] = useState(false)

  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [lookback, setLookback] = useState(90)

  const [backtest, setBacktest] = useState(null)
  const [backtestLoading, setBacktestLoading] = useState(true)
  const [backtestError, setBacktestError] = useState(null)
  const [horizon, setHorizon] = useState(10)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSa(await getSituationalAwareness(30))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHistory = useCallback(async (days) => {
    setHistoryLoading(true)
    try {
      const res = await getSituationalHistory(days)
      setHistory(res.rows || [])
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const loadBacktest = useCallback(async () => {
    setBacktestLoading(true)
    setBacktestError(null)
    try {
      setBacktest(await getRegimeBacktest())
    } catch (e) {
      setBacktestError(e.message)
    } finally {
      setBacktestLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadHistory(lookback) }, [loadHistory, lookback])
  useEffect(() => { loadBacktest() }, [loadBacktest])

  // Pull any missing trading days into the breadth cache (same as Market
  // Monitor's "Refresh MM"), then recompute the read + history.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      await refreshBreadth({ lookbackDays: 130 })
      setSa(await getSituationalAwareness(30))
      await Promise.all([loadHistory(lookback), loadBacktest()])
    } catch (e) {
      setError(e.message)
    } finally {
      setRefreshing(false)
    }
  }, [loadHistory, lookback, loadBacktest])

  const stance = sa?.stance
  const theme = STANCE_THEME[stance?.level] || STANCE_THEME.neutral
  const breakoutSetup = sa?.setups?.find((s) => s.key === 'breakout')
  const breakoutLight = LIGHT[breakoutSetup?.light] || LIGHT.amber
  const stats = sa?.stats
  const empty = !loading && (sa?.score == null)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-surface-50">Situational Awareness</h1>
          <p className="text-sm text-surface-500 mt-1 max-w-2xl">
            How aggressive to be right now — and which setups are in season. Breadth-based regime
            filter built on the Stockbee Market Monitor. <span className="text-surface-400">SA is setup-specific:</span> a
            breakout filter and a mean-reversion filter read the same tape oppositely.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {sa?.as_of && <span className="text-xs text-surface-500 font-mono">{sa.as_of}</span>}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-4 py-2 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {refreshing ? 'Refreshing…' : 'Refresh breadth'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      {loading && !sa && (
        <div className="rounded-2xl bg-surface-900/60 border border-surface-700/40 p-12 text-center">
          <div className="inline-flex items-center gap-2 text-surface-300">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Reading the tape…
          </div>
        </div>
      )}

      {empty && !error && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 border-dashed p-10 text-center">
          <p className="text-surface-100 font-semibold text-base">No breadth data cached yet</p>
          <p className="text-surface-500 text-sm mt-2 max-w-md mx-auto">
            Click <span className="text-accent font-medium">Refresh breadth</span> to build the cache, or visit the{' '}
            <Link to="/market-monitor" className="text-accent hover:text-accent/80">Market Monitor</Link> page. First run
            pulls the ~3000-symbol universe and ~130 days of OHLCV (3–5 min); after that it's near-instant.
          </p>
        </div>
      )}

      {sa && stance && sa.score != null && (
        <>
          {/* Stance banner */}
          <div className={`rounded-2xl border ${theme.ring} ${theme.bg} p-5`}>
            <div className="flex items-start gap-6 flex-wrap">
              <div className="flex-1 min-w-[280px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] uppercase tracking-wide text-surface-400 font-semibold">Current stance</span>
                  <DeltaPill delta={sa.score_delta_5d} />
                  {stats?.percentile != null && (
                    <StatBadge
                      label="vs 1Y"
                      value={`${ORDINAL(stats.percentile)} pct`}
                      hint={`Today's exposure score ranks in the ${ORDINAL(stats.percentile)} percentile of the last ${stats.window} sessions (median ${stats.median}, range ${stats.min}–${stats.max}).`}
                    />
                  )}
                  {stats?.days_in_regime != null && (
                    <StatBadge
                      label="regime"
                      value={`day ${stats.days_in_regime}`}
                      hint={`${stats.days_in_regime} consecutive session(s) in the ${stance.label} stance.`}
                    />
                  )}
                </div>
                <div className={`mt-1 text-2xl font-bold ${theme.text}`}>
                  {stance.label} — {stance.headline}
                </div>
                <div className="mt-1 text-sm text-surface-300 font-medium">{stance.exposure}</div>
                <p className="mt-2.5 text-sm text-surface-300 leading-snug max-w-xl">{stance.action}</p>
              </div>
              <div className="w-full sm:w-72 shrink-0">
                <ScoreDial score={sa.score} theme={theme} />
              </div>
            </div>
          </div>

          {/* Breakout call-out — the trader's core decision */}
          {breakoutSetup && (
            <div className={`rounded-2xl border ${breakoutLight.ring} ${breakoutLight.bg} px-5 py-4`}>
              <div className="flex items-start gap-3">
                <span className={`mt-1 shrink-0 w-3 h-3 rounded-full ${breakoutLight.dot}`} aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-surface-400 font-semibold">Breakout posture</div>
                  <div className={`text-lg font-bold ${breakoutLight.text} leading-tight`}>{sa.breakout_takeaway}</div>
                  <p className="text-[13px] text-surface-300 mt-1 leading-snug">{breakoutSetup.why}</p>
                </div>
              </div>
            </div>
          )}

          {/* How & why + exposure history */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <HowAndWhy explanation={sa.explanation} bands={sa.criteria?.stance_bands || []} score={sa.score} />
            <HistoryChart
              rows={history}
              lookback={lookback}
              setLookback={setLookback}
              loading={historyLoading}
              median={stats?.median}
            />
          </div>

          {/* Setup lights grid */}
          <div>
            <div className="text-[11px] uppercase tracking-wide text-surface-500 font-semibold mb-2">
              Setups in season <span className="text-surface-600 normal-case tracking-normal">· expand any card for its live ✓/✗ criteria</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {sa.setups.map((s) => <SetupCard key={s.key} s={s} />)}
            </div>
          </div>

          {/* Drivers (+ scoring criteria) */}
          <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">What's driving the read</div>
              <button
                onClick={() => setShowScoring((s) => !s)}
                className="text-[11px] font-medium text-surface-400 hover:text-surface-200 inline-flex items-center gap-1"
              >
                <span className={`transition-transform ${showScoring ? 'rotate-90' : ''}`}>▸</span>
                {showScoring ? 'Hide scoring criteria' : 'Show scoring criteria'}
              </button>
            </div>
            <div className="text-[11px] text-surface-600 mb-2">
              Each breadth signal pushes the exposure score off neutral (50). Strongest first.
            </div>
            {sa.drivers.length === 0 ? (
              <div className="text-[12px] text-surface-500 py-2">Quiet tape — no strong signals today.</div>
            ) : (
              <div className="divide-y divide-surface-800/60">
                {sa.drivers.map((d, i) => <DriverRow key={i} d={d} />)}
              </div>
            )}
            {showScoring && sa.criteria?.factors && (
              <div className="mt-3 pt-3 border-t border-surface-700/40">
                <div className="text-[10px] uppercase tracking-wide text-surface-600 font-semibold mb-2">
                  Scoring criteria — every factor & its tiers (active tier highlighted)
                </div>
                <FactorLadder factors={sa.criteria.factors} />
              </div>
            )}
          </div>

          {/* Regime edge — empirical validation of the filter */}
          <RegimeEdge
            data={backtest}
            loading={backtestLoading}
            error={backtestError}
            horizon={horizon}
            setHorizon={setHorizon}
          />

          {/* Footer / methodology */}
          <div className="rounded-2xl bg-surface-900/50 border border-surface-700/40 px-4 py-3 text-[11px] text-surface-500 leading-relaxed">
            Computed from the local Stockbee-style breadth cache
            {sa.coverage?.universe_size ? ` (${sa.coverage.count}/${sa.coverage.universe_size} symbols)` : ''}; daily reads are
            stored to a persistent ledger ({stats?.history_len || 0} sessions on record). Lights are a regime filter, not
            buy/sell orders — confirm with the chart and your own rules. Raw numbers live on the{' '}
            <Link to="/market-monitor" className="text-accent hover:text-accent/80">Market Monitor</Link>. Methodology:{' '}
            <a href="https://stockbee.blogspot.com/p/mm.html" target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent/80">
              Stockbee Market Monitor
            </a>.
          </div>
        </>
      )}
    </div>
  )
}
