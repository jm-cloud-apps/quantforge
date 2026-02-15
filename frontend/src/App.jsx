import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Backtesting from './pages/Backtesting'
import Screener from './pages/Screener'
import BotTrader from './pages/BotTrader'
import TradingAnalysis from './pages/TradingAnalysis'
import Playbook from './pages/Playbook'
import Journal from './pages/Journal'
import Tools from './pages/Tools'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<TradingAnalysis />} />
        <Route path="backtesting" element={<Backtesting />} />
        <Route path="screener" element={<Screener />} />
        <Route path="bot-trader" element={<BotTrader />} />
        <Route path="trading-analysis" element={<TradingAnalysis />} />
        <Route path="playbook" element={<Playbook />} />
        <Route path="journal" element={<Journal />} />
        <Route path="tools" element={<Tools />} />
      </Route>
    </Routes>
  )
}

export default App
