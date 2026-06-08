import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadDefaultTrades } from '../api/tradingAnalysis'
import { getReviewNotes, saveReviewNote, buildTradeKey } from '../api/reviewNotes'
import LightweightTradeChart from '../components/review/LightweightTradeChart'

const QUEUE_FILTERS = [
  { id: 'unreviewed', label: 'Needs review', hint: 'Missing notes, setup, or grade' },
  { id: 'losers',     label: 'Losers & big movers', hint: 'Post-mortems: any loss, or > 5% move' },
  { id: 'week',       label: 'This week',           hint: 'Closed in the last 7 days' },
  { id: 'all',        label: 'All trades',          hint: 'Everything closed, newest first' },
]

const GRADES = ['A', 'B', 'C', 'D', 'F']
const EMOTIONS = ['calm', 'confident', 'fomo', 'fearful', 'frustrated', 'tilted', 'patient']

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString() } catch { return String(d) }
}
function fmtTime(t) {
  if (!t || !/^\d{1,2}:/.test(String(t))) return null
  return String(t).slice(0, 8) // HH:MM:SS
}
function fmtDateTime(d, t) {
  const date = fmtDate(d)
  const time = fmtTime(t)
  return time ? `${date} · ${time} ET` : date
}
function fmtMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  return v >= 0 ? `+$${v.toFixed(2)}` : `-$${Math.abs(v).toFixed(2)}`
}
function fmtPct(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function tradeNeedsReview(t) {
  const has = (v) => v != null && v !== ''
  return !(has(t.entry_notes) || has(t.exit_notes) || has(t.notes)) || !has(t.setup) || !has(t.grade)
}

function filterTrades(trades, filterId) {
  if (filterId === 'unreviewed') return trades.filter(tradeNeedsReview)
  if (filterId === 'losers') {
    return trades.filter(t => (t.pnl ?? 0) < 0 || Math.abs(t.pnl_pct ?? 0) >= 5)
  }
  if (filterId === 'week') {
    const cutoff = Date.now() - 7 * 86400000
    return trades.filter(t => t.exit_date && new Date(t.exit_date).getTime() >= cutoff)
  }
  return trades
}

function TradeListItem({ trade, active, reviewed, onClick }) {
  const pnl = trade.pnl ?? 0
  const pct = trade.pnl_pct ?? 0
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-surface-800/60 transition-colors ${
        active ? 'bg-accent/15 border-l-2 border-l-accent' : 'hover:bg-surface-800/40 border-l-2 border-l-transparent'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono font-bold text-[13px] text-surface-100">{trade.symbol}</span>
          {reviewed && (
            <span className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded bg-success/15 text-success border border-success/30">
              ✓
            </span>
          )}
          {trade.setup && (
            <span className="text-[10px] text-surface-500 truncate">{String(trade.setup).split(' - ')[0]}</span>
          )}
        </div>
        <span className={`text-[12px] font-mono font-semibold tabular-nums ${pnl >= 0 ? 'text-success' : 'text-danger'}`}>
          {fmtPct(pct)}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between text-[10px] text-surface-500">
        <span>{fmtDate(trade.entry_date)} → {fmtDate(trade.exit_date)}</span>
        <span className={`tabular-nums ${pnl >= 0 ? 'text-success/80' : 'text-danger/80'}`}>{fmtMoney(pnl)}</span>
      </div>
    </button>
  )
}

/* Searchable, free-entry combobox. Suggestions are filtered as you type, but
   you can also type a brand-new value (it's not a strict select) — so the
   Setup taxonomy stays consistent without blocking a new variant. */
function Combobox({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value || '')
  // Have they typed since opening? If not, show the full list rather than
  // filtering by the already-selected value.
  const [touched, setTouched] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef(null)

  // Keep the input in sync when the active trade (and its value) changes.
  useEffect(() => { setQuery(value || ''); setTouched(false) }, [value])

  // Close the dropdown on an outside click.
  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const filtered = useMemo(() => {
    const q = touched ? (query || '').trim().toLowerCase() : ''
    if (!q) return options
    // Prefix matches first, then any substring — keeps "EP -" typing tight.
    const starts = [], contains = []
    for (const o of options) {
      const lo = o.toLowerCase()
      if (lo.startsWith(q)) starts.push(o)
      else if (lo.includes(q)) contains.push(o)
    }
    return [...starts, ...contains]
  }, [options, query, touched])

  const choose = (val) => { onChange(val); setQuery(val); setTouched(false); setOpen(false) }

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setTouched(true); setOpen(true); setHighlight(0) }}
        onFocus={(e) => { setOpen(true); setTouched(false); e.target.select() }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight((h) => Math.min(h + 1, filtered.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
          else if (e.key === 'Enter' && open && filtered[highlight]) { e.preventDefault(); choose(filtered[highlight]) }
          else if (e.key === 'Escape') { setOpen(false) }
        }}
        placeholder={placeholder}
        className="w-full rounded-lg bg-surface-900 border border-surface-700/50 px-3 py-2 text-[13px] text-surface-100 focus:border-accent focus:outline-none"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-lg bg-surface-900 border border-surface-700/60 shadow-xl">
          {filtered.map((o, i) => (
            <button
              key={o}
              type="button"
              onMouseEnter={() => setHighlight(i)}
              onClick={() => choose(o)}
              className={`w-full text-left px-3 py-1.5 text-[12px] ${
                i === highlight ? 'bg-accent/15 text-accent' : 'text-surface-200 hover:bg-surface-800'
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function NotesForm({ trade, onSaved, setupOptions = [] }) {
  const [draft, setDraft] = useState(() => ({
    entry_notes: trade.entry_notes ?? trade.notes ?? '',
    exit_notes: trade.exit_notes ?? '',
    lessons: trade.lessons ?? '',
    setup: trade.setup ?? '',
    emotion: trade.emotion ?? '',
    grade: trade.grade ?? '',
    conviction: trade.conviction ?? '',
    stop_price: trade.stop_price ?? '',
    target_price: trade.target_price ?? '',
  }))
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [error, setError] = useState(null)

  // Reset the draft whenever the active trade changes.
  useEffect(() => {
    setDraft({
      entry_notes: trade.entry_notes ?? trade.notes ?? '',
      exit_notes: trade.exit_notes ?? '',
      lessons: trade.lessons ?? '',
      setup: trade.setup ?? '',
      emotion: trade.emotion ?? '',
      grade: trade.grade ?? '',
      conviction: trade.conviction ?? '',
      stop_price: trade.stop_price ?? '',
      target_price: trade.target_price ?? '',
    })
    setSavedAt(null)
    setError(null)
  }, [trade.symbol, trade.entry_date, trade.entry_price, trade.quantity])

  const update = (k, v) => setDraft(prev => ({ ...prev, [k]: v }))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        symbol: trade.symbol,
        entry_date: trade.entry_date,
        entry_price: trade.entry_price,
        quantity: trade.quantity,
        ...draft,
        // Coerce numbers from inputs
        conviction: draft.conviction === '' ? null : Number(draft.conviction),
        stop_price: draft.stop_price === '' ? null : Number(draft.stop_price),
        target_price: draft.target_price === '' ? null : Number(draft.target_price),
      }
      const res = await saveReviewNote(payload)
      setSavedAt(new Date())
      onSaved?.(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[11px] uppercase tracking-wider text-surface-400 font-semibold mb-1">
          Entry thesis — why you bought
        </label>
        <textarea
          rows={3}
          value={draft.entry_notes}
          onChange={(e) => update('entry_notes', e.target.value)}
          placeholder="Setup, level, catalyst, what convinced you…"
          className="w-full rounded-lg bg-surface-900 border border-surface-700/50 px-3 py-2 text-[13px] text-surface-100 focus:border-accent focus:outline-none resize-y"
        />
      </div>

      <div>
        <label className="block text-[11px] uppercase tracking-wider text-surface-400 font-semibold mb-1">
          Exit reason — why you sold
        </label>
        <textarea
          rows={3}
          value={draft.exit_notes}
          onChange={(e) => update('exit_notes', e.target.value)}
          placeholder="Target hit, stop, deteriorating action, time-stop…"
          className="w-full rounded-lg bg-surface-900 border border-surface-700/50 px-3 py-2 text-[13px] text-surface-100 focus:border-accent focus:outline-none resize-y"
        />
      </div>

      <div>
        <label className="block text-[11px] uppercase tracking-wider text-surface-400 font-semibold mb-1">
          Lessons — what to do differently
        </label>
        <textarea
          rows={2}
          value={draft.lessons}
          onChange={(e) => update('lessons', e.target.value)}
          placeholder="Process insights, rule violations, sizing tweaks…"
          className="w-full rounded-lg bg-surface-900 border border-surface-700/50 px-3 py-2 text-[13px] text-surface-100 focus:border-accent focus:outline-none resize-y"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-surface-400 font-semibold mb-1">Setup</label>
          <Combobox
            value={draft.setup}
            onChange={(v) => update('setup', v)}
            options={setupOptions}
            placeholder="Search or type a setup…"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-surface-400 font-semibold mb-1">Emotion</label>
          <select
            value={draft.emotion}
            onChange={(e) => update('emotion', e.target.value)}
            className="w-full rounded-lg bg-surface-900 border border-surface-700/50 px-3 py-2 text-[13px] text-surface-100 focus:border-accent focus:outline-none"
          >
            <option value="">—</option>
            {EMOTIONS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-surface-400 font-semibold mb-1">Grade</label>
          <div className="flex gap-1">
            {GRADES.map(g => (
              <button
                key={g}
                type="button"
                onClick={() => update('grade', draft.grade === g ? '' : g)}
                className={`flex-1 py-2 rounded-lg border text-[13px] font-bold font-mono transition-colors ${
                  draft.grade === g
                    ? g === 'A' ? 'bg-success/20 border-success/40 text-success'
                      : g === 'B' ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                      : g === 'C' ? 'bg-warning/20 border-warning/40 text-warning'
                      : 'bg-danger/20 border-danger/40 text-danger'
                    : 'bg-surface-900 border-surface-700/50 text-surface-400 hover:text-surface-200'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-surface-400 font-semibold mb-1">Conviction (1-5)</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(s => (
              <button
                key={s}
                type="button"
                onClick={() => update('conviction', draft.conviction === s ? '' : s)}
                className={`flex-1 py-2 rounded-lg border text-[13px] font-bold transition-colors ${
                  Number(draft.conviction) >= s
                    ? 'bg-warning/20 border-warning/40 text-warning'
                    : 'bg-surface-900 border-surface-700/50 text-surface-500 hover:text-surface-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-surface-400 font-semibold mb-1">Stop</label>
          <input
            type="number" step="0.01"
            value={draft.stop_price}
            onChange={(e) => update('stop_price', e.target.value)}
            className="w-full rounded-lg bg-surface-900 border border-surface-700/50 px-3 py-2 text-[13px] text-surface-100 focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-surface-400 font-semibold mb-1">Target</label>
          <input
            type="number" step="0.01"
            value={draft.target_price}
            onChange={(e) => update('target_price', e.target.value)}
            className="w-full rounded-lg bg-surface-900 border border-surface-700/50 px-3 py-2 text-[13px] text-surface-100 focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-400/30 px-3 py-2 rounded-lg">{error}</div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-accent text-surface-950 font-semibold text-[13px] hover:bg-accent/90 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save review'}
        </button>
        {savedAt && (
          <span className="text-[11px] text-success">Saved {savedAt.toLocaleTimeString()}</span>
        )}
      </div>
    </div>
  )
}

export default function Review() {
  const [allTrades, setAllTrades] = useState([])
  const [notesMap, setNotesMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('unreviewed')
  const [activeKey, setActiveKey] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [tradesRes, notesRes] = await Promise.all([
        loadDefaultTrades(),
        getReviewNotes().catch(() => ({ notes: {} })),
      ])
      const sorted = (tradesRes.trades || []).slice().sort((a, b) => {
        const at = a.exit_date ? new Date(a.exit_date).getTime() : 0
        const bt = b.exit_date ? new Date(b.exit_date).getTime() : 0
        return bt - at
      })
      setAllTrades(sorted)
      setNotesMap(notesRes.notes || {})
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // First load: if "Needs review" is empty (e.g. xlsx already filled in
  // setup/notes), step through the other filters and land on the first one
  // that actually has trades — saves the user a click.
  useEffect(() => {
    if (allTrades.length === 0) return
    if (filter !== 'unreviewed') return
    if (filterTrades(allTrades, 'unreviewed').length > 0) return
    const fallback = ['week', 'losers', 'all'].find(id => filterTrades(allTrades, id).length > 0)
    if (fallback) setFilter(fallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTrades])

  const filtered = useMemo(() => filterTrades(allTrades, filter), [allTrades, filter])

  // Recycle the setup taxonomy already present in the user's trades — distinct
  // values, most-used first — to seed the Setup combobox (no drift, no retyping).
  const setupOptions = useMemo(() => {
    const counts = new Map()
    for (const t of allTrades) {
      const s = (t.setup || '').trim()
      if (s) counts.set(s, (counts.get(s) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s)
  }, [allTrades])

  // Auto-select the first trade in the queue when the filter changes or on load.
  useEffect(() => {
    if (filtered.length === 0) {
      setActiveKey(null)
      return
    }
    const stillThere = filtered.some(t => buildTradeKey(t) === activeKey)
    if (!stillThere) setActiveKey(buildTradeKey(filtered[0]))
  }, [filtered, activeKey])

  const activeTrade = useMemo(
    () => filtered.find(t => buildTradeKey(t) === activeKey) || filtered[0],
    [filtered, activeKey],
  )

  const handleSaved = useCallback((res) => {
    // Optimistically reflect the new note in our map so the ✓ chip appears
    // immediately without a full reload.
    setNotesMap(prev => ({ ...prev, [res.key]: res.note }))
    setAllTrades(prev => prev.map(t => {
      const k = buildTradeKey(t)
      if (k !== res.key) return t
      return { ...t, ...res.note, _has_review_notes: true }
    }))
  }, [])

  const goToNext = () => {
    if (!activeTrade || filtered.length === 0) return
    const idx = filtered.findIndex(t => buildTradeKey(t) === buildTradeKey(activeTrade))
    const next = filtered[(idx + 1) % filtered.length]
    if (next) setActiveKey(buildTradeKey(next))
  }
  const goToPrev = () => {
    if (!activeTrade || filtered.length === 0) return
    const idx = filtered.findIndex(t => buildTradeKey(t) === buildTradeKey(activeTrade))
    const prev = filtered[(idx - 1 + filtered.length) % filtered.length]
    if (prev) setActiveKey(buildTradeKey(prev))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">Trade Review</h1>
          <p className="text-surface-400 text-[13px] mt-1">
            Chart + journal in one place. Filter the queue, click a trade, write your thoughts. Saved to a sidecar so the formatter is never blocked.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-[12px] font-medium hover:bg-accent/20 disabled:opacity-50 transition"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Queue filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {QUEUE_FILTERS.map(f => {
          const count = filterTrades(allTrades, f.id).length
          const active = filter === f.id
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              title={f.hint}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                active
                  ? 'bg-accent/15 border-accent/40 text-accent'
                  : 'bg-surface-900/60 border-surface-700/50 text-surface-300 hover:text-surface-100'
              }`}
            >
              {f.label} <span className="ml-1 text-[10px] tabular-nums opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4">
        {/* Queue */}
        <div className="rounded-xl bg-surface-900/60 border border-surface-700/50 overflow-hidden flex flex-col max-h-[80vh]">
          <div className="px-3 py-2 border-b border-surface-700/50 text-[11px] uppercase tracking-wider text-surface-400 font-semibold flex items-center justify-between">
            <span>Queue</span>
            <span className="tabular-nums opacity-70">{filtered.length}</span>
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-8 text-center text-[12px] text-surface-500">No trades match this filter.</div>
            ) : (
              filtered.map(t => {
                const k = buildTradeKey(t)
                return (
                  <TradeListItem
                    key={k}
                    trade={t}
                    active={k === buildTradeKey(activeTrade || {})}
                    reviewed={t._has_review_notes || !!notesMap[k]}
                    onClick={() => setActiveKey(k)}
                  />
                )
              })
            )}
          </div>
        </div>

        {/* Detail pane */}
        <div className="space-y-4 min-w-0">
          {!activeTrade ? (
            <div className="rounded-xl bg-surface-900/60 border border-surface-700/50 p-10 text-center text-[13px] text-surface-500">
              {loading ? 'Loading trades…' : 'Select a trade from the queue to begin.'}
            </div>
          ) : (
            <>
              {/* Trade header */}
              <div className="rounded-xl bg-surface-900/60 border border-surface-700/50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-display font-bold text-[20px] text-surface-50">{activeTrade.symbol}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded ${activeTrade.side === 'LONG' ? 'bg-accent/15 text-accent' : 'bg-danger/10 text-danger'}`}>
                      {activeTrade.side || 'N/A'}
                    </span>
                    <span className="text-[12px] font-mono text-surface-300">
                      ${Number(activeTrade.entry_price ?? 0).toFixed(2)} → ${Number(activeTrade.exit_price ?? 0).toFixed(2)}
                      <span className="text-surface-500"> · {activeTrade.quantity ?? 0} shares</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`font-mono font-bold text-[16px] ${(activeTrade.pnl ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                      {fmtMoney(activeTrade.pnl)}
                    </span>
                    <span className={`font-mono font-semibold text-[13px] ${(activeTrade.pnl_pct ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                      {fmtPct(activeTrade.pnl_pct)}
                    </span>
                    <div className="flex items-center gap-1 ml-2">
                      <button onClick={goToPrev} className="px-2 py-1 rounded bg-surface-800 hover:bg-surface-700 text-surface-300 text-[12px]">←</button>
                      <button onClick={goToNext} className="px-2 py-1 rounded bg-surface-800 hover:bg-surface-700 text-surface-300 text-[12px]">Next →</button>
                    </div>
                  </div>
                </div>
                {/* Exact entry/exit timestamps */}
                <div className="mt-2 pt-2 border-t border-surface-700/40 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] font-mono">
                  <span className="text-surface-500">
                    <span className="text-success font-semibold">▲ Entry</span>{' '}
                    <span className="text-surface-200">{fmtDateTime(activeTrade.entry_date, activeTrade.entry_time)}</span>
                  </span>
                  <span className="text-surface-500">
                    <span className="text-danger font-semibold">▼ Exit</span>{' '}
                    <span className="text-surface-200">{fmtDateTime(activeTrade.exit_date, activeTrade.exit_time)}</span>
                  </span>
                  {activeTrade.duration_days != null && (
                    <span className="text-surface-500">
                      Hold <span className="text-surface-300">{activeTrade.duration_days > 0 ? `${activeTrade.duration_days}d` : 'intraday'}</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Chart + form side-by-side at xl */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <LightweightTradeChart
                  symbol={activeTrade.symbol}
                  entryDate={activeTrade.entry_date}
                  entryTime={activeTrade.entry_time}
                  exitDate={activeTrade.exit_date}
                  exitTime={activeTrade.exit_time}
                  entryPrice={activeTrade.entry_price}
                  exitPrice={activeTrade.exit_price}
                  height={560}
                />
                <div className="rounded-xl bg-surface-900/60 border border-surface-700/50 p-4">
                  <NotesForm trade={activeTrade} onSaved={handleSaved} setupOptions={setupOptions} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
