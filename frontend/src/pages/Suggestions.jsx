import { useState, useEffect, useRef } from 'react'
import { startScreening, getProgress, getResult, getHistory, clearAdvisorCache } from '../api/advisor'

const PERSONAS = {
  qullamaggie: {
    id: 'qullamaggie',
    name: 'Qullamaggie',
    fullName: 'Kristjan Kullamägi',
    tagline: 'Momentum & Breakout',
    description:
      'Screens for stocks in a Stage 2 uptrend with explosive volume surges and strong relative strength versus the S&P 500. Inspired by Qullamaggie\'s multi-million dollar momentum trading strategy.',
    criteria: [
      'Price > SMA50 > SMA150 > SMA200 (Stage 2 uptrend)',
      'Within 25% of 52-week high',
      '3-day average volume > 1.5× 20-day average (volume surge)',
      'Outperforming SPY over last 3 months (positive RS)',
      'Positive trailing EPS',
      'Price > $10 and Market Cap > $300M',
    ],
    rankBy: 'Ranked by Relative Strength vs SPY',
    color: 'emerald',
    accent: '#10b981',
    metricPills: (pick) => [
      { label: 'RS vs SPY', value: `+${pick.rs_ratio}%`, positive: true },
      { label: '3M Return', value: `${pick.stock_3m_return > 0 ? '+' : ''}${pick.stock_3m_return}%`, positive: pick.stock_3m_return > 0 },
      { label: 'Vol Surge', value: `${pick.volume_surge?.toFixed(1)}×`, positive: true },
    ],
  },
  adam_khoo: {
    id: 'adam_khoo',
    name: 'Adam Khoo',
    fullName: 'Adam Khoo',
    tagline: 'Value Growth',
    description:
      'Screens for fundamentally strong companies growing at reasonable valuations. Inspired by Adam Khoo\'s value-growth framework — find businesses with high ROE, expanding revenues, and attractive P/E ratios.',
    criteria: [
      'P/E ratio between 5 and 35 (growth at reasonable price)',
      'Positive and growing trailing EPS',
      'Positive revenue growth year-over-year',
      'Return on Equity > 15%',
      'Positive profit margins',
      'Market Cap > $1B (established company)',
    ],
    rankBy: 'Ranked by composite fundamentals score',
    color: 'cyan',
    accent: '#06b6d4',
    metricPills: (pick) => [
      { label: 'P/E Ratio', value: pick.pe_ratio, positive: true },
      { label: 'ROE', value: `${pick.roe_pct}%`, positive: true },
      { label: 'Rev Growth', value: `+${pick.revenue_growth_pct}%`, positive: true },
    ],
  },
}

function MetricPill({ label, value, positive }) {
  return (
    <div className="flex flex-col rounded-lg bg-[#1a1f2e] px-2.5 py-1.5 min-w-0">
      <span className="text-[9px] uppercase tracking-wider text-slate-500 font-medium whitespace-nowrap">{label}</span>
      <span className={`font-mono text-sm font-semibold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>{value}</span>
    </div>
  )
}

function StockPickCard({ pick, rank, persona }) {
  const personaDef = PERSONAS[persona]

  return (
    <div
      className="rounded-xl bg-[#111827]/80 border border-slate-700/50 backdrop-blur-sm p-5 hover:border-slate-500/50 transition-all duration-200"
      style={{ animation: `fadeInUp 0.4s ease both`, animationDelay: `${(rank - 1) * 80}ms` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ backgroundColor: `${personaDef.accent}22`, border: `1px solid ${personaDef.accent}55`, color: personaDef.accent }}
          >
            {rank}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-base font-bold text-slate-100">{pick.ticker}</span>
              {pick.sector && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700/50 text-slate-400 font-medium whitespace-nowrap">
                  {pick.sector}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5 truncate">{pick.company}</p>
          </div>
        </div>
        <div className="text-right flex-shrink-0 ml-3">
          <p className="font-mono text-base font-semibold text-slate-100">${pick.price?.toFixed(2)}</p>
          <p className="text-[10px] text-slate-500">${pick.market_cap_b}B cap</p>
        </div>
      </div>

      {/* Key metrics */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {personaDef.metricPills(pick).map((pill) => (
          <MetricPill key={pill.label} {...pill} />
        ))}
      </div>

      {/* Why it qualifies */}
      <div className="border-t border-slate-700/30 pt-3">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2">Why it qualifies</p>
        <ul className="space-y-1.5">
          {(pick.why || []).map((reason, i) => (
            <li key={i} className="flex items-start gap-2 text-[11px] text-slate-300 leading-snug">
              <span className="flex-shrink-0 mt-0.5" style={{ color: personaDef.accent }}>✓</span>
              {reason}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const STEPS = [
  { id: 1, label: 'Price Data',    sublabel: 'Downloading 1-year OHLCV history' },
  { id: 2, label: 'Fundamentals',  sublabel: 'Fetching P/E, ROE, earnings data' },
  { id: 3, label: 'Screening',     sublabel: 'Applying strategy criteria'        },
]

function LoadingPanel({ progress, persona }) {
  const personaDef = PERSONAS[persona]
  const step      = progress?.step || 1
  const current   = progress?.current || 0
  const total     = progress?.total   || 0
  const ticker    = progress?.current_ticker || ''

  // Per-step progress percentage
  const pct = step === 2 && total > 0
    ? Math.min(99, Math.round((current / total) * 100))
    : step === 1 ? 15
    : step === 3 ? 97
    : 5

  // Remaining count only meaningful during step 2
  const remaining = step === 2 && total > 0 ? total - current : null

  return (
    <div className="rounded-2xl border border-slate-700/40 bg-[#111827]/80 backdrop-blur-sm overflow-hidden">
      {/* Step rail */}
      <div className="flex items-center gap-0 border-b border-slate-700/40">
        {STEPS.map((s, i) => {
          const isDone   = step > s.id
          const isActive = step === s.id
          return (
            <div
              key={s.id}
              className="flex-1 flex flex-col items-center py-4 px-3 relative"
              style={{
                borderRight: i < STEPS.length - 1 ? '1px solid rgba(51,65,85,0.4)' : 'none',
                backgroundColor: isActive ? `${personaDef.accent}0d` : 'transparent',
              }}
            >
              {/* Connector line above dot */}
              <div className="flex items-center justify-center mb-2">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center transition-all duration-500"
                  style={{
                    backgroundColor: isDone ? personaDef.accent : isActive ? `${personaDef.accent}30` : '#1e293b',
                    border: `1.5px solid ${isDone || isActive ? personaDef.accent : '#334155'}`,
                  }}
                >
                  {isDone ? (
                    <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="#0d1117" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : isActive ? (
                    <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: personaDef.accent }} />
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                  )}
                </div>
              </div>
              <p
                className="text-[11px] font-semibold text-center leading-tight transition-colors duration-300"
                style={{ color: isDone || isActive ? '#f1f5f9' : '#475569' }}
              >
                {s.label}
              </p>
              <p className="text-[9px] text-slate-600 text-center mt-0.5 leading-tight hidden sm:block">
                {s.sublabel}
              </p>
            </div>
          )
        })}
      </div>

      {/* Main content */}
      <div className="px-8 pt-8 pb-6 text-center">
        {/* Big count — only shown during step 2 */}
        {step === 2 && total > 0 ? (
          <div className="mb-6">
            <div className="flex items-end justify-center gap-2 mb-1">
              <span
                className="font-bold tabular-nums transition-all duration-300"
                style={{ fontSize: '3.5rem', lineHeight: 1, color: personaDef.accent }}
              >
                {current}
              </span>
              <span className="text-slate-500 text-base mb-2 font-medium">/ {total}</span>
            </div>
            <p className="text-slate-400 text-sm">stocks analyzed</p>
            {remaining !== null && (
              <p className="text-slate-600 text-xs mt-1">{remaining} remaining</p>
            )}
          </div>
        ) : (
          <div className="mb-6">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
              style={{ backgroundColor: `${personaDef.accent}18`, border: `1px solid ${personaDef.accent}35` }}
            >
              <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" style={{ color: personaDef.accent }}>
                <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            </div>
            <p className="text-slate-300 text-sm font-medium">
              {step === 1 ? 'Downloading price history…' : 'Applying screening criteria…'}
            </p>
          </div>
        )}

        {/* Progress bar */}
        <div className="w-full max-w-xs mx-auto mb-4">
          <div className="h-[3px] w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${pct}%`, backgroundColor: personaDef.accent }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[10px] text-slate-600">{pct}%</span>
            <span className="text-[10px] text-slate-600 font-mono truncate max-w-[160px]">
              {step === 2 && ticker ? ticker : ''}
            </span>
          </div>
        </div>

        <p className="text-[11px] text-slate-600">~65 stocks · sequential fetch · results cached 4 hours</p>
      </div>
    </div>
  )
}

function HistoryPanel({ history, persona }) {
  const [open, setOpen] = useState(false)
  const personaDef = PERSONAS[persona]

  if (!history || history.length === 0) return null

  // Find tickers that appear on multiple days (recurring picks)
  const tickerCounts = {}
  history.forEach((record) => {
    record.picks.forEach(({ ticker }) => {
      tickerCounts[ticker] = (tickerCounts[ticker] || 0) + 1
    })
  })

  return (
    <div className="rounded-xl border border-slate-700/50 bg-[#111827]/60 overflow-hidden mt-6">
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-800/30 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-semibold text-slate-200">Scan History</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400">
            {history.length} day{history.length !== 1 ? 's' : ''}
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-slate-700/30 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700/30">
                <th className="text-left px-5 py-2.5 text-slate-500 font-medium whitespace-nowrap">Date</th>
                {[1, 2, 3, 4, 5].map((n) => (
                  <th key={n} className="text-left px-3 py-2.5 text-slate-500 font-medium whitespace-nowrap">
                    Pick #{n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((record, i) => (
                <tr
                  key={record.date}
                  className={`border-b border-slate-700/20 ${i % 2 === 0 ? 'bg-transparent' : 'bg-slate-800/20'}`}
                >
                  <td className="px-5 py-2.5 text-slate-400 font-mono whitespace-nowrap">{record.date}</td>
                  {Array.from({ length: 5 }, (_, j) => {
                    const pick = record.picks[j]
                    const isRecurring = pick && tickerCounts[pick.ticker] > 1
                    return (
                      <td key={j} className="px-3 py-2.5 whitespace-nowrap">
                        {pick ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-semibold text-slate-200">{pick.ticker}</span>
                            {isRecurring && (
                              <span
                                className="text-[9px] px-1 py-0.5 rounded font-medium"
                                style={{ backgroundColor: `${personaDef.accent}20`, color: personaDef.accent }}
                                title={`Appeared ${tickerCounts[pick.ticker]} times`}
                              >
                                ×{tickerCounts[pick.ticker]}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-700">—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-slate-600 px-5 py-3">
            Showing up to 30 days. One scan recorded per day. ×N badge = ticker appeared N times across history.
          </p>
        </div>
      )}
    </div>
  )
}

export default function Suggestions() {
  const [activePersona, setActivePersona] = useState('qullamaggie')
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [results, setResults] = useState(null)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [showStrategy, setShowStrategy] = useState(true)
  const [lastRun, setLastRun] = useState(null)
  const [history, setHistory] = useState([])

  const pollRef = useRef(null)

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const startPolling = () => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const prog = await getProgress()
        setProgress(prog)
        if (prog?.status === 'done') {
          stopPolling()
          const result = await getResult(activePersona)
          if (result) {
            setResults(result)
            setStatus('done')
            setLastRun(new Date())
            getHistory(activePersona).then(setHistory)
          }
        } else if (prog?.status === 'error') {
          stopPolling()
          setError(prog.error || 'Screening failed')
          setStatus('error')
        }
      } catch {
        // ignore transient errors
      }
    }, 1500)
  }

  const handleRun = async (force = false) => {
    setStatus('loading')
    setError(null)
    setProgress(null)
    try {
      const res = await startScreening(activePersona, force)
      if (res.from_cache || res.picks) {
        setResults(res)
        setStatus('done')
        setLastRun(new Date())
        getHistory(activePersona).then(setHistory)
        return
      }
      startPolling()
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  const handlePersonaSwitch = (id) => {
    if (id === activePersona) return
    stopPolling()
    setActivePersona(id)
    setStatus('idle')
    setResults(null)
    setError(null)
    setProgress(null)
    setHistory([])
    getHistory(id).then(setHistory)
  }

  const handleRefresh = () => {
    clearAdvisorCache(activePersona)
    handleRun(true)
  }

  useEffect(() => {
    return () => stopPolling()
  }, [])

  const persona = PERSONAS[activePersona]

  const formatLastRun = (d) => {
    if (!d) return null
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-slate-100 p-6">
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="max-w-6xl mx-auto">
        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
              <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a3.75 3.75 0 01-1.298.872l-.11.042a3.75 3.75 0 01-2.687 0l-.11-.042a3.75 3.75 0 01-1.298-.872L12 17z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-100">Signal Lab</h1>
          </div>
          <p className="text-slate-400 text-sm ml-11">
            Top 5 picks from leading US equities — filtered through the lens of two legendary trading personas.
          </p>
        </div>

        {/* Persona selector */}
        <div className="flex gap-3 mb-6 flex-wrap">
          {Object.values(PERSONAS).map((p) => {
            const isActive = activePersona === p.id
            return (
              <button
                key={p.id}
                onClick={() => handlePersonaSwitch(p.id)}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-200"
                style={{
                  backgroundColor: isActive ? `${p.accent}18` : '#111827',
                  borderColor: isActive ? `${p.accent}60` : '#374151',
                  boxShadow: isActive ? `0 0 12px ${p.accent}20` : 'none',
                }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                  style={{ backgroundColor: `${p.accent}25`, color: p.accent }}
                >
                  {p.name[0]}
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-slate-100 leading-tight">{p.name}</p>
                  <p className="text-[11px] leading-tight" style={{ color: p.accent }}>{p.tagline}</p>
                </div>
              </button>
            )
          })}
        </div>

        {/* Strategy info panel */}
        <div className="rounded-xl border border-slate-700/50 bg-[#111827]/60 mb-6 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-800/30 transition-colors"
            onClick={() => setShowStrategy((v) => !v)}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-200">{persona.fullName}'s Strategy</span>
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: `${persona.accent}20`, color: persona.accent }}
              >
                {persona.tagline}
              </span>
            </div>
            <svg
              className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${showStrategy ? '' : '-rotate-90'}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showStrategy && (
            <div className="px-5 pb-5 border-t border-slate-700/30">
              <p className="text-sm text-slate-400 mt-4 mb-4 leading-relaxed">{persona.description}</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {persona.criteria.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-slate-300">
                    <span className="flex-shrink-0 mt-0.5" style={{ color: persona.accent }}>▸</span>
                    {c}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-600 mt-4 italic">{persona.rankBy}</p>
            </div>
          )}
        </div>

        {/* Action bar */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            {status === 'idle' && (
              <button
                onClick={() => handleRun(false)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm transition-all duration-200"
                style={{ backgroundColor: persona.accent, color: '#0d1117' }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Run {persona.name} Scan
              </button>
            )}
            {status === 'done' && (
              <button
                onClick={handleRefresh}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            )}
            {status === 'error' && (
              <button
                onClick={() => handleRun(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm bg-slate-800 border border-red-500/40 text-red-400 hover:bg-slate-700 transition-colors"
              >
                Retry Scan
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500">
            {results?.from_cache && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Cached
              </span>
            )}
            {lastRun && (
              <span>Updated {formatLastRun(lastRun)}</span>
            )}
            {results && (
              <span className="text-slate-600">
                {results.candidates_evaluated || '—'} US large-cap stocks evaluated
              </span>
            )}
          </div>
        </div>

        {/* States */}
        {status === 'loading' && (
          <LoadingPanel progress={progress} persona={activePersona} />
        )}

        {status === 'error' && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center">
            <p className="text-red-400 font-semibold mb-1">Screening Failed</p>
            <p className="text-slate-400 text-sm">{error}</p>
          </div>
        )}

        {status === 'idle' && (
          <div className="rounded-xl border border-slate-700/50 bg-[#111827]/40 p-12 text-center">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: `${persona.accent}15`, border: `1px solid ${persona.accent}30` }}
            >
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} style={{ color: persona.accent }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a3.75 3.75 0 01-1.298.872l-.11.042a3.75 3.75 0 01-2.687 0l-.11-.042a3.75 3.75 0 01-1.298-.872L12 17z" />
              </svg>
            </div>
            <p className="text-slate-300 font-semibold text-sm mb-1">Ready to scan the S&amp;P 500</p>
            <p className="text-slate-500 text-xs">
              Click "Run {persona.name} Scan" to screen ~65 high-liquidity US large-caps through {persona.fullName}'s criteria.
            </p>
          </div>
        )}

        {status === 'done' && results?.picks?.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">Top 5 Picks</span>
              <div className="h-px flex-1 bg-slate-700/50" />
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {results.picks.map((pick, i) => (
                <StockPickCard key={pick.ticker} pick={pick} rank={i + 1} persona={activePersona} />
              ))}
            </div>
          </div>
        )}

        {status === 'done' && (!results?.picks || results.picks.length === 0) && (
          <div className="rounded-xl border border-slate-700/50 bg-[#111827]/40 p-8 text-center">
            <p className="text-slate-400 font-semibold text-sm mb-1">No stocks met the criteria today</p>
            <p className="text-slate-500 text-xs">Market conditions may not align with {persona.fullName}'s strategy right now.</p>
          </div>
        )}

        <HistoryPanel history={history} persona={activePersona} />

        {/* Disclaimer */}
        <p className="mt-8 text-[10px] text-slate-600 text-center leading-relaxed">
          Signal Lab is for educational purposes only. Not financial advice. Past screener results do not guarantee future performance.
          Always do your own research before investing.
        </p>
      </div>
    </div>
  )
}
