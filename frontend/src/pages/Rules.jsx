import { useEffect, useMemo, useState, useRef } from 'react'

const STORAGE_KEY = 'qf:trading-rules:v2'

// Category metadata — single source of truth for icons, tones, and labels.
// Bumping STORAGE_KEY to v2 because the seed list expanded and the schema now
// expects every rule to have a known category.
const CATEGORIES = ['MINDSET', 'RISK', 'ENTRY', 'EXIT']

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

// Seeded from Qullamaggie (Kristjan Kullamägi) plus widely-accepted trader discipline.
// Order matters — first read should feel like a calm, prioritized briefing.
const DEFAULT_RULES = [
  // MINDSET
  { category: 'MINDSET', text: 'Patience is the edge — most of the time, do nothing. Wait for A+ setups.' },
  { category: 'MINDSET', text: 'Biggest size on the highest-conviction setups only. Small size on probes.' },
  { category: 'MINDSET', text: 'Trade with the market regime. Never fight a downtrend.' },
  { category: 'MINDSET', text: 'Sit on your hands during choppy, sideways markets. No setups, no trades.' },
  { category: 'MINDSET', text: 'After a string of losses, cut size in half or take a break. Reset the head.' },
  { category: 'MINDSET', text: 'No revenge trades. Walk away from the screen for 15 minutes after a meaningful loss.' },
  { category: 'MINDSET', text: 'Process over P&L. Grade your decisions, not your outcomes.' },
  { category: 'MINDSET', text: 'Pre-market plan: write down what you’ll trade and at what level before the bell.' },
  { category: 'MINDSET', text: 'Journal every trade with screenshots. Review weekly. The edge compounds.' },

  // RISK
  { category: 'RISK', text: 'Risk 0.25–1% of account per trade. Never more, no exceptions.' },
  { category: 'RISK', text: 'Cut losses fast. A small loss is the price of admission — never let it run.' },
  { category: 'RISK', text: 'Always know your stop before you enter. No stop, no trade.' },
  { category: 'RISK', text: 'Position size off the stop, not the conviction. Risk drives size — every time.' },
  { category: 'RISK', text: 'Never average down on a losing trade. Add only to winners.' },
  { category: 'RISK', text: 'Hold a max of 3–5 positions. Concentration beats diversification when risk is defined.' },
  { category: 'RISK', text: 'Define a maximum daily loss. Hit it, close the laptop. Tomorrow is another day.' },
  { category: 'RISK', text: 'Don’t hold through earnings unless that’s the explicit, planned trade.' },

  // ENTRY
  { category: 'ENTRY', text: 'Trade only A+ setups: Episodic Pivots, Breakouts, Parabolic Shorts.' },
  { category: 'ENTRY', text: 'Only buy stocks at or near 52-week / all-time highs. Leaders only.' },
  { category: 'ENTRY', text: 'Use 2x leveraged ETFs (TQQQ, SOXL, FNGU, NUGT, FAS) when the setup is A+ AND the market is in a confirmed uptrend.' },
  { category: 'ENTRY', text: 'Watch the leaders — they tell you what the market wants. Trade leaders, not laggards.' },
  { category: 'ENTRY', text: 'Trade leading sectors only. If the group is weak, the trade is weak.' },
  { category: 'ENTRY', text: 'Best moves usually come 3–5 days after the initial breakout — wait for the tight consolidation.' },
  { category: 'ENTRY', text: 'Require ADR > 5% — volatility is the raw material of returns.' },
  { category: 'ENTRY', text: 'Minimum $5M daily dollar volume. Liquidity matters when you need to exit.' },
  { category: 'ENTRY', text: 'The first 15–30 minutes is for amateurs. Let the open settle before entering.' },
  { category: 'ENTRY', text: 'Don’t chase. If the entry is gone, the entry is gone. Wait for the next one.' },

  // EXIT
  { category: 'EXIT', text: 'Sell 1/3 into strength on day 1. Lock in something on every winner.' },
  { category: 'EXIT', text: 'Trail the remaining position with the 10 or 20 EMA. Ride the trend.' },
  { category: 'EXIT', text: 'Move stop to breakeven once the trade extends meaningfully in your favor.' },
  { category: 'EXIT', text: 'The big money is made in the holding, not the trading. Let winners run.' },
]

const FEATURED_QUOTE = {
  text: 'Most of the time, doing nothing is the right trade. Patience is the entire edge.',
  attribution: 'Kristjan Kullamägi',
}

function loadRules() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return seedRules()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return seedRules()
    return parsed
  } catch {
    return seedRules()
  }
}

function seedRules() {
  return DEFAULT_RULES.map((r, i) => ({ ...r, id: i + 1 }))
}

function saveRules(rules) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rules)) } catch {}
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

          {/* Featured quote */}
          <figure className="mt-6 relative pl-5">
            <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-gradient-to-b from-accent via-purple to-cyan" />
            <blockquote className="text-[16px] sm:text-[17px] text-surface-100 font-display leading-relaxed italic">
              “{FEATURED_QUOTE.text}”
            </blockquote>
            <figcaption className="mt-1.5 text-[11px] font-mono text-surface-500 tracking-wide">
              — {FEATURED_QUOTE.attribution}
            </figcaption>
          </figure>
        </div>
      </div>

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
