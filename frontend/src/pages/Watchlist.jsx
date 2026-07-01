import { useEffect, useMemo, useState } from 'react'
import {
  getWatchlist,
  addSymbols,
  removeSymbol,
  refreshWatchlist,
} from '../api/watchlists'
import TickerLink from '../components/TickerLink'

const fmtPct = (v, digits = 2) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`

const fmtPrice = (v) => (v == null ? '—' : `$${v.toFixed(2)}`)

// Compact "May 30, 2:23 PM" — fits in the existing column without a redesign.
// Time matters for intraday adds (you want to know if you grabbed it pre-market
// vs. after a 5% run); date alone hides that.
const fmtDateTime = (iso) => {
  if (!iso) return { date: '—', time: '' }
  try {
    const d = new Date(iso)
    return {
      date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      time: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    }
  } catch {
    return { date: iso, time: '' }
  }
}

// "3d ago", "2h ago", "just now" — for the hover tooltip alongside the ISO.
const fmtRelative = (iso) => {
  if (!iso) return ''
  try {
    const then = new Date(iso).getTime()
    const diffMs = Date.now() - then
    if (diffMs < 0) return 'in the future'
    const sec = Math.floor(diffMs / 1000)
    if (sec < 60) return 'just now'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    const day = Math.floor(hr / 24)
    if (day < 30) return `${day}d ago`
    const mo = Math.floor(day / 30)
    if (mo < 12) return `${mo}mo ago`
    return `${Math.floor(mo / 12)}y ago`
  } catch {
    return ''
  }
}

function ReturnCell({ value }) {
  if (value == null) return <span className="text-surface-500">—</span>
  const cls = value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-surface-400'
  return <span className={`font-mono font-semibold tabular-nums ${cls}`}>{fmtPct(value)}</span>
}

function SummaryStrip({ summary }) {
  if (!summary) return null
  const { count, scored, winners, losers, avg_return_pct } = summary
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 backdrop-blur-sm p-4">
        <p className="text-[10px] font-medium text-surface-400 uppercase tracking-wider">Tickers</p>
        <p className="text-2xl font-bold tracking-tight mt-1 text-surface-100">{count}</p>
        {scored < count && (
          <p className="text-[11px] text-surface-500 mt-1">{scored} priced</p>
        )}
      </div>
      <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 backdrop-blur-sm p-4">
        <p className="text-[10px] font-medium text-surface-400 uppercase tracking-wider">Avg return</p>
        <p className={`text-2xl font-bold tracking-tight mt-1 tabular-nums ${
          avg_return_pct == null
            ? 'text-surface-500'
            : avg_return_pct > 0 ? 'text-success' : avg_return_pct < 0 ? 'text-danger' : 'text-surface-200'
        }`}>
          {fmtPct(avg_return_pct)}
        </p>
        <p className="text-[11px] text-surface-500 mt-1">since each was added</p>
      </div>
      <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 backdrop-blur-sm p-4">
        <p className="text-[10px] font-medium text-surface-400 uppercase tracking-wider">Winners</p>
        <p className="text-2xl font-bold tracking-tight mt-1 text-success tabular-nums">{winners}</p>
        <p className="text-[11px] text-surface-500 mt-1">in the black</p>
      </div>
      <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 backdrop-blur-sm p-4">
        <p className="text-[10px] font-medium text-surface-400 uppercase tracking-wider">Losers</p>
        <p className="text-2xl font-bold tracking-tight mt-1 text-danger tabular-nums">{losers}</p>
        <p className="text-[11px] text-surface-500 mt-1">in the red</p>
      </div>
    </div>
  )
}

export default function Watchlist() {
  const [wl, setWl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [addTickerInput, setAddTickerInput] = useState('')

  const [sort, setSort] = useState({ key: 'return_pct', dir: 'desc' })

  const entries = wl?.entries || []

  const load = async () => {
    try {
      const data = await getWatchlist()
      setWl(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = async () => {
    setRefreshing(true)
    setError(null)
    try {
      setWl(await refreshWatchlist())
    } catch (e) {
      setError(e.message)
    } finally {
      setRefreshing(false)
    }
  }

  const handleAddTickers = async (e) => {
    e?.preventDefault?.()
    const syms = addTickerInput.trim().split(/[\s,]+/).filter(Boolean)
    if (syms.length === 0) return
    setError(null)
    try {
      setWl(await addSymbols(syms))
      setAddTickerInput('')
    } catch (e) {
      setError(e.message)
    }
  }

  const handleRemoveSymbol = async (sym) => {
    setError(null)
    try {
      setWl(await removeSymbol(sym))
    } catch (e) {
      setError(e.message)
    }
  }

  const sortedRows = useMemo(() => {
    const rows = [...entries]
    const { key, dir } = sort
    rows.sort((a, b) => {
      const av = a[key], bv = b[key]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return dir === 'asc' ? av - bv : bv - av
    })
    return rows
  }, [entries, sort])

  const toggleSort = (key) => {
    setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' })
  }

  const SortHeader = ({ k, label, align = 'left' }) => (
    <th
      onClick={() => toggleSort(k)}
      className={`px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-surface-500 cursor-pointer select-none hover:text-surface-300 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {label}
      {sort.key === k && (
        <span className="ml-1 text-surface-600">{sort.dir === 'asc' ? '↑' : '↓'}</span>
      )}
    </th>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-surface-500 text-sm">
        Loading watchlist…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-[28px] text-surface-50 tracking-tight mb-1">
            Watchlist
          </h1>
          <p className="text-surface-400 text-sm">
            One list. Every ticker is stamped with the day + price you added it; hit refresh to
            re-price and see the return since.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || entries.length === 0}
          className="px-4 py-2 rounded-lg bg-accent/15 border border-accent/30 text-sm font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-40 inline-flex items-center gap-2"
        >
          {refreshing && (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          {refreshing ? 'Refreshing…' : 'Refresh prices'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-3">
          <p className="text-danger text-sm">{error}</p>
        </div>
      )}

      {/* Summary cards */}
      <SummaryStrip summary={wl?.summary} />

      {/* Add ticker */}
      <form onSubmit={handleAddTickers} className="flex gap-2 items-center max-w-xl">
        <input
          type="text"
          value={addTickerInput}
          onChange={(e) => setAddTickerInput(e.target.value.toUpperCase())}
          placeholder="Add tickers… (e.g. AMD NVDA)"
          className="flex-1 px-3 py-2 rounded-lg bg-surface-900/60 border border-surface-700/40 text-sm text-surface-100 placeholder-surface-600 outline-none focus:border-accent/50 font-mono tracking-wider"
        />
        <button
          type="submit"
          disabled={!addTickerInput.trim()}
          className="px-4 py-2 rounded-lg bg-accent/15 border border-accent/30 text-sm font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-40"
        >
          Add
        </button>
      </form>

      {/* Benchmark table */}
      {entries.length === 0 ? (
        <div className="rounded-xl bg-surface-900/40 border border-surface-700/30 p-10 text-center">
          <p className="text-surface-300 text-sm">
            Your watchlist is empty. Add a ticker above to start tracking entry prices.
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-surface-900/40 border border-surface-700/40 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-900/80 border-b border-surface-700/40">
              <tr>
                <SortHeader k="symbol" label="Ticker" />
                <SortHeader k="added_at" label="Added" />
                <SortHeader k="added_price" label="Add price" align="right" />
                <SortHeader k="current_price" label="Now" align="right" />
                <SortHeader k="return_pct" label="Return" align="right" />
                <SortHeader k="days_held" label="Days" align="right" />
                <th className="px-4 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr
                  key={row.symbol}
                  className="border-b border-surface-700/20 last:border-0 hover:bg-surface-900/60 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <TickerLink
                      symbol={row.symbol}
                      className="font-mono font-bold text-surface-100"
                    />
                  </td>
                  <td
                    className="px-4 py-2.5 text-xs"
                    title={row.added_at ? `${row.added_at.replace('T', ' ')} · ${fmtRelative(row.added_at)}` : ''}
                  >
                    {(() => {
                      const { date, time } = fmtDateTime(row.added_at)
                      return (
                        <div className="flex flex-col leading-tight">
                          <span className="text-surface-300">{date}</span>
                          {time && <span className="text-surface-500 text-[10.5px] font-mono tabular-nums">{time}</span>}
                        </div>
                      )
                    })()}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-surface-300 tabular-nums">
                    {fmtPrice(row.added_price)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-surface-100 tabular-nums">
                    {fmtPrice(row.current_price)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <ReturnCell value={row.return_pct} />
                  </td>
                  <td className="px-4 py-2.5 text-right text-surface-400 text-xs tabular-nums">
                    {`${row.days_held ?? '—'}d`}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <button
                      onClick={() => handleRemoveSymbol(row.symbol)}
                      className="text-surface-600 hover:text-danger transition-colors"
                      title={`Remove ${row.symbol}`}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 text-[11px] text-surface-600 border-t border-surface-700/30 bg-surface-900/60">
            {wl?.priced_at
              ? `Prices cached as of ${new Date(wl.priced_at).toLocaleString()}`
              : 'Prices not refreshed yet — hit “Refresh prices”.'}
          </div>
        </div>
      )}
    </div>
  )
}
