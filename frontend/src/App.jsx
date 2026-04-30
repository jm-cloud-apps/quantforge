import { Routes, Route, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { ToastProvider } from './components/Toast'
import Backtesting from './pages/Backtesting'
import Screener from './pages/Screener'
import BotTrader from './pages/BotTrader'
import TradingAnalysis from './pages/TradingAnalysis'
import Playbook from './pages/Playbook'
import Journal from './pages/Journal'
import Tools from './pages/Tools'
import NewsAnalysis from './pages/NewsAnalysis'
import Suggestions from './pages/Suggestions'

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <div key={location.pathname} className="animate-fade-in">
      <Routes location={location}>
        <Route path="/" element={<Layout />}>
          <Route index element={<TradingAnalysis />} />
          <Route path="backtesting" element={<Backtesting />} />
          <Route path="screener" element={<Screener />} />
          <Route path="bot-trader" element={<BotTrader />} />
          <Route path="trading-analysis" element={<TradingAnalysis />} />
          <Route path="playbook" element={<Playbook />} />
          <Route path="journal" element={<Journal />} />
          <Route path="tools" element={<Tools />} />
          <Route path="news" element={<NewsAnalysis />} />
          <Route path="signal-lab" element={<Suggestions />} />
        </Route>
      </Routes>
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
