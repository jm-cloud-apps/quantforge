import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getDailyEntry,
  saveDailyEntry,
  listDailyEntries,
  deleteDailyEntry,
} from '../api/dailyJournal'

// ─── Helpers ────────────────────────────────────────────────────────────────

const toISODate = (d) => {
  const yr = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  return `${yr}-${mo}-${dy}`
}

const todayISO = () => toISODate(new Date())

const fmtPretty = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const today = todayISO()
  const yest = toISODate(new Date(Date.now() - 86400000))
  if (iso === today) return 'Today'
  if (iso === yest) return 'Yesterday'
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + n)
  return toISODate(dt)
}

const MOODS = [
  { id: 'green', label: 'Green', tone: 'success', hint: 'Sharp, disciplined, in flow' },
  { id: 'amber', label: 'Amber', tone: 'warning', hint: 'Distracted, mixed signals' },
  { id: 'red',   label: 'Red',   tone: 'danger',  hint: 'Off — sit on hands' },
]

const moodPill = (tone, active) => {
  const base = 'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors'
  if (active) {
    if (tone === 'success') return `${base} bg-success/15 border-success/40 text-success`
    if (tone === 'warning') return `${base} bg-warning/15 border-warning/40 text-warning`
    if (tone === 'danger')  return `${base} bg-danger/15 border-danger/40 text-danger`
  }
  return `${base} bg-surface-900/60 border-surface-700/40 text-surface-400 hover:text-surface-200 hover:border-surface-600/60`
}

// ─── Section block (one of: Thesis / Plan / Reflection) ─────────────────────

function Section({ label, hint, value, placeholder, onChange, onBlur, rows = 5 }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wider font-medium text-surface-400">
          {label}
        </span>
        {hint && <span className="text-[10px] text-surface-600">{hint}</span>}
      </div>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className="w-full rounded-xl bg-surface-900/60 border border-surface-700/40 backdrop-blur-sm px-4 py-3 text-[14px] text-surface-100 placeholder-surface-600 leading-relaxed resize-none focus:border-accent/40 focus:bg-surface-900/80 focus:outline-none transition-colors"
      />
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────

export default function DailyJournal() {
  const [date, setDate] = useState(todayISO())
  const [entry, setEntry] = useState({ mood: null, market_thesis: '', plan: '', reflection: '', tags: [], exists: false })
  const [tagInput, setTagInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [error, setError] = useState(null)
  const [recent, setRecent] = useState([])

  const loadedSnapshotRef = useRef('')
  const saveTimerRef = useRef(null)

  // --- Load entry for the active date ---
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    getDailyEntry(date)
      .then((data) => {
        if (!alive) return
        const next = {
          mood: data.mood ?? null,
          market_thesis: data.market_thesis || '',
          plan: data.plan || '',
          reflection: data.reflection || '',
          tags: data.tags || [],
          exists: !!data.exists,
        }
        setEntry(next)
        loadedSnapshotRef.current = JSON.stringify(next)
        setSavedAt(data.updated_at || null)
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [date])

  // --- Recent entries (sidebar list) ---
  const reloadRecent = async () => {
    try {
      const data = await listDailyEntries(30)
      setRecent(data.entries || [])
    } catch (_) { /* non-fatal */ }
  }
  useEffect(() => { reloadRecent() }, [])

  // --- Save (debounced on change + immediate on blur) ---
  const persist = async (payload = entry) => {
    setSaving(true)
    setError(null)
    try {
      const res = await saveDailyEntry(date, {
        mood: payload.mood,
        market_thesis: payload.market_thesis,
        plan: payload.plan,
        reflection: payload.reflection,
        tags: payload.tags,
      })
      setSavedAt(res.updated_at)
      loadedSnapshotRef.current = JSON.stringify({ ...payload, exists: true })
      setEntry((e) => ({ ...e, exists: true }))
      reloadRecent()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const isDirty = useMemo(
    () => JSON.stringify(entry) !== loadedSnapshotRef.current,
    [entry],
  )

  const scheduleSave = (next) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => persist(next), 800)
  }

  const updateField = (key) => (val) => {
    setEntry((prev) => {
      const next = { ...prev, [key]: val }
      scheduleSave(next)
      return next
    })
  }

  const handleBlur = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (isDirty) persist(entry)
  }

  const handleMood = (moodId) => {
    setEntry((prev) => {
      const next = { ...prev, mood: prev.mood === moodId ? null : moodId }
      scheduleSave(next)
      return next
    })
  }

  const addTag = () => {
    const t = tagInput.trim().toLowerCase()
    if (!t) return
    if (entry.tags.includes(t)) { setTagInput(''); return }
    const next = { ...entry, tags: [...entry.tags, t] }
    setEntry(next)
    setTagInput('')
    scheduleSave(next)
  }

  const removeTag = (t) => {
    const next = { ...entry, tags: entry.tags.filter((x) => x !== t) }
    setEntry(next)
    scheduleSave(next)
  }

  const handleDelete = async () => {
    if (!entry.exists) return
    if (!confirm(`Delete the daily entry for ${fmtPretty(date)}?`)) return
    try {
      await deleteDailyEntry(date)
      const cleared = { mood: null, market_thesis: '', plan: '', reflection: '', tags: [], exists: false }
      setEntry(cleared)
      loadedSnapshotRef.current = JSON.stringify(cleared)
      setSavedAt(null)
      reloadRecent()
    } catch (e) {
      setError(e.message)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const isToday = date === todayISO()
  const saveStatus = saving
    ? 'Saving…'
    : savedAt
      ? `Saved · ${new Date(savedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
      : isDirty ? 'Unsaved changes' : '—'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
      {/* ── Editor pane ──────────────────────────────────────────────────── */}
      <div className="space-y-6">
        {/* Date stepper */}
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-900/60 border border-surface-700/40 backdrop-blur-sm px-4 py-3">
          <button
            onClick={() => setDate((d) => addDays(d, -1))}
            className="w-8 h-8 rounded-lg text-surface-400 hover:text-surface-100 hover:bg-surface-800/60 transition-colors flex items-center justify-center"
            title="Previous day"
            aria-label="Previous day"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="flex-1 text-center">
            <p className="text-surface-100 font-display font-semibold text-lg leading-tight">
              {fmtPretty(date)}
            </p>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayISO())}
              className="text-[11px] text-surface-500 font-mono bg-transparent border-none outline-none cursor-pointer hover:text-surface-300"
            />
          </div>

          <button
            onClick={() => setDate((d) => addDays(d, 1))}
            disabled={date >= todayISO()}
            className="w-8 h-8 rounded-lg text-surface-400 hover:text-surface-100 hover:bg-surface-800/60 transition-colors flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent"
            title="Next day"
            aria-label="Next day"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {!isToday && (
            <button
              onClick={() => setDate(todayISO())}
              className="ml-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-accent bg-accent/10 border border-accent/25 hover:bg-accent/15"
            >
              Today
            </button>
          )}
        </div>

        {loading ? (
          <div className="rounded-xl bg-surface-900/40 border border-surface-700/30 p-12 text-center text-surface-500 text-sm">
            Loading…
          </div>
        ) : (
          <>
            {/* Mood */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] uppercase tracking-wider font-medium text-surface-400">
                  How am I trading today
                </span>
                <span className="text-[10px] text-surface-600">{saveStatus}</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {MOODS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => handleMood(m.id)}
                    className={moodPill(m.tone, entry.mood === m.id)}
                    title={m.hint}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sections */}
            <Section
              label="Market Thesis"
              hint="What I'm watching today"
              value={entry.market_thesis}
              onChange={updateField('market_thesis')}
              onBlur={handleBlur}
              placeholder="Indices · sectors · risk-on / risk-off · the one chart that matters today…"
            />

            <Section
              label="Plan"
              hint="Setups I'm hunting"
              value={entry.plan}
              onChange={updateField('plan')}
              onBlur={handleBlur}
              placeholder="Tickers, entry zones, position sizing, stop levels…"
              rows={4}
            />

            <Section
              label="Reflection"
              hint="EOD recap"
              value={entry.reflection}
              onChange={updateField('reflection')}
              onBlur={handleBlur}
              placeholder="What went right · what went wrong · what to repeat · what to stop…"
              rows={6}
            />

            {/* Tags */}
            <div className="space-y-2">
              <span className="text-[11px] uppercase tracking-wider font-medium text-surface-400">Tags</span>
              <div className="flex flex-wrap gap-1.5 items-center">
                {entry.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full bg-surface-900/60 border border-surface-700/40 px-2.5 py-1 text-xs text-surface-300"
                  >
                    {t}
                    <button
                      onClick={() => removeTag(t)}
                      className="text-surface-500 hover:text-danger transition-colors"
                      aria-label={`Remove tag ${t}`}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                  onBlur={addTag}
                  placeholder="Add tag…"
                  className="bg-transparent text-xs text-surface-100 placeholder-surface-600 outline-none px-2 py-1 min-w-[80px]"
                />
              </div>
            </div>

            {/* Footer actions */}
            {entry.exists && (
              <div className="flex items-center justify-between pt-2 border-t border-surface-700/30">
                <span className="text-[11px] text-surface-600">
                  Auto-saves while you type · last save {saveStatus}
                </span>
                <button
                  onClick={handleDelete}
                  className="text-xs text-surface-500 hover:text-danger transition-colors"
                >
                  Delete entry
                </button>
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-3 text-xs text-danger">
                {error}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Recent entries sidebar ────────────────────────────────────────── */}
      <aside className="space-y-3">
        <p className="text-[11px] uppercase tracking-wider font-medium text-surface-400">
          Recent days
        </p>
        {recent.length === 0 ? (
          <p className="text-xs text-surface-600">
            No entries yet. Today's is your first.
          </p>
        ) : (
          <ul className="space-y-1">
            {recent.map((e) => {
              const active = e.date === date
              const moodTone = MOODS.find((m) => m.id === e.mood)?.tone
              const dot =
                moodTone === 'success' ? 'bg-success'
                : moodTone === 'warning' ? 'bg-warning'
                : moodTone === 'danger' ? 'bg-danger'
                : 'bg-surface-700'
              return (
                <li key={e.date}>
                  <button
                    onClick={() => setDate(e.date)}
                    className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                      active
                        ? 'bg-accent/5 border-accent/30'
                        : 'bg-surface-900/40 border-surface-700/40 hover:border-surface-600/60'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                      <span className={`text-sm font-medium ${active ? 'text-accent' : 'text-surface-200'}`}>
                        {fmtPretty(e.date)}
                      </span>
                    </div>
                    {(e.market_thesis || e.plan || e.reflection) && (
                      <p className="text-[11px] text-surface-500 mt-0.5 truncate">
                        {(e.market_thesis || e.plan || e.reflection).slice(0, 80)}
                      </p>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </aside>
    </div>
  )
}
