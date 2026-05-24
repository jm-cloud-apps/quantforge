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
import { getBreadthSnapshot, getBreadthHistory, refreshBreadth } from '../api/breadth'

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
function MetricTile({ label, value, hint, accent }) {
  return (
    <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 p-4">
      <div className="text-[11px] uppercase tracking-wide text-surface-500 font-semibold">
        {label}
      </div>
      <div className={`mt-1.5 text-2xl font-mono font-semibold ${accent || 'text-surface-100'}`}>
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-[11px] text-surface-500 leading-snug">{hint}</div>
      )}
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
// Main page
// ---------------------------------------------------------------------------
export default function MarketMonitor() {
  const [snapshot, setSnapshot] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [refreshSummary, setRefreshSummary] = useState(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [snap, hist] = await Promise.all([
        getBreadthSnapshot(),
        getBreadthHistory(15),
      ])
      setSnapshot(snap)
      setHistory(hist.rows || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const res = await refreshBreadth({ lookbackDays: 130 })
      setSnapshot(res.snapshot)
      setRefreshSummary(res.cache_summary)
      // Re-pull the history table since the latest day may have changed.
      const hist = await getBreadthHistory(15)
      setHistory(hist.rows || [])
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
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-4 py-2 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {refreshing ? 'Refreshing…' : 'Refresh MM'}
          </button>
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
          {/* Regime banner */}
          <div className={`rounded-2xl border ${theme.ring} ${theme.tint} p-5`}>
            <div className="flex items-start gap-4 flex-wrap">
              <div className="flex-1 min-w-[260px]">
                <div className="text-[11px] uppercase tracking-wide text-surface-400 font-semibold">
                  Current read
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
              <div className="text-right shrink-0">
                <div className="text-[11px] uppercase tracking-wide text-surface-400 font-semibold">
                  Coverage
                </div>
                <div className="mt-1 text-sm text-surface-200 font-mono">
                  {fmtInt(coverage?.count)}/{fmtInt(coverage?.universe_size)} ({coverage?.pct ?? 0}%)
                </div>
                <div className="text-[11px] text-surface-500 mt-0.5">Source: {snapshot.source}</div>
              </div>
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
            />
            <MetricTile
              label="4% down today"
              value={fmtInt(metrics.down_4)}
              hint="500+ is selling pressure"
              accent={metrics.down_4 >= 300 ? 'text-red-300' : ''}
            />
            <MetricTile
              label="5-day ratio"
              value={fmtRatio(metrics.ratio_5d)}
              hint="short thrust"
              accent={metrics.ratio_5d >= 1.5 ? 'text-emerald-300' : metrics.ratio_5d <= 0.7 ? 'text-red-300' : ''}
            />
            <MetricTile
              label="10-day ratio"
              value={fmtRatio(metrics.ratio_10d)}
              hint="2+ bullish, <0.5 bearish"
              accent={metrics.ratio_10d >= 2 ? 'text-emerald-300' : metrics.ratio_10d <= 0.5 ? 'text-red-300' : ''}
            />
            <MetricTile
              label="25% quarter up"
              value={fmtInt(metrics.qtr_up_25)}
              hint={`vs ${fmtInt(metrics.qtr_down_25)} down`}
            />
            <MetricTile
              label="25% month up"
              value={fmtInt(metrics.mo_up_25)}
              hint={`vs ${fmtInt(metrics.mo_down_25)} down`}
            />
            <MetricTile
              label="50% month up"
              value={fmtInt(metrics.mo_up_50)}
              hint=">20 can be overheated"
              accent={metrics.mo_up_50 > 50 ? 'text-amber-300' : metrics.mo_up_50 > 20 ? 'text-amber-200' : ''}
            />
            <MetricTile
              label="T2108 local"
              value={fmtPct(metrics.t2108)}
              hint="% above SMA40"
              accent={metrics.t2108 >= 80 ? 'text-amber-300' : metrics.t2108 <= 20 ? 'text-cyan-300' : ''}
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
