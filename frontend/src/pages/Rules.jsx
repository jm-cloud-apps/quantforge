import { useEffect, useMemo, useState, useRef } from 'react'
import {
  CATEGORIES,
  CATALYST_HIERARCHY,
  loadRules,
  saveRules,
  seedRules,
  getRuleOfDay,
} from '../utils/tradingRules'

// Category metadata — single source of truth for icons, tones, and labels.

const CATEGORY_META = {
  MINDSET: {
    label: 'Mindset',
    short: 'MIND',
    text:   'text-purple',
    bg:     'bg-purple/10',
    bgSoft: 'bg-purple/5',
    border: 'border-purple/30',
    bar:    'bg-purple',
    glow:   'shadow-[0_0_30px_-12px_rgba(139,92,246,0.5)]',
    icon: (
      <svg className="w-full h-full" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a3.75 3.75 0 01-1.298.872l-.11.042a3.75 3.75 0 01-2.687 0l-.11-.042a3.75 3.75 0 01-1.298-.872L12 17z" />
      </svg>
    ),
  },
  RISK: {
    label: 'Risk',
    short: 'RISK',
    text:   'text-danger',
    bg:     'bg-danger/10',
    bgSoft: 'bg-danger/5',
    border: 'border-danger/30',
    bar:    'bg-danger',
    glow:   'shadow-[0_0_30px_-12px_rgba(239,68,68,0.5)]',
    icon: (
      <svg className="w-full h-full" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  ENTRY: {
    label: 'Entry',
    short: 'IN',
    text:   'text-accent',
    bg:     'bg-accent/10',
    bgSoft: 'bg-accent/5',
    border: 'border-accent/30',
    bar:    'bg-accent',
    glow:   'shadow-[0_0_30px_-12px_rgba(16,185,129,0.5)]',
    icon: (
      <svg className="w-full h-full" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    ),
  },
  EXIT: {
    label: 'Exit',
    short: 'OUT',
    text:   'text-cyan',
    bg:     'bg-cyan/10',
    bgSoft: 'bg-cyan/5',
    border: 'border-cyan/30',
    bar:    'bg-cyan',
    glow:   'shadow-[0_0_30px_-12px_rgba(6,182,212,0.5)]',
    icon: (
      <svg className="w-full h-full" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
      </svg>
    ),
  },
}

function nextId(rules) {
  return rules.reduce((max, r) => Math.max(max, r.id || 0), 0) + 1
}

function RuleRow({ rule, index, total, onEdit, onDelete, onMove }) {
  const meta = CATEGORY_META[rule.category] || CATEGORY_META.MINDSET
  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState(rule.text)
  const [draftCategory, setDraftCategory] = useState(rule.category)
  const textareaRef = useRef(null)

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      const len = textareaRef.current.value.length
      textareaRef.current.setSelectionRange(len, len)
    }
  }, [editing])

  const startEdit = () => {
    setDraftText(rule.text)
    setDraftCategory(rule.category)
    setEditing(true)
  }

  const commit = () => {
    const trimmed = draftText.trim()
    if (!trimmed) { setEditing(false); return }
    onEdit(rule.id, { text: trimmed, category: draftCategory })
    setEditing(false)
  }

  const cancel = () => {
    setDraftText(rule.text)
    setDraftCategory(rule.category)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className={`relative rounded-2xl border ${meta.border} bg-surface-900/80 p-4 ${meta.glow}`}>
        <div className={`absolute left-0 top-4 bottom-4 w-1 rounded-r-full ${meta.bar}`} />
        <div className="flex items-center gap-2 mb-3 pl-3">
          <select
            value={draftCategory}
            onChange={(e) => setDraftCategory(e.target.value)}
            className="bg-surface-800 border border-surface-600 text-surface-100 text-[11px] font-semibold rounded px-2 py-1 focus:outline-none focus:border-accent"
          >
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="flex-1" />
          <button onClick={cancel} className="text-[11px] text-surface-400 hover:text-surface-200 px-2 py-1">
            Cancel
          </button>
          <button
            onClick={commit}
            className="text-[11px] font-semibold text-accent hover:text-accent-bright bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded px-2.5 py-1"
          >
            Save
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit()
            if (e.key === 'Escape') cancel()
          }}
          rows={2}
          className="w-full bg-surface-800/60 border border-surface-700 rounded-lg px-3 py-2 text-[13.5px] text-surface-100 placeholder-surface-500 focus:outline-none focus:border-accent resize-none ml-3"
          style={{ width: 'calc(100% - 0.75rem)' }}
          placeholder="Rule text…"
        />
        <div className="mt-1 pl-3 text-[10px] text-surface-500">⌘/Ctrl+Enter to save · Esc to cancel</div>
      </div>
    )
  }

  return (
    <div
      className={`group relative rounded-2xl border border-surface-700/40 bg-gradient-to-br from-surface-900/80 to-surface-900/40 hover:from-surface-800/80 hover:to-surface-800/40 hover:border-surface-600 transition-all duration-200 hover:-translate-y-px hover:shadow-card overflow-hidden`}
    >
      {/* Category accent bar */}
      <div className={`absolute left-0 top-3 bottom-3 w-1 rounded-r-full ${meta.bar} opacity-70 group-hover:opacity-100 transition-opacity`} />

      <div className="flex items-start gap-3 pl-4 pr-3 py-3">
        <div className={`shrink-0 w-9 h-9 rounded-xl ${meta.bg} border ${meta.border} flex items-center justify-center font-mono font-bold text-[13px] ${meta.text}`}>
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${meta.bg} ${meta.text} ${meta.border}`}>
              <span className="w-2.5 h-2.5">{meta.icon}</span>
              {meta.label.toUpperCase()}
            </span>
          </div>
          <button
            onClick={startEdit}
            className="text-left text-[14px] leading-relaxed text-surface-100 hover:text-white w-full"
            title="Click to edit"
          >
            {rule.text}
          </button>
        </div>
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onMove(rule.id, -1)}
            disabled={index === 0}
            className="w-7 h-7 rounded-md flex items-center justify-center text-surface-500 hover:text-surface-200 hover:bg-surface-800 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move up"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <button
            onClick={() => onMove(rule.id, 1)}
            disabled={index === total - 1}
            className="w-7 h-7 rounded-md flex items-center justify-center text-surface-500 hover:text-surface-200 hover:bg-surface-800 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move down"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            onClick={startEdit}
            className="w-7 h-7 rounded-md flex items-center justify-center text-surface-500 hover:text-accent hover:bg-surface-800"
            title="Edit"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(rule.id)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-surface-500 hover:text-danger hover:bg-surface-800"
            title="Delete"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function AddRuleForm({ onAdd, defaultCategory }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [category, setCategory] = useState(defaultCategory || 'MINDSET')
  const textareaRef = useRef(null)

  useEffect(() => {
    if (open && textareaRef.current) textareaRef.current.focus()
  }, [open])

  useEffect(() => { if (defaultCategory) setCategory(defaultCategory) }, [defaultCategory])

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    onAdd({ text: trimmed, category })
    setText('')
    setOpen(false)
  }

  const cancel = () => {
    setText('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl border border-dashed border-surface-600 hover:border-accent text-surface-400 hover:text-accent hover:bg-accent/5 transition-colors text-[13px] font-medium"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add a rule
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-accent/40 bg-surface-900/80 p-4 shadow-glow-sm">
      <div className="flex items-center gap-2 mb-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="bg-surface-800 border border-surface-600 text-surface-100 text-[11px] font-semibold rounded px-2 py-1 focus:outline-none focus:border-accent"
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={cancel} className="text-[11px] text-surface-400 hover:text-surface-200 px-2 py-1">
          Cancel
        </button>
        <button
          onClick={submit}
          className="text-[11px] font-semibold text-accent hover:text-accent-bright bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded px-2.5 py-1"
        >
          Add rule
        </button>
      </div>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          if (e.key === 'Escape') cancel()
        }}
        rows={2}
        className="w-full bg-surface-800/60 border border-surface-700 rounded-lg px-3 py-2 text-[13.5px] text-surface-100 placeholder-surface-500 focus:outline-none focus:border-accent resize-none"
        placeholder="What's the rule? Keep it short and actionable…"
      />
      <div className="mt-1 text-[10px] text-surface-500">⌘/Ctrl+Enter to add · Esc to cancel</div>
    </div>
  )
}

function CategoryCard({ cat, count, active, onClick }) {
  const meta = CATEGORY_META[cat]
  return (
    <button
      onClick={onClick}
      className={`relative group text-left rounded-2xl border p-4 transition-all duration-200 overflow-hidden ${
        active
          ? `${meta.border} ${meta.bgSoft} ${meta.glow}`
          : 'border-surface-700/50 bg-surface-900/40 hover:border-surface-600 hover:bg-surface-900/70'
      }`}
    >
      {/* Top accent bar */}
      <div className={`absolute left-0 right-0 top-0 h-0.5 ${meta.bar} ${active ? 'opacity-100' : 'opacity-30 group-hover:opacity-60'} transition-opacity`} />

      <div className="flex items-start justify-between gap-2">
        <div className={`w-9 h-9 rounded-xl ${meta.bg} border ${meta.border} flex items-center justify-center ${meta.text}`}>
          <div className="w-4.5 h-4.5" style={{ width: '18px', height: '18px' }}>{meta.icon}</div>
        </div>
        <div className={`text-[28px] font-display font-bold leading-none ${active ? meta.text : 'text-surface-200'}`}>
          {count}
        </div>
      </div>
      <div className={`mt-2.5 text-[11px] font-bold tracking-wider ${active ? meta.text : 'text-surface-400'}`}>
        {meta.label.toUpperCase()}
      </div>
      <div className="mt-0.5 text-[10.5px] text-surface-500">
        {cat === 'MINDSET' && 'How to think'}
        {cat === 'RISK' && 'How to not blow up'}
        {cat === 'ENTRY' && 'When to get in'}
        {cat === 'EXIT' && 'When to get out'}
      </div>
    </button>
  )
}

// Stockbee (Pradeep Bonde) catalyst ranking — surfaced as a framework, not
// a one-line rule, because the *ordering* is the whole insight. Visually a
// stacked tier ladder: tier number, name, blurb, and an intensity dot row
// that decays from accent → muted as you walk down the hierarchy.
function CatalystHierarchy() {
  // Intensity dots: tier 1 gets 6 filled, tier 6 gets 1 filled.
  const dots = (tier) => {
    const filled = Math.max(1, 7 - tier)
    return Array.from({ length: 6 }, (_, i) => i < filled)
  }
  return (
    <section
      aria-labelledby="catalyst-hierarchy-title"
      className="relative overflow-hidden rounded-3xl border border-accent/25 bg-gradient-to-br from-surface-900 via-surface-900 to-surface-950"
    >
      {/* Decorative top accent — mirrors the hero's gradient stripe */}
      <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-accent via-cyan to-purple opacity-70" />
      <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

      <div className="relative px-6 sm:px-7 py-6 sm:py-7">
        {/* Title row */}
        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center text-accent">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h2 id="catalyst-hierarchy-title" className="text-[16px] font-display font-bold text-surface-50 tracking-tight leading-tight">
                Catalyst Hierarchy
              </h2>
              <div className="text-[11px] text-surface-500 mt-0.5">
                Rank the <span className="text-surface-300">why</span> before sizing into an Episodic Pivot.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-accent/10 text-accent border-accent/30">
              EP SETUP
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-surface-800/60 text-surface-400 border-surface-700">
              FRAMEWORK
            </span>
          </div>
        </div>

        {/* Tier ladder */}
        <ol className="mt-5 space-y-1.5">
          {CATALYST_HIERARCHY.map((c, i) => {
            const isTop = i === 0
            const dotRow = dots(c.tier)
            return (
              <li
                key={c.tier}
                className={`group relative rounded-xl border transition-colors ${
                  isTop
                    ? 'border-accent/30 bg-accent/[0.04]'
                    : 'border-surface-700/40 bg-surface-900/40 hover:border-surface-600/70'
                }`}
              >
                <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                  {/* Tier numeral */}
                  <div
                    className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-[12px] tabular-nums ${
                      isTop
                        ? 'bg-accent/15 text-accent border border-accent/40'
                        : 'bg-surface-800 text-surface-400 border border-surface-700'
                    }`}
                  >
                    {String(c.tier).padStart(2, '0')}
                  </div>

                  {/* Name + blurb */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={`text-[13.5px] font-semibold tracking-tight ${isTop ? 'text-surface-50' : 'text-surface-200'}`}>
                        {c.name}
                      </span>
                      {isTop && (
                        <span className="text-[9.5px] uppercase tracking-widest text-accent/80 font-bold">
                          most powerful
                        </span>
                      )}
                      {i === CATALYST_HIERARCHY.length - 1 && (
                        <span className="text-[9.5px] uppercase tracking-widest text-surface-500 font-bold">
                          slowest
                        </span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-surface-500 mt-0.5 leading-snug truncate sm:whitespace-normal">
                      {c.blurb}
                    </div>
                  </div>

                  {/* Intensity dots — visual decay across tiers */}
                  <div className="shrink-0 hidden sm:flex items-center gap-[3px]" aria-hidden>
                    {dotRow.map((on, di) => (
                      <span
                        key={di}
                        className={`w-1.5 h-1.5 rounded-full ${on ? (isTop ? 'bg-accent' : 'bg-surface-400') : 'bg-surface-700'}`}
                      />
                    ))}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>

        {/* Attribution */}
        <div className="mt-4 flex items-center justify-between gap-2 text-[10.5px] font-mono text-surface-500">
          <span>
            — Stockbee (Pradeep Bonde)
          </span>
          <span className="hidden sm:inline text-surface-600">
            Theme &gt; Policy &gt; Shortage &gt; Sales &gt; Product &gt; Mgmt
          </span>
        </div>
      </div>
    </section>
  )
}

function SectionHeader({ cat, count }) {
  const meta = CATEGORY_META[cat]
  return (
    <div className="flex items-center gap-3 mb-3 mt-2">
      <div className={`w-7 h-7 rounded-lg ${meta.bg} border ${meta.border} flex items-center justify-center ${meta.text}`}>
        <div style={{ width: '14px', height: '14px' }}>{meta.icon}</div>
      </div>
      <div className="flex items-baseline gap-2">
        <h2 className={`text-[13px] font-bold tracking-wider uppercase ${meta.text}`}>{meta.label}</h2>
        <span className="text-[11px] font-mono text-surface-500">{count} {count === 1 ? 'rule' : 'rules'}</span>
      </div>
      <div className={`flex-1 h-px ${meta.bg}`} />
    </div>
  )
}

export default function Rules() {
  const [rules, setRules] = useState(loadRules)
  const [filter, setFilter] = useState('ALL')
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  useEffect(() => { saveRules(rules) }, [rules])

  // Today's rotating rule — deterministic by day-of-year so the same rule
  // is shown all session, and the user cycles through every rule over time
  // instead of re-reading the same static quote.
  const dailyRule = useMemo(() => getRuleOfDay(rules), [rules])
  const dailyMeta = dailyRule ? (CATEGORY_META[dailyRule.category] || CATEGORY_META.MINDSET) : null

  const counts = useMemo(() => {
    const c = { ALL: rules.length }
    for (const cat of CATEGORIES) c[cat] = 0
    for (const r of rules) if (c[r.category] !== undefined) c[r.category]++
    return c
  }, [rules])

  // Original index lookup so the row's number badge reflects its true position,
  // not its position within the filtered slice.
  const indexById = useMemo(() => {
    const m = new Map()
    rules.forEach((r, i) => m.set(r.id, i))
    return m
  }, [rules])

  const groupedByCategory = useMemo(() => {
    const groups = {}
    for (const cat of CATEGORIES) groups[cat] = []
    for (const r of rules) {
      if (!groups[r.category]) groups[r.category] = []
      groups[r.category].push(r)
    }
    return groups
  }, [rules])

  const filteredRules = useMemo(() => {
    if (filter === 'ALL') return rules
    return rules.filter(r => r.category === filter)
  }, [rules, filter])

  const handleAdd = ({ text, category }) => {
    setRules(prev => [...prev, { id: nextId(prev), text, category }])
  }

  const handleEdit = (id, patch) => {
    setRules(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)))
  }

  const handleDelete = (id) => {
    setRules(prev => prev.filter(r => r.id !== id))
  }

  const handleMove = (id, direction) => {
    setRules(prev => {
      const idx = prev.findIndex(r => r.id === id)
      if (idx === -1) return prev
      const target = idx + direction
      if (target < 0 || target >= prev.length) return prev
      const next = prev.slice()
      const [item] = next.splice(idx, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  const handleReset = () => {
    setRules(seedRules())
    setShowResetConfirm(false)
  }

  return (
    <div className="space-y-6">
      {/* HERO — gradient panel with quote */}
      <div className="relative overflow-hidden rounded-3xl border border-surface-700/50 bg-gradient-to-br from-surface-900 via-surface-900/80 to-surface-950">
        {/* Decorative gradient orbs */}
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-accent/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-purple/10 blur-3xl pointer-events-none" />

        <div className="relative px-6 sm:px-8 py-7 sm:py-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-bold tracking-widest text-accent bg-accent/10 border border-accent/30 uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-soft" />
                  Discipline
                </span>
              </div>
              <h1 className="text-[28px] sm:text-[32px] font-display font-bold text-surface-50 tracking-tight leading-tight">
                Trading Rules
              </h1>
              <p className="mt-1.5 text-[13.5px] text-surface-400 max-w-xl">
                Review before every session. Especially before clicking the buy button.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {showResetConfirm ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-danger/10 border border-danger/30">
                  <span className="text-[11px] text-danger">Reset to Qullamaggie defaults?</span>
                  <button onClick={() => setShowResetConfirm(false)} className="text-[11px] text-surface-300 hover:text-surface-100 px-1.5">
                    Cancel
                  </button>
                  <button onClick={handleReset} className="text-[11px] font-semibold text-danger hover:text-red-300 px-1.5">
                    Reset
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="text-[11.5px] text-surface-300 hover:text-surface-100 px-3 py-2 rounded-xl border border-surface-700 hover:border-surface-600 bg-surface-900/60 transition-colors flex items-center gap-1.5"
                  title="Replace current rules with Qullamaggie defaults"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Reset to defaults
                </button>
              )}
            </div>
          </div>

          {/* Rule of the Day — rotates deterministically through the user's
              rules so the hero always shows something fresh without being
              random or flashy. Tapping it filters to that rule's category. */}
          {dailyRule && dailyMeta && (
            <figure className="mt-6 relative pl-5">
              <div className={`absolute left-0 top-1 bottom-1 w-[3px] rounded-full ${dailyMeta.bar}`} />
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase">
                  Rule of the day
                </span>
                <button
                  type="button"
                  onClick={() => setFilter(dailyRule.category)}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${dailyMeta.bg} ${dailyMeta.text} ${dailyMeta.border} hover:opacity-80`}
                  title={`Filter to ${dailyMeta.label}`}
                >
                  <span className="w-2.5 h-2.5">{dailyMeta.icon}</span>
                  {dailyMeta.label.toUpperCase()}
                </button>
              </div>
              <blockquote className="text-[16px] sm:text-[17px] text-surface-100 font-display leading-relaxed italic">
                “{dailyRule.text}”
              </blockquote>
              <figcaption className="mt-1.5 text-[11px] font-mono text-surface-500 tracking-wide">
                Day {(new Date()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · 1 of {rules.length} on rotation
              </figcaption>
            </figure>
          )}
        </div>
      </div>

      {/* CATALYST HIERARCHY — Stockbee framework for EP catalyst ranking. */}
      <CatalystHierarchy />

      {/* CATEGORY CARDS — also serve as filters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {CATEGORIES.map(cat => (
          <CategoryCard
            key={cat}
            cat={cat}
            count={counts[cat] || 0}
            active={filter === cat}
            onClick={() => setFilter(filter === cat ? 'ALL' : cat)}
          />
        ))}
      </div>

      {/* Filter status bar */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2 text-[12px] text-surface-400">
          {filter === 'ALL' ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span>Showing all <span className="text-surface-100 font-semibold">{counts.ALL}</span> rules</span>
            </>
          ) : (
            <>
              <span>Filtered: <span className={`font-semibold ${CATEGORY_META[filter].text}`}>{CATEGORY_META[filter].label}</span></span>
              <button
                onClick={() => setFilter('ALL')}
                className="text-[11px] text-surface-500 hover:text-surface-200 underline-offset-2 hover:underline"
              >
                Show all
              </button>
            </>
          )}
        </div>
      </div>

      {/* RULES — grouped sections when ALL, flat when filtered */}
      <div className="space-y-2">
        {counts.ALL === 0 ? (
          <div className="rounded-2xl border border-surface-700/40 bg-surface-900/40 p-12 text-center">
            <div className="text-[13px] text-surface-400">No rules yet. Add your first one below.</div>
          </div>
        ) : filter === 'ALL' ? (
          <>
            {CATEGORIES.map(cat => {
              const group = groupedByCategory[cat] || []
              if (group.length === 0) return null
              return (
                <div key={cat} className="space-y-2 pt-2 first:pt-0">
                  <SectionHeader cat={cat} count={group.length} />
                  {group.map(rule => (
                    <RuleRow
                      key={rule.id}
                      rule={rule}
                      index={indexById.get(rule.id)}
                      total={rules.length}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onMove={handleMove}
                    />
                  ))}
                </div>
              )
            })}
          </>
        ) : filteredRules.length === 0 ? (
          <div className="rounded-2xl border border-surface-700/40 bg-surface-900/40 p-12 text-center">
            <div className="text-[13px] text-surface-400">
              No rules in {CATEGORY_META[filter].label}. Add one below or switch the filter.
            </div>
          </div>
        ) : (
          filteredRules.map(rule => (
            <RuleRow
              key={rule.id}
              rule={rule}
              index={indexById.get(rule.id)}
              total={rules.length}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onMove={handleMove}
            />
          ))
        )}

        <div className="pt-2">
          <AddRuleForm onAdd={handleAdd} defaultCategory={filter === 'ALL' ? 'MINDSET' : filter} />
        </div>
      </div>

      {/* Attribution */}
      <div className="pt-2 text-[10.5px] text-surface-500 font-mono text-center">
        Defaults adapted from Kristjan Kullamägi (Qullamaggie) · Stored locally in this browser
      </div>
    </div>
  )
}
