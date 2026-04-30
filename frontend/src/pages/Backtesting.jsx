import { useState, useEffect } from 'react'
import { fetchStrategies, runBacktest, runMultiBacktest, runBreakoutBacktest } from '../api/backtest'
import EquityChart from '../components/EquityChart'
import PerformanceMetrics from '../components/PerformanceMetrics'
import TradeStats from '../components/TradeStats'
import TradeList from '../components/TradeList'

const INPUT_STYLE = 'w-full rounded-lg bg-surface-800 border border-surface-600/40 px-4 py-2.5 text-sm text-surface-100 placeholder-surface-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 transition-colors'

export default function Backtesting() {
  const [mode, setMode] = useState('breakout')
  const [strategies, setStrategies] = useState({})
  const [strategyId, setStrategyId] = useState('sma_crossover')
  const [params, setParams] = useState({})
  const [symbols, setSymbols] = useState('AAPL,MSFT,GOOGL')
  const [holdings, setHoldings] = useState([{ symbol: 'AAPL', allocation_pct: 100 }])
  const [startDate, setStartDate] = useState('2022-01-01')
  const [endDate, setEndDate] = useState('2024-01-01')
  const [initialCapital, setInitialCapital] = useState(100000)
  const [riskPct, setRiskPct] = useState(1)
  const [maxPositionPct, setMaxPositionPct] = useState(25)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [multiResult, setMultiResult] = useState(null)
  const [breakoutResult, setBreakoutResult] = useState(null)
  const [selectedSymbol, setSelectedSymbol] = useState(null)

  useEffect(() => {
    fetchStrategies()
      .then(setStrategies)
      .catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    const s = strategies[strategyId]
    if (s?.params) {
      const defaults = {}
      s.params.forEach((p) => (defaults[p.key] = p.default))
      setParams(defaults)
    } else {
      setParams({})
    }
  }, [strategyId, strategies])

  const handleRun = async () => {
    setError(null)
    setResult(null)
    setMultiResult(null)
    setBreakoutResult(null)
    setSelectedSymbol(null)
    setLoading(true)

    try {
      if (mode === 'breakout') {
        const valid = holdings.filter((h) => h.symbol?.trim())
        if (!valid.length) {
          setError('Add at least one ticker with allocation')
          setLoading(false)
          return
        }
        const total = valid.reduce((s, h) => s + (parseFloat(h.allocation_pct) || 0), 0)
        if (Math.abs(total - 100) > 0.1) {
          setError('Allocation percentages must sum to 100')
          setLoading(false)
          return
        }
        const res = await runBreakoutBacktest({
          holdings: valid.map((h) => ({
            symbol: h.symbol.trim().toUpperCase(),
            allocation_pct: parseFloat(h.allocation_pct) || 0,
          })),
          start_date: startDate,
          end_date: endDate,
          initial_capital: initialCapital,
          risk_pct: riskPct,
          max_position_pct: maxPositionPct,
        })
        setBreakoutResult(res)
      } else {
        const symbolList = symbols.split(/[\s,]+/).filter(Boolean)
        if (symbolList.length === 0) {
          setError('Enter at least one stock symbol')
          setLoading(false)
          return
        }
        if (symbolList.length === 1) {
          const res = await runBacktest({
            symbol: symbolList[0],
            strategy_id: strategyId,
            start_date: startDate,
            end_date: endDate,
            initial_capital: initialCapital,
            params,
          })
          setResult(res)
        } else {
          const res = await runMultiBacktest({
            symbols: symbolList,
            strategy_id: strategyId,
            start_date: startDate,
            end_date: endDate,
            initial_capital: initialCapital,
            params,
          })
          setMultiResult(res)
          if (res.results?.length) {
            const first = res.results.find((r) => !r.error)
            if (first) setSelectedSymbol(first.symbol)
          }
        }
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const addHolding = () => setHoldings([...holdings, { symbol: '', allocation_pct: 0 }])
  const removeHolding = (i) => setHoldings(holdings.filter((_, idx) => idx !== i))
  const updateHolding = (i, field, value) => {
    const next = [...holdings]
    next[i] = { ...next[i], [field]: value }
    setHoldings(next)
  }

  const displayResult =
    breakoutResult ||
    result ||
    (multiResult && selectedSymbol
      ? multiResult.results.find((r) => r.symbol === selectedSymbol && !r.error)
      : multiResult?.results?.[0])

  const selectedResult = displayResult && !displayResult.error ? displayResult : null

  const currentStrategy = strategies[strategyId]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display font-semibold text-3xl text-surface-50 tracking-tight">
          Backtesting
        </h1>
        <p className="text-surface-400 text-sm mt-1">
          Run strategy scenarios on specific stocks and analyze performance.
        </p>
      </div>

      {/* Stock Input */}
      <div className="rounded-[16px] bg-surface-900 border border-accent/25 p-5">
        <h2 className="text-base font-semibold text-surface-100 mb-3">Enter Stock Ticker</h2>
        {mode === 'breakout' ? (
          <div className="space-y-3">
            {holdings.map((h, i) => (
              <div key={i} className="flex gap-3 items-center flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <input
                    type="text"
                    value={h.symbol}
                    onChange={(e) => updateHolding(i, 'symbol', e.target.value)}
                    placeholder="e.g. AAPL, MSFT, TSLA"
                    className={`${INPUT_STYLE} text-[16px] py-3`}
                  />
                </div>
                <div className="w-20">
                  <input
                    type="number"
                    value={h.allocation_pct}
                    onChange={(e) => updateHolding(i, 'allocation_pct', e.target.value)}
                    placeholder="100"
                    min={0}
                    max={100}
                    className={INPUT_STYLE}
                  />
                </div>
                <span className="text-surface-400 text-sm">%</span>
                {holdings.length > 1 && (
                  <button type="button" onClick={() => removeHolding(i)} className="text-danger text-sm hover:underline">
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={addHolding} className="text-accent text-sm font-medium hover:underline">
              + Add another ticker
            </button>
            <p className="text-[11px] text-surface-500">Allocation % must sum to 100</p>
          </div>
        ) : (
          <input
            type="text"
            value={symbols}
            onChange={(e) => setSymbols(e.target.value)}
            placeholder="e.g. AAPL, MSFT, GOOGL (comma-separated)"
            className={`${INPUT_STYLE} text-[16px] py-3`}
          />
        )}
      </div>

      {/* Mode Segmented Control */}
      <div className="inline-flex rounded-lg bg-surface-800/80 p-[3px]">
        <button
          onClick={() => setMode('breakout')}
          className={`px-4 py-[5px] rounded-md text-sm font-medium transition-all duration-200 ${
            mode === 'breakout'
              ? 'bg-surface-700 text-surface-50 shadow-sm'
              : 'text-surface-400 hover:text-surface-300'
          }`}
        >
          Breakout Strategy
        </button>
        <button
          onClick={() => setMode('indicators')}
          className={`px-4 py-[5px] rounded-md text-sm font-medium transition-all duration-200 ${
            mode === 'indicators'
              ? 'bg-surface-700 text-surface-50 shadow-sm'
              : 'text-surface-400 hover:text-surface-300'
          }`}
        >
          Indicator Strategies
        </button>
      </div>

      {/* Breakout Strategy Form */}
      {mode === 'breakout' && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-5 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-surface-100">Previous Day Breakout Settings</h2>
            <p className="text-sm text-surface-400 mt-1">
              Buy when price closes above previous day high. Sell when price closes below previous day low.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Initial Capital ($)</label>
              <input type="number" value={initialCapital} onChange={(e) => setInitialCapital(Number(e.target.value) || 100000)} min={1000} step={10000} className={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Risk per trade %</label>
              <input type="number" value={riskPct} onChange={(e) => setRiskPct(parseFloat(e.target.value) || 1)} min={0.1} max={10} step={0.5} className={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Max position %</label>
              <input type="number" value={maxPositionPct} onChange={(e) => setMaxPositionPct(parseFloat(e.target.value) || 25)} min={5} max={100} step={5} className={INPUT_STYLE} />
            </div>
          </div>

          {error && (
            <div className="rounded-[10px] bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleRun}
            disabled={loading}
            className="px-5 py-2.5 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 hover:text-surface-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Running...' : 'Run Backtest'}
          </button>
        </div>
      )}

      {/* Indicator Strategy Form */}
      {mode === 'indicators' && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-5 space-y-5">
          <h2 className="text-base font-semibold text-surface-100">Strategy Configuration</h2>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Strategy</label>
              <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)} className={INPUT_STYLE}>
                {Object.entries(strategies).map(([id, s]) => (
                  <option key={id} value={id}>{s.name}</option>
                ))}
              </select>
              {currentStrategy?.description && (
                <p className="text-[11px] text-surface-500 mt-1">{currentStrategy.description}</p>
              )}
            </div>

            {currentStrategy?.params?.map((p) => (
              <div key={p.key}>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">{p.label}</label>
                <input
                  type="number"
                  value={params[p.key] ?? p.default}
                  onChange={(e) => setParams({ ...params, [p.key]: parseFloat(e.target.value) || p.default })}
                  className={INPUT_STYLE}
                />
              </div>
            ))}
          </div>

          <p className="text-sm text-surface-400">Dates and capital:</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Initial Capital ($)</label>
              <input type="number" value={initialCapital} onChange={(e) => setInitialCapital(Number(e.target.value) || 100000)} min={1000} step={10000} className={INPUT_STYLE} />
            </div>
          </div>

          <button
            onClick={handleRun}
            disabled={loading}
            className="px-5 py-2.5 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 hover:text-surface-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Running...' : 'Run Backtest'}
          </button>

          {error && (
            <div className="rounded-[10px] bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Multi-symbol selector */}
      {mode === 'indicators' && multiResult?.results?.length > 1 && (
        <div className="inline-flex flex-wrap gap-1 rounded-lg bg-surface-800/80 p-[3px]">
          {multiResult.results
            .filter((r) => !r.error)
            .map((r) => (
              <button
                key={r.symbol}
                onClick={() => setSelectedSymbol(r.symbol)}
                className={`px-3 py-[5px] rounded-md text-sm font-medium transition-all duration-200 ${
                  selectedSymbol === r.symbol
                    ? 'bg-surface-700 text-surface-50 shadow-sm'
                    : 'text-surface-400 hover:text-surface-300'
                }`}
              >
                {r.symbol} ({r.total_return_pct >= 0 ? '+' : ''}{r.total_return_pct}%)
              </button>
            ))}
        </div>
      )}

      {/* Results */}
      {selectedResult && (
        <div className="space-y-4">
          <h2 className="text-[17px] font-semibold text-surface-100 tracking-tight">
            Results {selectedResult.symbol && `-- ${selectedResult.symbol}`}
          </h2>

          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-5">
            <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-4">
              Equity Curve
            </h3>
            <EquityChart
              data={selectedResult.equity_curve}
              initialCapital={selectedResult.initial_capital}
            />
          </div>

          <PerformanceMetrics result={selectedResult} />
          <TradeStats result={selectedResult} />
          <TradeList trades={selectedResult.trades} />
        </div>
      )}

      {/* Breakout per-symbol breakdown */}
      {breakoutResult?.results?.length > 1 && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-700/30">
            <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
              Per-Symbol Breakdown
            </h3>
          </div>
          <div className="p-4 flex flex-wrap gap-2">
            {breakoutResult.results.map((r) => (
              <div
                key={r.symbol}
                className="px-4 py-2.5 rounded-lg bg-surface-900/60 border border-surface-700/30 text-sm"
              >
                <span className="font-medium text-surface-200">{r.symbol}</span>
                <span className="text-surface-500 ml-2">({r.allocation_pct}%)</span>
                <span className={`ml-2 font-semibold ${r.total_return_pct >= 0 ? 'text-success' : 'text-danger'}`}>
                  {r.total_return_pct >= 0 ? '+' : ''}{r.total_return_pct}%
                </span>
                <span className="text-surface-500 ml-1">-- {r.total_trades} trades</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Multi aggregate summary */}
      {multiResult?.aggregate && multiResult.results?.length > 1 && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 overflow-hidden">
          <div className="px-5 py-3 border-b border-surface-700/30">
            <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
              Aggregate Summary
            </h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-surface-700/20">
            <div className="bg-surface-900 p-4">
              <p className="text-[11px] text-surface-500 mb-1">Symbols Run</p>
              <p className="text-[20px] font-semibold text-surface-100 tracking-tight">{multiResult.aggregate.symbols_run}</p>
            </div>
            <div className="bg-surface-900 p-4">
              <p className="text-[11px] text-surface-500 mb-1">Successful</p>
              <p className="text-[20px] font-semibold text-success tracking-tight">{multiResult.aggregate.successful}</p>
            </div>
            <div className="bg-surface-900 p-4">
              <p className="text-[11px] text-surface-500 mb-1">Avg Return</p>
              <p className="text-[20px] font-semibold text-surface-100 tracking-tight">{multiResult.aggregate.avg_return_pct}%</p>
            </div>
            <div className="bg-surface-900 p-4">
              <p className="text-[11px] text-surface-500 mb-1">Total Trades</p>
              <p className="text-[20px] font-semibold text-surface-100 tracking-tight">{multiResult.aggregate.total_trades}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
