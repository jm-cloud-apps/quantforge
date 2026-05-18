import { useEffect, useMemo, useState } from 'react'
import {
  listWatchlists,
  createWatchlist,
  deleteWatchlist,
  addSymbols,
  removeSymbol,
  benchmarkWatchlist,
} from '../api/watchlists'
import TickerLink from '../components/TickerLink'

const fmtPct = (v, digits = 2) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`

const fmtPrice = (v) => (v == null ? '—' : `$${v.toFixed(2)}`)

const fmtDate = (iso) => {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
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

function WatchlistChip({ wl, active, onSelect, onDelete }) {
  return (
    <div
      onClick={() => onSelect(wl)}
      className={`group inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors cursor-pointer ${
        active
          ? 'bg-accent/10 border-accent/40 text-accent'
          : 'bg-surface-900/60 border-surface-700/40 text-surface-300 hover:border-surface-600/60'
      }`}
    >
      <span className="font-medium">{wl.name}</span>
      <span className="text-[10px] text-surface-500 tabular-nums">{wl.entries?.length || 0}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(wl) }}
        className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-danger transition-opacity"
        title="Delete watchlist"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

export default function Watchlist() {
  const [lists, setLists] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [bench, setBench] = useState(null)
  const [loading, setLoading] = useState(true)
  const [benching, setBenching] = useState(false)
  const [error, setError] = useState(null)

  const [creatingList, setCreatingList] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [addTickerInput, setAddTickerInput] = useState('')

  const [sort, setSort] = useState({ key: 'return', dir: 'desc' })

  const active = useMemo(() => lists.find((w) => w.id === activeId), [lists, activeId])

  const reloadLists = async (selectId) => {
    try {
      const data = await listWatchlists()
      setLists(data || [])
      if (selectId) setActiveId(selectId)
      else if (!activeId && data?.length) setActiveId(data[0].id)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const reloadBenchmark = async (id = activeId) => {
    if (!id) { setBench(null); return }
    setBenching(true)
    try {
      const b = await benchmarkWatchlist(id)
      setBench(b)
    } catch (e) {
      setError(e.message)
    } finally {
      setBenching(false)
    }
  }

  useEffect(() => { reloadLists() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reloadBenchmark(activeId) }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreateList = async () => {
    const name = newListName.trim()
    if (!name) return
    try {
      const wl = await createWatchlist({ name, symbols: [] })
      setNewListName('')
      setCreatingList(false)
      await reloadLists(wl.id)
    } catch (e) {
      setError(e.message)
    }
  }

  const handleDeleteList = async (wl) => {
    if (!confirm(`Delete watchlist "${wl.name}"?`)) return
    try {
      await deleteWatchlist(wl.id)
      const remaining = lists.filter((w) => w.id !== wl.id)
      setLists(remaining)
      if (activeId === wl.id) setActiveId(remaining[0]?.id ?? null)
    } catch (e) {
      setError(e.message)
    }
  }

  const handleAddTickers = async (e) => {
    e?.preventDefault?.()
    if (!active) return
    const syms = addTickerInput.trim().split(/[\s,]+/).filter(Boolean)
    if (syms.length === 0) return
    setError(null)
    try {
      await addSymbols(active.id, syms)
      setAddTickerInput('')
      await reloadLists(active.id)
      reloadBenchmark(active.id)
    } catch (e) {
      setError(e.message)
    }
  }

  const handleRemoveSymbol = async (sym) => {
    if (!active) return
    try {
      await removeSymbol(active.id, sym)
      await reloadLists(active.id)
      reloadBenchmark(active.id)
    } catch (e) {
      setError(e.message)
    }
  }

  // Source rows in priority order:
  //   1. fully-benchmarked rows (have current_price + return_pct)
  //   2. fall back to the raw watchlist entries (so tickers + add-prices are
  //      visible IMMEDIATELY while benchmark prices are still on the wire)
  const baseRows = useMemo(() => {
    if (bench?.entries) return bench.entries
    if (!active?.entries) return []
    return active.entries.map((e) => ({
      symbol: e.symbol,
      added_at: e.added_at,
      added_price: e.added_price,
      current_price: null,
      return_pct: null,
      days_held: null,
      _pending: true,
    }))
  }, [bench, active])

  const sortedRows = useMemo(() => {
    const rows = [...baseRows]
    const { key, dir } = sort
    const cmp = (a, b) => {
      const av = a[key], bv = b[key]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return dir === 'asc' ? av - bv : bv - av
    }
    rows.sort(cmp)
    return rows
  }, [baseRows, sort])

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
        Loading watchlists…
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
            Track entry price and benchmark each ticker against the day you added it.
          </p>
        </div>
        <button
          onClick={() => reloadBenchmark()}
          disabled={benching || !activeId}
          className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 transition-colors disabled:opacity-50"
        >
          {benching ? 'Refreshing…' : 'Refresh prices'}
        </button>
      </div>

      {/* Watchlist chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {lists.map((wl) => (
          <WatchlistChip
            key={wl.id}
            wl={wl}
            active={wl.id === activeId}
            onSelect={(w) => setActiveId(w.id)}
            onDelete={handleDeleteList}
          />
        ))}

        {creatingList ? (
          <div className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-surface-900/80 px-2 py-1">
            <input
              autoFocus
              type="text"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateList()
                if (e.key === 'Escape') { setCreatingList(false); setNewListName('') }
              }}
              placeholder="Name…"
              className="bg-transparent text-sm text-surface-100 placeholder-surface-600 outline-none w-36"
            />
            <button
              onClick={handleCreateList}
              className="text-sm text-accent hover:text-accent/80"
              disabled={!newListName.trim()}
            >
              Save
            </button>
            <button
              onClick={() => { setCreatingList(false); setNewListName('') }}
              className="text-sm text-surface-500 hover:text-surface-300"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreatingList(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-surface-700/60 bg-surface-900/40 px-3 py-1.5 text-sm text-surface-500 hover:text-surface-300 hover:border-surface-600 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New watchlist
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-3">
          <p className="text-danger text-sm">{error}</p>
        </div>
      )}

      {!active ? (
        <div className="rounded-xl bg-surface-900/40 border border-surface-700/30 p-10 text-center">
          <p className="text-surface-300 text-sm">
            You don't have any watchlists yet. Create one to start tracking entry prices.
          </p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <SummaryStrip summary={bench?.summary} />

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
              Add to {active.name}
            </button>
          </form>

          {/* Benchmark table */}
          {!active?.entries?.length ? (
            <div className="rounded-xl bg-surface-900/40 border border-surface-700/30 p-10 text-center">
              <p className="text-surface-300 text-sm">
                "{active.name}" is empty. Add a ticker above to start tracking.
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-surface-900/40 border border-surface-700/40 overflow-hidden">
              {benching && !bench && (
                <div className="px-4 py-2 text-[11px] text-surface-500 border-b border-surface-700/30 bg-surface-900/60 flex items-center gap-2">
                  <svg className="w-3 h-3 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Pricing {active.entries.length} ticker{active.entries.length === 1 ? '' : 's'}…
                </div>
              )}
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
                      <td className="px-4 py-2.5 text-surface-400 text-xs">
                        {fmtDate(row.added_at)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-surface-300 tabular-nums">
                        {fmtPrice(row.added_price)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-surface-100 tabular-nums">
                        {row._pending ? (
                          <span className="inline-block w-14 h-3 rounded bg-surface-700/40 animate-pulse" />
                        ) : (
                          fmtPrice(row.current_price)
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {row._pending ? (
                          <span className="inline-block w-12 h-3 rounded bg-surface-700/40 animate-pulse" />
                        ) : (
                          <ReturnCell value={row.return_pct} />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-surface-400 text-xs tabular-nums">
                        {row._pending ? (
                          <span className="inline-block w-6 h-3 rounded bg-surface-700/40 animate-pulse" />
                        ) : (
                          `${row.days_held ?? '—'}d`
                        )}
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
              {bench?.as_of && (
                <div className="px-4 py-2 text-[11px] text-surface-600 border-t border-surface-700/30 bg-surface-900/60">
                  Prices as of {new Date(bench.as_of).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
