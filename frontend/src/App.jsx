import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Backtesting from './pages/Backtesting'
import Screener from './pages/Screener'
import BotTrader from './pages/BotTrader'
import TradingAnalysis from './pages/TradingAnalysis'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Backtesting />} />
        <Route path="backtesting" element={<Backtesting />} />
        <Route path="screener" element={<Screener />} />
        <Route path="bot-trader" element={<BotTrader />} />
        <Route path="trading-analysis" element={<TradingAnalysis />} />
      </Route>
    </Routes>
  )
}

export default App
