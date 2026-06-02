import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts'
import { getReviewBars } from '../../api/reviewNotes'

// --- time helpers -----------------------------------------------------------

// Eastern-time UTC offset (seconds, negative) for a given YYYY-MM-DD. Derived
// via Intl so it's DST-correct (-4 EDT vs -5 EST). Massive returns bar times
// in UTC; we shift by this so lightweight-charts (which renders the raw number
// as UTC) actually shows ET wall-clock.
function etOffsetSeconds(dateStr) {
  try {
    const d = new Date(`${dateStr}T12:00:00Z`)
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      timeZoneName: 'shortOffset',
    }).formatToParts(d)
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT-5'
    const m = tzName.match(/GMT([+-]\d+)(?::(\d+))?/)
    if (!m) return -5 * 3600
    const h = parseInt(m[1], 10)
    const min = m[2] ? parseInt(m[2], 10) : 0
    return h * 3600 + Math.sign(h) * min * 60
  } catch {
    return -5 * 3600
  }
}

function datePart(d) {
  if (!d) return ''
  return String(d).split('T')[0]
}

// Combine a trade's date + ET wall-clock time into a "fake-UTC" epoch second
// that matches the shifted intraday bars.
function wallClockToEpoch(dateStr, timeStr) {
  const dp = datePart(dateStr)
  const t = timeStr && /^\d{1,2}:/.test(timeStr) ? timeStr : '00:00:00'
  const ms = Date.parse(`${dp}T${t}Z`)
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000)
}

function addDays(dateStr, n) {
  const d = new Date(`${datePart(dateStr)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function nearestBarTime(bars, target) {
  if (!bars.length || target == null) return null
  let best = bars[0].time
  let bestDiff = Math.abs(bars[0].time - target)
  for (let i = 1; i < bars.length; i++) {
    const diff = Math.abs(bars[i].time - target)
    if (diff < bestDiff) { bestDiff = diff; best = bars[i].time }
  }
  return best
}

// Decide resolution + fetch window from the hold duration.
function planFetch(entryDate, exitDate) {
  const e = new Date(`${datePart(entryDate)}T00:00:00Z`)
  const x = new Date(`${datePart(exitDate)}T00:00:00Z`)
  const holdDays = Math.max(0, Math.round((x - e) / 86400000))

  if (holdDays <= 1) {
    return { multiplier: 1, timespan: 'minute', intraday: true,
             frm: addDays(entryDate, -1), to: addDays(exitDate, 1) }
  }
  if (holdDays <= 4) {
    return { multiplier: 5, timespan: 'minute', intraday: true,
             frm: addDays(entryDate, -1), to: addDays(exitDate, 1) }
  }
  if (holdDays <= 20) {
    return { multiplier: 30, timespan: 'minute', intraday: true,
             frm: addDays(entryDate, -1), to: addDays(exitDate, 1) }
  }
  return { multiplier: 1, timespan: 'day', intraday: false,
           frm: addDays(entryDate, -25), to: addDays(exitDate, 12) }
}

const RESOLUTION_LABEL = (p) =>
  p.timespan === 'day' ? 'Daily' : `${p.multiplier}-min`

export default function LightweightTradeChart({
  symbol, entryDate, entryTime, exitDate, exitTime,
  entryPrice, exitPrice, height = 560,
}) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const [status, setStatus] = useState('loading') // loading | ready | empty | error
  const [resLabel, setResLabel] = useState('')

  useEffect(() => {
    if (!symbol || !entryDate || !containerRef.current) return
    let disposed = false
    const plan = planFetch(entryDate, exitDate || entryDate)
    setResLabel(RESOLUTION_LABEL(plan))
    setStatus('loading')

    getReviewBars({ symbol, frm: plan.frm, to: plan.to, multiplier: plan.multiplier, timespan: plan.timespan })
      .then((res) => {
        if (disposed) return
        const raw = res.bars || []
        if (raw.length === 0) { setStatus('empty'); return }

        // For intraday, shift UTC bar times into ET wall-clock so axis labels
        // match the trade's recorded times. Daily bars are date strings — no
        // shift needed.
        const offset = plan.intraday ? etOffsetSeconds(datePart(entryDate)) : 0
        const candles = raw
          .filter((b) => b.open != null && b.close != null)
          .map((b) => ({
            time: plan.intraday ? b.time + offset : b.time,
            open: b.open, high: b.high, low: b.low, close: b.close,
          }))
        const volumes = raw.map((b) => ({
          time: plan.intraday ? b.time + offset : b.time,
          value: b.volume || 0,
          color: (b.close ?? 0) >= (b.open ?? 0) ? 'rgba(52,211,153,0.35)' : 'rgba(251,113,133,0.35)',
        }))

        // Tear down any prior chart instance.
        if (chartRef.current) { chartRef.current.remove(); chartRef.current = null }
        containerRef.current.innerHTML = ''

        const chart = createChart(containerRef.current, {
          layout: {
            background: { type: ColorType.Solid, color: 'transparent' },
            textColor: '#94a3b8',
            fontSize: 11,
          },
          grid: {
            vertLines: { color: 'rgba(51,65,85,0.25)' },
            horzLines: { color: 'rgba(51,65,85,0.25)' },
          },
          crosshair: { mode: CrosshairMode.Normal },
          rightPriceScale: { borderColor: 'rgba(51,65,85,0.5)' },
          timeScale: {
            borderColor: 'rgba(51,65,85,0.5)',
            timeVisible: plan.intraday,
            secondsVisible: false,
          },
          autoSize: true,
        })
        chartRef.current = chart

        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#34d399', downColor: '#fb7185',
          borderUpColor: '#34d399', borderDownColor: '#fb7185',
          wickUpColor: '#34d399', wickDownColor: '#fb7185',
        })
        candleSeries.setData(candles)

        const volSeries = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: '',
        })
        volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
        volSeries.setData(volumes)

        // Entry / exit price lines.
        if (entryPrice != null) {
          candleSeries.createPriceLine({
            price: Number(entryPrice), color: '#34d399', lineWidth: 1,
            lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Entry',
          })
        }
        if (exitPrice != null) {
          candleSeries.createPriceLine({
            price: Number(exitPrice), color: '#fb7185', lineWidth: 1,
            lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Exit',
          })
        }

        // Entry / exit markers, snapped to the nearest available bar.
        const markers = []
        let entryT, exitT
        if (plan.intraday) {
          entryT = nearestBarTime(candles, wallClockToEpoch(entryDate, entryTime))
          exitT = nearestBarTime(candles, wallClockToEpoch(exitDate || entryDate, exitTime))
        } else {
          entryT = datePart(entryDate)
          exitT = datePart(exitDate || entryDate)
        }
        if (entryT != null) {
          markers.push({ time: entryT, position: 'belowBar', color: '#34d399', shape: 'arrowUp', text: 'BUY' })
        }
        if (exitT != null && exitT !== entryT) {
          markers.push({ time: exitT, position: 'aboveBar', color: '#fb7185', shape: 'arrowDown', text: 'SELL' })
        }
        // Markers must be time-ordered.
        markers.sort((a, b) => (a.time > b.time ? 1 : -1))
        if (markers.length) createSeriesMarkers(candleSeries, markers)

        // Jump the viewport to the exact trade window (+ padding).
        try {
          if (plan.intraday) {
            const padSec = plan.multiplier * 60 * 8 // ~8 bars of padding each side
            const from = (wallClockToEpoch(entryDate, entryTime) ?? candles[0].time) - padSec
            const to = (wallClockToEpoch(exitDate || entryDate, exitTime) ?? candles[candles.length - 1].time) + padSec
            chart.timeScale().setVisibleRange({ from, to })
          } else {
            chart.timeScale().setVisibleRange({
              from: addDays(entryDate, -7),
              to: addDays(exitDate || entryDate, 5),
            })
          }
        } catch {
          chart.timeScale().fitContent()
        }

        setStatus('ready')
      })
      .catch(() => { if (!disposed) setStatus('error') })

    return () => {
      disposed = true
      if (chartRef.current) { chartRef.current.remove(); chartRef.current = null }
    }
  }, [symbol, entryDate, entryTime, exitDate, exitTime, entryPrice, exitPrice])

  const fmtDT = (d, t) => {
    const dp = datePart(d)
    if (!dp) return '—'
    let label
    try { label = new Date(`${dp}T00:00:00`).toLocaleDateString() } catch { label = dp }
    const tt = t && /^\d{1,2}:/.test(t) ? t.slice(0, 8) : null
    return tt ? `${label} ${tt} ET` : label
  }

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-950 overflow-hidden flex flex-col" style={{ height: `${height}px` }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700/40 text-[11px]">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-mono font-semibold text-surface-100">{symbol?.toUpperCase()}</span>
          <span className="text-success">▲ Entry {fmtDT(entryDate, entryTime)}</span>
          <span className="text-danger">▼ Exit {fmtDT(exitDate, exitTime)}</span>
        </div>
        <div className="flex items-center gap-2 text-surface-500">
          {resLabel && <span className="px-1.5 py-0.5 rounded bg-surface-800/60 text-surface-400">{resLabel}</span>}
          <a
            href={`https://www.tradingview.com/chart/?symbol=${symbol?.toUpperCase()}`}
            target="_blank" rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            TradingView →
          </a>
        </div>
      </div>
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        {status !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-surface-500 pointer-events-none">
            {status === 'loading' && 'Loading chart…'}
            {status === 'empty' && 'No price data for this window.'}
            {status === 'error' && 'Could not load chart data.'}
          </div>
        )}
      </div>
    </div>
  )
}
