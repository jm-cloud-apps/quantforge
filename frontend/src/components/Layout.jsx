import { NavLink, Outlet } from 'react-router-dom'

const navItems = [
  { path: '/', label: 'Trading Analysis' },
  { path: '/backtesting', label: 'Backtesting' },
  { path: '/screener', label: 'Sector Scan' },
  { path: '/bot-trader', label: 'Bot Trader' },
  { path: '/playbook', label: 'Database' },
  { path: '/tools', label: 'Tools' },
]

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 border-b border-surface-700/50 bg-surface-950/80 backdrop-blur-xl">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <NavLink
              to="/"
              className="font-display font-bold text-lg flex items-center gap-2.5 hover:opacity-80 transition-opacity"
            >
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-cyan flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <span className="text-surface-50">QuantForge</span>
            </NavLink>

            <nav className="flex items-center gap-1">
              {navItems.map(({ path, label, badge }) => (
                <NavLink
                  key={path}
                  to={path}
                  end={path === '/'}
                  className={({ isActive }) =>
                    `px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                      isActive
                        ? 'bg-accent/10 text-accent border border-accent/20'
                        : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/60'
                    }`
                  }
                >
                  {label}
                  {badge && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700/60 text-surface-500 font-mono">
                      {badge}
                    </span>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  )
}
