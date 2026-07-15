import { useCallback, useEffect, useState } from 'react'
import { getMAReclaimScan } from '../api/maReclaim'
import TickerLink from '../components/TickerLink'
import RefreshControl from '../components/RefreshControl'

// ---------------------------------------------------------------------------
// "200 MA Reclaim" scanner — a long-term momentum flip from bearish to bullish.
//
// The 200-day MA is the institutional dividing line between a stock in a bull
// phase and one that isn't. This scan catches the *event* where a name that sat
// BELOW its 200-day line for weeks reclaims it — the earliest structural sign the
// long-term trend is turning up. The "was below ≥25 sessions first" gate is what
// separates a genuine downtrend flip from a name chopping across a flat MA.
// ---------------------------------------------------------------------------

const RULES = [
  {
    title: 'Liquidity — Close ≥ $5, $Vol ≥ $5M',
    body: 'Real, tradable names only. Keeps the reclaim signal on stocks that institutions can actually accumulate.',
  },
  {
    title: 'Above the 200-day today',
    body: 'The latest close is at or above its 200-day moving average — it has reclaimed the line. This is the structural bull/bear divide.',
  },
  {
    title: 'Fresh cross (≤ 10 sessions)',
    body: 'The below→above cross happened within the last ~2 weeks. You want to be early to the reclaim, near the pivot — not chasing a name that crossed and already ran.',
  },
  {
    title: 'Was below ≥ 25 sessions first',
    body: 'Price sat under the 200-day for a month+ in a row before the cross. This is the filter that turns "wiggled above a flat line" into a genuine long-term-downtrend flip.',
  },
  {
    title: 'MA turning up (soft)',
    body: "The 200-day itself has stopped falling / is curling up (slope ≥ 0). A reclaim while the line is still falling is weaker than one where the trend — not just price — is turning. Toggle above to require it.",
  },
  {
    title: 'RS leading (soft)',
    body: 'Mansfield relative strength vs SPY is positive — the stock is outperforming the market into the reclaim. Toggle above to require it.',
  },
  {
    title: 'Not extended (soft)',
    body: 'Price is still within ~8% of the 200-day. Beyond that the reclaim already ran and you are late. Toggle above to drop extended names.',
  },
]

const ENTRY = [
  { phase: 'Scan', rule: 'End of day — the reclaim is confirmed on the close above the line' },
  { phase: 'Prefer', rule: 'Names where the 200d is flattening/turning up and RS is improving' },
  { phase: 'Enter', rule: 'On the reclaim, or a tight pullback that holds the 200-day line' },
]

const EXITS = [
  { phase: 'Initial stop', rule: 'A decisive close back below the reclaimed 200-day MA' },
  { phase: 'Stalls at line', rule: 'Fails to hold above / churns on the line → step aside, it wasn\'t ready' },
  { phase: 'Trend develops', rule: 'Trail under higher lows as the new Stage-2 uptrend builds' },
  { phase: 'Extended', rule: 'Far above the line already? Wait for the next base rather than chase' },
]

const COLUMN_HELP = {
  Symbol:  'Ticker. The colored dot marks the setup: green = fresh reclaim with the 200d turning up, teal = fresh reclaim, blue = holding above, amber = already extended. Click to open Stock Analysis.',
  Close:   'Latest closing price.',
  '200d':  'The 200-day simple moving average — the line just reclaimed. If the breadth cache is shallow this is a shorter proxy (see the banner).',
  '+%':    'How far above the 200-day price closed. Amber (> 8%) means the reclaim already ran — you\'re late to it.',
  Age:     'Sessions since the close crossed back above the line. 0 = crossed today; ≤ 3 is freshest.',
  Below:   'Consecutive sessions spent below the 200-day before reclaiming. Bigger = a longer downtrend being flipped.',
  'Slope': "The 200-day's own slope, %/week. ▲ rising · ▶ flat · ▼ still falling. A reclaim while the line is turning up is the strongest.",
  Depth:   'The deepest price traded under its 200-day during the decline — the size of the hole it climbed out of.',
  RS:      'Relative-strength rank vs the market, 1–99 (Mansfield RS vs SPY). ≥ 70 = a leader.',
  'Vol×':  'Volume since the cross vs the pre-cross average. > 1 means the reclaim came on expanding demand.',
  Q:       'Composite quality 0–100: freshness, depth of base reclaimed, 200d slope, relative strength, volume, and not-extended.',
  Stop:    'Reference stop — the reclaimed 200-day line. A close back below it invalidates the flip.',
}

// Setup-bucket dot color, keyed to the signal label from the backend.
function signalDot(signal) {
  if (!signal) return 'text-surface-500'
  if (signal.includes('Extended')) return 'text-amber-400'
  if (signal.includes('MA turning')) return 'text-emerald-400'
  if (signal.startsWith('Fresh')) return 'text-teal-300'
  return 'text-sky-400'
}

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

export default function MAReclaim() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [requireMaTurning, setRequireMaTurning] = useState(false)
  const [requireRs, setRequireRs] = useState(false)
  const [excludeExtended, setExcludeExtended] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await getMAReclaimScan({ requireMaTurning, requireRs, excludeExtended, force })
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [requireMaTurning, requireRs, excludeExtended])

  useEffect(() => { load(false) }, [load])

  const candidates = data?.candidates || []
  const th = data?.thresholds
  const maApprox = th?.ma_approx

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">
            200 MA Reclaim
          </h1>
          <p className="text-surface-400 text-[13px] mt-1">
            Long-term momentum flip — stocks reclaiming their 200-day MA after a sustained stretch below it.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-900/80 border border-surface-700/50 text-[12px] text-surface-300 cursor-pointer hover:text-surface-100">
            <input type="checkbox" checked={requireMaTurning} onChange={(e) => setRequireMaTurning(e.target.checked)} className="accent-accent" />
            MA turning up
          </label>
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-900/80 border border-surface-700/50 text-[12px] text-surface-300 cursor-pointer hover:text-surface-100">
            <input type="checkbox" checked={requireRs} onChange={(e) => setRequireRs(e.target.checked)} className="accent-accent" />
            RS leading
          </label>
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-900/80 border border-surface-700/50 text-[12px] text-surface-300 cursor-pointer hover:text-surface-100">
            <input type="checkbox" checked={excludeExtended} onChange={(e) => setExcludeExtended(e.target.checked)} className="accent-accent" />
            Hide extended
          </label>
          <RefreshControl jobId="ma-reclaim" onRefresh={() => load(true)} refreshing={loading} busyLabel="Scanning…" />
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Approx-MA banner: the cache is too shallow for a true 200-day MA. */}
      {maApprox && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 px-4 py-3 text-[12.5px] text-amber-100 flex items-start gap-2.5">
          <svg className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3l-6.93-12a2 2 0 00-3.48 0l-6.93 12a2 2 0 001.74 3z" />
          </svg>
          <span>
            Using a <span className="font-semibold">{th?.ma_days}-day MA proxy</span> — only {th?.days_available} trading days are cached,
            and a true 200-day MA needs ~245. Reclaims below are measured against that shorter line.
            For the real 200-day, deepen the breadth cache: <span className="font-semibold">Market Monitor → Refresh</span> with a ~360-day lookback.
          </span>
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
            The <span className="text-surface-100 font-semibold">200-day moving average</span> is the single most-watched
            long-term trend line in the market — institutions treat <span className="text-surface-100">"above the 200d"</span> as
            the line between a stock in a bull phase and one that isn't. This scan hunts the moment a name that has been{' '}
            <span className="text-surface-100">below</span> its 200-day for weeks{' '}
            <span className="text-surface-100">reclaims</span> it. That reclaim is the earliest structural signal the long-term
            trend is flipping from <span className="text-rose-300">bearish</span> to{' '}
            <span className="text-emerald-300">bullish</span> — you catch the shift near the pivot instead of chasing it later.
            The <span className="text-surface-100">"was below ≥ 25 sessions first"</span> requirement is the key filter: it
            surfaces genuine regime flips, not names chopping back and forth across a flat line.
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
              <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">Entry</div>
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
              <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">Exits</div>
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
            <div className="text-[11px] uppercase tracking-wider text-emerald-300/80 font-semibold mb-1">Why it works</div>
            <div className="text-[12px] text-emerald-100/80 leading-relaxed">
              A cross from below to above the 200-day is the classic long-term momentum regime change. Buying the{' '}
              <span className="font-semibold">first reclaim after a long downtrend</span> gets you in near the pivot with a
              clean, close-by invalidation — the line itself. Stack the odds by favouring reclaims where the 200-day has
              stopped falling and relative strength is already turning up.
            </div>
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
              className={`rounded-xl border p-3 ${stale ? 'bg-amber-500/5 border-amber-400/30' : 'bg-surface-900/80 border-surface-700/50'}`}
              title={data.generated_at ? `Scan ran ${data.generated_at.replace('T', ' ')}${data.from_cache ? ' (served from cache)' : ''}` : ''}
            >
              <div className="flex items-center gap-1.5">
                <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Scanned</div>
                {stale && (
                  <span className="text-[9px] font-bold tracking-wider text-amber-300 bg-amber-500/15 border border-amber-400/30 rounded px-1 py-px uppercase">Stale</span>
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
            <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-3" title="Liquid names currently trading above their 200-day MA.">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Above 200d</div>
              <div className="mt-1 text-[15px] font-mono font-semibold text-surface-100">{fmtInt(data.counts?.currently_above)}</div>
            </div>
            <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-3" title="Names that just reclaimed the line after a sustained stretch below — the setups.">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Reclaims</div>
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
            Scanning for 200-day reclaims…
          </div>
        </div>
      )}

      {/* Empty state */}
      {data && candidates.length === 0 && !loading && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 border-dashed p-10 text-center">
          <p className="text-surface-100 font-semibold text-base">No 200-day reclaims today</p>
          <p className="text-surface-500 text-sm mt-2 max-w-md mx-auto">
            {data.error
              ? data.error
              : 'Fresh reclaims cluster after downtrends break — some days legitimately produce none. Try toggling off the soft gates above, or come back at the next refresh.'}
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
                  {['Symbol', 'Close', '200d', '+%', 'Age', 'Below', 'Slope', 'Depth', 'RS', 'Vol×', 'Q', 'Stop'].map(h => {
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
                        <span className={signalDot(c.signal)} title={c.signal}>●</span>
                        <TickerLink symbol={c.symbol} className="text-surface-100" />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-surface-200">{fmtMoney(c.close)}</td>
                    <td className="px-3 py-2 text-surface-400">{fmtMoney(c.ma)}</td>
                    <td className={`px-3 py-2 ${c.extended ? 'text-amber-300 font-semibold' : 'text-emerald-200'}`}>
                      {c.pct_above_ma == null ? '—' : `+${c.pct_above_ma.toFixed(1)}%`}
                    </td>
                    <td className={`px-3 py-2 ${c.reclaim_age <= 3 ? 'text-emerald-300 font-semibold' : c.reclaim_age >= 8 ? 'text-amber-300' : 'text-surface-200'}`}>
                      {c.reclaim_age === 0 ? 'today' : `${c.reclaim_age}d`}
                    </td>
                    <td className={`px-3 py-2 ${c.days_below >= 40 ? 'text-emerald-300 font-semibold' : c.days_below >= 25 ? 'text-emerald-200' : 'text-surface-300'}`}>
                      {c.days_below}
                    </td>
                    <td className={`px-3 py-2 ${c.ma_rising ? 'text-emerald-300' : c.ma_falling ? 'text-rose-300' : 'text-surface-300'}`}>
                      <span title={c.ma_rising ? '200d rising' : c.ma_falling ? '200d still falling' : '200d flat / turning'}>
                        {c.ma_rising ? '▲' : c.ma_falling ? '▼' : '▶'} {c.ma_slope_per_week?.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-surface-400">
                      {c.max_below_pct == null ? '—' : `−${c.max_below_pct.toFixed(0)}%`}
                    </td>
                    <td className={`px-3 py-2 ${c.rs_rank == null ? 'text-surface-500' : c.rs_rank >= 70 ? 'text-emerald-300 font-semibold' : c.rs_rank >= 50 ? 'text-surface-200' : 'text-surface-500'}`}>
                      {c.rs_rank == null ? '—' : c.rs_rank}
                    </td>
                    <td className={`px-3 py-2 ${c.vol_ratio == null ? 'text-surface-500' : c.vol_ratio >= 1.5 ? 'text-emerald-300 font-semibold' : c.vol_ratio >= 1 ? 'text-surface-200' : 'text-surface-500'}`}>
                      {c.vol_ratio == null ? '—' : `${c.vol_ratio.toFixed(1)}×`}
                    </td>
                    <td className={`px-3 py-2 ${c.quality >= 60 ? 'text-emerald-300 font-semibold' : c.quality >= 45 ? 'text-surface-200' : 'text-surface-400'}`}>
                      {c.quality?.toFixed(0)}
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
          <span>Hover any column header for what it means. Sorted freshest, highest-quality reclaims first.</span>
        </div>
      )}
    </div>
  )
}
