import { useState, useEffect, useRef, useMemo } from 'react'
import { getSectorPerformance, getFetchProgress, saveSnapshot, getSnapshots } from '../api/screener'

export default function Screener() {
  const [sectorData, setSectorData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [heatmapTimeframe, setHeatmapTimeframe] = useState('1D')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [hoveredSector, setHoveredSector] = useState(null)
  const [isDemoData, setIsDemoData] = useState(false)
  const [demoNote, setDemoNote] = useState(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [fromCache, setFromCache] = useState(false)
  const [progress, setProgress] = useState(null)
  const [radarSort, setRadarSort] = useState({ key: 'momentum', dir: 'desc' })
  const [snapshots, setSnapshots] = useState([])
  const [showAllWeeks, setShowAllWeeks] = useState(false)
  const [showMethodology, setShowMethodology] = useState(true)
  const gridRef = useRef(null)
  const progressInterval = useRef(null)

  const heatmapTimeframes = [
    { value: '1D', label: '1 Day' },
    { value: '5D', label: '5 Days' },
    { value: '1M', label: '1 Month' },
    { value: '3M', label: '3 Months' },
    { value: 'YTD', label: 'YTD' },
    { value: '1Y', label: '1 Year' },
  ]

  useEffect(() => {
    fetchSectorData()
    setSnapshots(getSnapshots())
    const interval = setInterval(fetchSectorData, 2 * 60 * 60 * 1000)
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
      } catch { /* ignore */ }
    }, 500)
  }

  const fetchSectorData = async (forceRefresh = false) => {
    try {
      setError(null)
      let cacheValid = false
      if (!forceRefresh) {
        try {
          const cached = localStorage.getItem('sector_performance_cache')
          if (cached) {
            const { timestamp } = JSON.parse(cached)
            cacheValid = Date.now() - timestamp < 2 * 60 * 60 * 1000
          }
        } catch { /* ignore */ }
      }
      if (!cacheValid) {
        setLoading(true)
        startProgressPolling()
      }

      const data = await getSectorPerformance({ forceRefresh })
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

      // Auto-save snapshot on fresh (non-cached) load
      if (!data.from_cache && data.sectors?.length > 0) {
        const saved = saveSnapshot(data.sectors)
        if (saved) setSnapshots(getSnapshots())
      }
    } catch (err) {
      setError(err.message)
      setLoading(false)
      setProgress(null)
    }
  }

  // --- Rotation Analysis Computation ---
  const rotationData = useMemo(() => {
    if (!sectorData.length) return null

    const analyzed = sectorData.map(s => {
      const r5d = s.returns['5D'] || 0
      const r1m = s.returns['1M'] || 0
      const r3m = s.returns['3M'] || 0

      // Normalize to weekly rates
      const weeklyRate5D = r5d           // ~1 week
      const weeklyRate1M = r1m / 4.3     // monthly → weekly avg
      const weeklyRate3M = r3m / 13      // quarterly → weekly avg

      // Acceleration: how much recent rate exceeds long-term rate
      const acceleration = weeklyRate5D - weeklyRate3M

      // Weighted momentum score
      const momentum = (weeklyRate5D * 3) + (weeklyRate1M * 2) + (weeklyRate3M * 1)

      return {
        ...s,
        weeklyRate5D,
        weeklyRate1M,
        weeklyRate3M,
        acceleration,
        momentum,
        r5d, r1m, r3m,
      }
    })

    // Rotation In: top 5 by acceleration where 5D > 0
    const rotationIn = analyzed
      .filter(s => s.r5d > 0)
      .sort((a, b) => b.acceleration - a.acceleration)
      .slice(0, 5)

    // Rotation Out: bottom 5 by acceleration (or sharp 5D decline)
    const rotationOut = analyzed
      .sort((a, b) => a.acceleration - b.acceleration)
      .slice(0, 5)

    // Multi-timeframe columns (sorted by return desc)
    const by5D = [...analyzed].sort((a, b) => b.r5d - a.r5d)
    const by1M = [...analyzed].sort((a, b) => b.r1m - a.r1m)
    const by3M = [...analyzed].sort((a, b) => b.r3m - a.r3m)

    // Badges: top-5 in all three = "Strong Trend"; top-5 5D but NOT top-10 3M = "Fresh"
    const top5_5d = new Set(by5D.slice(0, 5).map(s => s.ticker))
    const top5_1m = new Set(by1M.slice(0, 5).map(s => s.ticker))
    const top5_3m = new Set(by3M.slice(0, 5).map(s => s.ticker))
    const top10_3m = new Set(by3M.slice(0, 10).map(s => s.ticker))

    const badges = {}
    for (const ticker of top5_5d) {
      if (top5_1m.has(ticker) && top5_3m.has(ticker)) {
        badges[ticker] = 'strong'
      } else if (!top10_3m.has(ticker)) {
        badges[ticker] = 'fresh'
      }
    }

    return { analyzed, rotationIn, rotationOut, by5D, by1M, by3M, badges }
  }, [sectorData])

  // --- Radar table sorting ---
  const radarRows = useMemo(() => {
    if (!rotationData) return []
    const rows = [...rotationData.analyzed]
    const { key, dir } = radarSort
    rows.sort((a, b) => {
      const av = a[key] ?? 0
      const bv = b[key] ?? 0
      return dir === 'desc' ? bv - av : av - bv
    })
    return rows
  }, [rotationData, radarSort])

  const toggleSort = (key) => {
    setRadarSort(prev =>
      prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }
    )
  }

  const SortIcon = ({ col }) => {
    if (radarSort.key !== col) return <span className="text-surface-600 ml-1">↕</span>
    return <span className="text-accent ml-1">{radarSort.dir === 'desc' ? '↓' : '↑'}</span>
  }

  // --- Snapshot comparison ---
  const snapshotComparison = useMemo(() => {
    if (snapshots.length < 2 || !rotationData) return null

    const current = snapshots[snapshots.length - 1]
    const previous = snapshots[snapshots.length - 2]

    const currentTop5 = [...current.sectors].sort((a, b) => (b['5D'] || 0) - (a['5D'] || 0)).slice(0, 5)
    const previousTop5 = [...previous.sectors].sort((a, b) => (b['5D'] || 0) - (a['5D'] || 0)).slice(0, 5)

    const prevRanks = {}
    previousTop5.forEach((s, i) => { prevRanks[s.ticker] = i + 1 })
    const currRanks = {}
    currentTop5.forEach((s, i) => { currRanks[s.ticker] = i + 1 })

    const prevTickers = new Set(previousTop5.map(s => s.ticker))
    const currTickers = new Set(currentTop5.map(s => s.ticker))

    const changes = currentTop5.map(s => ({
      ...s,
      rank: currRanks[s.ticker],
      prevRank: prevRanks[s.ticker] || null,
      isNew: !prevTickers.has(s.ticker),
    }))

    const droppedOut = previousTop5
      .filter(s => !currTickers.has(s.ticker))
      .map(s => ({ ...s, prevRank: prevRanks[s.ticker] }))

    return {
      currentWeek: current.week,
      currentDate: current.date,
      previousWeek: previous.week,
      previousDate: previous.date,
      changes,
      droppedOut,
      allSnapshots: snapshots,
    }
  }, [snapshots, rotationData])

  // --- Heatmap helpers ---
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

  const getReturnColor = (v) => {
    if (v == null) return 'text-surface-400'
    return v > 0 ? 'text-success' : v < 0 ? 'text-danger' : 'text-surface-400'
  }

  const handleMouseEnter = (sector, e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const gridRect = gridRef.current?.getBoundingClientRect()
    if (!gridRect) return
    let x = rect.left - gridRect.left
    let y = rect.bottom - gridRect.top + 8
    const above = rect.bottom + 260 > window.innerHeight
    if (above) y = rect.top - gridRect.top - 8
    if (x + 300 > gridRect.width) x = gridRect.width - 300
    if (x < 0) x = 0
    setTooltipPos({ x, y, above })
    setHoveredSector(sector)
  }

  const heatmapSorted = useMemo(() =>
    [...sectorData].sort((a, b) => (b.returns[heatmapTimeframe] || 0) - (a.returns[heatmapTimeframe] || 0)),
    [sectorData, heatmapTimeframe]
  )

  const progressPct = progress?.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
  const dataReady = !loading && !error && sectorData.length > 0

  const fmtPct = (v) => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : 'N/A'
  const fmtPrice = (v) => v != null ? `$${v.toFixed(2)}` : ''

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display font-bold text-3xl text-surface-50">
            Sector Rotation
          </h1>
          <p className="text-surface-400 text-sm mt-1">
            Track institutional money flow across sectors and industries
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
            onClick={() => fetchSectorData(true)}
            disabled={loading && !sectorData.length}
            className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 hover:text-surface-50 transition-colors disabled:opacity-40"
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
            Showing demo data -- {demoNote || 'Finnhub API is temporarily unavailable. Refresh later for live data.'}
          </p>
        </div>
      )}

      {/* Loading State with Progress */}
      {loading && !sectorData.length && (
        <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 backdrop-blur-sm p-8">
          <div className="max-w-md mx-auto">
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
            {progress?.current_ticker ? (
              <div className="flex items-center justify-center gap-2 text-sm">
                <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                <span className="text-surface-400">
                  Fetching <span className="text-surface-200 font-mono font-medium">{progress.current_ticker}</span>
                  <span className="text-surface-500"> -- {progress.current_name}</span>
                </span>
                <span className="text-surface-500 font-mono text-xs">({progress.current}/{progress.total})</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-sm text-surface-400">
                <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                Connecting to Finnhub...
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== Section 1: Rotation Intelligence Summary ===== */}
      {dataReady && rotationData && (
        <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 backdrop-blur-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-surface-700/50">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display font-semibold text-lg text-surface-50">Rotation Intelligence</h2>
                <p className="text-[11px] text-surface-500 mt-0.5">
                  Detects early institutional accumulation by comparing short-term vs long-term weekly return rates
                </p>
              </div>
              <button
                onClick={() => setShowMethodology(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-surface-300 bg-surface-800/60 border border-surface-700/40 hover:bg-surface-700 hover:text-surface-100 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                How it works
                <svg className={`w-3 h-3 transition-transform ${showMethodology ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {/* Expandable Methodology */}
            {showMethodology && (
              <div className="mt-4 pt-4 border-t border-surface-700/30 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-lg bg-surface-800/50 p-3">
                  <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium mb-1.5">Acceleration</p>
                  <p className="text-xs text-surface-300 leading-relaxed">
                    Compares the 5D return (already ~1 week) against the 3M return normalized to a weekly rate (3M / 13 weeks).
                    A <span className="text-success font-medium">positive</span> value means recent buying exceeds the longer-term trend — fresh accumulation.
                  </p>
                  <p className="text-[10px] text-surface-500 font-mono mt-2">5D rate - (3M / 13)</p>
                </div>
                <div className="rounded-lg bg-surface-800/50 p-3">
                  <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium mb-1.5">Momentum</p>
                  <p className="text-xs text-surface-300 leading-relaxed">
                    Weighted score favoring recent performance. 5D is weighted 3x, 1M weighted 2x, 3M weighted 1x.
                    Higher scores indicate stronger broad buying pressure across timeframes.
                  </p>
                  <p className="text-[10px] text-surface-500 font-mono mt-2">(5D x 3) + (1M/4.3 x 2) + (3M/13 x 1)</p>
                </div>
                <div className="rounded-lg bg-surface-800/50 p-3">
                  <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium mb-1.5">Trend</p>
                  <p className="text-xs text-surface-300 leading-relaxed">
                    Direction arrow based on acceleration. <span className="text-success">↑</span> when accel {'>'} 0.3 (accelerating),
                    <span className="text-danger"> ↓</span> when {'<'} -0.3 (decelerating), <span className="text-surface-400">→</span> otherwise (steady).
                  </p>
                  <p className="text-[10px] text-surface-500 font-mono mt-2">↑ accel {'>'} 0.3 · ↓ accel {'<'} -0.3</p>
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-surface-700/30">
            {/* Rotation In */}
            <div className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-success" />
                <h3 className="text-sm font-semibold text-success">Rotation In</h3>
                <span className="text-[10px] text-surface-500">Fresh accumulation</span>
              </div>
              <div className="space-y-1">
                {rotationData.rotationIn.map((s, i) => (
                  <div key={s.ticker} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-surface-800/40 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-bold text-surface-500 w-4 text-right">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-surface-100">{s.ticker}</span>
                          <span className="font-mono text-[11px] text-surface-500">{fmtPrice(s.price)}</span>
                          {rotationData.badges[s.ticker] === 'fresh' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-accent/15 text-accent">FRESH</span>
                          )}
                          {rotationData.badges[s.ticker] === 'strong' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-success/15 text-success">STRONG</span>
                          )}
                        </div>
                        <p className="text-[11px] text-surface-500 truncate">{s.sector}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <div className="text-right">
                        <p className={`font-mono text-sm font-semibold ${getReturnColor(s.r5d)}`}>{fmtPct(s.r5d)}</p>
                        <p className="text-[10px] text-surface-500">5D</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-xs text-success">+{s.acceleration.toFixed(2)}</p>
                        <p className="text-[10px] text-surface-500">accel</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Rotation Out */}
            <div className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-danger" />
                <h3 className="text-sm font-semibold text-danger">Rotation Out</h3>
                <span className="text-[10px] text-surface-500">Money leaving</span>
              </div>
              <div className="space-y-1">
                {rotationData.rotationOut.map((s, i) => (
                  <div key={s.ticker} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-surface-800/40 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-bold text-surface-500 w-4 text-right">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-surface-100">{s.ticker}</span>
                          <span className="font-mono text-[11px] text-surface-500">{fmtPrice(s.price)}</span>
                        </div>
                        <p className="text-[11px] text-surface-500 truncate">{s.sector}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <div className="text-right">
                        <p className={`font-mono text-sm font-semibold ${getReturnColor(s.r5d)}`}>{fmtPct(s.r5d)}</p>
                        <p className="text-[10px] text-surface-500">5D</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-xs text-danger">{s.acceleration.toFixed(2)}</p>
                        <p className="text-[10px] text-surface-500">accel</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Section 2: Multi-Timeframe Comparison (3 Columns) ===== */}
      {dataReady && rotationData && (
        <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 backdrop-blur-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-surface-700/50">
            <h2 className="font-display font-semibold text-lg text-surface-50">Multi-Timeframe Comparison</h2>
            <p className="text-[11px] text-surface-500 mt-0.5">Sectors ranked by return — spot trends that persist across timeframes</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-surface-700/30">
            {[
              { label: '5 Days', data: rotationData.by5D, key: 'r5d' },
              { label: '1 Month', data: rotationData.by1M, key: 'r1m' },
              { label: '3 Months', data: rotationData.by3M, key: 'r3m' },
            ].map(({ label, data, key }) => (
              <div key={label} className="p-4">
                <h3 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3 px-2">{label}</h3>
                <div className="space-y-0.5">
                  {data.slice(0, 15).map((s, i) => (
                    <div key={s.ticker} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-surface-800/40 transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`text-[11px] font-bold w-5 text-right ${i < 5 ? 'text-surface-300' : 'text-surface-600'}`}>
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs font-semibold text-surface-100">{s.ticker}</span>
                            <span className="font-mono text-[10px] text-surface-500">{fmtPrice(s.price)}</span>
                            {rotationData.badges[s.ticker] === 'strong' && (
                              <span className="px-1 py-px rounded text-[8px] font-bold bg-success/15 text-success leading-tight">TREND</span>
                            )}
                            {rotationData.badges[s.ticker] === 'fresh' && (
                              <span className="px-1 py-px rounded text-[8px] font-bold bg-accent/15 text-accent leading-tight">FRESH</span>
                            )}
                          </div>
                          <p className="text-[10px] text-surface-500 truncate">{s.sector}</p>
                        </div>
                      </div>
                      <span className={`font-mono text-xs font-semibold ${getReturnColor(s[key])}`}>
                        {fmtPct(s[key])}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== Section 3: Rotation Radar (Sortable Table) ===== */}
      {dataReady && radarRows.length > 0 && (
        <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 backdrop-blur-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-surface-700/50">
            <h2 className="font-display font-semibold text-lg text-surface-50">Rotation Radar</h2>
            <p className="text-[11px] text-surface-500 mt-0.5">All {radarRows.length} ETFs — click column headers to sort</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-700">
                  {[
                    { key: 'ticker', label: 'Ticker', align: 'left', tip: null },
                    { key: 'price', label: 'Price', align: 'right', tip: null },
                    { key: 'sector', label: 'Sector', align: 'left', tip: null },
                    { key: 'r5d', label: '5D', align: 'right', tip: null },
                    { key: 'r1m', label: '1M', align: 'right', tip: null },
                    { key: 'r3m', label: '3M', align: 'right', tip: null },
                    { key: 'momentum', label: 'Momentum', align: 'right', tip: '(5D x 3) + (1M/4.3 x 2) + (3M/13 x 1)' },
                    { key: 'acceleration', label: 'Trend', align: 'right', tip: '5D rate - 3M weekly avg' },
                  ].map(({ key, label, align, tip }) => (
                    <th
                      key={key}
                      onClick={() => toggleSort(key)}
                      className={`py-3 px-4 text-${align} text-surface-400 text-xs font-medium cursor-pointer hover:text-surface-200 transition-colors select-none`}
                      title={tip || undefined}
                    >
                      {label}
                      {tip && (
                        <svg className="w-3 h-3 inline-block ml-0.5 text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                      <SortIcon col={key} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {radarRows.map((s) => {
                  const trendDir = s.acceleration > 0.3 ? 'up' : s.acceleration < -0.3 ? 'down' : 'flat'
                  return (
                    <tr
                      key={s.ticker}
                      className={`border-b border-surface-800 hover:bg-surface-800/40 transition-colors ${
                        trendDir === 'up' ? 'bg-success/[0.03]' : trendDir === 'down' ? 'bg-danger/[0.03]' : ''
                      }`}
                    >
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-surface-100">{s.ticker}</span>
                          {rotationData.badges[s.ticker] === 'strong' && (
                            <span className="px-1 py-px rounded text-[8px] font-bold bg-success/15 text-success">TREND</span>
                          )}
                          {rotationData.badges[s.ticker] === 'fresh' && (
                            <span className="px-1 py-px rounded text-[8px] font-bold bg-accent/15 text-accent">FRESH</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs text-surface-400 text-right">{fmtPrice(s.price)}</td>
                      <td className="py-2.5 px-4 text-surface-400 text-xs truncate max-w-[200px]">{s.sector}</td>
                      <td className={`py-2.5 px-4 font-mono text-xs font-semibold text-right ${getReturnColor(s.r5d)}`}>{fmtPct(s.r5d)}</td>
                      <td className={`py-2.5 px-4 font-mono text-xs font-semibold text-right ${getReturnColor(s.r1m)}`}>{fmtPct(s.r1m)}</td>
                      <td className={`py-2.5 px-4 font-mono text-xs font-semibold text-right ${getReturnColor(s.r3m)}`}>{fmtPct(s.r3m)}</td>
                      <td className={`py-2.5 px-4 font-mono text-xs font-semibold text-right ${getReturnColor(s.momentum)}`}>
                        {s.momentum.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <span className={`inline-flex items-center gap-1 font-mono text-xs font-semibold ${
                          trendDir === 'up' ? 'text-success' : trendDir === 'down' ? 'text-danger' : 'text-surface-500'
                        }`}>
                          {trendDir === 'up' ? '↑' : trendDir === 'down' ? '↓' : '→'}
                          {Math.abs(s.acceleration).toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== Section 4: Heatmap (Existing, with own timeframe selector) ===== */}
      {dataReady && heatmapSorted.length > 0 && (
        <>
          {/* Heatmap Timeframe Tabs */}
          <div className="flex gap-2 p-1 rounded-lg bg-surface-900/60 border border-surface-700/50 w-fit">
            {heatmapTimeframes.map((tf) => (
              <button
                key={tf.value}
                onClick={() => setHeatmapTimeframe(tf.value)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                  heatmapTimeframe === tf.value
                    ? 'bg-accent/15 text-accent border border-accent/25'
                    : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/60'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <div className="relative" ref={gridRef}>
            <div className="rounded-xl overflow-hidden border border-surface-700/50">
              <div className="px-6 py-3 border-b border-surface-700/50 bg-surface-900/60 flex items-center justify-between">
                <h2 className="font-display font-semibold text-lg text-surface-50">
                  {heatmapTimeframes.find(tf => tf.value === heatmapTimeframe)?.label} Heatmap
                </h2>
                <span className="text-xs text-surface-500">{heatmapSorted.length} ETFs</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-px bg-surface-700/20">
                {heatmapSorted.map((sector) => {
                  const returnPct = sector.returns[heatmapTimeframe]
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
                          <p className="text-surface-50 text-sm font-semibold leading-tight">{sector.ticker}</p>
                          <p className="text-surface-400 text-xs leading-tight mt-0.5 truncate">{sector.sector}</p>
                        </div>
                        <div>
                          <p className={`font-mono text-xl font-bold tracking-tight ${getReturnColor(returnPct)}`}>
                            {fmtPct(returnPct)}
                          </p>
                          <p className="text-surface-500 text-xs font-mono">${sector.price?.toFixed(2)}</p>
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

          {/* Color Legend */}
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
        </>
      )}

      {/* ===== Section 5: Weekly Snapshot Comparison ===== */}
      {dataReady && snapshotComparison && (
        <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 backdrop-blur-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-surface-700/50 flex items-center justify-between">
            <div>
              <h2 className="font-display font-semibold text-lg text-surface-50">Week-Over-Week</h2>
              <p className="text-[11px] text-surface-500 mt-0.5">
                Top 5 by 5D return — comparing {snapshotComparison.currentWeek} vs {snapshotComparison.previousWeek}
              </p>
            </div>
            {snapshotComparison.allSnapshots.length > 2 && (
              <button
                onClick={() => setShowAllWeeks(v => !v)}
                className="text-xs text-accent hover:text-accent-muted transition-colors"
              >
                {showAllWeeks ? 'Collapse' : `Show ${snapshotComparison.allSnapshots.length} weeks`}
              </button>
            )}
          </div>
          <div className="p-5">
            {/* Current vs Previous */}
            <div className="space-y-1.5">
              {snapshotComparison.changes.map((s) => (
                <div key={s.ticker} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-surface-800/40 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-surface-300 w-4 text-right">#{s.rank}</span>
                    <span className="font-mono text-sm font-semibold text-surface-100">{s.ticker}</span>
                    {s.isNew ? (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-accent/15 text-accent">NEW</span>
                    ) : s.prevRank ? (
                      <span className={`text-[11px] font-mono font-semibold ${
                        s.prevRank > s.rank ? 'text-success' : s.prevRank < s.rank ? 'text-danger' : 'text-surface-500'
                      }`}>
                        {s.prevRank > s.rank ? `+${s.prevRank - s.rank}` : s.prevRank < s.rank ? `${s.prevRank - s.rank}` : '='} from #{s.prevRank}
                      </span>
                    ) : null}
                  </div>
                  <span className={`font-mono text-sm font-semibold ${getReturnColor(s['5D'])}`}>
                    {fmtPct(s['5D'])}
                  </span>
                </div>
              ))}
            </div>

            {/* Dropped Out */}
            {snapshotComparison.droppedOut.length > 0 && (
              <div className="mt-4 pt-4 border-t border-surface-700/30">
                <p className="text-[11px] text-surface-500 uppercase tracking-wider font-medium mb-2 px-3">Dropped from Top 5</p>
                <div className="space-y-1">
                  {snapshotComparison.droppedOut.map(s => (
                    <div key={s.ticker} className="flex items-center gap-3 py-1.5 px-3 text-surface-500">
                      <span className="text-xs font-mono">was #{s.prevRank}</span>
                      <span className="font-mono text-sm text-surface-400">{s.ticker}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-danger/10 text-danger">OUT</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Historical Weeks (expandable) */}
            {showAllWeeks && snapshotComparison.allSnapshots.length > 2 && (
              <div className="mt-4 pt-4 border-t border-surface-700/30">
                <p className="text-[11px] text-surface-500 uppercase tracking-wider font-medium mb-3 px-3">Historical Snapshots</p>
                <div className="space-y-3">
                  {snapshotComparison.allSnapshots.slice(0, -1).reverse().map((snap) => {
                    const top3 = [...snap.sectors].sort((a, b) => (b['5D'] || 0) - (a['5D'] || 0)).slice(0, 3)
                    return (
                      <div key={snap.week} className="px-3 py-2 rounded-lg bg-surface-800/30">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-medium text-surface-300">{snap.week}</span>
                          <span className="text-[10px] text-surface-500">{snap.date}</span>
                        </div>
                        <div className="flex gap-3">
                          {top3.map((s, i) => (
                            <span key={s.ticker} className="text-xs">
                              <span className="text-surface-500">#{i + 1}</span>{' '}
                              <span className="font-mono text-surface-200">{s.ticker}</span>{' '}
                              <span className={`font-mono ${getReturnColor(s['5D'])}`}>{fmtPct(s['5D'])}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
