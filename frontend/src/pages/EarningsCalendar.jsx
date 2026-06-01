import { useCallback, useEffect, useMemo, useState } from 'react'
import { getEarnings } from '../api/calendar'
import { listWatchlists } from '../api/watchlists'
import TradingViewLink from '../components/TradingViewLink'

const WINDOWS = [
  { value: 5,  label: 'This week' },
  { value: 14, label: '2 weeks' },
  { value: 30, label: '30 days' },
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatDateLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return `${DAY_LABELS[d.getDay()]} · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

function relativeDay(iso) {
  if (!iso) return ''
  const target = new Date(iso + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((target - today) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0) return `${-diff}d ago`
  return `in ${diff}d`
}

const TIME_LABEL = { bmo: 'Before open', amc: 'After close', other: 'During / TBD' }
const TIME_TONE = {
  bmo:   'bg-cyan/10 text-cyan border-cyan/30',
  amc:   'bg-purple/10 text-purple border-purple/30',
  other: 'bg-surface-700/40 text-surface-300 border-surface-600/40',
}

function fmtEps(v) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (Number.isNaN(n)) return '—'
  return n >= 0 ? `$${n.toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`
}

function EarningRow({ row }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ${
      row.in_watchlist
        ? 'bg-accent/10 border-accent/30'
        : 'bg-surface-900/60 border-surface-700/40 hover:bg-surface-800/60'
    } transition-colors`}>
      <div className="flex items-center gap-2 min-w-0">
        <TradingViewLink
          symbol={row.symbol}
          className={`font-mono font-semibold text-[13px] ${row.in_watchlist ? 'text-accent' : 'text-surface-100'}`}
        />
        {row.in_watchlist && (
          <svg className="w-3 h-3 text-accent shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        )}
      </div>
      <div className="text-[11px] font-mono text-surface-400 shrink-0">
        EPS est <span className="text-surface-200">{fmtEps(row.eps_estimate)}</span>
      </div>
    </div>
  )
}

function DayColumn({ slot }) {
  const all = [...slot.bmo, ...slot.amc, ...slot.other]
  const isToday = relativeDay(slot.date) === 'Today'

  return (
    <div className={`rounded-2xl bg-surface-900/60 border ${isToday ? 'border-accent/40' : 'border-surface-700/40'} p-3 min-w-0`}>
      <div className="flex items-baseline justify-between mb-2.5">
        <div>
          <div className="text-[13px] font-semibold text-surface-100">
            {formatDateLabel(slot.date)}
          </div>
          <div className="text-[10px] text-surface-500 uppercase tracking-wider">
            {relativeDay(slot.date)} · {all.length} {all.length === 1 ? 'report' : 'reports'}
          </div>
        </div>
        {isToday && (
          <span className="text-[10px] font-semibold uppercase text-accent">Today</span>
        )}
      </div>

      {all.length === 0 ? (
        <div className="text-[12px] text-surface-500 py-4 text-center">No earnings</div>
      ) : (
        <div className="space-y-2.5">
          {['bmo', 'amc', 'other'].map(bucket => {
            const rows = slot[bucket]
            if (!rows || rows.length === 0) return null
            return (
              <div key={bucket}>
                <div className={`inline-block px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider border ${TIME_TONE[bucket]} mb-1.5`}>
                  {TIME_LABEL[bucket]} · {rows.length}
                </div>
                <div className="space-y-1">
                  {rows.slice(0, 8).map((r, i) => (
                    <EarningRow key={`${r.symbol}-${r.date}-${bucket}-${i}`} row={r} />
                  ))}
                  {rows.length > 8 && (
                    <div className="text-[10px] text-surface-500 italic px-1">
                      +{rows.length - 8} more
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function EarningsCalendar() {
  const [days, setDays] = useState(5)
  const [watchlistsList, setWatchlistsList] = useState([])
  const [wlId, setWlId] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    listWatchlists().then(setWatchlistsList).catch(() => setWatchlistsList([]))
  }, [])

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await getEarnings({ days, wlId: wlId || null, force })
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [days, wlId])

  useEffect(() => { load(false) }, [load])

  const totalHits = data?.watchlist_hits?.length || 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">
            Earnings Calendar
          </h1>
          <p className="text-surface-400 text-[13px] mt-1">
            What's reporting in the days ahead. Filter to a watchlist to avoid surprise blowups.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg bg-surface-900/80 border border-surface-700/50 p-0.5">
            {WINDOWS.map(w => (
              <button
                key={w.value}
                onClick={() => setDays(w.value)}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                  days === w.value ? 'bg-accent/15 text-accent' : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <select
            value={wlId}
            onChange={(e) => setWlId(e.target.value)}
            className="rounded-lg bg-surface-900/80 border border-surface-700/50 px-3 py-1.5 text-[12px] text-surface-200 focus:border-accent focus:outline-none"
          >
            <option value="">All earnings</option>
            {watchlistsList.map(wl => (
              <option key={wl.id} value={wl.id}>★ {wl.name}</option>
            ))}
          </select>
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-[12px] font-medium hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Watchlist hits banner */}
      {data?.watchlist?.id && (
        <div className={`rounded-2xl border p-4 ${
          totalHits > 0
            ? 'bg-accent/5 border-accent/30'
            : 'bg-surface-900/60 border-surface-700/40'
        }`}>
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-[240px]">
              <div className="text-[11px] uppercase tracking-wider text-surface-400 font-semibold">
                {data.watchlist.name || 'Watchlist'} earnings
              </div>
              <div className="mt-0.5 text-[15px] text-surface-100">
                {totalHits === 0
                  ? `No watchlist names reporting in the next ${days} days.`
                  : `${totalHits} watchlist ${totalHits === 1 ? 'name reports' : 'names report'} in this window`}
              </div>
            </div>
            {totalHits > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.watchlist_hits.map(r => (
                  <div key={`${r.symbol}-${r.date}`} className="px-2.5 py-1 rounded-md bg-accent/15 border border-accent/30 text-[11px] flex items-center gap-1.5">
                    <TradingViewLink symbol={r.symbol} className="font-mono font-semibold text-accent" />
                    <span className="text-surface-400">·</span>
                    <span className="text-surface-300">{relativeDay(r.date)}</span>
                    {r.time && (
                      <span className="text-[9px] uppercase text-surface-500 ml-0.5">{r.time}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {loading && !data && (
        <div className="rounded-2xl bg-surface-900/60 border border-surface-700/40 p-12 text-center">
          <div className="inline-flex items-center gap-2 text-surface-300">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Loading earnings calendar…
          </div>
        </div>
      )}

      {/* Day grid */}
      {data && data.by_date && (
        data.by_date.length === 0 ? (
          <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 border-dashed p-10 text-center">
            <p className="text-surface-100 font-semibold text-base">No earnings in this window</p>
            <p className="text-surface-500 text-sm mt-2">
              Try widening the date range.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            {data.by_date.map(slot => (
              <DayColumn key={slot.date} slot={slot} />
            ))}
          </div>
        )
      )}

      {data?.as_of && (
        <div className="text-[10px] font-mono text-surface-600 text-right">
          {data.total} total · {data.provider ? `${data.provider} · ` : ''}{data.from_cache ? 'cached · ' : ''}as of {data.as_of}
        </div>
      )}
    </div>
  )
}
