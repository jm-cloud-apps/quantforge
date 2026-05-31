import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getOptionsFlow } from '../api/optionsFlow'
import TickerLink from '../components/TickerLink'

const LEAN_STYLES = {
  strong_bullish: { label: 'Strong Bullish', cls: 'text-success border-success/60 bg-success/10' },
  bullish:        { label: 'Bullish',        cls: 'text-success border-success/40 bg-success/5'  },
  neutral:        { label: 'Neutral',        cls: 'text-surface-300 border-surface-600/40 bg-surface-800' },
  bearish:        { label: 'Bearish',        cls: 'text-danger border-danger/40 bg-danger/5'    },
  strong_bearish: { label: 'Strong Bearish', cls: 'text-danger border-danger/60 bg-danger/10'   },
}

const fmtMoney = (v) => {
  if (v == null) return '–'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

const fmtNum = (v) => (v == null ? '–' : Number(v).toLocaleString())

const OptionsFlow = () => {
  // URL param /flow/:underlying (deeplink from /breakouts tiles).
  const { underlying: urlUnderlying } = useParams()
  const navigate = useNavigate()

  const [ticker, setTicker] = useState(urlUnderlying || '')
  const [submitted, setSubmitted] = useState(urlUnderlying || '')
  const [includeSweeps, setIncludeSweeps] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = async (sym, { fresh = false, sweeps = includeSweeps } = {}) => {
    if (!sym) return
    setLoading(true)
    setError(null)
    try {
      const res = await getOptionsFlow(sym, { fresh, includeSweeps: sweeps })
      setData(res)
    } catch (e) {
      // Preserve structured error so the UI can branch on e.code.
      setError({ message: e.message, code: e.code, hint: e.hint, endpointName: e.endpointName, status: e.status })
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  // Auto-load on URL param change (deeplink entry).
  useEffect(() => {
    if (urlUnderlying) {
      const sym = urlUnderlying.toUpperCase()
      setTicker(sym)
      setSubmitted(sym)
      load(sym)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlUnderlying])

  const handleSubmit = (e) => {
    e.preventDefault()
    const sym = ticker.trim().toUpperCase()
    if (!sym) return
    setSubmitted(sym)
    // Keep the URL in sync — that way users can bookmark / share.
    navigate(`/flow/${sym}`, { replace: true })
    load(sym)
  }

  const handleSweepsToggle = () => {
    const next = !includeSweeps
    setIncludeSweeps(next)
    if (submitted) load(submitted, { sweeps: next })
  }

  const lean = data?.lean ? (LEAN_STYLES[data.lean] || LEAN_STYLES.neutral) : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display font-bold text-[28px] text-surface-50 tracking-tight mb-1">
          Options Flow
        </h1>
        <p className="text-surface-400 text-sm">
          Premium-weighted call/put activity + unusual contracts by Volume/OI. Lens on institutional positioning visible in the options tape.
        </p>
      </div>

      {/* Search */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="Ticker (e.g. NVDA, TSLA, PLTR)"
          className="px-4 py-2 rounded-lg bg-surface-900 border border-surface-700 text-surface-100 text-sm focus:outline-none focus:border-accent w-64"
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || !ticker.trim()}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? 'Fetching…' : 'Get Flow'}
        </button>
        {submitted && (
          <button
            type="button"
            onClick={() => load(submitted, { fresh: true })}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 disabled:opacity-50"
          >
            Refresh
          </button>
        )}
        <button
          type="button"
          onClick={handleSweepsToggle}
          disabled={loading || !submitted}
          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
            includeSweeps
              ? 'bg-success/10 border-success/40 text-success'
              : 'bg-surface-800 border-surface-600/50 text-surface-200 hover:bg-surface-700'
          }`}
          title="Pull tick-level trades for the top 10 unusual contracts and detect multi-exchange sweeps (urgent institutional fills)."
        >
          {includeSweeps ? '✓ Sweep detection on' : '+ Detect sweeps'}
        </button>
      </form>

      {error && <ErrorPanel error={error} />}

      {/* About panel */}
      {!data && !loading && (
        <div className="rounded-xl bg-accent/[0.04] border border-accent/20 p-4 space-y-2">
          <div className="text-xs uppercase tracking-wider text-accent font-bold">What this page shows</div>
          <ul className="space-y-1.5">
            <li className="text-[12px] text-surface-400 leading-snug">
              <span className="text-surface-200 font-medium">Premium-weighted P/C ratio:</span> dollar volume in puts vs. calls. Way more meaningful than contract-count P/C — a single $50 institutional fill dwarfs 1,000 retail $0.05 lottos.
            </li>
            <li className="text-[12px] text-surface-400 leading-snug">
              <span className="text-surface-200 font-medium">Vol/OI per contract:</span> today's volume vs. total open interest. {'>'} 1 means today alone exceeds the entire existing position — fresh institutional positioning, not unwinding.
            </li>
            <li className="text-[12px] text-surface-400 leading-snug">
              <span className="text-surface-200 font-medium">Lean classification:</span> Strong Bullish/Bullish/Neutral/Bearish/Strong Bearish based on the share of total premium going into calls. Strong = ≥70% one side.
            </li>
            <li className="text-[12px] text-surface-400 leading-snug">
              <span className="text-surface-200 font-medium">Top Unusual table:</span> contracts sorted by Vol/OI desc. The strikes here are where the money is actually positioning — read it like a heat map of conviction.
            </li>
          </ul>
          <p className="text-[11px] text-surface-500 pt-2 border-t border-surface-700/40">
            Data: one Massive <span className="font-mono">/v3/snapshot/options/{'{underlying}'}</span> call per ticker. Cached 5 min server-side.
            Sweep detection (multi-exchange large prints) is a follow-up — current MVP uses the snapshot, which captures 80% of the signal in 1 API call.
          </p>
        </div>
      )}

      {loading && (
        <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-4 flex items-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          <span className="text-sm text-surface-100 font-medium">Pulling option chain for {submitted}…</span>
          <span className="text-[11px] text-surface-400">Paginates the full chain (~250 contracts/page). Usually 2-5 seconds.</span>
        </div>
      )}

      {data && (
        <>
          {/* Summary card */}
          <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-5 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-3">
                  <TickerLink symbol={data.underlying} className="text-2xl font-bold text-surface-100" />
                  {data.underlying_price != null && (
                    <span className="text-sm text-surface-400 font-mono">${data.underlying_price.toFixed(2)}</span>
                  )}
                  {lean && (
                    <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${lean.cls}`}>
                      {lean.label}
                    </span>
                  )}
                  {data.premium_vs_baseline != null && (
                    <span
                      className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${
                        data.premium_vs_baseline >= 2 ? 'border-success/60 text-success bg-success/10'
                        : data.premium_vs_baseline >= 1.3 ? 'border-warning/60 text-warning bg-warning/10'
                        : 'border-surface-600/40 text-surface-300 bg-surface-800'
                      }`}
                      title={`Today's total premium vs. the ${data.baseline?.sample_days}-day rolling mean ($${(data.baseline?.avg_total_premium / 1e6).toFixed(2)}M). ≥2× = clearly unusual.`}
                    >
                      {data.premium_vs_baseline.toFixed(2)}× normal
                    </span>
                  )}
                  {data.premium_vs_baseline == null && data.baseline?.sample_days < 5 && (
                    <span className="text-[10px] text-surface-500 italic">
                      Building baseline ({data.baseline?.sample_days}/5 days)
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-surface-500 mt-1">
                  As of {new Date(data.as_of).toLocaleString()} · {data.contract_count_traded} contracts traded · {data.elapsed_seconds}s
                  {data.cached && (
                    <span className="ml-2 px-1.5 py-0.5 rounded border border-surface-700/40 bg-surface-900/60 font-mono text-[10px]">
                      cached · {Math.round((data.cache_age_seconds || 0) / 60)}m old
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Premium grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Call Premium" value={fmtMoney(data.call_premium)} cls="text-success" />
              <Stat label="Put Premium"  value={fmtMoney(data.put_premium)}  cls="text-danger" />
              <Stat
                label="P/C Premium"
                value={data.pc_premium_ratio != null ? data.pc_premium_ratio.toFixed(2) : '–'}
                cls={data.pc_premium_ratio != null && data.pc_premium_ratio < 1 ? 'text-success' : 'text-danger'}
                hint={data.pc_premium_ratio != null && data.pc_premium_ratio < 1
                  ? 'More dollars going to calls — bullish lean'
                  : 'More dollars going to puts — bearish lean'}
              />
              <Stat
                label="Bullish %"
                value={data.bullish_pct != null ? `${(data.bullish_pct * 100).toFixed(0)}%` : '–'}
                hint="Share of total premium going into calls"
              />
              <Stat label="Call Volume" value={fmtNum(data.call_volume)} />
              <Stat label="Put Volume"  value={fmtNum(data.put_volume)} />
              <Stat
                label="P/C Volume"
                value={data.pc_volume_ratio != null ? data.pc_volume_ratio.toFixed(2) : '–'}
                hint="Contract count P/C — less reliable than premium P/C"
              />
              <Stat label="Total Premium" value={fmtMoney(data.total_premium)} />
            </div>
          </div>

          {/* Top unusual contracts table */}
          <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-surface-700/40">
              <h3 className="text-sm font-medium text-surface-100">Top Unusual Contracts</h3>
              <p className="text-[11px] text-surface-500 mt-0.5">
                Sorted by Vol/OI desc — fresh positioning where today's volume exceeds existing open interest.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-surface-500 border-b border-surface-700/40">
                  <tr>
                    <th className="text-left px-3 py-2">Side</th>
                    <th className="text-right px-3 py-2">Strike</th>
                    <th className="text-left px-3 py-2">Expiry</th>
                    <th className="text-right px-3 py-2">Vol</th>
                    <th className="text-right px-3 py-2">OI</th>
                    <th className="text-right px-3 py-2">Vol/OI</th>
                    <th className="text-right px-3 py-2">Last $</th>
                    <th className="text-right px-3 py-2">Premium</th>
                    <th className="text-right px-3 py-2">IV</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_unusual?.map((c, i) => (
                    <tr key={`${c.side}-${c.strike}-${c.expiration}-${i}`} className="border-b border-surface-800/60 hover:bg-surface-800/30">
                      <td className={`px-3 py-2 font-bold uppercase ${c.side === 'call' ? 'text-success' : 'text-danger'}`}>
                        {c.side === 'call' ? 'CALL' : 'PUT'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-surface-100">${c.strike?.toFixed(2)}</td>
                      <td className="px-3 py-2 text-surface-300">{c.expiration}</td>
                      <td className="px-3 py-2 text-right font-mono text-surface-200">{fmtNum(c.volume)}</td>
                      <td className="px-3 py-2 text-right font-mono text-surface-400">{fmtNum(c.open_interest)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${c.vol_oi >= 2 ? 'text-success' : c.vol_oi >= 1 ? 'text-warning' : 'text-surface-200'}`}>
                        {c.vol_oi != null ? `${c.vol_oi.toFixed(2)}x` : '–'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-surface-300">${c.last_price?.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-surface-100">{fmtMoney(c.premium)}</td>
                      <td className="px-3 py-2 text-right font-mono text-surface-400">{c.iv != null ? `${(c.iv * 100).toFixed(0)}%` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!data.top_unusual || data.top_unusual.length === 0) && (
                <div className="p-6 text-center text-surface-500 text-sm">No traded contracts above min volume threshold.</div>
              )}
            </div>
          </div>

          {/* Partial-failure: sweep detection failed but main chain succeeded. */}
          {data.include_sweeps && data.sweeps_error && (
            <ErrorPanel error={data.sweeps_error} compact />
          )}

          {/* Sweeps table (only when opt-in toggle is on AND no error) */}
          {data.include_sweeps && !data.sweeps_error && (
            <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-700/40">
                <h3 className="text-sm font-medium text-surface-100">
                  Detected Sweeps
                  <span className="ml-2 text-[11px] font-normal text-surface-500">({data.sweeps?.length || 0})</span>
                </h3>
                <p className="text-[11px] text-surface-500 mt-0.5">
                  Multi-exchange large prints in a ≤500ms window. Hallmark of urgent institutional fills.
                  Side hint is from price drift across the cluster — bid-lift vs ask-hit heuristic, not true aggressor side.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-surface-500 border-b border-surface-700/40">
                    <tr>
                      <th className="text-left px-3 py-2">Time</th>
                      <th className="text-left px-3 py-2">Contract</th>
                      <th className="text-right px-3 py-2">Strike</th>
                      <th className="text-right px-3 py-2">Size</th>
                      <th className="text-right px-3 py-2">Exch.</th>
                      <th className="text-right px-3 py-2">Avg $</th>
                      <th className="text-right px-3 py-2">Premium</th>
                      <th className="text-left px-3 py-2">Hint</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sweeps?.map((s, i) => (
                      <tr key={`${s.contract_ticker}-${s.timestamp_ms}-${i}`} className="border-b border-surface-800/60 hover:bg-surface-800/30">
                        <td className="px-3 py-2 font-mono text-surface-300">
                          {new Date(s.timestamp_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                        <td className={`px-3 py-2 font-bold uppercase ${s.side === 'call' ? 'text-success' : 'text-danger'}`}>
                          {s.side === 'call' ? 'CALL' : 'PUT'}
                          <span className="text-[10px] font-normal text-surface-500 ml-1.5">{s.expiration}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-surface-100">${s.strike?.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono text-surface-200">{fmtNum(s.total_size)}</td>
                        <td className="px-3 py-2 text-right font-mono text-surface-300">{s.num_exchanges}</td>
                        <td className="px-3 py-2 text-right font-mono text-surface-300">${s.avg_price?.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono text-surface-100 font-bold">{fmtMoney(s.premium)}</td>
                        <td className={`px-3 py-2 uppercase text-[10px] font-bold ${
                          s.side_hint === 'bullish' ? 'text-success'
                          : s.side_hint === 'bearish' ? 'text-danger'
                          : 'text-surface-400'
                        }`}>
                          {s.side_hint}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(!data.sweeps || data.sweeps.length === 0) && (
                  <div className="p-6 text-center text-surface-500 text-sm">
                    No sweeps detected on top {data.top_unusual?.length || 0} contracts.
                    Tighter clusters require ≥2 exchanges + ≥50 contracts in &lt;500ms.
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Branches on the structured error code emitted by the backend. Each code
// gets a specific UI + actionable hint rather than a generic red box.
const ErrorPanel = ({ error, compact = false }) => {
  const code = error?.code || ''
  const isEntitlement = code === 'options_not_entitled' || code === 'trades_not_entitled'
  const isNoKey = code === 'no_api_key'
  const isRateLimit = code === 'rate_limited'
  const isNoData = code === 'no_data'

  let title = 'Something went wrong'
  let body = error?.message || 'Unknown error.'
  let cls = 'border-danger/40 bg-danger/10 text-danger'
  let icon = '!'

  if (isEntitlement) {
    title = `${error.endpointName || 'This endpoint'} not on your Massive plan`
    body = error.hint || error.message
    cls = 'border-warning/40 bg-warning/10 text-warning'
    icon = '$'
  } else if (isNoKey) {
    title = 'Massive API key not configured'
    cls = 'border-warning/40 bg-warning/10 text-warning'
    icon = '⚙'
  } else if (isRateLimit) {
    title = 'Rate limit hit'
    cls = 'border-warning/40 bg-warning/10 text-warning'
    icon = '⏱'
  } else if (isNoData) {
    title = 'No data for this ticker'
    cls = 'border-surface-700/40 bg-surface-900/60 text-surface-300'
    icon = 'i'
  }

  return (
    <div className={`rounded-lg border px-4 ${compact ? 'py-2' : 'py-3'} ${cls} flex items-start gap-3`}>
      <div className={`shrink-0 w-6 h-6 rounded-full border ${cls} flex items-center justify-center font-bold text-xs mt-0.5`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-[12px] opacity-80 mt-0.5 leading-snug">{body}</div>
        {isEntitlement && (
          <a
            href="https://massive.com/pricing"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] underline mt-1 inline-block"
          >
            See Massive plans →
          </a>
        )}
      </div>
    </div>
  )
}

const Stat = ({ label, value, cls = 'text-surface-100', hint }) => (
  <div className="rounded-lg bg-surface-800/60 border border-surface-700/40 px-3 py-2.5" title={hint || ''}>
    <div className="text-[10px] text-surface-500 uppercase tracking-wider">{label}</div>
    <div className={`text-lg font-bold font-mono ${cls}`}>{value}</div>
  </div>
)

export default OptionsFlow
