import { useEffect } from 'react'

// Match the calendar's keying: trades roll up to their exit date (fallback entry).
function toDateKey(val) {
  if (!val) return null
  if (typeof val === 'string') {
    const m = val.match(/^(\d{4}-\d{2}-\d{2})/)
    if (m) return m[1]
  }
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}

const fmtUSD = (v) => {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  const a = Math.abs(n)
  return `${n < 0 ? '-' : ''}$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function DayTradesModal({ dates, trades, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // `dates` is a set of YYYY-MM-DD strings — a single day, or a whole week
  // when the Total column is clicked.
  const sorted = [...new Set(dates || [])].sort()
  const dateSet = new Set(sorted)
  const isWeek = sorted.length > 1

  const dayTrades = (trades || [])
    .filter((t) => dateSet.has(toDateKey(t.exit_date) || toDateKey(t.entry_date)))
    .sort((a, b) => (b.pnl || 0) - (a.pnl || 0))

  const totalPnl = dayTrades.reduce((s, t) => s + (t.pnl || 0), 0)
  const count = dayTrades.length
  const wins = dayTrades.filter((t) => (t.pnl || 0) > 0).length
  const losses = dayTrades.filter((t) => (t.pnl || 0) < 0).length
  const winRate = count > 0 ? Math.round((wins / count) * 100) : 0

  const fmtFull = (ds) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const fmtShort = (ds) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const title = !sorted.length ? 'No trades'
    : isWeek ? `Week of ${fmtShort(sorted[0])} – ${fmtShort(sorted[sorted.length - 1])}`
    : fmtFull(sorted[0])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl mx-4 rounded-2xl bg-surface-900 border border-surface-700/50 shadow-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5 border-b border-surface-700/40">
          <div>
            <h3 className="font-display font-semibold text-lg text-surface-50">{title}</h3>
            <p className="text-[12px] text-surface-400 mt-0.5">{count} trade{count !== 1 ? 's' : ''} closed {isWeek ? 'this week' : 'this day'}</p>
          </div>
          <button onClick={onClose} className="text-surface-400 hover:text-surface-200 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-3 p-5 border-b border-surface-700/40">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-surface-500">Net P&L</p>
            <p className={`text-xl font-bold font-mono mt-0.5 ${totalPnl >= 0 ? 'text-success' : 'text-danger'}`}>
              {totalPnl >= 0 ? '+' : ''}{fmtUSD(totalPnl)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-surface-500">Win rate</p>
            <p className={`text-xl font-bold font-mono mt-0.5 ${winRate >= 50 ? 'text-success' : 'text-danger'}`}>{winRate}%</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-surface-500">Win / Loss</p>
            <p className="text-xl font-bold font-mono mt-0.5 text-surface-100">{wins} / {losses}</p>
          </div>
        </div>

        {/* Trades */}
        <div className="overflow-y-auto px-2 py-1">
          {dayTrades.length === 0 ? (
            <p className="text-sm text-surface-500 py-8 text-center">No individual trade details for this day.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-900">
                <tr className="text-[10px] uppercase tracking-wider text-surface-500 border-b border-surface-700/40">
                  <th className="text-left font-medium py-2 px-3">Symbol</th>
                  <th className="text-left font-medium py-2 px-2">Side</th>
                  <th className="text-right font-medium py-2 px-2">Entry</th>
                  <th className="text-right font-medium py-2 px-2">Exit</th>
                  <th className="text-right font-medium py-2 px-2">Qty</th>
                  <th className="text-right font-medium py-2 px-3">P&L</th>
                </tr>
              </thead>
              <tbody>
                {dayTrades.map((t, i) => (
                  <tr key={i} className="border-b border-surface-800/40 last:border-0">
                    <td className="py-2 px-3 font-mono font-semibold text-surface-100">
                      {t.symbol}
                      {typeof t.setup === 'string' && t.setup && (
                        <span className="block text-[10px] text-surface-500 font-normal">{t.setup.split(' - ')[0]}</span>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${t.side === 'LONG' ? 'bg-accent/15 text-accent' : 'bg-danger/10 text-danger'}`}>{t.side || '—'}</span>
                    </td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums text-surface-300">${Number(t.entry_price ?? 0).toFixed(2)}</td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums text-surface-300">${Number(t.exit_price ?? 0).toFixed(2)}</td>
                    <td className="py-2 px-2 text-right font-mono tabular-nums text-surface-400">{t.quantity}</td>
                    <td className={`py-2 px-3 text-right font-mono tabular-nums font-semibold ${(t.pnl || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                      {(t.pnl || 0) >= 0 ? '+' : ''}{fmtUSD(t.pnl)}
                      <span className="block text-[10px] font-normal text-surface-500">
                        {(t.pnl_pct || 0) >= 0 ? '+' : ''}{Number(t.pnl_pct ?? 0).toFixed(2)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
