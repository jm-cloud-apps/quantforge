import { lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { ToastProvider } from './components/Toast'

// Route-level code-splitting — each page becomes its own chunk, so the
// initial bundle is just the layout + the page you actually land on. Cuts
// first-paint bundle from ~1.1MB to ~250KB.
const Backtesting     = lazy(() => import('./pages/Backtesting'))
const Screener        = lazy(() => import('./pages/Screener'))
const BotTrader       = lazy(() => import('./pages/BotTrader'))
const TradingAnalysis = lazy(() => import('./pages/TradingAnalysis'))
const Playbook        = lazy(() => import('./pages/Playbook'))
const Journal         = lazy(() => import('./pages/Journal'))
const Tools           = lazy(() => import('./pages/Tools'))
const NewsAnalysis    = lazy(() => import('./pages/NewsAnalysis'))
const Suggestions     = lazy(() => import('./pages/Suggestions'))
const Breakouts       = lazy(() => import('./pages/Breakouts'))
const OptionsFlow     = lazy(() => import('./pages/OptionsFlow'))
const Watchlist       = lazy(() => import('./pages/Watchlist'))
const MarketMonitor   = lazy(() => import('./pages/MarketMonitor'))
const EarningsCalendar = lazy(() => import('./pages/EarningsCalendar'))
const Scanner9M       = lazy(() => import('./pages/Scanner9M'))
const Rules           = lazy(() => import('./pages/Rules'))
const Dashboard       = lazy(() => import('./pages/Dashboard'))

function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-surface-500">
      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    </div>
  )
}

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <div key={location.pathname} className="animate-fade-in">
      <Suspense fallback={<RouteFallback />}>
        <Routes location={location}>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="rules" element={<Rules />} />
            <Route path="backtesting" element={<Backtesting />} />
            <Route path="screener" element={<Screener />} />
            <Route path="breakouts" element={<Breakouts />} />
            <Route path="flow" element={<OptionsFlow />} />
            <Route path="flow/:underlying" element={<OptionsFlow />} />
            <Route path="bot-trader" element={<BotTrader />} />
            <Route path="trading-analysis" element={<TradingAnalysis />} />
            <Route path="playbook" element={<Playbook />} />
            <Route path="journal" element={<Journal />} />
            <Route path="tools" element={<Tools />} />
            <Route path="news" element={<NewsAnalysis />} />
            <Route path="watchlist" element={<Watchlist />} />
            <Route path="signal-lab" element={<Suggestions />} />
            <Route path="market-monitor" element={<MarketMonitor />} />
            <Route path="earnings" element={<EarningsCalendar />} />
            <Route path="scanner-9m" element={<Scanner9M />} />
          </Route>
        </Routes>
      </Suspense>
    </div>
  )
}

function App() {
  return (
    <ToastProvider>
      <AnimatedRoutes />
    </ToastProvider>
  )
}

export default App
