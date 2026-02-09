import { useState, useEffect, useRef } from 'react'
import { getSectorPerformance, getFetchProgress } from '../api/screener'

export default function Screener() {
  const [sectorData, setSectorData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedTimeframe, setSelectedTimeframe] = useState('1D')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [hoveredSector, setHoveredSector] = useState(null)
  const [isDemoData, setIsDemoData] = useState(false)
  const [demoNote, setDemoNote] = useState(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [fromCache, setFromCache] = useState(false)
  const [progress, setProgress] = useState(null)
  const gridRef = useRef(null)
  const progressInterval = useRef(null)

  const timeframes = [
    { value: '1D', label: '1 Day' },
    { value: '5D', label: '5 Days' },
    { value: '1M', label: '1 Month' },
    { value: '3M', label: '3 Months' },
    { value: 'YTD', label: 'YTD' },
    { value: '1Y', label: '1 Year' },
  ]

  useEffect(() => {
    fetchSectorData()
    const interval = setInterval(fetchSectorData, 2 * 60 * 60 * 1000) // 2 hours
    return () => {
      clearInterval(interval)
      if (progressInterval.current) clearInterval(progressInterval.current)
    }
  }, [])

  const startProgressPolling = () => {
    if (progressInterval.current) clearInterval(progressInterval.current)
    progressInterval.current = setInterval(async () => {
      try {
        const prog = await getFetchProgress()
        if (prog) {
          setProgress(prog)
          if (!prog.loading) {
            clearInterval(progressInterval.current)
            progressInterval.current = null
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 500)
  }

  const fetchSectorData = async () => {
    try {
      setError(null)
      // Check if we have valid cache BEFORE the async fetch so we can start progress polling during the fetch
      let cacheValid = false
      try {
        const cached = localStorage.getItem('sector_performance_cache')
        if (cached) {
          const { timestamp } = JSON.parse(cached)
          cacheValid = Date.now() - timestamp < 2 * 60 * 60 * 1000
        }
      } catch { /* ignore */ }
      if (!cacheValid) startProgressPolling()

      const data = await getSectorPerformance()
      setSectorData(data.sectors)
      setLastUpdated(new Date(data.last_updated))
      setIsDemoData(data.is_demo || false)
      setDemoNote(data.note || null)
      setFromCache(data.from_cache || false)
      setLoading(false)
      setProgress(null)
      if (progressInterval.current) {
        clearInterval(progressInterval.current)
        progressInterval.current = null
      }
    } catch (err) {
      setError(err.message)
      setLoading(false)
      setProgress(null)
    }
  }

  // Heat map colors with more depth
  const getColor = (returnPct) => {
    if (returnPct === undefined || returnPct === null) return 'bg-surface-800'
    if (returnPct <= -3) return 'bg-[#EF4444]/30 border-[#EF4444]/40'
    if (returnPct <= -1.5) return 'bg-[#EF4444]/20 border-[#EF4444]/25'
    if (returnPct <= -0.5) return 'bg-[#EF4444]/12 border-[#EF4444]/15'
    if (returnPct < 0) return 'bg-[#EF4444]/6 border-surface-700/50'
    if (returnPct === 0) return 'bg-surface-800/80 border-surface-700/50'
    if (returnPct < 0.5) return 'bg-[#10B981]/6 border-surface-700/50'
    if (returnPct < 1.5) return 'bg-[#10B981]/12 border-[#10B981]/15'
    if (returnPct < 3) return 'bg-[#10B981]/20 border-[#10B981]/25'
    return 'bg-[#10B981]/30 border-[#10B981]/40'
  }

  const getReturnColor = (returnPct) => {
    if (returnPct === undefined || returnPct === null) return 'text-surface-400'
    if (returnPct > 0) return 'text-success'
    if (returnPct < 0) return 'text-danger'
    return 'text-surface-400'
  }

  const handleMouseEnter = (sector, e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const gridRect = gridRef.current?.getBoundingClientRect()
    if (!gridRect) return

    let x = rect.left - gridRect.left
    let y = rect.bottom - gridRect.top + 8
    const above = rect.bottom + 260 > window.innerHeight

    if (above) {
      y = rect.top - gridRect.top - 8
    }
    if (x + 300 > gridRect.width) {
      x = gridRect.width - 300
    }
    if (x < 0) x = 0

    setTooltipPos({ x, y, above })
    setHoveredSector(sector)
  }

  const sortedSectors = [...sectorData].sort((a, b) => {
    const aReturn = a.returns[selectedTimeframe] || 0
    const bReturn = b.returns[selectedTimeframe] || 0
    return bReturn - aReturn
  })

  const progressPct = progress?.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display font-bold text-3xl text-surface-50">
            Sector Scan
          </h1>
          <p className="text-surface-400 text-sm mt-1">
            Real-time performance across sectors and industry ETFs
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-surface-500">
              {fromCache && 'Cached -- '}
              {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => {
              localStorage.removeItem('sector_performance_cache')
              setLoading(true)
              fetchSectorData()
            }}
            disabled={loading && !sectorData.length}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-muted text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading && !sectorData.length ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-danger/10 border border-danger/30 px-4 py-3">
          <p className="text-danger text-sm">{error}</p>
        </div>
      )}

      {/* Demo Data Notice */}
      {isDemoData && !loading && (
        <div className="rounded-xl bg-warning/10 border border-warning/30 px-4 py-3">
          <p className="text-warning text-sm font-medium">
            Showing demo data -- {demoNote || 'Yahoo Finance is temporarily unavailable. Refresh later for live data.'}
          </p>
        </div>
      )}

      {/* Timeframe Tabs */}
      <div className="flex gap-2 p-1 rounded-lg bg-surface-900/60 border border-surface-700/50 w-fit">
        {timeframes.map((tf) => (
          <button
            key={tf.value}
            onClick={() => setSelectedTimeframe(tf.value)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
              selectedTimeframe === tf.value
                ? 'bg-accent/15 text-accent border border-accent/25'
                : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/60'
            }`}
          >
            {tf.label}
          </button>
        ))}
      </div>

      {/* Loading State with Progress */}
      {loading && !sectorData.length && (
        <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 backdrop-blur-sm p-8">
          <div className="max-w-md mx-auto">
            {/* Progress Bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-surface-300 font-medium">Loading sector data...</span>
                <span className="text-sm text-surface-400 font-mono">{progressPct}%</span>
              </div>
              <div className="w-full h-2 bg-surface-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(progressPct, 2)}%` }}
                />
              </div>
            </div>

            {/* Current Ticker */}
            {progress?.current_ticker && (
              <div className="flex items-center justify-center gap-2 text-sm">
                <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                <span className="text-surface-400">
                  Fetching <span className="text-surface-200 font-mono font-medium">{progress.current_ticker}</span>
                  <span className="text-surface-500"> -- {progress.current_name}</span>
                </span>
                <span className="text-surface-500 font-mono text-xs">
                  ({progress.current}/{progress.total})
                </span>
              </div>
            )}

            {!progress?.current_ticker && (
              <div className="flex items-center justify-center gap-2 text-sm text-surface-400">
                <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                Connecting to Yahoo Finance...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Heat Map */}
      {!loading && !error && sortedSectors.length > 0 && (
        <div className="relative" ref={gridRef}>
          <div className="rounded-xl overflow-hidden border border-surface-700/50">
            <div className="px-6 py-3 border-b border-surface-700/50 bg-surface-900/60 flex items-center justify-between">
              <h2 className="font-display font-semibold text-lg text-surface-50">
                {timeframes.find(tf => tf.value === selectedTimeframe)?.label} Performance
              </h2>
              <span className="text-xs text-surface-500">{sortedSectors.length} ETFs</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-px bg-surface-700/20">
              {sortedSectors.map((sector) => {
                const returnPct = sector.returns[selectedTimeframe]

                return (
                  <div
                    key={sector.ticker}
                    onMouseEnter={(e) => handleMouseEnter(sector, e)}
                    onMouseLeave={() => setHoveredSector(null)}
                    className={`relative p-4 cursor-default transition-all duration-150 border ${getColor(returnPct)} ${
                      hoveredSector?.ticker === sector.ticker ? 'brightness-125 z-10' : 'hover:brightness-110'
                    }`}
                    style={{ minHeight: '100px' }}
                  >
                    <div className="flex flex-col justify-between h-full gap-2">
                      <div>
                        <p className="text-surface-50 text-sm font-semibold leading-tight">
                          {sector.ticker}
                        </p>
                        <p className="text-surface-400 text-xs leading-tight mt-0.5 truncate">
                          {sector.sector}
                        </p>
                      </div>
                      <div>
                        <p className={`font-mono text-xl font-bold tracking-tight ${getReturnColor(returnPct)}`}>
                          {returnPct !== undefined && returnPct !== null
                            ? `${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%`
                            : 'N/A'}
                        </p>
                        <p className="text-surface-500 text-xs font-mono">
                          ${sector.price?.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Floating Tooltip */}
          {hoveredSector && (
            <div
              className="absolute z-[200] pointer-events-none"
              style={{
                left: tooltipPos.x,
                ...(tooltipPos.above
                  ? { bottom: `calc(100% - ${tooltipPos.y}px)` }
                  : { top: tooltipPos.y }),
              }}
            >
              <div className="bg-surface-950/95 backdrop-blur-xl border border-surface-600/50 rounded-xl shadow-glow p-4 w-[290px]">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-surface-50 text-base font-semibold">{hoveredSector.sector}</p>
                    <p className="text-surface-400 text-xs font-mono">{hoveredSector.ticker}</p>
                  </div>
                  <p className="text-surface-200 font-mono text-base font-semibold">
                    ${hoveredSector.price?.toFixed(2)}
                  </p>
                </div>

                <div className="h-px bg-surface-700/40 mb-3" />

                <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                  {Object.entries(hoveredSector.returns).map(([tf, ret]) => (
                    <div key={tf}>
                      <p className="text-surface-500 text-[10px] uppercase tracking-wider font-medium">{tf}</p>
                      <p className={`font-mono text-sm font-semibold ${ret >= 0 ? 'text-success' : 'text-danger'}`}>
                        {ret >= 0 ? '+' : ''}{ret.toFixed(2)}%
                      </p>
                    </div>
                  ))}
                </div>

                <div className="h-px bg-surface-700/40 my-3" />

                <div className="flex justify-between">
                  <span className="text-surface-500 text-xs">Avg Volume</span>
                  <span className="text-surface-300 font-mono text-xs">
                    {(hoveredSector.volume / 1000000).toFixed(1)}M
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rankings */}
      {!loading && !error && sortedSectors.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top Performers */}
          <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 backdrop-blur-sm overflow-hidden hover:border-accent/20 hover:shadow-card-hover transition-all">
            <div className="px-6 py-4 border-b border-surface-700/50">
              <h2 className="font-display font-semibold text-lg text-surface-50 flex items-center gap-2">
                Top Performers
              </h2>
            </div>
            <div>
              {sortedSectors.slice(0, 5).map((sector, idx) => {
                const returnPct = sector.returns[selectedTimeframe] || 0
                return (
                  <div key={sector.ticker} className={idx < 4 ? 'border-b border-surface-700/20' : ''}>
                    <div className="flex items-center justify-between px-6 py-3 hover:bg-surface-800/40 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-surface-500 w-5 text-right">#{idx + 1}</span>
                        <div>
                          <p className="text-surface-100 font-medium text-sm">{sector.sector}</p>
                          <p className="text-surface-500 text-xs font-mono">{sector.ticker}</p>
                        </div>
                      </div>
                      <p className={`font-mono font-bold text-sm ${returnPct >= 0 ? 'text-success' : 'text-danger'}`}>
                        {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Bottom Performers */}
          <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 backdrop-blur-sm overflow-hidden hover:border-accent/20 hover:shadow-card-hover transition-all">
            <div className="px-6 py-4 border-b border-surface-700/50">
              <h2 className="font-display font-semibold text-lg text-surface-50 flex items-center gap-2">
                Bottom Performers
              </h2>
            </div>
            <div>
              {sortedSectors.slice(-5).reverse().map((sector, idx) => {
                const returnPct = sector.returns[selectedTimeframe] || 0
                return (
                  <div key={sector.ticker} className={idx < 4 ? 'border-b border-surface-700/20' : ''}>
                    <div className="flex items-center justify-between px-6 py-3 hover:bg-surface-800/40 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-surface-500 w-5 text-right">#{sortedSectors.length - idx}</span>
                        <div>
                          <p className="text-surface-100 font-medium text-sm">{sector.sector}</p>
                          <p className="text-surface-500 text-xs font-mono">{sector.ticker}</p>
                        </div>
                      </div>
                      <p className={`font-mono font-bold text-sm ${returnPct >= 0 ? 'text-success' : 'text-danger'}`}>
                        {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Color Legend */}
      {!loading && !error && sortedSectors.length > 0 && (
        <div className="flex items-center justify-center gap-1.5 py-2">
          <span className="text-xs text-surface-500 mr-2">Bearish</span>
          <div className="w-7 h-3.5 rounded-sm bg-[#EF4444]/30 border border-[#EF4444]/40" />
          <div className="w-7 h-3.5 rounded-sm bg-[#EF4444]/20 border border-[#EF4444]/25" />
          <div className="w-7 h-3.5 rounded-sm bg-[#EF4444]/12 border border-[#EF4444]/15" />
          <div className="w-7 h-3.5 rounded-sm bg-surface-800/80 border border-surface-700/50" />
          <div className="w-7 h-3.5 rounded-sm bg-[#10B981]/12 border border-[#10B981]/15" />
          <div className="w-7 h-3.5 rounded-sm bg-[#10B981]/20 border border-[#10B981]/25" />
          <div className="w-7 h-3.5 rounded-sm bg-[#10B981]/30 border border-[#10B981]/40" />
          <span className="text-xs text-surface-500 ml-2">Bullish</span>
        </div>
      )}
    </div>
  )
}
