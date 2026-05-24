import { useCallback, useEffect, useState } from 'react'
import { getWeeklyReview } from '../api/journal'

const WINDOWS = [
  { value: 7,  label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
]

function StatCard({ label, value, accent }) {
  return (
    <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">{label}</div>
      <div className={`mt-1 text-lg font-mono font-semibold ${accent || 'text-surface-100'}`}>{value}</div>
    </div>
  )
}

function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export default function WeeklyReview() {
  const [days, setDays] = useState(7)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await getWeeklyReview({ days, force })
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load(false) }, [load])

  const stats = data?.objective_stats
  const ai = data?.ai
  const patterns = ai?.patterns || []
  const headline = ai?.headline

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display font-semibold text-[20px] text-surface-50 tracking-tight">
            AI Weekly Review
          </h2>
          <p className="text-[12px] text-surface-500 mt-0.5">
            Claude reads your trades + journal entries and surfaces behavioral patterns. Cached for 10 min.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-[12px] font-medium hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loading ? 'Reviewing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="rounded-2xl bg-surface-900/60 border border-surface-700/40 p-10 text-center">
          <div className="inline-flex items-center gap-2 text-surface-300">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Reviewing the last {days} days…
          </div>
        </div>
      )}

      {data && (
        <>
          {/* Objective stats strip */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              <StatCard label="Trades" value={stats.trade_count} />
              <StatCard
                label="Win rate"
                value={`${stats.win_rate_pct}%`}
                accent={stats.win_rate_pct >= 50 ? 'text-emerald-300' : 'text-red-300'}
              />
              <StatCard
                label="Net P&L"
                value={fmtMoney(stats.total_pnl)}
                accent={stats.total_pnl > 0 ? 'text-emerald-300' : stats.total_pnl < 0 ? 'text-red-300' : ''}
              />
              <StatCard label="Avg win" value={fmtMoney(stats.avg_win)} accent="text-emerald-300/80" />
              <StatCard label="Avg loss" value={fmtMoney(stats.avg_loss)} accent="text-red-300/80" />
              <StatCard
                label="Best / worst"
                value={`${fmtMoney(stats.biggest_win)} / ${fmtMoney(stats.biggest_loss)}`}
              />
            </div>
          )}

          {/* AI patterns */}
          {headline && (
            <div className="rounded-2xl bg-gradient-to-br from-accent/5 to-cyan/5 border border-accent/20 p-5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 shrink-0 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center">
                  <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a3.75 3.75 0 01-1.298.872l-.11.042a3.75 3.75 0 01-2.687 0l-.11-.042a3.75 3.75 0 01-1.298-.872L12 17z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] uppercase tracking-wider text-accent/80 font-semibold">
                    The week in one sentence
                  </div>
                  <div className="mt-1 text-[15px] text-surface-100 leading-snug">
                    {headline}
                  </div>
                </div>
                {data.from_cache && (
                  <span className="text-[10px] font-mono text-surface-500 shrink-0 mt-0.5">cached</span>
                )}
              </div>
            </div>
          )}

          {patterns.length > 0 ? (
            <div className="grid sm:grid-cols-2 gap-3">
              {patterns.map((p, i) => (
                <div key={i} className="rounded-2xl bg-surface-900/80 border border-surface-700/50 p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="w-5 h-5 shrink-0 rounded-full bg-accent/15 border border-accent/40 flex items-center justify-center text-[10px] font-mono font-semibold text-accent">
                      {i + 1}
                    </div>
                    <div className="text-[14px] font-semibold text-surface-100 leading-snug">
                      {p.title}
                    </div>
                  </div>
                  <div className="text-[12px] text-surface-400 leading-relaxed pl-7">
                    {p.evidence}
                  </div>
                  {p.recommendation && (
                    <div className="pl-7 mt-2 pt-2 border-t border-surface-700/40">
                      <div className="text-[10px] uppercase tracking-wider text-accent/80 font-semibold mb-1">
                        Do this next
                      </div>
                      <div className="text-[12px] text-surface-200 leading-relaxed">
                        {p.recommendation}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            stats?.trade_count === 0 && (
              <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 border-dashed p-8 text-center">
                <p className="text-surface-200 font-medium">
                  No trades or journal entries in this window.
                </p>
                <p className="text-surface-500 text-[12px] mt-1">
                  Log some trades or daily entries, then come back here.
                </p>
              </div>
            )
          )}

          {data.model && (
            <div className="text-[10px] font-mono text-surface-600 text-right">
              {data.model} · window {data.window?.start} → {data.window?.end}
            </div>
          )}
        </>
      )}
    </div>
  )
}
