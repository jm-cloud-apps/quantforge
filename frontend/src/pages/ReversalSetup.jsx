import { useCallback, useEffect, useState } from 'react'
import { getReversalScan } from '../api/reversal'
import TickerLink from '../components/TickerLink'

// ---------------------------------------------------------------------------
// "Reversal Setup" scanner — Stockbee's intraday-exhaustion reversal.
// Source: https://stockbee.blogspot.com/2019/11/how-to-use-reversal-setup-to-make-money.html
//
//   l = minl5 and (o-l)>(c-o) and (c-l)/(h-l)>=.6
//   and v>=290000 and c>=5 and minv3.1>=100000
//
// Buy selling exhaustion: a stock that made a fresh short-term low intraday,
// then recovered to close near the high on a long lower tail. Enter near the
// close (MOC), stop just under the signal-day low — small, repeatable risk.
// ---------------------------------------------------------------------------

const RULES = [
  {
    title: 'Close ≥ $5.00',
    body: 'Penny-stock patterns are unreliable. Keeps the scan on names where the reversal candle actually means something.',
  },
  {
    title: 'Volume ≥ 290,000 shares',
    body: 'Enough participation on the signal day for the washout-and-recover to be real demand, not a thin-tape wiggle.',
  },
  {
    title: 'Fresh 5-day low (l = minl5)',
    body: 'Today\'s low is the lowest low of the last 5 sessions — the stock sold off to a new short-term low intraday. That selling is the exhaustion you\'re fading.',
  },
  {
    title: 'Recovery ≥ 60%',
    body: '(Close − Low) ÷ (High − Low). The close lands in the upper 40% of the day\'s range — buyers took control back into the close.',
  },
  {
    title: 'Lower-tail dominant',
    body: '(Open − Low) > (Close − Open). The drop below the open is bigger than the push up to the close — the long-lower-tail signature of an intraday washout that recovered.',
  },
  {
    title: 'Liquidity floor (minv3.1 ≥ 100K)',
    body: 'Each of the prior 3 sessions traded ≥ 100,000 shares. Filters out names that only printed volume on the signal day.',
  },
  {
    title: 'Real intraday range ≥ 1%',
    body: 'Beyond the literal scan: the day\'s range must be ≥ 1% of price. A flat 1-cent-range bar (think sleepy bond ETFs) can satisfy the formula but has no washout to recover from — this keeps the scan on names that actually moved.',
  },
  {
    title: 'Strong tail — 3× body (soft)',
    body: 'Lower tail ≥ 3× the candle body. Stockbee: "the candle tail is 3 to 5 times the body." Surfaced as a column; toggle the gate above to require it.',
  },
  {
    title: 'Green close (soft)',
    body: 'Close > Open. The hard scan admits red hammers too; toggle the gate to keep only green reversals.',
  },
]

const ENTRY = [
  { phase: 'Scan', rule: 'Run between 3:30 and 3:55 PM — you want the near-final candle' },
  { phase: 'Select', rule: 'Pick 1 to 3 ideas; prefer higher-priced stocks' },
  { phase: 'Enter', rule: 'Buy 3:58–4:00 PM or with a Market-On-Close (MOC) order' },
]

const EXITS = [
  { phase: 'Initial stop', rule: 'Just under the signal-day low (keeps risk ≈ <2.5%)' },
  { phase: 'Next day up', rule: 'Move stop to breakeven (or breakeven + a few %)' },
  { phase: 'Day 3 dud', rule: 'Doesn\'t move by the 3rd day → exit on stop' },
  { phase: 'In profit', rule: 'Up a multiple of risk → take profits or trail aggressively' },
]

const COLUMN_HELP = {
  Symbol:   'Ticker symbol. ▲ green / ▼ red marks the signal-day candle color. Click to open Stock Analysis.',
  Close:    'Signal-day closing price — roughly your MOC entry.',
  Vol:      'Signal-day share volume. Must be ≥ 290,000 to be in the scan.',
  '$ Vol':  'Dollar volume traded on the signal day (Close × Volume).',
  Recov:    'Recovery = (Close − Low) ÷ (High − Low). ≥ 60% to qualify; 80%+ means it closed right at the high — strongest reversal.',
  'Tail×':  'Lower tail ÷ body. Stockbee wants 3–5×. Bold = strong (≥3×). "doji" = near-zero body (hammer/doji), an even stronger tail.',
  'Risk%':  'Risk if you enter at the close with a stop just under the signal-day low: (Close − Low) ÷ Close. Lower is better — green ≤ 2.5%.',
  '5d ↓':   'Decline being reversed: drop from the prior 5-session high down to today\'s low. Bigger = more selling exhausted into the low.',
  Run:      'Trailing run of lower-closing sessions leading into the low — the selling streak this candle is fading. 3+ = washed out.',
  Stop:     'Reference stop: the signal-day low. Size so the Close-to-Stop distance is your fixed dollar risk.',
}

// Compact relative-time string for the freshness indicator.
function fmtRelativeAge(iso) {
  if (!iso) return null
  try {
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return null
    const diffMs = Date.now() - then
    if (diffMs < 0) return 'just now'
    const sec = Math.floor(diffMs / 1000)
    if (sec < 60) return 'just now'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    return null
  } catch {
    return null
  }
}

const STALE_AFTER_MIN = 90
function isScanStale(iso) {
  if (!iso) return false
  try {
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return false
    return (Date.now() - then) / 60000 > STALE_AFTER_MIN
  } catch {
    return false
  }
}

function fmtInt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return Number(n).toLocaleString('en-US')
}
function fmtMoney(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `$${Number(n).toFixed(digits)}`
}
function fmtCompactDollars(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const v = Math.abs(Number(n))
  if (v >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${Number(n).toFixed(0)}`
}

export default function ReversalSetup() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [requireStrongTail, setRequireStrongTail] = useState(false)
  const [requireGreen, setRequireGreen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await getReversalScan({ requireStrongTail, requireGreen, force })
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [requireStrongTail, requireGreen])

  useEffect(() => { load(false) }, [load])

  const candidates = data?.candidates || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">
            Reversal Setup
          </h1>
          <p className="text-surface-400 text-[13px] mt-1">
            Stockbee's intraday-exhaustion reversal — buy a fresh 5-day low that closed near the high on a long lower tail.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-900/80 border border-surface-700/50 text-[12px] text-surface-300 cursor-pointer hover:text-surface-100">
            <input
              type="checkbox"
              checked={requireStrongTail}
              onChange={(e) => setRequireStrongTail(e.target.checked)}
              className="accent-accent"
            />
            Require strong tail
          </label>
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-900/80 border border-surface-700/50 text-[12px] text-surface-300 cursor-pointer hover:text-surface-100">
            <input
              type="checkbox"
              checked={requireGreen}
              onChange={(e) => setRequireGreen(e.target.checked)}
              className="accent-accent"
            />
            Require green close
          </label>
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-[12px] font-medium hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loading ? 'Scanning…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* About / explanation panel */}
      <details
        className="rounded-2xl bg-surface-900/80 border border-surface-700/50"
        open={aboutOpen}
        onToggle={(e) => setAboutOpen(e.currentTarget.open)}
      >
        <summary className="cursor-pointer list-none px-5 py-3.5 flex items-center justify-between hover:bg-surface-800/40 rounded-2xl transition-colors">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
            The <span className="text-surface-100 font-semibold">Reversal Setup</span> buys{' '}
            <span className="text-surface-100">selling exhaustion</span>: a stock that sold off to a fresh short-term low
            intraday and then recovered to close near the high, leaving a long lower tail (Stockbee:{' '}
            <em className="text-surface-200">"the candle tail is 3 to 5 times the body"</em>). Because you enter near the
            close with a stop just under the signal-day low, per-trade risk is small —{' '}
            <span className="text-surface-100">often under 2.5%</span> — so a string of small stops is paid for by the
            occasional multi-R winner. Attributed to <span className="text-surface-100">Stockbee (Pradeep Bonde)</span>.
          </p>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">
              Scan rules (this scanner)
            </div>
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
            <div>
              <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">
                Entry
              </div>
              <div className="space-y-2">
                {ENTRY.map(e => (
                  <div key={e.phase} className="rounded-lg bg-surface-950/40 border border-surface-700/40 px-3 py-2 flex items-center justify-between gap-3">
                    <div className="text-[12px] font-semibold text-surface-100 shrink-0">{e.phase}</div>
                    <div className="text-[12px] text-surface-300 text-right">{e.rule}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">
                Exits
              </div>
              <div className="space-y-2">
                {EXITS.map(e => (
                  <div key={e.phase} className="rounded-lg bg-surface-950/40 border border-surface-700/40 px-3 py-2 flex items-center justify-between gap-3">
                    <div className="text-[12px] font-semibold text-surface-100 shrink-0">{e.phase}</div>
                    <div className="text-[12px] text-surface-300 text-right">{e.rule}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-emerald-500/5 border border-emerald-400/20 p-3">
            <div className="text-[11px] uppercase tracking-wider text-emerald-300/80 font-semibold mb-1">
              Why it works
            </div>
            <div className="text-[12px] text-emerald-100/80 leading-relaxed">
              The whole edge is <span className="font-semibold">small, repeatable risk</span>. Buying near the signal-day
              low puts your stop a hair below it, so a $-fixed risk translates into a tight % stop. Stockbee:{' '}
              <em>"it allows you to find stocks with less than 2.5% risk if bought near low on signal day."</em> Move the
              stop to breakeven the moment it works, and let the winners run to multiples of that risk.
            </div>
          </div>

          <div className="text-[10px] text-surface-600">
            Source: stockbee.blogspot.com — "How to use Reversal setup to make money" (Nov 2019)
          </div>
        </div>
      </details>

      {/* Scan meta + counts */}
      {data && (() => {
        const stale = isScanStale(data.generated_at)
        const scanTime = data.generated_at
          ? new Date(data.generated_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
          : null
        const scanRel = fmtRelativeAge(data.generated_at)
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div
              className={`rounded-xl border p-3 ${
                stale ? 'bg-amber-500/5 border-amber-400/30' : 'bg-surface-900/80 border-surface-700/50'
              }`}
              title={data.generated_at ? `Scan ran ${data.generated_at.replace('T', ' ')}${data.from_cache ? ' (served from cache)' : ''}` : ''}
            >
              <div className="flex items-center gap-1.5">
                <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Scanned</div>
                {stale && (
                  <span className="text-[9px] font-bold tracking-wider text-amber-300 bg-amber-500/15 border border-amber-400/30 rounded px-1 py-px uppercase">
                    Stale
                  </span>
                )}
                {data.from_cache && !stale && (
                  <span className="text-[9px] font-mono text-surface-600 lowercase">cached</span>
                )}
              </div>
              <div className={`mt-1 text-[15px] font-mono font-semibold tabular-nums ${stale ? 'text-amber-200' : 'text-surface-100'}`}>
                {scanTime || data.as_of || '—'}
              </div>
              <div className={`text-[10px] mt-0.5 ${stale ? 'text-amber-300/80' : 'text-surface-500'}`}>
                {scanRel ? `${scanRel} · ${data.as_of || ''}` : (data.as_of || '')}
              </div>
            </div>
            <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-3" title="Total US tickers considered before any filter.">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Universe</div>
              <div className="mt-1 text-[15px] font-mono font-semibold text-surface-100">{fmtInt(data.counts?.universe)}</div>
            </div>
            <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-3" title="Tickers that passed the hard volume + price floor (Vol ≥ 290K AND Close ≥ $5).">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">≥ 290K vol + $5</div>
              <div className="mt-1 text-[15px] font-mono font-semibold text-surface-100">{fmtInt(data.counts?.passed_volume)}</div>
            </div>
            <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-3" title="Tickers that cleared every rule and reached the candidate table.">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Setups</div>
              <div className="mt-1 text-[15px] font-mono font-semibold text-accent">{fmtInt(data.counts?.passed_all)}</div>
            </div>
          </div>
        )
      })()}

      {/* Loading */}
      {loading && !data && (
        <div className="rounded-2xl bg-surface-900/60 border border-surface-700/40 p-12 text-center">
          <div className="inline-flex items-center gap-2 text-surface-300">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Scanning for reversals…
          </div>
        </div>
      )}

      {/* Empty state */}
      {data && candidates.length === 0 && !loading && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 border-dashed p-10 text-center">
          <p className="text-surface-100 font-semibold text-base">No reversal setups today</p>
          <p className="text-surface-500 text-sm mt-2 max-w-md mx-auto">
            {data.error
              ? data.error
              : 'Some days legitimately produce zero — fresh-low reversals cluster around selloffs. Try toggling off the strict gates above, or come back at the next refresh.'}
          </p>
        </div>
      )}

      {/* Candidates table */}
      {data && candidates.length > 0 && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-[12px]">
              <thead className="bg-surface-950/50 text-[10px] uppercase tracking-wide text-surface-500">
                <tr>
                  {['Symbol', 'Close', 'Vol', '$ Vol', 'Recov', 'Tail×', 'Risk%', '5d ↓', 'Run', 'Stop'].map(h => {
                    const help = COLUMN_HELP[h]
                    return (
                      <th
                        key={h}
                        title={help}
                        aria-label={help ? `${h}: ${help}` : h}
                        className={`px-3 py-2 text-left font-semibold whitespace-nowrap ${
                          help ? 'cursor-help underline decoration-dotted decoration-surface-600 underline-offset-[3px] hover:text-surface-300' : ''
                        }`}
                      >
                        {h}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="font-mono">
                {candidates.map(c => (
                  <tr key={c.symbol} className="border-t border-surface-800/60 hover:bg-surface-800/30">
                    <td className="px-3 py-2 font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={c.green ? 'text-emerald-400' : 'text-rose-400'}
                          title={c.green ? 'Green candle (close > open)' : 'Red candle (close ≤ open)'}
                        >
                          {c.green ? '▲' : '▼'}
                        </span>
                        <TickerLink symbol={c.symbol} className="text-surface-100" />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-surface-200">{fmtMoney(c.close)}</td>
                    <td className="px-3 py-2 text-surface-300">{fmtInt(c.volume)}</td>
                    <td className="px-3 py-2 text-surface-400">{fmtCompactDollars(c.dollar_volume)}</td>
                    <td className={`px-3 py-2 ${c.recovery_pct >= 80 ? 'text-emerald-300 font-semibold' : c.recovery_pct >= 70 ? 'text-emerald-200' : 'text-surface-200'}`}>
                      {c.recovery_pct?.toFixed(1)}%
                    </td>
                    <td className={`px-3 py-2 ${c.is_strong_tail ? 'text-emerald-300 font-semibold' : 'text-surface-300'}`}>
                      {c.tail_body_ratio === null || c.tail_body_ratio === undefined
                        ? <span className="text-cyan-300" title="Near-zero body — hammer/doji, an even stronger tail">doji</span>
                        : `${c.tail_body_ratio.toFixed(1)}×`}
                    </td>
                    <td className={`px-3 py-2 ${
                      c.risk_pct == null ? 'text-surface-500'
                      : c.risk_pct <= 2.5 ? 'text-emerald-300 font-semibold'
                      : c.risk_pct <= 4 ? 'text-surface-200'
                      : 'text-amber-300'
                    }`}>
                      {c.risk_pct == null ? '—' : `${c.risk_pct.toFixed(2)}%`}
                    </td>
                    <td className="px-3 py-2 text-surface-300">
                      {c.decline_5d_pct == null ? '—' : `${c.decline_5d_pct.toFixed(1)}%`}
                    </td>
                    <td className={`px-3 py-2 ${c.down_days_prior >= 3 ? 'text-amber-300 font-semibold' : 'text-surface-400'}`}>
                      {c.down_days_prior ?? 0}
                    </td>
                    <td className="px-3 py-2 text-surface-400">{fmtMoney(c.stop)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data?.candidates?.length > 0 && (
        <div className="text-[10.5px] text-surface-500 flex items-center gap-2 px-1">
          <svg className="w-3 h-3 text-surface-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Hover any column header for what it means. Sorted strongest-tail first.</span>
        </div>
      )}
    </div>
  )
}
