import { useCallback, useEffect, useMemo, useState } from 'react'
import { getPrepAttention, getPrepLeaders, getPrepSessions, savePrepSession } from '../api/prep'
import { getSituationalAwareness } from '../api/breadth'
import { getRRG } from '../api/sectorRotation'
import { getEarnings } from '../api/calendar'
import { getGapMovers } from '../api/movers'
import { addSymbols } from '../api/watchlists'
import TickerLink from '../components/TickerLink'
import InfoTip from '../components/InfoTip'
import RefreshControl from '../components/RefreshControl'
import { useToast } from '../components/Toast'

// ---------------------------------------------------------------------------
// Prep — the weekend / evening research routine.
//
// The page is a SEQUENCE, not a dashboard, because the order is the whole
// point. Reading the tape first is what stops a scan from turning into a
// shopping list on a day you shouldn't be buying: the same 25 names look
// compelling whether the market is in an uptrend or falling apart, and the scan
// itself can't tell you which. So the gate comes first and visibly changes what
// the scan is *for* — a buy list, a watch list, or nothing.
//
// Everything except the leader scan reuses endpoints that already exist and are
// already background-warmed; this page composes them into the order the work
// actually happens in.
// ---------------------------------------------------------------------------

const STATE_META = {
  at_pivot: { label: 'At pivot', tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/30', rank: 0 },
  basing:   { label: 'Basing',   tone: 'text-cyan-300 bg-cyan-500/10 border-cyan-400/30',        rank: 1 },
  watch:    { label: 'Watch',    tone: 'text-surface-300 bg-surface-800/60 border-surface-600',  rank: 2 },
  extended: { label: 'Extended', tone: 'text-amber-300 bg-amber-500/10 border-amber-400/30',     rank: 3 },
  broken:   { label: 'Broken',   tone: 'text-danger bg-danger/10 border-danger/30',              rank: 4 },
}

// The gate. Cuts are the exposure bands, and 60 is where the band that actually
// beat the base rate starts (see Market Monitor → "Is the dial calibrated?").
function gateFor(score) {
  if (score == null) return {
    key: 'unknown', title: 'No market read available',
    body: 'Refresh breadth before prepping — without a read you are scanning blind.',
    tone: 'border-surface-600 bg-surface-800/40', text: 'text-surface-200', scanLabel: 'Scan anyway',
  }
  if (score >= 60) return {
    key: 'go', title: 'Green — build the buy list',
    body: 'Constructive tape. Run all three scans and shortlist aggressively; this is the band where breakouts have followed through.',
    tone: 'border-success/40 bg-success/10', text: 'text-success', scanLabel: 'Buy list',
  }
  if (score >= 45) return {
    key: 'selective', title: 'Amber — shortlist only, A+ and half size',
    body: 'Mixed tape. Do the work and keep the list, but demand pivots you would take at half size. Most of these will be watch-only.',
    tone: 'border-amber-400/40 bg-amber-500/10', text: 'text-amber-300', scanLabel: 'Watch list',
  }
  return {
    key: 'stand-down', title: 'Red — no buy list tonight',
    body: 'Defensive tape. Prep is still worth doing — leadership that holds up in a bad tape is what leads the next advance — but tonight the output is a watch list and a short list, not orders.',
    tone: 'border-danger/40 bg-danger/10', text: 'text-danger', scanLabel: 'Research only',
  }
}

function pct(v, digits = 1) {
  if (v === null || v === undefined) return '—'
  return `${v > 0 ? '+' : ''}${Number(v).toFixed(digits)}%`
}

function retTone(v) {
  if (v === null || v === undefined) return 'text-surface-600'
  return v > 0 ? 'text-emerald-300' : v < 0 ? 'text-danger' : 'text-surface-400'
}

function Section({ step, title, hint, right, children, muted }) {
  return (
    <section className={`rounded-2xl bg-surface-900/80 border border-surface-700/50 overflow-hidden ${muted ? 'opacity-60' : ''}`}>
      <div className="px-4 py-3 border-b border-surface-700/40 flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-surface-800 border border-surface-600 text-[11px] font-mono font-bold text-surface-300 flex items-center justify-center">
            {step}
          </span>
          <div>
            <h2 className="text-sm font-semibold text-surface-100">{title}</h2>
            {hint && <p className="text-[11px] text-surface-500 mt-0.5 max-w-[62ch] leading-snug">{hint}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

function StateBadge({ state }) {
  const m = STATE_META[state] || STATE_META.watch
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap ${m.tone}`}>
      {m.label}
    </span>
  )
}

const SPARK_TONE = {
  at_pivot: '#34D399', basing: '#22D3EE', watch: '#64748B', extended: '#FBBF24', broken: '#EF4444',
}

// 60 closes as a 68×22 line. "Is this basing?" is a question about a picture —
// a state label alone asks you to take the classifier's word for it, and the
// whole point of prep is that you looked.
function Spark({ points, state }) {
  if (!points || points.length < 2) return <span className="text-surface-700 text-[10px]">—</span>
  const w = 68, h = 22
  const min = Math.min(...points)
  const span = (Math.max(...points) - min) || 1
  const d = points
    .map((p, i) => `${i ? 'L' : 'M'}${((i / (points.length - 1)) * w).toFixed(1)},${(h - ((p - min) / span) * h).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="block">
      <path d={d} fill="none" stroke={SPARK_TONE[state] || '#64748B'} strokeWidth={1.2}
            strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// Risk to the reference stop. Above ~15% the name can't be sized sensibly
// whatever its chart says — this is the column that catches the ones the state
// label flatters.
function riskTone(v) {
  if (v == null) return 'text-surface-600'
  if (v <= 8) return 'text-emerald-300'
  if (v <= 15) return 'text-surface-300'
  return 'text-danger'
}

// Names the scan keeps surfacing that never become a trade.
//
// Every other panel here measures the stock. This measures the distance
// between what the scan showed you and what you did — the thing that would
// have said "SNDK has been on this list for forty sessions" while that was
// still worth hearing, instead of after it went from $219 to $2,100.
function IgnoredLeaders({ data, onAdd, pickedSet }) {
  if (!data || !data.rows?.length) return null
  return (
    <div className="border-t border-surface-700/40 bg-amber-500/[0.04] px-4 py-3">
      <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
        <span className="text-[10px] font-bold tracking-widest uppercase text-amber-300">Kept seeing, never traded</span>
        <span className="text-[11px] text-surface-500">
          on the list {data.long_listed_threshold}+ sessions and never taken since it first appeared
        </span>
        <span className="ml-auto text-[10px] font-mono text-surface-600">
          {data.sessions_in_ledger} sessions on record
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {data.rows.map(r => (
          <button
            key={r.symbol}
            onClick={() => onAdd(r.symbol)}
            disabled={pickedSet.has(r.symbol)}
            title={`Listed ${r.sessions_listed} sessions (${r.first_listed} → ${r.last_listed}) · lanes ${r.lanes.join(', ')}`}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors ${
              pickedSet.has(r.symbol)
                ? 'border-accent/40 bg-accent/10 text-accent cursor-default'
                : 'border-surface-700 bg-surface-950/40 text-surface-200 hover:border-amber-400/50'
            }`}
          >
            <span className="font-mono font-semibold">{r.symbol}</span>
            <span className="font-mono text-surface-500">{r.sessions_listed}d</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-surface-500 leading-snug">
        Not a buy list — a list of names your process surfaced and your attention skipped. If one of these is a
        correct pass, log it that way in the Missed Book and it stops being a question.
      </p>
    </div>
  )
}

function LeaderRow({ row, picked, onToggle, earning, onLastPrep }) {
  return (
    <tr className={`border-t border-surface-800/60 ${picked ? 'bg-accent/[0.07]' : 'hover:bg-surface-800/30'}`}>
      <td className="px-2 py-1.5">
        <button
          onClick={() => onToggle(row)}
          aria-pressed={picked}
          title={picked ? 'Remove from shortlist' : 'Add to shortlist'}
          className={`w-5 h-5 rounded border flex items-center justify-center text-[11px] transition-colors ${
            picked ? 'bg-accent border-accent text-surface-950' : 'border-surface-600 text-surface-600 hover:border-accent hover:text-accent'
          }`}
        >
          {picked ? '✓' : '+'}
        </button>
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <span className="font-mono font-semibold text-surface-100"><TickerLink symbol={row.symbol} /></span>
        {onLastPrep && (
          <span className="ml-1.5 text-[9px] text-surface-500" title="Was on your last prep list">•held</span>
        )}
      </td>
      <td className="px-2 py-1.5"><Spark points={row.spark} state={row.setup_state} /></td>
      <td className={`px-2 py-1.5 text-right font-mono ${retTone(row.ret_6m)}`}>{pct(row.ret_6m, 0)}</td>
      <td className={`px-2 py-1.5 text-right font-mono ${retTone(row.ret_3m)}`}>{pct(row.ret_3m, 0)}</td>
      <td className={`px-2 py-1.5 text-right font-mono ${retTone(row.ret_1m)}`}>{pct(row.ret_1m, 0)}</td>
      <td className="px-2 py-1.5 text-right font-mono text-surface-400">{row.adr_pct?.toFixed(1)}%</td>
      <td className={`px-2 py-1.5 text-right font-mono ${riskTone(row.risk_pct)}`}
          title={row.stop ? `Reference stop ${row.stop} — the low of the recent consolidation` : undefined}>
        {row.risk_pct == null ? '—' : `${row.risk_pct.toFixed(0)}%`}
      </td>
      <td className="px-2 py-1.5 text-right font-mono text-surface-400">{pct(row.from_high_pct, 0)}</td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <StateBadge state={row.setup_state} />
        {earning && (
          <span
            className="ml-1 inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium border border-purple/40 text-purple bg-purple/10"
            title={`Reports ${earning.date} ${String(earning.time || '').toUpperCase()} — a swing entry now is an earnings bet`}
          >
            ER {String(earning.date).slice(5)}
          </span>
        )}
      </td>
    </tr>
  )
}

function LeaderTable({ rows, pickedSet, onToggle, emptyNote, earningsBySymbol, lastPrepSet }) {
  if (!rows.length) {
    return <div className="px-4 py-6 text-[12px] text-surface-500 text-center">{emptyNote}</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-[12px]">
        <thead className="bg-surface-950/50 text-[10px] uppercase tracking-wide text-surface-500">
          <tr>
            <th className="px-2 py-2 w-8" />
            <th className="px-2 py-2 text-left font-semibold">Symbol</th>
            <th className="px-2 py-2 text-left font-semibold">
              <InfoTip label="The last 60 sessions of closing prices. Read the shape before you trust the state label — a base looks like a base." className="border-b border-dotted border-surface-600">60d</InfoTip>
            </th>
            <th className="px-2 py-2 text-right font-semibold">6M</th>
            <th className="px-2 py-2 text-right font-semibold">3M</th>
            <th className="px-2 py-2 text-right font-semibold">1M</th>
            <th className="px-2 py-2 text-right font-semibold">
              <InfoTip label="Average daily range as a % of price. Your position-sizing input: a 3% ADR name needs a wider stop in dollars than a 1% one, so it gets less size for the same risk." className="border-b border-dotted border-surface-600">ADR</InfoTip>
            </th>
            <th className="px-2 py-2 text-right font-semibold">
              <InfoTip label="Distance from price down to the reference stop (the low of the recent consolidation) as a % — how much you lose per share if the idea is wrong. Above ~15% the name can't be sized sensibly whatever its chart looks like." className="border-b border-dotted border-surface-600">Risk</InfoTip>
            </th>
            <th className="px-2 py-2 text-right font-semibold">
              <InfoTip label="How far below its 6-month high the stock closed. Near zero means it is at the highs; -10 to -25% is the zone where bases form; past -25% leadership is usually gone." className="border-b border-dotted border-surface-600">From hi</InfoTip>
            </th>
            <th className="px-2 py-2 text-left font-semibold">
              <InfoTip label="Where the name sits in its cycle. At pivot / Basing are actionable; Extended means it is a leader with no entry right now; Broken means leadership has rolled over. An ER tag means it reports inside the window — a swing entry now is an earnings bet." className="border-b border-dotted border-surface-600">State</InfoTip>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <LeaderRow
              key={r.symbol}
              row={r}
              picked={pickedSet.has(r.symbol)}
              onToggle={onToggle}
              earning={earningsBySymbol?.get(r.symbol)}
              onLastPrep={lastPrepSet?.has(r.symbol)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Prep() {
  const { toast } = useToast()
  const [sa, setSa] = useState(null)
  const [leaders, setLeaders] = useState(null)
  const [rrg, setRrg] = useState(null)
  const [earnings, setEarnings] = useState(null)
  const [gaps, setGaps] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const [tab, setTab] = useState('confluence')
  const [stateFilter, setStateFilter] = useState('actionable')
  const [picks, setPicks] = useState([])          // [{symbol, ...row, note}]
  const [notes, setNotes] = useState('')
  const [kind, setKind] = useState('evening')
  const [lastSession, setLastSession] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [saRes, leadRes] = await Promise.all([
        getSituationalAwareness(30).catch(() => null),
        getPrepLeaders(),
      ])
      setSa(saRes)
      setLeaders(leadRes)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
    // Context panels are non-blocking — the routine works without them.
    getRRG().then(setRrg).catch(() => {})
    // 10 days, not 7 — weekend prep needs to see through the whole coming week.
    getEarnings({ days: 10 }).then(setEarnings).catch(() => {})
    getGapMovers({ minPct: 4, limit: 10 }).then(setGaps).catch(() => {})
    getPrepSessions(10).then(r => {
      setLastSession(r.latest || null)
      // Re-opening the same day's prep restores what you already shortlisted
      // rather than making you start over.
      const today = new Date().toISOString().slice(0, 10)
      if (r.latest?.date === today) {
        setPicks((r.latest.candidates || []).map(c => ({ ...c, note: c.note || '' })))
        setNotes(r.latest.notes || '')
        setKind(r.latest.kind || 'evening')
      }
    }).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const fresh = await getPrepLeaders({ fresh: true })
      setLeaders(fresh)
    } catch (e) {
      setError(e.message)
    } finally {
      setRefreshing(false)
    }
  }, [])

  const score = sa?.score ?? null
  const gate = gateFor(score)
  // Names the scan keeps surfacing that never turn into a trade. Loaded
  // independently and allowed to fail silently — it's a nudge beside the
  // scans, never a precondition for them.
  const [attention, setAttention] = useState(null)
  useEffect(() => {
    let alive = true
    getPrepAttention({ limit: 8 })
      .then(d => { if (alive) setAttention(d) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const pickedSet = useMemo(() => new Set(picks.map(p => p.symbol)), [picks])

  const togglePick = useCallback((row) => {
    setPicks(prev => prev.some(p => p.symbol === row.symbol)
      ? prev.filter(p => p.symbol !== row.symbol)
      : [...prev, {
          symbol: row.symbol,
          setup_state: row.setup_state,
          horizons: row.horizons || [],
          adr_pct: row.adr_pct ?? null,
          from_high_pct: row.from_high_pct ?? null,
          // Carried so an RS-leadership pick keeps its reason on the shortlist —
          // it qualifies on sustained rank, not on any return horizon.
          rs_rank: row.rs_rank ?? null,
          rs_days_top: row.rs_days_top ?? null,
          rs_window: row.rs_window ?? null,
          sessions_listed: row.sessions_listed ?? null,
          note: '',
        }])
  }, [])

  // Rows for the active tab, filtered by setup state. "Actionable" is the
  // default because the top of a return ranking is almost always extended —
  // the useful names are further down the list.
  const visibleRows = useMemo(() => {
    if (!leaders) return []
    const rows = tab === 'confluence'
      ? leaders.confluence || []
      : (leaders.horizons || []).find(h => h.key === tab)?.rows || []
    if (stateFilter === 'all') return rows
    if (stateFilter === 'actionable') return rows.filter(r => r.setup_state === 'at_pivot' || r.setup_state === 'basing')
    return rows.filter(r => r.setup_state === stateFilter)
  }, [leaders, tab, stateFilter])

  const leadingGroups = useMemo(() => {
    const pts = rrg?.points || []
    const rank = { leading: 0, improving: 1, weakening: 2, lagging: 3 }
    return [...pts].sort((a, b) => (rank[a.quadrant] ?? 9) - (rank[b.quadrant] ?? 9) || b.rs_ratio - a.rs_ratio)
  }, [rrg])

  // `by_date` is a list of day groups, each holding one array per session slot
  // (bmo / amc / …), so flatten every array-valued field rather than assuming
  // the slot names — a new slot shouldn't silently drop names.
  const earningsBySymbol = useMemo(() => {
    const groups = Array.isArray(earnings?.by_date) ? earnings.by_date : []
    const m = new Map()
    for (const g of groups) {
      for (const [slot, items] of Object.entries(g || {})) {
        if (!Array.isArray(items)) continue
        for (const it of items) {
          if (it?.symbol && !m.has(it.symbol)) {
            m.set(it.symbol, { date: it.date || g.date, time: it.time || slot })
          }
        }
      }
    }
    return m
  }, [earnings])

  const earningsForPicks = useMemo(() => (
    picks
      .map(p => ({ symbol: p.symbol, ...(earningsBySymbol.get(p.symbol) || {}) }))
      .filter(e => e.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  ), [earningsBySymbol, picks])

  // Names carried over from the previous prep — the evening pass is mostly a
  // diff against the weekend's work, not a fresh start.
  const lastPrepSet = useMemo(
    () => new Set((lastSession?.candidates || []).map(c => c.symbol)),
    [lastSession],
  )

  // The scan is only as current as the breadth cache behind it. Three days is
  // a long weekend; past that the "leaders" are last week's leaders.
  const staleDays = useMemo(() => {
    if (!leaders?.as_of) return null
    const days = Math.floor((Date.now() - new Date(`${leaders.as_of}T00:00:00`).getTime()) / 86400000)
    return days > 3 ? days : null
  }, [leaders])

  // `quiet` is the autosave path: same write, no toast. The endpoint upserts by
  // date ("one record per day — re-saving replaces"), so repeatedly saving the
  // same evening is safe by construction and can't produce duplicate sessions.
  const persist = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setSaving(true)
    try {
      const res = await savePrepSession({
        kind,
        gate_passed: gate.key === 'go',
        score,
        stance: sa?.stance?.level ?? null,
        regime: sa?.stance?.label ?? null,
        notes,
        candidates: picks,
      })
      setLastSession(res.session)
      setSavedAt(Date.now())
      if (!quiet) toast.success(`Prep saved — ${picks.length} name${picks.length === 1 ? '' : 's'}`)
    } catch (e) {
      // An autosave that shouts on every transient failure is worse than one
      // that retries on the next edit.
      if (!quiet) toast.error(e.message)
    } finally {
      if (!quiet) setSaving(false)
    }
  }, [kind, gate.key, score, sa, notes, picks, toast])

  const handleSave = useCallback(() => persist({ quiet: false }), [persist])

  // Autosave. The record is what makes the rest of the loop work — the missed
  // suggester matches shortlists to fills, Discipline separates planned trades
  // from 10am impulses, and the attention ledger needs to know what you picked,
  // not just what the scan listed. All of that was dark because saving was a
  // button you had to remember. Fires once there's something worth keeping.
  useEffect(() => {
    if (!picks.length && !notes.trim()) return
    const t = setTimeout(() => persist({ quiet: true }), 1500)
    return () => clearTimeout(t)
  }, [picks, notes, kind, persist])

  const handleAddToWatchlist = useCallback(async () => {
    if (!picks.length) return
    try {
      await addSymbols(picks.map(p => p.symbol))
      toast.success(`Added ${picks.length} to watchlist`)
    } catch (e) {
      toast.error(e.message)
    }
  }, [picks, toast])

  const tabs = [
    { key: 'confluence', label: `Confluence (${leaders?.confluence?.length ?? 0})` },
    ...(leaders?.horizons || []).map(h => ({ key: h.key, label: h.key })),
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-surface-50">Prep</h1>
          <p className="text-sm text-surface-500 mt-1 max-w-[70ch]">
            The research routine, in the order it should happen: read the tape, find where money is going, run the
            6M / 3M / 1M scans, shortlist, and set up tomorrow morning. Done the night before or on the weekend —
            when a plan is still cheap.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastSession && (
            <span className="text-[11px] text-surface-500 font-mono">
              last prep {lastSession.date} · {(lastSession.candidates || []).length} names
            </span>
          )}
          <RefreshControl jobId="prep-leaders" onRefresh={handleRefresh} refreshing={refreshing} />
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      {loading && (
        <div className="rounded-2xl bg-surface-900/60 border border-surface-700/40 p-10 text-center text-surface-300 text-sm">
          Loading the tape and running the leader scans…
        </div>
      )}

      {!loading && (
        <>
          {/* 1 — the gate */}
          <Section
            step="1"
            title="Is the tape worth trading?"
            hint="This runs first on purpose. The same 25 names look compelling in any tape; the scan can't tell you whether to act on them, so the market read has to come before the list, not after it."
          >
            <div className={`m-4 rounded-xl border p-4 ${gate.tone}`}>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className={`text-lg font-semibold ${gate.text}`}>{gate.title}</span>
                {score != null && (
                  <span className="text-[12px] font-mono text-surface-400">
                    exposure {score}/100 · {sa?.stance?.label}
                  </span>
                )}
              </div>
              <p className="text-[13px] text-surface-200 mt-1.5 leading-relaxed max-w-[80ch]">{gate.body}</p>
              {(sa?.drivers || []).length > 0 && (
                <div className="mt-3 pt-3 border-t border-surface-700/40 flex flex-wrap gap-x-5 gap-y-1">
                  {sa.drivers.slice(0, 4).map(d => (
                    <span key={d.label} className="text-[11.5px] text-surface-400">
                      <span className={`font-mono font-semibold ${d.points > 0 ? 'text-emerald-300' : 'text-danger'}`}>
                        {d.points > 0 ? '+' : ''}{d.points}
                      </span>{' '}
                      {d.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Section>

          {/* 2 — leadership context */}
          <Section
            step="2"
            title="Where is money going?"
            hint="A leader inside a leading group has sponsorship behind it; the same chart in a lagging group is one stock fighting its sector. Check the groups before you fall in love with a name."
          >
            {!rrg ? (
              <div className="px-4 py-5 text-[12px] text-surface-500">Sector rotation unavailable — skip this step.</div>
            ) : (
              <div className="p-4 grid sm:grid-cols-2 gap-3">
                {['leading', 'improving', 'weakening', 'lagging'].map(q => {
                  const items = leadingGroups.filter(p => p.quadrant === q).slice(0, 5)
                  const tone = {
                    leading: 'text-emerald-300', improving: 'text-cyan-300',
                    weakening: 'text-amber-300', lagging: 'text-danger',
                  }[q]
                  return (
                    <div key={q} className="rounded-xl bg-surface-950/40 border border-surface-700/40 p-3">
                      <div className={`text-[10px] uppercase tracking-wider font-semibold ${tone}`}>{q}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {items.length === 0 && <span className="text-[11px] text-surface-600">—</span>}
                        {items.map(p => (
                          <span key={p.ticker} className="text-[11px] px-1.5 py-0.5 rounded bg-surface-800/70 text-surface-300 border border-surface-700/60">
                            {p.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>

          {/* 3 — the scans */}
          <Section
            step="3"
            title="Run the scans — 6M · 3M · 1M"
            hint="Three rankings of the liquid common-stock universe by return over each window. A name in two or three lists is sustained AND accelerating — that's the output the three-scan routine exists to produce."
            right={
              leaders && (
                <span className="text-[11px] text-surface-500 font-mono shrink-0">
                  {leaders.as_of} · {leaders.passed_liquidity?.toLocaleString()} liquid of {leaders.universe?.toLocaleString()}
                </span>
              )
            }
          >
            {leaders?.error ? (
              <div className="px-4 py-5 text-[12px] text-amber-200">{leaders.error}</div>
            ) : (
              <>
                <div className="px-4 pt-3 flex items-center gap-2 flex-wrap">
                  {tabs.map(t => (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className={`px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors ${
                        tab === t.key ? 'bg-accent/15 text-accent' : 'text-surface-400 hover:text-surface-100 hover:bg-surface-800/60'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                  <span className="ml-auto flex items-center gap-1.5">
                    {[
                      { k: 'actionable', l: 'Actionable' },
                      { k: 'all', l: 'All' },
                      { k: 'extended', l: 'Extended' },
                      { k: 'broken', l: 'Broken' },
                    ].map(f => (
                      <button
                        key={f.k}
                        onClick={() => setStateFilter(f.k)}
                        className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                          stateFilter === f.k ? 'bg-surface-700 text-surface-100' : 'text-surface-500 hover:text-surface-200'
                        }`}
                      >
                        {f.l}
                      </button>
                    ))}
                  </span>
                </div>
                {tab !== 'confluence' && (
                  <p className="px-4 pt-2 text-[11px] text-surface-500">
                    {(leaders?.horizons || []).find(h => h.key === tab)?.blurb}
                  </p>
                )}
                {staleDays && (
                  <div className="mx-4 mt-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-100">
                    Breadth cache is {staleDays} days old ({leaders.as_of}) — these are last week's leaders.
                    Refresh Market Monitor before you trust the ranking.
                  </div>
                )}
                <div className="mt-3">
                  <LeaderTable
                    rows={visibleRows}
                    pickedSet={pickedSet}
                    onToggle={togglePick}
                    earningsBySymbol={earningsBySymbol}
                    lastPrepSet={lastPrepSet}
                    emptyNote={
                      stateFilter === 'actionable'
                        ? 'Nothing in a basing or at-pivot state in this list — which is itself the read. Switch to All to see the extended names, but there is no entry in them tonight.'
                        : 'No names in this list.'
                    }
                  />
                </div>
              </>
            )}
            <IgnoredLeaders
              data={attention}
              pickedSet={pickedSet}
              onAdd={(symbol) => {
                // Pull the full row out of whichever lane holds it so the pick
                // carries its state and ADR, not just a ticker.
                const all = (leaders?.horizons || []).flatMap(h => h.rows || [])
                const live = all.find(r => r.symbol === symbol)
                // A long-ignored name is often no longer on today's list — that
                // is rather the point — so fall back to what the ledger knows.
                const seen = (attention?.rows || []).find(r => r.symbol === symbol)
                togglePick(live || { symbol, sessions_listed: seen?.sessions_listed ?? null })
              }}
            />
          </Section>

          {/* 4 — the shortlist */}
          <Section
            step="4"
            title={`Your shortlist${picks.length ? ` (${picks.length})` : ''}`}
            hint="Write it down now, while nothing is moving. Monday's version of this decision costs a lot more than tonight's."
            right={
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={kind}
                  onChange={e => setKind(e.target.value)}
                  className="bg-surface-800 border border-surface-600 rounded-lg px-2 py-1 text-[12px] text-surface-200"
                >
                  <option value="evening">Evening prep</option>
                  <option value="weekend">Weekend prep</option>
                </select>
                <button
                  onClick={handleAddToWatchlist}
                  disabled={!picks.length}
                  className="px-2.5 py-1 rounded-lg text-[12px] font-medium border border-surface-600 text-surface-300 hover:text-surface-100 hover:bg-surface-800 disabled:opacity-40"
                >
                  Add to watchlist
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-2.5 py-1 rounded-lg text-[12px] font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Save prep'}
                </button>
                {savedAt && !saving && (
                  <span className="text-[10px] text-surface-500 font-mono" title="Autosaved — the record is what the missed-trade and discipline views read">
                    saved
                  </span>
                )}
              </div>
            }
          >
            <div className="p-4 space-y-3">
              {picks.length === 0 ? (
                <p className="text-[12px] text-surface-500">
                  Nothing shortlisted yet — tick names in step 3. An empty list is a legitimate outcome on a red tape;
                  saving it still records that you did the work.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {picks.map((p, i) => (
                    <div key={p.symbol} className="flex items-center gap-2 rounded-lg bg-surface-950/40 border border-surface-700/40 px-2.5 py-1.5">
                      <span className="font-mono font-semibold text-surface-100 w-16 shrink-0"><TickerLink symbol={p.symbol} /></span>
                      <StateBadge state={p.setup_state} />
                      <span className="text-[11px] text-surface-500 font-mono shrink-0">
                        {/* Return-lane names carry their horizons; an RS-leadership
                            name qualifies on sustained rank instead, so show that
                            rather than an empty dash. */}
                        {(p.horizons || []).length
                          ? p.horizons.join('+')
                          : p.rs_days_top != null
                            ? `RS ${p.rs_rank} · ${p.rs_days_top}/${p.rs_window}d`
                            : p.sessions_listed != null
                              ? `ignored ${p.sessions_listed}d`
                              : '—'} · ADR {p.adr_pct?.toFixed?.(1) ?? '—'}%
                      </span>
                      <input
                        value={p.note}
                        onChange={e => setPicks(prev => prev.map((x, j) => j === i ? { ...x, note: e.target.value } : x))}
                        placeholder="trigger / stop / why"
                        className="flex-1 min-w-0 bg-transparent border-b border-surface-700 focus:border-accent outline-none text-[12px] text-surface-200 placeholder:text-surface-600 px-1 py-0.5"
                      />
                      <button
                        onClick={() => setPicks(prev => prev.filter(x => x.symbol !== p.symbol))}
                        className="shrink-0 text-surface-600 hover:text-danger text-[13px] px-1"
                        aria-label={`Remove ${p.symbol}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Session notes — what the tape looked like, what you're waiting for, what would change your mind."
                className="w-full bg-surface-950/50 border border-surface-700/50 rounded-lg px-3 py-2 text-[12.5px] text-surface-200 placeholder:text-surface-600 outline-none focus:border-accent/50"
              />
            </div>
          </Section>

          {/* 5 — the morning */}
          <Section
            step="5"
            title="Tomorrow morning"
            hint="The only part that can't be done the night before. Everything above is decided; this is the check for what changed overnight."
          >
            <div className="p-4 grid lg:grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-surface-500 font-semibold mb-2">
                  Gappers with a catalyst
                </div>
                {!gaps?.rows?.length ? (
                  <p className="text-[12px] text-surface-500">
                    No gap data right now — this fills in pre-market. Look for a gap on real news or earnings, not drift.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {gaps.rows.slice(0, 8).map(g => (
                      <div key={g.symbol} className="flex items-center gap-2 text-[12px]">
                        <span className="font-mono font-semibold w-14 shrink-0"><TickerLink symbol={g.symbol} /></span>
                        <span className={`font-mono w-16 text-right ${retTone(g.change_pct)}`}>{pct(g.change_pct)}</span>
                        {g.earnings_today_bmo && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple/15 text-purple border border-purple/30">EP · earnings</span>
                        )}
                        <span className="text-surface-500 truncate">{g.headline || ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-surface-500 font-semibold mb-2">
                  Earnings in your shortlist (next 10 days)
                </div>
                {earningsForPicks.length === 0 ? (
                  <p className="text-[12px] text-surface-500">
                    {picks.length === 0
                      ? 'Shortlist some names and any earnings dates in the next week will show here.'
                      : 'None of your shortlisted names report in the next 10 days — they can be held through the week.'}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {earningsForPicks.map(e => (
                      <div key={`${e.symbol}-${e.date}`} className="flex items-center gap-2 text-[12px]">
                        <span className="font-mono font-semibold w-14 shrink-0"><TickerLink symbol={e.symbol} /></span>
                        <span className="font-mono text-surface-400">{e.date}</span>
                        <span className="text-[10px] uppercase text-surface-500">{e.time}</span>
                        <span className="text-[10px] text-amber-300 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-400/30">
                          size for a gap, or be flat
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  )
}
