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
}

// Grouped navigation — mirrors macOS sidebar conventions (Mail/Notes/Music).
// Order within each group is by likely frequency-of-use.
const navGroups = [
  {
    label: 'Overview',
    items: [
      { path: '/',      label: 'Dashboard', icon: icons.dashboard, end: true },
    ],
  },
  {
    label: 'Discipline',
    items: [
      { path: '/rules', label: 'Rules',     icon: icons.rules },
    ],
  },
  {
    label: 'Analyze',
    items: [
      { path: '/trading-analysis', label: 'Trading Analysis', icon: icons.trading },
      { path: '/yearly-strongest', label: 'Yearly Strongest', icon: icons.trophy },
      { path: '/wealthsimple',    label: 'Wealthsimple',     icon: icons.journal },
      { path: '/news',            label: 'Stock Analysis',   icon: icons.stock },
      { path: '/market-monitor',  label: 'Market Monitor',   icon: icons.monitor },
      { path: '/theme-radar',     label: 'Theme Radar',      icon: icons.signal },
      { path: '/earnings',        label: 'Earnings',         icon: icons.calendar },
      { path: '/scanner-9m',      label: '$9M Scanner',      icon: icons.ninem },
      { path: '/screener',        label: 'Sector Scan',      icon: icons.sector },
      { path: '/breakouts',       label: 'Breakouts',        icon: icons.breakouts },
      { path: '/flow',            label: 'Options Flow',     icon: icons.breakouts },
    ],
  },
  {
    label: 'Trade',
    items: [
      { path: '/ai-trader',   label: 'AI Trader',   icon: icons.signal },
      { path: '/watchlist',   label: 'Watchlist',   icon: icons.watchlist },
      { path: '/review',      label: 'Review',      icon: icons.journal },
      { path: '/journal',     label: 'Journal',     icon: icons.journal },
      { path: '/signal-lab',  label: 'Signal Lab',  icon: icons.signal },
      { path: '/bot-trader',  label: 'Bot Trader',  icon: icons.bot },
      { path: '/backtesting', label: 'Backtesting', icon: icons.backtest },
    ],
  },
  {
    label: 'Data',
    items: [
      { path: '/playbook', label: 'Database', icon: icons.database },
      { path: '/tools',    label: 'Tools',    icon: icons.tools },
    ],
  },
]

const flatNavItems = navGroups.flatMap(g => g.items)

const COLLAPSE_KEY = 'qf:sidebar:collapsed'

export default function Layout() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0') } catch {}
  }, [collapsed])

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
    <div className="min-h-screen flex">
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
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {navGroups.map(group => (
            <div key={group.label}>
              {!collapsed && (
                <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-surface-500">
                  {group.label}
                </div>
              )}
              {collapsed && <div className="mx-2 mb-1.5 h-px bg-surface-700/40" />}
              <div className="space-y-0.5">
                {group.items.map(({ path, label, icon, end }) => (
                  <NavLink
                    key={path}
                    to={path}
                    end={end}
                    title={collapsed ? label : undefined}
                    className={({ isActive }) =>
                      `flex items-center ${collapsed ? 'justify-center' : 'gap-2.5'} px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 ${
                        isActive
                          ? 'bg-accent/10 text-accent'
                          : 'text-surface-400 hover:text-surface-100 hover:bg-surface-800/60'
                      }`
                    }
                  >
                    <span className="shrink-0">{icon}</span>
                    {!collapsed && <span className="whitespace-nowrap">{label}</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
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
            {navGroups.map(group => (
              <div key={group.label} className="mb-4 last:mb-0">
                <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-surface-500">
                  {group.label}
                </div>
                <nav className="space-y-1">
                  {group.items.map(({ path, label, icon, end }) => (
                    <NavLink
                      key={path}
                      to={path}
                      end={end}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-4 py-3.5 rounded-xl text-[15px] font-medium transition-all ${
                          isActive
                            ? 'bg-accent/10 text-accent'
                            : 'text-surface-300 hover:text-surface-100 hover:bg-surface-800/60'
                        }`
                      }
                    >
                      {icon}
                      {label}
                    </NavLink>
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
