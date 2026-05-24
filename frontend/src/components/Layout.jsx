import { useState, useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

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
}

// Grouped navigation — mirrors macOS sidebar conventions (Mail/Notes/Music).
// Order within each group is by likely frequency-of-use.
const navGroups = [
  {
    label: 'Analyze',
    items: [
      { path: '/',                label: 'Trading Analysis', icon: icons.trading,   end: true },
      { path: '/news',            label: 'Stock Analysis',   icon: icons.stock },
      { path: '/market-monitor',  label: 'Market Monitor',   icon: icons.monitor },
      { path: '/earnings',        label: 'Earnings',         icon: icons.calendar },
      { path: '/screener',        label: 'Sector Scan',      icon: icons.sector },
      { path: '/breakouts',       label: 'Breakouts',        icon: icons.breakouts },
    ],
  },
  {
    label: 'Trade',
    items: [
      { path: '/watchlist',   label: 'Watchlist',   icon: icons.watchlist },
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

        {/* Build stamp footer */}
        <div className={`border-t border-surface-700/40 px-3 py-2 ${collapsed ? 'text-center' : ''}`}>
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
          <Outlet />
        </div>
      </main>
    </div>
  )
}
