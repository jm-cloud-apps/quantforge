import { useState, useEffect, useMemo, Suspense } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { loadRules, getRuleOfDay } from '../utils/tradingRules'

// Content-area loader shown while a lazy page chunk downloads. Scoped to the
// main panel so the sidebar/header stay put — only the page is "loading".
function PageLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-28 text-surface-500 gap-3">
      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <span className="text-xs">Loading page…</span>
    </div>
  )
}

const icons = {
  trading: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  ),
  watchlist: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
  ),
  trophy: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8m-4-4v4m-5-17h10v4a5 5 0 01-10 0V4zm0 1H5a2 2 0 002 4m10-4h2a2 2 0 01-2 4" />
    </svg>
  ),
  journal: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
  stock: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  sector: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  monitor: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 14l3-3 4 4 6-6" />
    </svg>
  ),
  calendar: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  awareness: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3m0 12v3m9-9h-3M6 12H3" />
    </svg>
  ),
  ninem: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      <circle cx="17" cy="6" r="3" stroke="currentColor" strokeWidth="1.6" fill="none" />
    </svg>
  ),
  breakouts: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8m0 0v6m0-6h-6" />
    </svg>
  ),
  reversal: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 15a5 5 0 00-10 0V8m0 0L6 11m3-3l3 3" />
    </svg>
  ),
  flashcards: (
    // A stack of cards — the retrieval drill over the Rules frameworks.
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="7" width="14" height="12" rx="2" />
      <path strokeLinecap="round" d="M7 4h10a3 3 0 013 3v9" />
      <path strokeLinecap="round" d="M7 12h6M7 15.5h4" />
    </svg>
  ),
  breakdown: (
    // Price stepping down through stacked, declining rails.
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l6 6-3 3 6 6" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 2" d="M4 10h16M6 15h14" />
    </svg>
  ),
  parabolic: (
    // A vertical ramp that rolls over — the parabola that snaps back.
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 20c3 0 5-2 6.5-6S13 5 15 5s3 3 3.5 6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 15l-2.5 3L15 16" />
    </svg>
  ),
  stages: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 20h4v-5h4v-4h4V6h6" />
    </svg>
  ),
  reclaim: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 2" d="M3 14h18" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 18l5-4 3 2 8-9m0 0h-4m4 0v4" />
    </svg>
  ),
  board: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v11h-4z" />
    </svg>
  ),
  factor: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h6M18 12v6m3-3h-6" />
    </svg>
  ),
  edge: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 19V5m0 14h16M8 15l3-4 3 2 5-7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 8h.01" />
    </svg>
  ),
  signal: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a3.75 3.75 0 01-1.298.872l-.11.042a3.75 3.75 0 01-2.687 0l-.11-.042a3.75 3.75 0 01-1.298-.872L12 17z" />
    </svg>
  ),
  backtest: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  bot: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  database: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
    </svg>
  ),
  tools: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  rules: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
    </svg>
  ),
  dashboard: (
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h7v7H4V4zm0 9h7v7H4v-7zm9-9h7v4h-7V4zm0 6h7v10h-7V10z" />
    </svg>
  ),
  prep: (
    // A clipboard with a checked line — the routine you work through.
    <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 13l2 2 4-4" />
    </svg>
  ),
}

// Grouped navigation — ordered as the daily trading workflow: read the tape,
// find setups for the watchlist, plan/execute from the playbook, then review.
// Research/validation tools sit last — they're offline work, not daily flow.
const navGroups = [
  {
    label: 'Overview',
    items: [
      { path: '/',      label: 'Dashboard', icon: icons.dashboard, end: true },
    ],
  },
  {
    label: '1 · Market Context',
    items: [
      // Prep comes first because it happens first — the night before / the
      // weekend. Trade Today is the morning-of decision that follows it.
      { path: '/prep',            label: 'Prep',             icon: icons.prep },
      { path: '/situational-awareness', label: 'Trade Today', icon: icons.awareness },
      { path: '/market-monitor',  label: 'Market Monitor',   icon: icons.monitor },
      { path: '/theme-radar',     label: 'Theme Radar',      icon: icons.signal },
    ],
  },
  {
    label: '2 · Find Setups',
    items: [
      { path: '/setups',          label: 'Setups Board',     icon: icons.board },
      { path: '/stage-analysis',  label: 'Stage Analysis',   icon: icons.stages },
      { path: '/ma-reclaim',      label: '200 MA Reclaim',   icon: icons.reclaim },
      { path: '/breakouts',       label: 'Breakouts',        icon: icons.breakouts },
      { path: '/scanner-9m',      label: '$9M Scanner',      icon: icons.ninem },
      { path: '/reversal-setup',  label: 'Reversal Setup',   icon: icons.reversal },
      { path: '/parabolic-short', label: 'Parabolic Short',  icon: icons.parabolic },
      { path: '/breakdown-short', label: 'Breakdown Short',  icon: icons.breakdown },
      { path: '/screener',        label: 'Sector Scan',      icon: icons.sector },
      { path: '/earnings',        label: 'Earnings',         icon: icons.calendar },
      { path: '/news',            label: 'Stock Analysis',   icon: icons.stock },
      { path: '/flow',            label: 'Options Flow',     icon: icons.breakouts },
    ],
  },
  {
    label: '3 · Plan & Execute',
    items: [
      { path: '/rules',       label: 'Rules',       icon: icons.rules },
      { path: '/playbook',    label: 'Playbook',    icon: icons.database },
      { path: '/tools',       label: 'Tools',       icon: icons.tools },
      { path: '/watchlist',   label: 'Watchlist',   icon: icons.watchlist },
      { path: '/ai-trader',   label: 'AI Trader',   icon: icons.signal },
    ],
  },
  {
    label: '4 · Review & Learn',
    items: [
      { path: '/discipline',       label: 'Discipline',       icon: icons.edge },
      { path: '/review',           label: 'Review',           icon: icons.journal },
      { path: '/journal',          label: 'Journal',          icon: icons.journal },
      { path: '/trading-analysis', label: 'Trading Analysis', icon: icons.trading },
      { path: '/flashcards',       label: 'Flashcards',       icon: icons.flashcards },
      { path: '/wealthsimple',     label: 'Wealthsimple',     icon: icons.journal },
      { path: '/yearly-strongest', label: 'Yearly Strongest', icon: icons.trophy },
    ],
  },
  {
    label: 'Research & Validation',
    items: [
      { path: '/edge-validation', label: 'Edge Validation', icon: icons.edge },
      { path: '/factor-model',    label: 'Factor Model',    icon: icons.factor },
      { path: '/backtesting',     label: 'Backtesting',     icon: icons.backtest },
      { path: '/signal-lab',      label: 'Signal Lab',      icon: icons.signal },
      { path: '/bot-trader',      label: 'Bot Trader',      icon: icons.bot },
    ],
  },
]

const flatNavItems = navGroups.flatMap(g => g.items)

const COLLAPSE_KEY = 'qf:sidebar:collapsed'
const ORDER_KEY = 'qf:sidebar:order'
const FAV_KEY = 'qf:sidebar:favorites'

// Star toggle that rides on a nav row. On desktop it stays invisible until the
// row is hovered — unless the page is already a favourite, in which case the
// filled star is a permanent mark, not a hover affordance.
function FavToggle({ active, label, onToggle, mobile = false }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`${active ? 'Remove' : 'Add'} ${label} ${active ? 'from' : 'to'} favorites`}
      aria-pressed={active}
      title={active ? 'Remove from favorites' : 'Add to favorites'}
      className={`absolute top-1/2 -translate-y-1/2 rounded-md flex items-center justify-center transition-opacity ${
        mobile ? 'right-2 w-9 h-9' : 'right-1.5 w-5 h-5'
      } ${
        active
          ? 'text-amber-400 opacity-100'
          : `text-surface-600 hover:text-amber-400 ${mobile ? 'opacity-70' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`
      }`}
    >
      <svg className={mobile ? 'w-4 h-4' : 'w-[13px] h-[13px]'} viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75l2.42 4.9 5.41.79-3.92 3.81.93 5.39L12 16.09l-4.84 2.55.93-5.39-3.92-3.81 5.41-.79L12 3.75z" />
      </svg>
    </button>
  )
}

// Row chrome for a sidebar link. Three states, each with one quiet signal —
// no outlines, because a ring around a single row in a 33-row list reads as an
// error box rather than a bookmark:
//   active    → accent fill + a left rail (the strongest mark in the rail)
//   favourite → raised surface + the brightest label; the gold star does the rest
//   default   → muted label that lifts on hover
function navRowClass({ isActive, fav, collapsed }) {
  const base = `relative flex items-center ${collapsed ? 'justify-center' : 'gap-3 pr-7'} px-3 py-[7px] rounded-lg text-[13px] font-medium transition-colors duration-150`
  if (isActive) {
    const rail = collapsed
      ? ''
      : ' before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-[18px] before:w-[3px] before:rounded-r-full before:bg-accent'
    return `${base} bg-accent/[0.12] text-accent${rail}`
  }
  if (fav) return `${base} bg-surface-800/50 text-surface-50 hover:bg-surface-800/80`
  return `${base} text-surface-400 hover:text-surface-100 hover:bg-surface-800/50`
}

// Apply a saved per-group path order over the default nav groups. Items not in
// the saved order (e.g. a newly-added page) fall back to their default slot, so
// custom orders survive future nav additions.
function applyOrder(order) {
  return navGroups.map(g => {
    const saved = order[g.label]
    if (!saved || !saved.length) return g
    const byPath = new Map(g.items.map(it => [it.path, it]))
    const items = []
    for (const p of saved) if (byPath.has(p)) { items.push(byPath.get(p)); byPath.delete(p) }
    for (const it of g.items) if (byPath.has(it.path)) items.push(it)  // leftovers keep default order
    return { ...g, items }
  })
}

export default function Layout() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0') } catch {}
  }, [collapsed])

  // --- Sidebar item ordering (drag to reorder within a group) --------------
  const [order, setOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem(ORDER_KEY)) || {} } catch { return {} }
  })
  const [editOrder, setEditOrder] = useState(false)
  const [dragItem, setDragItem] = useState(null)   // { group, path }

  useEffect(() => {
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)) } catch {}
  }, [order])

  const orderedGroups = useMemo(() => applyOrder(order), [order])
  const hasCustomOrder = Object.keys(order).length > 0

  // --- Favourites (star a page to emphasise its row) -----------------------
  const [favorites, setFavorites] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem(FAV_KEY)); return Array.isArray(v) ? v : [] } catch { return [] }
  })

  useEffect(() => {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favorites)) } catch {}
  }, [favorites])

  const favSet = useMemo(() => new Set(favorites), [favorites])
  const toggleFavorite = (path) => setFavorites(prev => (
    prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]
  ))

  const dropOnItem = (groupLabel, targetPath) => {
    if (!dragItem || dragItem.group !== groupLabel || dragItem.path === targetPath) { setDragItem(null); return }
    const group = orderedGroups.find(g => g.label === groupLabel)
    const paths = group.items.map(it => it.path)
    const from = paths.indexOf(dragItem.path)
    const to = paths.indexOf(targetPath)
    if (from < 0 || to < 0) { setDragItem(null); return }
    const next = [...paths]
    next.splice(to, 0, next.splice(from, 1)[0])
    setOrder(prev => ({ ...prev, [groupLabel]: next }))
    setDragItem(null)
  }

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') setMobileOpen(false) }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const sidebarWidth = collapsed ? 'lg:w-[64px]' : 'lg:w-[232px]'

  // Ambient "today's rule" — same deterministic pick as the Rules-page hero,
  // so the user sees the same one in both places throughout the session.
  // Recomputed once per mount; rotates at local midnight when the app reloads.
  const dailyRule = useMemo(() => getRuleOfDay(loadRules()), [])

  return (
    // Column on mobile (header stacks above content); row at lg+ where the
    // sidebar is fixed/out-of-flow. Without flex-col on mobile, the w-full
    // header is a flex sibling of <main> in a row and eats the full width,
    // collapsing the content area to 0.
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col fixed inset-y-0 left-0 z-40 ${sidebarWidth} bg-surface-950/95 backdrop-blur-xl border-r border-surface-700/50 transition-[width] duration-200 ease-out`}
      >
        {/* Brand + collapse toggle */}
        <div className={`h-14 flex items-center border-b border-surface-700/40 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
          <NavLink to="/" className="font-display font-bold flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <div className="w-7 h-7 shrink-0 rounded-lg bg-gradient-to-br from-accent to-cyan flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            {!collapsed && <span className="text-surface-50 text-[15px] whitespace-nowrap">QuantForge</span>}
          </NavLink>
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-surface-500 hover:text-surface-200 hover:bg-surface-800/60"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>

        {/* Expand button when collapsed — floats just below brand */}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="mx-2 mt-2 h-8 rounded-md flex items-center justify-center text-surface-500 hover:text-surface-200 hover:bg-surface-800/60"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* Nav groups */}
        <nav className={`flex-1 overflow-y-auto py-4 ${collapsed ? 'px-2' : 'px-2.5'} space-y-5`}>
          {orderedGroups.map(group => (
            <div key={group.label}>
              {!collapsed && (
                <div className="px-3 pb-2 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-surface-600">
                  {group.label}
                </div>
              )}
              {collapsed && <div className="mx-2 mb-2 h-px bg-surface-700/40" />}
              <div className="space-y-[3px]">
                {group.items.map(({ path, label, icon, end }) => (
                  editOrder && !collapsed ? (
                    <div
                      key={path}
                      draggable
                      onDragStart={() => setDragItem({ group: group.label, path })}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => dropOnItem(group.label, path)}
                      onDragEnd={() => setDragItem(null)}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] font-medium cursor-grab active:cursor-grabbing border border-dashed transition-colors ${
                        dragItem?.path === path
                          ? 'border-accent/50 bg-accent/5 opacity-60'
                          : 'border-surface-700/50 text-surface-300 hover:bg-surface-800/60'
                      }`}
                    >
                      <svg className="w-3.5 h-3.5 shrink-0 text-surface-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                        <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                        <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                      </svg>
                      <span className="shrink-0">{icon}</span>
                      <span className="whitespace-nowrap">{label}</span>
                    </div>
                  ) : (
                    <div key={path} className="relative group">
                      <NavLink
                        to={path}
                        end={end}
                        title={collapsed ? label : undefined}
                        className={({ isActive }) => navRowClass({ isActive, fav: favSet.has(path), collapsed })}
                      >
                        <span className="shrink-0">{icon}</span>
                        {!collapsed && <span className="whitespace-nowrap">{label}</span>}
                      </NavLink>
                      {!collapsed ? (
                        <FavToggle active={favSet.has(path)} label={label} onToggle={() => toggleFavorite(path)} />
                      ) : favSet.has(path) && (
                        // No room for the star when collapsed — a gold pip keeps
                        // the favourite legible against the icon-only rail.
                        <span className="pointer-events-none absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden="true" />
                      )}
                    </div>
                  )
                ))}
              </div>
            </div>
          ))}

          {/* Reorder controls (expanded only) */}
          {!collapsed && (
            <div className="pt-1 border-t border-surface-700/30 mt-2">
              <div className="flex items-center gap-2 px-1 pt-2">
                <button
                  onClick={() => setEditOrder(v => !v)}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    editOrder ? 'bg-accent/15 text-accent' : 'text-surface-500 hover:text-surface-200 hover:bg-surface-800/60'
                  }`}
                  title="Drag nav items to reorder them within each section"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16M7 4v4M17 12v8" />
                  </svg>
                  {editOrder ? 'Done' : 'Edit order'}
                </button>
                {editOrder && hasCustomOrder && (
                  <button
                    onClick={() => setOrder({})}
                    className="px-2 py-1 rounded-md text-[11px] font-medium text-surface-500 hover:text-surface-200 hover:bg-surface-800/60"
                    title="Restore the default sidebar order"
                  >
                    Reset
                  </button>
                )}
              </div>
              {editOrder && (
                <div className="px-1 pt-1 text-[10px] text-surface-500 leading-snug">
                  Drag items to reorder within each section.
                </div>
              )}
            </div>
          )}
        </nav>

        {/* Footer: ambient "today's rule" (expanded only) + build stamp.
            Quiet, single-line, low-contrast — it should fade into the
            background until the eye drifts down. Hover reveals full text. */}
        <div className={`border-t border-surface-700/40 px-3 py-2 ${collapsed ? 'text-center' : ''}`}>
          {!collapsed && dailyRule && (
            <NavLink
              to="/rules"
              title={dailyRule.text}
              className="block group mb-1.5"
            >
              <div className="text-[8.5px] font-bold tracking-widest text-surface-600 group-hover:text-surface-400 uppercase">
                Today’s rule
              </div>
              <div className="text-[10.5px] leading-snug text-surface-500 group-hover:text-surface-300 line-clamp-2 transition-colors">
                {dailyRule.text}
              </div>
            </NavLink>
          )}
          <span
            className="inline-block text-[9px] font-mono text-surface-600 px-1.5 py-0.5 rounded bg-surface-800/60 border border-surface-700/40 whitespace-nowrap"
            title="Frontend build timestamp"
          >
            {typeof __BUILD_ID__ !== 'undefined' ? (collapsed ? '●' : __BUILD_ID__) : 'dev'}
          </span>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-50 w-full border-b border-surface-700/50 bg-surface-950/80 backdrop-blur-xl">
        <div className="px-4 sm:px-6 flex items-center justify-between h-14">
          <NavLink to="/" className="font-display font-bold text-lg flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-cyan flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <span className="text-surface-50 whitespace-nowrap">QuantForge</span>
          </NavLink>
          <button
            onClick={() => setMobileOpen(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-surface-300 hover:text-surface-100 hover:bg-surface-800/60"
            aria-label="Open navigation"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </header>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-[60] animate-overlay-in"
          onClick={() => setMobileOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        </div>
      )}

      {/* Mobile bottom drawer (Apple-style sheet) */}
      {mobileOpen && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-[70] animate-drawer-in max-h-[85vh] overflow-y-auto">
          <div className="bg-surface-900 border-t border-surface-700/60 rounded-t-2xl pb-8 pt-3 px-6 shadow-2xl">
            <div className="w-10 h-1 rounded-full bg-surface-600 mx-auto mb-5" />
            {orderedGroups.map(group => (
              <div key={group.label} className="mb-4 last:mb-0">
                <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-surface-500">
                  {group.label}
                </div>
                <nav className="space-y-1">
                  {group.items.map(({ path, label, icon, end }) => (
                    <div key={path} className="relative">
                      <NavLink
                        to={path}
                        end={end}
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center gap-3 px-4 py-3.5 pr-12 rounded-xl text-[15px] font-medium transition-all ${
                            isActive
                              ? 'bg-accent/[0.12] text-accent'
                              : favSet.has(path)
                                ? 'bg-surface-800/60 text-surface-50'
                                : 'text-surface-300 hover:text-surface-100 hover:bg-surface-800/50'
                          }`
                        }
                      >
                        {icon}
                        {label}
                      </NavLink>
                      <FavToggle mobile active={favSet.has(path)} label={label} onToggle={() => toggleFavorite(path)} />
                    </div>
                  ))}
                </nav>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content area — pushed right of fixed sidebar on desktop */}
      <main className={`flex-1 min-w-0 ${collapsed ? 'lg:pl-[64px]' : 'lg:pl-[232px]'} transition-[padding] duration-200 ease-out`}>
        <div className="max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          {/* Suspense scoped to the content panel: the sidebar/header persist
              across navigation; only the page area shows the loader and the
              per-route fade. */}
          <Suspense fallback={<PageLoading />}>
            <div key={location.pathname} className="animate-fade-in">
              <Outlet />
            </div>
          </Suspense>
        </div>
      </main>
    </div>
  )
}
