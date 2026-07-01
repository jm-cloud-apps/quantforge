import { useEffect, useId, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Embedded TradingView "Advanced Chart" widget (tv.js), loaded lazily and only
// once. Defaults to the WEEKLY interval with a 30-period SMA — i.e. the exact
// 30-week-MA weekly view Weinstein stage analysis is read off, so the chart the
// user sees matches the stage the scanner assigned.
//
// tv.js is loaded on demand (never in the initial bundle); the promise is
// memoised so a page full of expandable rows shares a single script load.
// ---------------------------------------------------------------------------

let tvScriptPromise = null
function loadTradingView() {
  if (typeof window !== 'undefined' && window.TradingView) return Promise.resolve()
  if (tvScriptPromise) return tvScriptPromise
  tvScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://s3.tradingview.com/tv.js'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { tvScriptPromise = null; reject(new Error('tv.js failed to load')) }
    document.head.appendChild(s)
  })
  return tvScriptPromise
}

const INTERVALS = [
  { key: 'W', label: 'Weekly' },
  { key: 'D', label: 'Daily' },
  { key: 'M', label: 'Monthly' },
]

export default function TradingViewChart({ symbol, height = 460, maLength = 30 }) {
  const rawId = useId()
  const containerId = `tv_${rawId.replace(/[^a-zA-Z0-9]/g, '')}_${String(symbol || '').replace(/[^A-Z0-9]/gi, '')}`
  const containerRef = useRef(null)
  const [interval, setInterval] = useState('W')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    loadTradingView()
      .then(() => {
        if (cancelled || !containerRef.current || !window.TradingView) return
        containerRef.current.innerHTML = ''
        // eslint-disable-next-line no-new
        new window.TradingView.widget({
          container_id: containerId,
          symbol: String(symbol || '').toUpperCase(),
          interval,
          autosize: true,
          theme: 'dark',
          style: '1',
          timezone: 'Etc/UTC',
          locale: 'en',
          withdateranges: true,
          hide_side_toolbar: false,
          allow_symbol_change: false,
          // A single simple MA set to the Weinstein length (30 on the weekly =
          // the 30-week MA), coloured amber to match the app's stage theme.
          studies: ['MASimple@tv-basicstudies'],
          studies_overrides: {
            'MASimple@tv-basicstudies.length': maLength,
            'MASimple@tv-basicstudies.plot.color': '#f59e0b',
            'MASimple@tv-basicstudies.plot.linewidth': 2,
          },
        })
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [symbol, interval, containerId, maLength])

  const tvUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(String(symbol || '').toUpperCase())}`

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-1">
          {INTERVALS.map(iv => (
            <button
              key={iv.key}
              onClick={() => setInterval(iv.key)}
              className={`px-2 py-1 rounded-md text-[11px] font-medium border transition ${
                interval === iv.key
                  ? 'bg-accent/15 border-accent/40 text-accent'
                  : 'bg-surface-900/80 border-surface-700/50 text-surface-400 hover:text-surface-100'
              }`}
            >
              {iv.label}
            </button>
          ))}
          <span className="ml-2 text-[10.5px] text-surface-500">
            <span className="text-amber-400">━</span> {maLength}-{interval === 'W' ? 'week' : interval === 'M' ? 'month' : 'day'} MA
          </span>
        </div>
        <a
          href={tvUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-surface-400 hover:text-accent transition-colors"
        >
          Open in TradingView ↗
        </a>
      </div>

      {failed ? (
        <div
          className="rounded-lg bg-surface-950/40 border border-surface-700/40 flex items-center justify-center text-[12px] text-surface-500"
          style={{ height }}
        >
          Couldn't load the TradingView chart —{' '}
          <a href={tvUrl} target="_blank" rel="noopener noreferrer" className="text-accent ml-1 hover:underline">
            open it on TradingView ↗
          </a>
        </div>
      ) : (
        <div
          id={containerId}
          ref={containerRef}
          style={{ height }}
          className="rounded-lg overflow-hidden bg-surface-950/40"
        />
      )}
    </div>
  )
}
