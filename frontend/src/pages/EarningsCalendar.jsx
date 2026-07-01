import { useCallback, useEffect, useMemo, useState } from 'react'
import { getEarnings, getEarningsReactions } from '../api/calendar'
import TradingViewLink from '../components/TradingViewLink'
import EarningsSessionIcon from '../components/EarningsSessionIcon'

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

function fmtEps(v) {
  if (v === null || v === undefined) return '—'
  const n = Number(v)
  if (Number.isNaN(n)) return '—'
  return n >= 0 ? `$${n.toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`
}

function surprisePct(actual, estimate) {
  if (actual === null || actual === undefined) return null
  if (estimate === null || estimate === undefined) return null
  const a = Number(actual)
  const e = Number(estimate)
  if (Number.isNaN(a) || Number.isNaN(e) || e === 0) return null
  return ((a - e) / Math.abs(e)) * 100
}

function EarningRow({ row, reaction }) {
  const actual = row.eps_actual
  const hasActual = actual !== null && actual !== undefined && !Number.isNaN(Number(actual))
  const estimate = row.eps_estimate
  const hasEstimate = estimate !== null && estimate !== undefined && !Number.isNaN(Number(estimate))

  let beatState = null
  if (hasActual && hasEstimate) {
    const a = Number(actual)
    const e = Number(estimate)
    if (a > e) beatState = 'beat'
    else if (a < e) beatState = 'miss'
    else beatState = 'inline'
  }

  const pct = surprisePct(actual, estimate)
  const actualColor = beatState === 'beat'
    ? 'text-emerald-400'
    : beatState === 'miss'
      ? 'text-rose-400'
      : 'text-surface-200'

  return (
    <div className={`px-3 py-2 rounded-lg border ${
      row.in_watchlist
        ? 'bg-accent/10 border-accent/30'
        : 'bg-surface-900/60 border-surface-700/40 hover:bg-surface-800/60'
    } transition-colors`}>
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
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
        {beatState === 'beat' && (
          <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
            Beat{pct !== null ? ` ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : ''}
          </span>
        )}
        {beatState === 'miss' && (
          <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 shrink-0">
            Miss{pct !== null ? ` ${Math.abs(pct).toFixed(1)}%` : ''}
          </span>
        )}
        {beatState === 'inline' && (
          <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface-700/40 text-surface-300 border border-surface-600/40 shrink-0">
            Inline
          </span>
        )}
        {!beatState && hasEstimate && (
          <span className="text-[10px] font-mono text-surface-400 shrink-0">
            est <span className="text-surface-200">{fmtEps(estimate)}</span>
          </span>
        )}
      </div>
      {hasActual && (
        <div className="mt-1 text-[10px] font-mono text-surface-500 flex items-baseline gap-1 flex-wrap">
          <span className={`${actualColor} text-[11px] font-semibold`}>{fmtEps(actual)}</span>
          <span className="text-surface-600">vs</span>
          <span className="text-surface-300">{fmtEps(estimate)}</span>
          <span className="text-surface-600">est</span>
          {reaction && reaction.pct !== null && reaction.pct !== undefined && (
            <span
              className={`ml-auto px-1.5 py-0.5 rounded text-[9px] font-semibold tabular-nums ${
                reaction.pct >= 0
                  ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25'
                  : 'bg-rose-500/10 text-rose-300 border border-rose-500/25'
              }`}
              title={`${reaction.session === 'amc' ? 'After-hours' : 'Pre-market'} move on ${reaction.date}: ${fmtEps(reaction.ref_price)} → ${fmtEps(reaction.ext_price)}`}
            >
              {reaction.session === 'amc' ? 'AH' : 'PM'} {reaction.pct >= 0 ? '+' : ''}{reaction.pct.toFixed(1)}%
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function DayColumn({ slot, reactions }) {
  const all = [...slot.bmo, ...slot.amc, ...slot.other]
  const rel = relativeDay(slot.date)
  const isToday = rel === 'Today'
  const isPast = rel.endsWith('ago')

  return (
    <div className={`rounded-2xl bg-surface-900/60 border ${
      isToday
        ? 'border-accent/40'
        : isPast
          ? 'border-surface-700/30 bg-surface-900/40'
          : 'border-surface-700/40'
    } p-3 min-w-0`}>
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
        {isPast && (
          <span className="text-[10px] font-semibold uppercase text-surface-500">Reported</span>
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
                <div className="flex items-center gap-1 mb-1.5 h-3.5">
                  <EarningsSessionIcon time={bucket} className="w-3.5 h-3.5" />
                  <span className="text-[10px] text-surface-500 tabular-nums">{rows.length}</span>
                </div>
                <div className="space-y-1">
                  {rows.slice(0, 8).map((r, i) => (
                    <EarningRow
                      key={`${r.symbol}-${r.date}-${bucket}-${i}`}
                      row={r}
                      reaction={reactions?.[`${r.symbol}|${r.date}`]}
                    />
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
  const [myOnly, setMyOnly] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reactions, setReactions] = useState({})

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await getEarnings({ days, wlId: myOnly ? '1' : null, force })
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [days, myOnly])

  useEffect(() => { load(false) }, [load])

  // Once the calendar lands, kick off a reactions fetch for every row that
  // already has an actual EPS (i.e. already reported). The chip on each row
  // fills in once this resolves; rows without actuals just stay as-is.
  useEffect(() => {
    if (!data?.by_date) return
    const items = []
    for (const slot of data.by_date) {
      for (const bucket of ['bmo', 'amc']) {
        for (const r of slot[bucket] || []) {
          if (r.eps_actual !== null && r.eps_actual !== undefined) {
            items.push({ symbol: r.symbol, date: r.date, time: bucket })
          }
        }
      }
    }
    if (items.length === 0) {
      setReactions({})
      return
    }
    let cancelled = false
    getEarningsReactions(items)
      .then(res => { if (!cancelled) setReactions(res.reactions || {}) })
      .catch(() => { if (!cancelled) setReactions({}) })
    return () => { cancelled = true }
  }, [data])

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
          <div className="inline-flex rounded-lg bg-surface-900/80 border border-surface-700/50 p-0.5">
            <button
              onClick={() => setMyOnly(false)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                !myOnly ? 'bg-accent/15 text-accent' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              All earnings
            </button>
            <button
              onClick={() => setMyOnly(true)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                myOnly ? 'bg-accent/15 text-accent' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              ★ My watchlist
            </button>
          </div>
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
                    <EarningsSessionIcon time={r.time} className="w-3 h-3 ml-0.5" />
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

      {/* Day grid — weekends hidden (no US earnings on Sat/Sun) */}
      {data && data.by_date && (() => {
        const weekdaySlots = data.by_date.filter(slot => {
          const day = new Date(slot.date + 'T00:00:00').getDay()
          return day !== 0 && day !== 6
        })
        if (weekdaySlots.length === 0) {
          return (
            <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 border-dashed p-10 text-center">
              <p className="text-surface-100 font-semibold text-base">No earnings in this window</p>
              <p className="text-surface-500 text-sm mt-2">Try widening the date range.</p>
            </div>
          )
        }
        return (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {weekdaySlots.map(slot => (
              <DayColumn key={slot.date} slot={slot} reactions={reactions} />
            ))}
          </div>
        )
      })()}

      {data?.as_of && (
        <div className="text-[10px] font-mono text-surface-600 text-right">
          {data.total} total · {data.provider ? `${data.provider} · ` : ''}{data.from_cache ? 'cached · ' : ''}as of {data.as_of}
        </div>
      )}
    </div>
  )
}
