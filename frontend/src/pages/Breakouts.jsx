import { useEffect, useState } from 'react'
import { getBreakouts, getRecentDeveloping } from '../api/breakoutScreener'
import ChartCard from '../components/screener/ChartCard'

const MODES = [
  { id: 'breakout', label: 'Breakout', hint: 'Setting up at the pivot' },
  { id: 'emerging', label: 'On The Come Up', hint: 'Thrust done, base just starting' },
  { id: 'leaders',  label: 'Leaders',  hint: 'Top-percentile trailing returns' },
]

const Breakouts = () => {
  const [mode, setMode] = useState('breakout')
  const [minAdr, setMinAdr] = useState(0.05)
  const [includeMovers, setIncludeMovers] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [history, setHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)

  const load = async (modeArg = mode, adrArg = minAdr, moversArg = includeMovers) => {
    setLoading(true)
    setError(null)
    try {
      const res = await getBreakouts({
        mode: modeArg, limit: 24, minAdr: adrArg, includeMovers: moversArg,
      })
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const loadHistory = async () => {
    try {
      const res = await getRecentDeveloping(30)
      setHistory(res.results || [])
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => { load() ; loadHistory() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleModeChange = (m) => {
    setMode(m)
    load(m, minAdr, includeMovers)
  }

  const handleAdrChange = (v) => {
    setMinAdr(v)
  }

  const handleAdrCommit = () => {
    load(mode, minAdr, includeMovers)
  }

  const handleMoversToggle = () => {
    const next = !includeMovers
    setIncludeMovers(next)
    load(mode, minAdr, next)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-[28px] text-surface-50 tracking-tight mb-1">
            Ranked Chart Wall
          </h1>
          <p className="text-surface-400 text-sm">
            {MODES.find((m) => m.id === mode)?.hint} • ADR ≥ {(minAdr * 100).toFixed(1)}%
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              showHistory
                ? 'bg-accent/10 border-accent/40 text-accent'
                : 'bg-surface-800 border-surface-600/50 text-surface-200 hover:bg-surface-700'
            }`}
          >
            Last 30 Days ({history.length})
          </button>
          <button
            onClick={() => load()}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 transition-colors disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Mode tabs + ADR filter */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-1 flex">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => handleModeChange(m.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                mode === m.id ? 'bg-accent text-white' : 'text-surface-400 hover:text-surface-200'
              }`}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-xl bg-surface-900/80 border border-surface-700/50 px-4 py-1.5">
          <span className="text-xs text-surface-400 uppercase tracking-wider">Min ADR</span>
          <input
            type="range"
            min="0" max="0.15" step="0.005"
            value={minAdr}
            onChange={(e) => handleAdrChange(parseFloat(e.target.value))}
            onMouseUp={handleAdrCommit}
            onTouchEnd={handleAdrCommit}
            className="w-32 accent-accent"
          />
          <span className="text-xs font-mono text-surface-200 w-12 text-right">
            {(minAdr * 100).toFixed(1)}%
          </span>
        </div>

        <button
          onClick={handleMoversToggle}
          className={`px-4 py-1.5 rounded-xl border text-sm font-medium transition-colors ${
            includeMovers
              ? 'bg-accent/10 border-accent/40 text-accent'
              : 'bg-surface-900/80 border-surface-700/50 text-surface-300 hover:text-surface-100'
          }`}
          title="Merge today's top gainers into the universe"
        >
          {includeMovers ? '✓ Including today\'s movers' : '+ Include today\'s movers'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-3">
          <p className="text-danger text-sm">{error}</p>
        </div>
      )}

      {data && (
        <div className="text-xs text-surface-500 flex items-center gap-4 flex-wrap">
          <span>{data.results?.length} of {data.scored} ranked</span>
          <span>Universe: {data.universe_size}</span>
          <span>As of {new Date(data.as_of).toLocaleString()}</span>
          <span>({data.elapsed_seconds}s)</span>
        </div>
      )}

      {/* History panel (collapsible) */}
      {showHistory && (
        <div className="rounded-xl bg-surface-900/40 border border-surface-700/40 p-4">
          <h3 className="text-sm font-medium text-surface-200 mb-3">
            Recent Developing Setups (last 30 days)
          </h3>
          {history.length === 0 ? (
            <p className="text-xs text-surface-500">No snapshots yet — run the screener a few times to build history.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
              {history.map((h) => (
                <div
                  key={h.symbol}
                  className="rounded-lg bg-surface-800/60 border border-surface-700/40 px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-surface-100">{h.symbol}</span>
                    <span className="font-mono text-success">{h.score?.toFixed(0)}</span>
                  </div>
                  <div className="text-[10px] text-surface-500 mt-0.5">
                    {h.status} · {h.last_seen_date}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && !data && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-surface-900/40 border border-surface-700/30 p-3 h-[380px] animate-pulse" />
          ))}
        </div>
      )}

      {data?.results?.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.results.map((c, i) => (
            <ChartCard key={c.symbol} candidate={c} rank={i + 1} />
          ))}
        </div>
      )}

      {data && (!data.results || data.results.length === 0) && !loading && (
        <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-12 text-center">
          <p className="text-surface-400 text-sm">
            No candidates passed the filters. Try lowering Min ADR or switching mode.
          </p>
        </div>
      )}
    </div>
  )
}

export default Breakouts
