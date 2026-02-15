import { Fragment, useState, useMemo } from 'react'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function fmt(val) {
  if (val == null || val === 0) return '$0'
  const abs = Math.abs(val)
  const str = abs >= 1000
    ? `$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${abs.toFixed(2)}`
  return `${val < 0 ? '-' : ''}${str}`
}

export default function PnLCalendar({ calendarData, onDayClick, loading }) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth())
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear())

  // Build lookup: "YYYY-MM-DD" -> day data
  const dayMap = useMemo(() => {
    const map = {}
    if (calendarData?.days) {
      for (const d of calendarData.days) {
        map[d.date] = d
      }
    }
    return map
  }, [calendarData])

  // Generate weekday-only grid (Mon-Fri)
  const grid = useMemo(() => {
    const firstOfMonth = new Date(currentYear, currentMonth, 1)
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
    const lastOfMonth = new Date(currentYear, currentMonth, daysInMonth)

    // Find the Monday of the week containing the 1st
    const startDate = new Date(firstOfMonth)
    const startDow = startDate.getDay()
    if (startDow === 0) startDate.setDate(startDate.getDate() + 1)       // Sun -> next Mon
    else if (startDow === 6) startDate.setDate(startDate.getDate() + 2)  // Sat -> next Mon
    else startDate.setDate(startDate.getDate() - (startDow - 1))         // Back to Monday

    // Find the Friday of the week containing the last day
    const endDate = new Date(lastOfMonth)
    const endDow = endDate.getDay()
    if (endDow === 0) endDate.setDate(endDate.getDate() - 2)             // Sun -> prev Fri
    else if (endDow === 6) endDate.setDate(endDate.getDate() - 1)        // Sat -> prev Fri
    else endDate.setDate(endDate.getDate() + (5 - endDow))               // Forward to Friday

    const cells = []
    const cur = new Date(startDate)
    while (cur <= endDate) {
      const dow = cur.getDay()
      if (dow >= 1 && dow <= 5) {
        const isCurrentMonth = cur.getMonth() === currentMonth && cur.getFullYear() === currentYear
        const y = cur.getFullYear()
        const m = cur.getMonth() + 1
        const d = cur.getDate()
        const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        cells.push({ day: d, date: dateStr, data: dayMap[dateStr] || null, isAdjacentMonth: !isCurrentMonth })
      }
      cur.setDate(cur.getDate() + 1)
    }

    return cells
  }, [currentMonth, currentYear, dayMap])

  // Split grid into weeks of 5 (Mon-Fri)
  const weeks = useMemo(() => {
    const rows = []
    for (let i = 0; i < grid.length; i += 5) {
      rows.push(grid.slice(i, i + 5))
    }
    return rows
  }, [grid])

  // Weekly summaries
  const weeklySummaries = useMemo(() => {
    return weeks.map((week) => {
      let pnl = 0
      let tradingDays = 0
      let trades = 0
      for (const cell of week) {
        if (cell.data) {
          pnl += cell.data.pnl
          tradingDays++
          trades += cell.data.trades
        }
      }
      return { pnl, tradingDays, trades }
    })
  }, [weeks])

  // Monthly totals (current month only)
  const monthStats = useMemo(() => {
    let totalPnl = 0
    let totalTrades = 0
    let tradingDays = 0
    for (const cell of grid) {
      if (!cell.isAdjacentMonth && cell.data) {
        totalPnl += cell.data.pnl
        totalTrades += cell.data.trades
        tradingDays++
      }
    }
    return { totalPnl, totalTrades, tradingDays }
  }, [grid])

  function prevMonth() {
    if (currentMonth === 0) {
      setCurrentMonth(11)
      setCurrentYear(currentYear - 1)
    } else {
      setCurrentMonth(currentMonth - 1)
    }
  }

  function nextMonth() {
    if (currentMonth === 11) {
      setCurrentMonth(0)
      setCurrentYear(currentYear + 1)
    } else {
      setCurrentMonth(currentMonth + 1)
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
        <div className="flex items-center justify-center py-12 text-surface-400">
          Loading calendar...
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
      {/* Header: Month Navigation + Monthly P&L */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={prevMonth}
            className="w-8 h-8 rounded-lg bg-surface-800 border border-surface-700/50 flex items-center justify-center text-surface-300 hover:bg-surface-700 hover:text-surface-100 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h2 className="font-display font-semibold text-lg text-surface-50">
            {MONTH_NAMES[currentMonth]}, {currentYear}
          </h2>
          <button
            onClick={nextMonth}
            className="w-8 h-8 rounded-lg bg-surface-800 border border-surface-700/50 flex items-center justify-center text-surface-300 hover:bg-surface-700 hover:text-surface-100 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
        <div className="text-sm text-surface-400">
          Monthly P&L:{' '}
          <span className={`font-mono font-semibold ${monthStats.totalPnl >= 0 ? 'text-success' : 'text-danger'}`}>
            {monthStats.totalPnl >= 0 ? '' : '-'}${Math.abs(monthStats.totalPnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Calendar Grid — 5 weekday columns + Total */}
      <div className="grid grid-cols-[repeat(5,1fr)_minmax(90px,auto)] gap-[1px] bg-surface-700/30 rounded-lg overflow-hidden">
        {/* Day name headers */}
        {DAY_NAMES.map((name) => (
          <div key={name} className="bg-surface-900/90 text-center text-[11px] font-medium text-surface-500 uppercase tracking-wider py-2">
            {name}
          </div>
        ))}
        {/* Total column header */}
        <div className="bg-surface-900/90 text-center text-[11px] font-medium text-surface-500 uppercase tracking-wider py-2">
          Total
        </div>

        {/* Week rows */}
        {weeks.map((week, wi) => (
          <Fragment key={wi}>
            {/* Day cells */}
            {week.map((cell, ci) => {
              const hasData = !!cell.data
              const pnl = cell.data?.pnl ?? 0
              const isProfit = pnl > 0
              const isLoss = pnl < 0
              const trades = cell.data?.trades ?? 0
              const dimmed = cell.isAdjacentMonth

              return (
                <div
                  key={`${wi}-${ci}`}
                  onClick={() => hasData && onDayClick?.(cell.date, cell.data)}
                  className={`
                    min-h-[80px] p-2.5 transition-all
                    ${hasData && !dimmed ? 'cursor-pointer' : 'cursor-default'}
                    ${isProfit && !dimmed ? 'bg-success/[0.07] hover:bg-success/[0.14]' : ''}
                    ${isLoss && !dimmed ? 'bg-danger/[0.07] hover:bg-danger/[0.14]' : ''}
                    ${(!hasData || (!isProfit && !isLoss)) || dimmed ? 'bg-surface-900/90' : ''}
                  `}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-xs font-medium ${dimmed ? 'text-surface-600' : 'text-surface-300'}`}>
                      {cell.day}
                    </span>
                  </div>
                  {!dimmed && (
                    <>
                      <div className={`text-xs font-semibold font-mono ${isProfit ? 'text-success' : isLoss ? 'text-danger' : 'text-surface-500'}`}>
                        {isProfit ? '+' : ''}{fmt(pnl)}
                      </div>
                      <div className="text-[10px] text-surface-500 mt-0.5">
                        {trades} trade{trades !== 1 ? 's' : ''}
                      </div>
                    </>
                  )}
                </div>
              )
            })}

            {/* Weekly total cell */}
            <div className={`min-h-[80px] p-2.5 flex flex-col justify-center ${
              weeklySummaries[wi].pnl > 0 ? 'bg-success/[0.05]' : weeklySummaries[wi].pnl < 0 ? 'bg-danger/[0.05]' : 'bg-surface-900/90'
            }`}>
              <div className="text-[10px] text-surface-500 font-medium mb-1">Week {wi + 1}</div>
              <div className={`text-xs font-semibold font-mono ${weeklySummaries[wi].pnl > 0 ? 'text-success' : weeklySummaries[wi].pnl < 0 ? 'text-danger' : 'text-surface-500'}`}>
                {weeklySummaries[wi].pnl > 0 ? '+' : ''}{fmt(weeklySummaries[wi].pnl)}
              </div>
              <div className="text-[10px] text-surface-500 mt-0.5">
                {weeklySummaries[wi].trades} trade{weeklySummaries[wi].trades !== 1 ? 's' : ''}
              </div>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  )
}
