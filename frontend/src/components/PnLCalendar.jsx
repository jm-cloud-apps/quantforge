import { Fragment, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'

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

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function PnLCalendar({ calendarData, onDayClick, onWeekClick, loading }) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth())
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear())
  // Hover tooltip rendered via a portal (see below) so it can't be clipped by
  // the grid's overflow-hidden or hidden behind neighbouring cells.
  const [hover, setHover] = useState(null) // { rect, date, pnl, trades, win_rate, isProfit, isLoss }

  const today = todayStr()

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

    const startDate = new Date(firstOfMonth)
    const startDow = startDate.getDay()
    if (startDow === 0) startDate.setDate(startDate.getDate() + 1)
    else if (startDow === 6) startDate.setDate(startDate.getDate() + 2)
    else startDate.setDate(startDate.getDate() - (startDow - 1))

    const endDate = new Date(lastOfMonth)
    const endDow = endDate.getDay()
    if (endDow === 0) endDate.setDate(endDate.getDate() - 2)
    else if (endDow === 6) endDate.setDate(endDate.getDate() - 1)
    else endDate.setDate(endDate.getDate() + (5 - endDow))

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
        if (cell.data && !cell.isAdjacentMonth) {
          pnl += cell.data.pnl
          tradingDays++
          trades += cell.data.trades
        }
      }
      return { pnl, tradingDays, trades }
    })
  }, [weeks])

  // Monthly totals
  const monthStats = useMemo(() => {
    let totalPnl = 0
    let totalTrades = 0
    let tradingDays = 0
    let wins = 0
    for (const cell of grid) {
      if (!cell.isAdjacentMonth && cell.data) {
        totalPnl += cell.data.pnl
        totalTrades += cell.data.trades
        tradingDays++
        wins += cell.data.wins || 0
      }
    }
    const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0
    const avgDaily = tradingDays > 0 ? totalPnl / tradingDays : 0
    return { totalPnl, totalTrades, tradingDays, winRate, avgDaily }
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

  // Keyboard: arrow left/right for month navigation
  function handleKeyDown(e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); prevMonth() }
    if (e.key === 'ArrowRight') { e.preventDefault(); nextMonth() }
  }

  if (loading) {
    return (
      <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
        {/* Skeleton calendar */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="skeleton w-8 h-8 rounded-lg" />
            <div className="skeleton h-6 w-40" />
            <div className="skeleton w-8 h-8 rounded-lg" />
          </div>
        </div>
        <div className="grid grid-cols-5 gap-[1px]">
          {[...Array(25)].map((_, i) => (
            <div key={i} className="skeleton min-h-[72px]" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="grid"
      aria-label={`P&L Calendar for ${MONTH_NAMES[currentMonth]} ${currentYear}`}
    >
      {/* Header: Month Navigation */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={prevMonth}
            className="w-10 h-10 rounded-xl bg-surface-800 border border-surface-700/50 flex items-center justify-center text-surface-300 hover:bg-surface-700 hover:text-surface-100 transition-colors"
            aria-label="Previous month"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h2 className="font-display font-semibold text-lg text-surface-50 select-none min-w-[180px] text-center">
            {MONTH_NAMES[currentMonth]} {currentYear}
          </h2>
          <button
            onClick={nextMonth}
            className="w-10 h-10 rounded-xl bg-surface-800 border border-surface-700/50 flex items-center justify-center text-surface-300 hover:bg-surface-700 hover:text-surface-100 transition-colors"
            aria-label="Next month"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Calendar Grid — 5 weekday columns + Total */}
      <div className="grid grid-cols-[repeat(5,1fr)_minmax(90px,auto)] gap-[1px] bg-surface-700/30 rounded-lg overflow-hidden">
        {/* Day name headers */}
        {DAY_NAMES.map((name) => (
          <div key={name} className="bg-surface-900/90 text-center text-[11px] font-medium text-surface-500 uppercase tracking-wider py-2.5">
            {name}
          </div>
        ))}
        <div className="bg-surface-900/90 text-center text-[11px] font-medium text-surface-500 uppercase tracking-wider py-2.5">
          Total
        </div>

        {/* Week rows */}
        {weeks.map((week, wi) => (
          <Fragment key={wi}>
            {week.map((cell, ci) => {
              const hasData = !!cell.data
              const pnl = cell.data?.pnl ?? 0
              const isProfit = pnl > 0
              const isLoss = pnl < 0
              const trades = cell.data?.trades ?? 0
              const dimmed = cell.isAdjacentMonth
              const isToday = cell.date === today
              const cellId = `${wi}-${ci}`

              return (
                <div
                  key={cellId}
                  onClick={() => hasData && !dimmed && onDayClick?.(cell.date, cell.data)}
                  onMouseEnter={(e) => hasData && !dimmed && setHover({
                    rect: e.currentTarget.getBoundingClientRect(),
                    date: cell.date, pnl, trades,
                    win_rate: cell.data?.win_rate, isProfit, isLoss,
                  })}
                  onMouseLeave={() => setHover(null)}
                  className={`
                    relative min-h-[72px] p-2.5 transition-all duration-150
                    ${hasData && !dimmed ? 'cursor-pointer hover:scale-[1.02] hover:z-10 hover:shadow-lg' : 'cursor-default'}
                    ${isProfit && !dimmed ? 'bg-success/[0.07] hover:bg-success/[0.14]' : ''}
                    ${isLoss && !dimmed ? 'bg-danger/[0.07] hover:bg-danger/[0.14]' : ''}
                    ${(!hasData || (!isProfit && !isLoss)) || dimmed ? 'bg-surface-900/90' : ''}
                  `}
                >
                  {/* Day number + today indicator */}
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-xs font-medium ${
                      isToday ? 'text-white bg-accent w-6 h-6 rounded-full flex items-center justify-center -ml-0.5'
                        : dimmed ? 'text-surface-600' : 'text-surface-300'
                    }`}>
                      {cell.day}
                    </span>
                  </div>

                  {/* P&L data */}
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

            {/* Weekly total cell — click for the week's trade summary */}
            {(() => {
              const wk = weeklySummaries[wi]
              const weekDates = week.filter((c) => !c.isAdjacentMonth).map((c) => c.date)
              const clickable = wk.trades > 0
              return (
                <div
                  onClick={() => clickable && onWeekClick?.(weekDates)}
                  className={`min-h-[72px] p-2.5 flex flex-col justify-center transition-colors ${
                    wk.pnl > 0 ? 'bg-success/[0.05]' : wk.pnl < 0 ? 'bg-danger/[0.05]' : 'bg-surface-900/90'
                  } ${clickable ? 'cursor-pointer hover:bg-surface-800/60' : ''}`}
                >
                  <div className="text-[10px] text-surface-500 font-medium mb-1">Week {wi + 1}</div>
                  <div className={`text-xs font-semibold font-mono ${wk.pnl > 0 ? 'text-success' : wk.pnl < 0 ? 'text-danger' : 'text-surface-500'}`}>
                    {wk.pnl > 0 ? '+' : ''}{fmt(wk.pnl)}
                  </div>
                  <div className="text-[10px] text-surface-500 mt-0.5">
                    {wk.trades} trade{wk.trades !== 1 ? 's' : ''}
                  </div>
                </div>
              )
            })()}
          </Fragment>
        ))}
      </div>

      {/* Monthly summary card */}
      {monthStats.tradingDays > 0 && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg bg-surface-800/60 border border-surface-700/30 px-4 py-3">
            <p className="text-[11px] text-surface-500 font-medium uppercase tracking-wider">Monthly P&L</p>
            <p className={`text-lg font-bold font-mono mt-1 ${monthStats.totalPnl >= 0 ? 'text-success' : 'text-danger'}`}>
              {monthStats.totalPnl >= 0 ? '+' : ''}{fmt(monthStats.totalPnl)}
            </p>
          </div>
          <div className="rounded-lg bg-surface-800/60 border border-surface-700/30 px-4 py-3">
            <p className="text-[11px] text-surface-500 font-medium uppercase tracking-wider">Win Rate</p>
            <p className={`text-lg font-bold font-mono mt-1 ${monthStats.winRate >= 50 ? 'text-success' : 'text-danger'}`}>
              {monthStats.winRate}%
            </p>
          </div>
          <div className="rounded-lg bg-surface-800/60 border border-surface-700/30 px-4 py-3">
            <p className="text-[11px] text-surface-500 font-medium uppercase tracking-wider">Trading Days</p>
            <p className="text-lg font-bold font-mono mt-1 text-surface-100">{monthStats.tradingDays}</p>
          </div>
          <div className="rounded-lg bg-surface-800/60 border border-surface-700/30 px-4 py-3">
            <p className="text-[11px] text-surface-500 font-medium uppercase tracking-wider">Avg Daily</p>
            <p className={`text-lg font-bold font-mono mt-1 ${monthStats.avgDaily >= 0 ? 'text-success' : 'text-danger'}`}>
              {monthStats.avgDaily >= 0 ? '+' : ''}{fmt(monthStats.avgDaily)}
            </p>
          </div>
        </div>
      )}

      {/* Hover tooltip — portaled to <body> with fixed positioning so it's
          never clipped by the grid's overflow-hidden, and flips below the cell
          when there isn't room above (top row). */}
      {hover && createPortal((() => {
        const above = hover.rect.top > 150
        const style = {
          position: 'fixed',
          left: hover.rect.left + hover.rect.width / 2,
          top: above ? hover.rect.top - 8 : hover.rect.bottom + 8,
          transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          zIndex: 9999,
          pointerEvents: 'none',
        }
        return (
          <div style={style} className="animate-scale-in">
            <div className="bg-surface-800 border border-surface-700/60 rounded-xl px-4 py-3 shadow-2xl min-w-[170px]">
              <p className="text-[11px] text-surface-400 font-medium mb-1.5">
                {new Date(hover.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </p>
              <p className={`text-base font-bold font-mono ${hover.isProfit ? 'text-success' : hover.isLoss ? 'text-danger' : 'text-surface-300'}`}>
                {hover.isProfit ? '+' : ''}{fmt(hover.pnl)}
              </p>
              <div className="flex items-center gap-3 mt-1.5 text-[11px] text-surface-400">
                <span>{hover.trades} trade{hover.trades !== 1 ? 's' : ''}</span>
                {hover.win_rate != null && <span>{hover.win_rate}% win</span>}
              </div>
              <p className="text-[10px] text-surface-500 mt-1.5">Click for trade details</p>
            </div>
          </div>
        )
      })(), document.body)}
    </div>
  )
}
