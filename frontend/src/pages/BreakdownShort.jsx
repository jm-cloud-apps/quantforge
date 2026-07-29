import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getBreakdownScan } from '../api/breakdown'
import TickerLink from '../components/TickerLink'
import RefreshControl from '../components/RefreshControl'
import { fmtInt, fmtMoney, fmtCompactDollars, fmtRelativeAge, isScanStale } from '../utils/format'

// ---------------------------------------------------------------------------
// "Breakdown Short" — the stage-4 trend short, and the other half of the short
// book alongside Parabolic Short.
//
//   Parabolic  = fade an over-extension (strength that ran too far).
//   Breakdown  = sell a broken trend (weakness already confirmed).
//
// Mirror of the long playbook: price under an INVERTED 10 < 20 < 50 with the
// rails rolling over. The timing rule is the whole edge — the flush is the worst
// entry, the rally back into a declining rail is the trade.
// ---------------------------------------------------------------------------

const RULES = [
  {
    title: 'Below all three rails',
    body: 'Close under the 10, 20 and 50. Losing one rail is a pullback; losing all three is a change of trend.',
  },
  {
    title: 'Rails inverted — 10 < 20 < 50',
    body: 'The exact mirror of the 10 > 20 > 50 stack the long side demands. Inversion means each timeframe of buyer has already given up in sequence.',
  },
  {
    title: 'Rails declining',
    body: 'Both the 20 and 50 sloping down. This is the discriminator: price can cross below a rising 50 and be fine — below a falling one, nothing is pulling it back up.',
  },
  {
    title: 'Liquidity ≥ $5 and $5M/day',
    body: 'Shortability matters more than usual. A name you can\'t borrow or can\'t exit isn\'t a trade, however good the chart.',
  },
  {
    title: 'At the rail (soft)',
    body: 'Price has rallied back to within 3% of a declining 10/20 — the preferred entry, with the rail right overhead as the stop. Toggle the gate to see only these.',
  },
  {
    title: 'Below the 200 (soft)',
    body: 'Also under the 200-day: full stage 4 rather than a deep correction inside a longer uptrend. Toggle the gate to require it.',
  },
]

const ENTRY = [
  { phase: 'Never chase', rule: 'The flush is the worst entry — that\'s where it squeezes' },
  { phase: 'Wait for the pop', rule: 'Short the rally back into a declining 10 / 20 rail' },
  { phase: 'Stop', rule: 'Just above that rail — tight, because the rail is right there' },
]

const EXITS = [
  { phase: 'Cover into flush', rule: 'Down moves are fast — take profit into panic, not after it' },
  { phase: 'Trail', rule: 'Down the declining rail as it steps lower' },
  { phase: 'Invalidation', rule: 'A daily close back above the declining 20 ends the thesis' },
  { phase: 'Reclaim', rule: 'Rails flatten and price reclaims the 50 → stand aside, stage 1 now' },
]

const COLUMN_HELP = {
  Symbol:  'Ticker. ⚑ marks a name sitting at a declining rail — the preferred entry. Click to open Stock Analysis.',
  Close:   'Latest close.',
  '→10':   'How far price must rally to reach the declining 10-day, as % of price. Small = at the rail = entry zone. Large = already flushed.',
  '→20':   'Same, to the declining 20-day.',
  '↓50':   'How far below the 50-day price sits, as % — the depth of the markdown.',
  's20:    ': 'Slope of the 20-day in % per week. More negative = steeper markdown.',
  's50':   'Slope of the 50-day in % per week. Must be negative to qualify.',
  'Days':  'Consecutive sessions the close has spent below its 50-day — how established the breakdown is.',
  '$ Vol': 'Dollar volume today (Close × Volume). Must be ≥ $5M to be shortable.',
  Stop:    'Reference stop for the short: just above the nearest declining rail.',
  'Risk%': 'Distance from the close up to that stop. Small because you\'re entering at the rail, not after the flush.',
}

export default function BreakdownShort() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [requireAtRail, setRequireAtRail] = useState(false)
  const [requireBelow200, setRequireBelow200] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  const load = useCallback(async (force = false) => {
    setLoading(true); setError(null)
    try {
      setData(await getBreakdownScan({ requireAtRail, requireBelow200, force }))
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }, [requireAtRail, requireBelow200])

  useEffect(() => { load(false) }, [load])

  const candidates = data?.candidates || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-[22px] text-surface-50 tracking-tight">Breakdown Short</h1>
          <p className="text-surface-400 text-[12.5px] mt-1 max-w-2xl">
            The stage-4 trend short — price beneath an <span className="text-surface-300">inverted 10 &lt; 20 &lt; 50</span> with
            the rails rolling over. The mirror of the long playbook, and the other half of the short book alongside{' '}
            <Link to="/parabolic-short" className="text-cyan hover:underline underline-offset-2">Parabolic Short</Link>.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-900/80 border border-surface-700/50 text-[12px] text-surface-300 cursor-pointer hover:text-surface-100">
            <input type="checkbox" checked={requireAtRail} onChange={e => setRequireAtRail(e.target.checked)} className="accent-rose-400" />
            At the rail only
          </label>
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-900/80 border border-surface-700/50 text-[12px] text-surface-300 cursor-pointer hover:text-surface-100">
            <input type="checkbox" checked={requireBelow200} onChange={e => setRequireBelow200(e.target.checked)} className="accent-rose-400" />
            Below 200 only
          </label>
          <RefreshControl jobId="breakdown-short" onRefresh={() => load(true)} refreshing={loading} busyLabel="Scanning…" />
        </div>
      </div>

      {/* The timing rule — the single thing that decides whether this pays */}
      <div className="rounded-xl bg-rose-500/10 border border-rose-400/30 px-4 py-2.5 flex items-start gap-2.5">
        <svg className="w-4 h-4 mt-px shrink-0 text-rose-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <p className="text-[12px] text-rose-100/90 leading-snug">
          <span className="font-semibold text-rose-200">Short the pop, not the drop.</span> The initial flush is the worst
          entry — that's where shorts get squeezed. The trade is the <span className="text-rose-200">rally back into a
          declining rail</span>, with the rail directly overhead as a tight stop. Names already far below their 10-day are
          ranked <em>down</em> here for exactly that reason. Shorts carry unlimited risk — obey the stop.
        </p>
      </div>

      {error && <div className="rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-3 text-sm text-red-200">{error}</div>}

      {/* About */}
      <details className="rounded-2xl bg-surface-900/80 border border-surface-700/50" open={aboutOpen} onToggle={e => setAboutOpen(e.currentTarget.open)}>
        <summary className="cursor-pointer list-none px-5 py-3.5 flex items-center justify-between hover:bg-surface-800/40 rounded-2xl transition-colors">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-rose-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[14px] font-semibold text-surface-100">About this setup</span>
            <span className="text-[11px] text-surface-500">— rules, entry timing, exits</span>
          </div>
          <svg className={`w-4 h-4 text-surface-500 transition-transform ${aboutOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="px-5 pb-5 pt-1 space-y-5 border-t border-surface-700/40">
          <p className="text-[13px] text-surface-300 leading-relaxed pt-3">
            Two different shorts live in this app. <Link to="/parabolic-short" className="text-cyan hover:underline underline-offset-2">Parabolic Short</Link>{' '}
            fades <span className="text-surface-100">strength</span> — a rubber band stretched too far. This one sells{' '}
            <span className="text-surface-100">confirmed weakness</span>: a trend that has already broken, where every rail
            has been lost and is now sloping down overhead. It's the mirror image of the long setup, and it's what the{' '}
            <Link to="/rules#short-side" className="text-cyan hover:underline underline-offset-2">Short Side</Link> framework
            calls the backside — pops into declining rails.
          </p>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">Scan rules</div>
            <div className="grid sm:grid-cols-2 gap-2">
              {RULES.map(r => (
                <div key={r.title} className="rounded-lg bg-surface-950/40 border border-surface-700/40 p-3">
                  <div className="text-[12px] font-semibold text-surface-100">{r.title}</div>
                  <div className="text-[11px] text-surface-400 mt-1 leading-relaxed">{r.body}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            {[['Entry', ENTRY], ['Exits', EXITS]].map(([label, rows]) => (
              <div key={label}>
                <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">{label}</div>
                <div className="space-y-2">
                  {rows.map(e => (
                    <div key={e.phase} className="rounded-lg bg-surface-950/40 border border-surface-700/40 px-3 py-2 flex items-center justify-between gap-3">
                      <div className="text-[12px] font-semibold text-surface-100 shrink-0">{e.phase}</div>
                      <div className="text-[12px] text-surface-300 text-right">{e.rule}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg bg-rose-500/5 border border-rose-400/20 p-3">
            <div className="text-[11px] uppercase tracking-wider text-rose-300/80 font-semibold mb-1">Regime still gates it</div>
            <div className="text-[12px] text-rose-100/80 leading-relaxed">
              A good chart in the wrong tape still fails. Check <Link to="/situational-awareness" className="underline underline-offset-2">Trade Today</Link>{' '}
              first: shorts want the <span className="font-semibold">defensive</span> band with the Shorts/Hedges light green
              — decline underway but not capitulated. At the washed-out extreme these same charts are where violent
              snap-backs start.
            </div>
          </div>
        </div>
      </details>

      {/* Counts */}
      {data && (() => {
        const stale = isScanStale(data.generated_at)
        const scanTime = data.generated_at ? new Date(data.generated_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={`rounded-xl border p-3 ${stale ? 'bg-amber-500/5 border-amber-400/30' : 'bg-surface-900/80 border-surface-700/50'}`}>
              <div className="flex items-center gap-1.5">
                <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Scanned</div>
                {data.from_cache && !stale && <span className="text-[9px] font-mono text-surface-600 lowercase">cached</span>}
              </div>
              <div className={`mt-1 text-[15px] font-mono font-semibold tabular-nums ${stale ? 'text-amber-200' : 'text-surface-100'}`}>{scanTime || data.as_of || '—'}</div>
              <div className="text-[10px] mt-0.5 text-surface-500">{fmtRelativeAge(data.generated_at) || data.as_of || ''}</div>
            </div>
            <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-3" title="Total US tickers before any filter.">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Universe</div>
              <div className="mt-1 text-[15px] font-mono font-semibold text-surface-100">{fmtInt(data.counts?.universe)}</div>
            </div>
            <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-3" title="Passed the liquidity floor (Close ≥ $5 AND $ Vol ≥ $5M).">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Liquid</div>
              <div className="mt-1 text-[15px] font-mono font-semibold text-surface-100">{fmtInt(data.counts?.passed_liquidity)}</div>
            </div>
            <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-3" title="Cleared every rule and reached the table.">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Breakdowns</div>
              <div className="mt-1 text-[15px] font-mono font-semibold text-rose-300">{fmtInt(data.counts?.passed_all)}</div>
            </div>
          </div>
        )
      })()}

      {loading && !data && (
        <div className="rounded-2xl bg-surface-900/60 border border-surface-700/40 p-12 text-center">
          <div className="inline-flex items-center gap-2 text-surface-300">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Scanning for breakdowns…
          </div>
        </div>
      )}

      {data && candidates.length === 0 && !loading && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 border-dashed p-10 text-center">
          <p className="text-surface-100 font-semibold text-base">No breakdown setups today</p>
          <p className="text-surface-500 text-sm mt-2 max-w-md mx-auto">
            {data.error || 'In a strong tape almost nothing is in confirmed stage 4 — that is the scan working, not failing. Loosen the gates or come back when the regime turns.'}
          </p>
        </div>
      )}

      {data && candidates.length > 0 && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-[12px]">
              <thead className="bg-surface-950/50 text-[10px] uppercase tracking-wide text-surface-500">
                <tr>
                  {['Symbol', 'Close', '→10', '→20', '↓50', 's20', 's50', 'Days', '$ Vol', 'Stop', 'Risk%'].map(h => (
                    <th key={h} title={COLUMN_HELP[h]} className={`px-3 py-2 text-left font-semibold whitespace-nowrap ${COLUMN_HELP[h] ? 'cursor-help underline decoration-dotted decoration-surface-600 underline-offset-[3px] hover:text-surface-300' : ''}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono">
                {candidates.map(c => (
                  <tr key={c.symbol} className="border-t border-surface-800/60 hover:bg-surface-800/30">
                    <td className="px-3 py-2 font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        {c.at_rail && <span className="text-rose-300" title="At a declining rail — the preferred entry">⚑</span>}
                        <TickerLink symbol={c.symbol} className="text-surface-100" />
                        {c.below_200 && <span className="text-[9px] text-surface-600" title="Also below the 200-day — full stage 4">200</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-surface-200">{fmtMoney(c.close)}</td>
                    <td className={`px-3 py-2 ${c.at_rail ? 'text-rose-300 font-semibold' : c.extended ? 'text-surface-600' : 'text-surface-300'}`}>{c.to_ma10_pct?.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-surface-400">{c.to_ma20_pct?.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-surface-400">{c.below_50_pct?.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-rose-300">{c.slope20_per_week?.toFixed(2)}</td>
                    <td className="px-3 py-2 text-rose-300">{c.slope50_per_week?.toFixed(2)}</td>
                    <td className="px-3 py-2 text-surface-400">{c.days_below_50 ?? '—'}</td>
                    <td className="px-3 py-2 text-surface-400">{fmtCompactDollars(c.dollar_volume)}</td>
                    <td className="px-3 py-2 text-surface-400">{fmtMoney(c.stop)}</td>
                    <td className={`px-3 py-2 ${c.risk_pct == null ? 'text-surface-500' : c.risk_pct <= 4 ? 'text-emerald-300 font-semibold' : c.risk_pct <= 8 ? 'text-surface-200' : 'text-amber-300'}`}>
                      {c.risk_pct == null ? '—' : `${c.risk_pct.toFixed(2)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {candidates.length > 0 && (
        <p className="text-[10.5px] text-surface-500 px-1">
          Hover any column header for what it means. Sorted best-entry first — ⚑ at-the-rail names above already-flushed
          ones, because the pop is the trade and the flush is the squeeze.
          {data?.counts?.split_filtered > 0 && <> {data.counts.split_filtered} forward-split artifact(s) filtered.</>}
        </p>
      )}
    </div>
  )
}
