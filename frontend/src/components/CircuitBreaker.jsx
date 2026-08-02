import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getToday } from '../api/discipline'

// ---------------------------------------------------------------------------
// The random-trade circuit breaker.
//
// Trade Today's Gate 1 answers "should I trade?" — and a green answer there is
// what an impulse trade gets justified with afterwards. So the green light is
// *withheld* until a plan exists for the day.
//
// Two deliberate limits on how far this goes:
//
//   • It withholds the NEW-ENTRY light only. The verdict's reasoning and its
//     instruction for positions already held stay visible, because those are
//     risk-management information — gating them would make the app less safe,
//     not more disciplined.
//   • It is friction, not a lock. Logging a plan takes seconds and the plan
//     form is directly below; the point is to make the trade pass through the
//     plan, not to make the page unusable.
//
// The month-to-date counter beside it is the standing cost of not doing that.
// ---------------------------------------------------------------------------

const fmt$ = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const v = Number(n)
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

// Poll-free: the breaker state only changes when a plan is logged, and the gate
// component calls `refresh` directly when that happens.
export function useCircuitBreaker() {
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      setState(await getToday({ force: true }))
      setError(null)
    } catch (e) {
      // A breaker that can't load must fail OPEN — never withhold the day's
      // read because an auxiliary endpoint is down.
      setError(e.message)
      setState(null)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { breaker: state, breakerError: error, refreshBreaker: refresh }
}

// Replaces the Gate-1 verdict headline while no plan exists for today.
export function BreakerLock({ breaker }) {
  if (!breaker || breaker.clear) return null
  return (
    <div>
      <div className="flex items-center gap-2">
        <svg className="w-3.5 h-3.5 text-amber-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
        <span className="text-[15px] font-bold leading-tight text-amber-200">Verdict withheld</span>
      </div>
      <p className="text-[12px] text-surface-400 mt-1.5 leading-snug">
        No plan logged today. Log one below and the day's read unlocks.
      </p>
    </div>
  )
}

// The standing month-to-date cost of trading without a plan. Rendered next to
// the gate so the number is in view at the moment the plan gets written.
export function RandomTax({ breaker }) {
  if (!breaker) return null
  const un = breaker.mtd?.unplanned
  const planned = breaker.mtd?.planned
  const hasUnplanned = un?.n > 0

  return (
    <div className="flex items-center gap-3 flex-wrap text-[11.5px]">
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${
        breaker.clear
          ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300'
          : 'bg-amber-500/10 border-amber-400/30 text-amber-300'
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${breaker.clear ? 'bg-emerald-400' : 'bg-amber-400'}`} />
        {breaker.clear
          ? `${breaker.plans_today} plan${breaker.plans_today === 1 ? '' : 's'} today`
          : 'No plan today'}
      </span>

      {hasUnplanned && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border bg-rose-500/10 border-rose-400/30 text-rose-300">
          Unplanned this month: <span className="font-semibold tabular-nums">{un.n}</span>
          <span className="tabular-nums">{fmt$(un.pnl)}</span>
        </span>
      )}
      {planned?.n > 0 && (
        <span className="text-surface-500">
          Playbook trades: <span className="tabular-nums text-surface-300">{planned.n}</span>{' '}
          <span className={`tabular-nums ${planned.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt$(planned.pnl)}</span>
        </span>
      )}
      {breaker.trades_through && (
        <span className="text-surface-600">
          workbook through {breaker.trades_through}
        </span>
      )}
      <Link to="/discipline" className="text-accent hover:underline ml-auto">Full scorecard →</Link>
    </div>
  )
}
