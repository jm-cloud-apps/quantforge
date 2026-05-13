import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts'
import IntradayModal from './IntradayModal'

const STATUS_COLORS = {
  READY: 'text-success',
  GOOD: 'text-success',
  DEVELOPING: 'text-warning',
  EMERGING: 'text-accent',
  WATCH: 'text-surface-400',
}

const SENTIMENT_COLORS = {
  positive: 'text-success',
  neutral: 'text-surface-400',
  negative: 'text-danger',
}

function ema(values, span) {
  const k = 2 / (span + 1)
  const out = []
  let prev = null
  for (const v of values) {
    prev = prev == null ? v : v * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}

const fmtPct = (v, digits = 1) => (v == null ? '–' : `${(v * 100).toFixed(digits)}%`)

const ChartCard = ({ candidate, rank }) => {
  const containerRef = useRef(null)
  const [showIntraday, setShowIntraday] = useState(false)

  useEffect(() => {
    if (!containerRef.current || !candidate?.ohlcv_tail?.length) return

    const chart = createChart(containerRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8', fontSize: 10 },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(148, 163, 184, 0.08)' },
      },
      timeScale: { borderColor: 'rgba(148, 163, 184, 0.2)', timeVisible: false },
      rightPriceScale: {
        borderColor: 'rgba(148, 163, 184, 0.2)',
        scaleMargins: { top: 0.05, bottom: 0.25 },
      },
      crosshair: { mode: 0 },
      handleScale: false,
      handleScroll: false,
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#ef4444',
      borderVisible: false, wickUpColor: '#10b981', wickDownColor: '#ef4444',
    })
    const bars = candidate.ohlcv_tail.map((b) => ({
      time: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
    }))
    candleSeries.setData(bars)

    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' }, priceScaleId: '', color: '#475569',
    })
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } })
    volSeries.setData(
      candidate.ohlcv_tail.map((b) => ({
        time: b.time, value: b.volume,
        color: b.close >= b.open ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)',
      })),
    )

    const closes = bars.map((b) => b.close)
    const ema10 = ema(closes, 10)
    const ema20 = ema(closes, 20)
    const ema10Series = chart.addSeries(LineSeries, {
      color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
    })
    ema10Series.setData(bars.map((b, i) => ({ time: b.time, value: ema10[i] })))
    const ema20Series = chart.addSeries(LineSeries, {
      color: '#3b82f6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
    })
    ema20Series.setData(bars.map((b, i) => ({ time: b.time, value: ema20[i] })))

    if (candidate.base_top || candidate.pivot) {
      candleSeries.createPriceLine({
        price: candidate.base_top || candidate.pivot,
        color: '#22c55e', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Pivot',
      })
    }
    if (candidate.base_bottom) {
      candleSeries.createPriceLine({
        price: candidate.base_bottom,
        color: '#ef4444', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: 'Base low',
      })
    }

    chart.timeScale().fitContent()
    const handleResize = () => containerRef.current && chart.applyOptions({ width: containerRef.current.clientWidth })
    window.addEventListener('resize', handleResize)
    handleResize()

    return () => { window.removeEventListener('resize', handleResize); chart.remove() }
  }, [candidate])

  const statusClass = STATUS_COLORS[candidate.status] || 'text-surface-400'
  const distPct = candidate.distance_pct != null ? (candidate.distance_pct * 100).toFixed(1) : null
  const news = candidate.news
  const sentimentClass = news?.sentiment ? SENTIMENT_COLORS[news.sentiment.label] || 'text-surface-400' : ''

  const rsiColor =
    candidate.rsi == null ? 'text-surface-200'
    : candidate.rsi >= 70 ? 'text-warning'
    : candidate.rsi <= 30 ? 'text-accent'
    : 'text-surface-200'

  const stats = [
    { label: 'ADR', value: fmtPct(candidate.adr_pct) },
    { label: 'RVOL', value: candidate.rvol != null ? `${candidate.rvol.toFixed(2)}x` : '–' },
    { label: 'RSI', value: candidate.rsi != null ? candidate.rsi.toFixed(0) : '–', cls: rsiColor },
    { label: 'Base', value: candidate.base_length != null ? `${candidate.base_length}d` : '–' },
    { label: 'Range', value: fmtPct(candidate.range_pct) },
    { label: 'Pullback', value: fmtPct(candidate.pullback_pct) },
    { label: 'Thrust', value: fmtPct(candidate.thrust_pct) },
    { label: '3M', value: fmtPct(candidate.ret_3m, 0) },
  ]

  return (
    <>
      <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-3 flex flex-col gap-2 hover:border-accent/30 transition-colors">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-mono text-surface-500">#{rank}</span>
              <span className="text-base font-bold text-surface-100">{candidate.symbol}</span>
            </div>
            <div className="text-[10px] text-surface-500 mt-0.5 flex items-center gap-2">
              <span>${candidate.last_close?.toFixed(2)}</span>
              {distPct != null && (
                <span className={distPct >= 0 ? 'text-surface-400' : 'text-warning'}>
                  {distPct >= 0 ? `${distPct}% to pivot` : `${Math.abs(distPct)}% past pivot`}
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-success leading-none">{candidate.score?.toFixed(1)}</div>
            <div className={`text-[10px] font-mono uppercase tracking-wider mt-0.5 ${statusClass}`}>
              {candidate.status}
            </div>
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1">
          {candidate.tags?.map((t) => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-md bg-surface-800 border border-surface-700/50 text-surface-300">
              {t}
            </span>
          ))}
        </div>

        {/* Chart */}
        <div ref={containerRef} className="w-full h-[220px]" />

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-1.5 text-[10px] font-mono">
          {stats.map((s) => (
            <div key={s.label} className="rounded bg-surface-800/60 px-1.5 py-1">
              <div className="text-surface-500 uppercase text-[9px]">{s.label}</div>
              <div className={s.cls || 'text-surface-200'}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Catalyst headline */}
        {news?.title && (
          <a
            href={news.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg bg-surface-800/40 border border-surface-700/40 px-2 py-1.5 hover:border-accent/40 transition-colors"
            title={news.sentiment?.reasoning}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] text-surface-200 leading-snug line-clamp-2">{news.title}</p>
              {news.sentiment?.label && (
                <span className={`text-[9px] uppercase font-mono shrink-0 ${sentimentClass}`}>
                  {news.sentiment.label}
                </span>
              )}
            </div>
            <p className="text-[9px] text-surface-500 mt-0.5">
              {news.site} · {news.publishedDate}
            </p>
          </a>
        )}

        {/* Intraday button — only show for READY/GOOD */}
        {(candidate.status === 'READY' || candidate.status === 'GOOD') && (
          <button
            onClick={() => setShowIntraday(true)}
            className="text-[11px] text-accent hover:text-accent/80 font-medium border-t border-surface-700/30 pt-2"
          >
            ↗ View intraday (5m)
          </button>
        )}
      </div>

      {showIntraday && (
        <IntradayModal
          symbol={candidate.symbol}
          pivot={candidate.base_top || candidate.pivot}
          onClose={() => setShowIntraday(false)}
        />
      )}
    </>
  )
}

export default ChartCard
