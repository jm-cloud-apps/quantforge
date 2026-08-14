import { lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import { ToastProvider } from './components/Toast'
import { AutoRefreshProvider } from './autorefresh/AutoRefreshProvider'

// Route-level code-splitting — each page becomes its own chunk, so the
// initial bundle is just the layout + the page you actually land on. Cuts
// first-paint bundle from ~1.1MB to ~250KB.
const Backtesting     = lazy(() => import('./pages/Backtesting'))
const Screener        = lazy(() => import('./pages/Screener'))
const BotTrader       = lazy(() => import('./pages/BotTrader'))
const TradingAnalysis = lazy(() => import('./pages/TradingAnalysis'))
const Flashcards      = lazy(() => import('./pages/Flashcards'))
const YearlyStrongest = lazy(() => import('./pages/YearlyStrongest'))
const Wealthsimple    = lazy(() => import('./pages/Wealthsimple'))
const Playbook        = lazy(() => import('./pages/Playbook'))
const Journal         = lazy(() => import('./pages/Journal'))
const Tools           = lazy(() => import('./pages/Tools'))
const NewsAnalysis    = lazy(() => import('./pages/NewsAnalysis'))
const Suggestions     = lazy(() => import('./pages/Suggestions'))
const Breakouts       = lazy(() => import('./pages/Breakouts'))
const OptionsFlow     = lazy(() => import('./pages/OptionsFlow'))
const Watchlist       = lazy(() => import('./pages/Watchlist'))
const MarketMonitor   = lazy(() => import('./pages/MarketMonitor'))
const SituationalAwareness = lazy(() => import('./pages/SituationalAwareness'))
const Prep            = lazy(() => import('./pages/Prep'))
const EarningsCalendar = lazy(() => import('./pages/EarningsCalendar'))
const Scanner9M       = lazy(() => import('./pages/Scanner9M'))
const Rules           = lazy(() => import('./pages/Rules'))
const Dashboard       = lazy(() => import('./pages/Dashboard'))
const Review          = lazy(() => import('./pages/Review'))
const AITrader        = lazy(() => import('./pages/AITrader'))
const ThemeRadar      = lazy(() => import('./pages/ThemeRadar'))
const ReversalSetup   = lazy(() => import('./pages/ReversalSetup'))
const ParabolicShort  = lazy(() => import('./pages/ParabolicShort'))
const BreakdownShort  = lazy(() => import('./pages/BreakdownShort'))
const StageAnalysis   = lazy(() => import('./pages/StageAnalysis'))
const MAReclaim       = lazy(() => import('./pages/MAReclaim'))
const SetupsBoard     = lazy(() => import('./pages/SetupsBoard'))
const FactorModel     = lazy(() => import('./pages/FactorModel'))
const EdgeValidation  = lazy(() => import('./pages/EdgeValidation'))
const Discipline      = lazy(() => import('./pages/Discipline'))
const RiskManagement  = lazy(() => import('./pages/RiskManagement'))
const MissedBook      = lazy(() => import('./pages/MissedBook'))

// Note: the Suspense boundary for lazy page chunks lives INSIDE Layout (around
// the <Outlet>), so the sidebar/header stay mounted and only the content area
// shows a loader while a page chunk loads. The per-route fade is also scoped to
// the content there. Keeping it here would blank the whole screen on every nav.
function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="rules" element={<Rules />} />
        <Route path="backtesting" element={<Backtesting />} />
        <Route path="screener" element={<Screener />} />
        <Route path="breakouts" element={<Breakouts />} />
        <Route path="flow" element={<OptionsFlow />} />
        <Route path="flow/:underlying" element={<OptionsFlow />} />
        <Route path="ai-trader" element={<AITrader />} />
        <Route path="theme-radar" element={<ThemeRadar />} />
        <Route path="bot-trader" element={<BotTrader />} />
        <Route path="trading-analysis" element={<TradingAnalysis />} />
        <Route path="risk" element={<RiskManagement />} />
        <Route path="flashcards" element={<Flashcards />} />
        <Route path="yearly-strongest" element={<YearlyStrongest />} />
        <Route path="wealthsimple" element={<Wealthsimple />} />
        <Route path="review" element={<Review />} />
        <Route path="discipline" element={<Discipline />} />
        <Route path="playbook" element={<Playbook />} />
        <Route path="missed" element={<MissedBook />} />
        <Route path="journal" element={<Journal />} />
        <Route path="tools" element={<Tools />} />
        <Route path="news" element={<NewsAnalysis />} />
        <Route path="watchlist" element={<Watchlist />} />
        <Route path="signal-lab" element={<Suggestions />} />
        <Route path="market-monitor" element={<MarketMonitor />} />
        <Route path="situational-awareness" element={<SituationalAwareness />} />
        <Route path="prep" element={<Prep />} />
        <Route path="earnings" element={<EarningsCalendar />} />
        <Route path="scanner-9m" element={<Scanner9M />} />
        <Route path="reversal-setup" element={<ReversalSetup />} />
        <Route path="parabolic-short" element={<ParabolicShort />} />
        <Route path="breakdown-short" element={<BreakdownShort />} />
        <Route path="stage-analysis" element={<StageAnalysis />} />
        <Route path="ma-reclaim" element={<MAReclaim />} />
        <Route path="setups" element={<SetupsBoard />} />
        <Route path="factor-model" element={<FactorModel />} />
        <Route path="edge-validation" element={<EdgeValidation />} />
      </Route>
    </Routes>
  )
}

function App() {
  return (
    <ToastProvider>
      <AutoRefreshProvider>
        <AppRoutes />
      </AutoRefreshProvider>
    </ToastProvider>
  )
}

export default App
