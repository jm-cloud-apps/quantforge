import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'
import { getIntraday } from '../../api/breakoutScreener'

function vwap(bars) {
  let cumPV = 0
  let cumV = 0
  return bars.map((b) => {
    const typical = (b.high + b.low + b.close) / 3
    cumPV += typical * b.volume
    cumV += b.volume
    return cumV > 0 ? cumPV / cumV : null
  })
}

const IntradayModal = ({ symbol, pivot, onClose }) => {
  const containerRef = useRef(null)
  const [bars, setBars] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getIntraday(symbol, 2)
      .then((res) => { if (alive) setBars(res.bars || []) })
      .catch((e) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [symbol])

  useEffect(() => {
    if (!containerRef.current || bars.length === 0) return
    const chart = createChart(containerRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8', fontSize: 11 },
      grid: {
        vertLines: { color: 'rgba(148, 163, 184, 0.06)' },
        horzLines: { color: 'rgba(148, 163, 184, 0.08)' },
      },
      timeScale: { borderColor: 'rgba(148, 163, 184, 0.2)', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: 'rgba(148, 163, 184, 0.2)', scaleMargins: { top: 0.05, bottom: 0.25 } },
      crosshair: { mode: 1 },
    })

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#ef4444',
      borderVisible: false, wickUpColor: '#10b981', wickDownColor: '#ef4444',
    })
    candle.setData(bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })))

    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' }, priceScaleId: '', color: '#475569',
    })
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } })
    vol.setData(
      bars.map((b) => ({
        time: b.time, value: b.volume,
        color: b.close >= b.open ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)',
      })),
    )

    // VWAP overlay
    const vwapVals = vwap(bars)
    const vwapSeries = chart.addSeries(LineSeries, {
      color: '#a855f7', lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
    })
    vwapSeries.setData(bars.map((b, i) => ({ time: b.time, value: vwapVals[i] })))

    // Pivot line
    if (pivot) {
      candle.createPriceLine({
        price: pivot, color: '#22c55e', lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title: 'Pivot',
      })
    }

    chart.timeScale().fitContent()
    const resize = () => containerRef.current && chart.applyOptions({ width: containerRef.current.clientWidth })
    window.addEventListener('resize', resize)
    resize()
    return () => { window.removeEventListener('resize', resize); chart.remove() }
  }, [bars, pivot])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-5xl mx-4 rounded-2xl bg-surface-900 border border-surface-700/50 p-6 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-surface-100">{symbol} · Intraday (5m)</h3>
            <p className="text-xs text-surface-400">
              VWAP (purple) · Pivot (green dashed) · last 2 trading days
            </p>
          </div>
          <button onClick={onClose} className="text-surface-400 hover:text-surface-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && <p className="text-danger text-sm">{error}</p>}
        {loading && <p className="text-surface-400 text-sm">Loading intraday data…</p>}
        <div ref={containerRef} className="w-full h-[450px]" />
      </div>
    </div>
  )
}

export default IntradayModal
