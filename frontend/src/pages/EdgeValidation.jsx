import { useCallback, useEffect, useState } from 'react'
import { getEdgeValidation } from '../api/edgeValidation'

// ---------------------------------------------------------------------------
// Edge validation — replays a family of entry signals over cached history,
// measures each one's forward-return edge over the tape, and corrects for
// multiple testing (bootstrap CIs, deflated Sharpe, BH-FDR). The anti-data-
// mining tool. Backend: analytics/edge_validation.py.
// ---------------------------------------------------------------------------

const HORIZONS = [5, 10, 20]

const TONE = {
  good: { badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30', card: 'border-emerald-400/25' },
  warn: { badge: 'bg-amber-500/15 text-amber-300 border-amber-400/30', card: 'border-amber-400/25' },
  bad:  { badge: 'bg-rose-500/15 text-rose-300 border-rose-400/30', card: 'border-surface-700/50' },
}

const METHOD = [
  { title: 'Edge over the tape', body: 'For each day a signal fires, we take the average forward return of the names that fired minus the whole universe\'s average forward return that day. That isolates the setup\'s edge from plain market drift — beating the tape, not just going up with it.' },
  { title: 'Bootstrap CI', body: 'The 95% confidence interval on the mean edge is resampled from the per-day edge series. If the interval straddles 0, the edge isn\'t distinguishable from luck.' },
  { title: 'Deflated Sharpe (DSR)', body: 'The Sharpe ratio, discounted for how many signals were tried at once and for the returns\' skew/kurtosis and sample length (Bailey & López de Prado). DSR ≥ 0.95 means the edge likely survives the fact that you tested several ideas.' },
  { title: 'BH-FDR across the family', body: 'Benjamini-Hochberg controls the false-discovery rate across all signals tested together, so one lucky winner out of many doesn\'t fool you.' },
]

function fmtPct(n, d = 2) { return n == null || Number.isNaN(n) ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(d)}%` }
function fmtNum(n, d = 2) { return n == null || Number.isNaN(n) ? '—' : Number(n).toFixed(d) }
function fmtInt(n) { return n == null ? '—' : Number(n).toLocaleString('en-US') }

function Stat({ label, value, hint, cls = 'text-surface-100' }) {
  return (
    <div className="rounded-lg bg-surface-950/50 border border-surface-700/40 px-2.5 py-1.5" title={hint}>
      <div className="text-[9px] uppercase tracking-wider text-surface-500 font-semibold">{label}</div>
      <div className={`text-[13px] font-mono mt-0.5 tabular-nums ${cls}`}>{value}</div>
    </div>
  )
}

// A little bar showing the edge CI relative to 0.
function EdgeBar({ lo, hi, mean }) {
  if (lo == null || hi == null) return null
  const span = Math.max(Math.abs(lo), Math.abs(hi), 0.5) * 1.15
  const x = (v) => `${((v + span) / (2 * span)) * 100}%`
  const positive = mean > 0
  return (
    <div className="relative h-6 mt-1">
      <div className="absolute inset-x-0 top-1/2 h-px bg-surface-700/60" />
      <div className="absolute top-0 bottom-0 w-px bg-surface-500/70" style={{ left: '50%' }} title="zero" />
      <div className={`absolute top-[9px] h-1.5 rounded-full ${positive ? 'bg-emerald-400/50' : 'bg-rose-400/50'}`}
        style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />
      <div className={`absolute top-[7px] w-1 h-2.5 rounded ${positive ? 'bg-emerald-300' : 'bg-rose-300'}`} style={{ left: `calc(${x(mean)} - 2px)` }} title={`mean edge ${fmtPct(mean)}`} />
    </div>
  )
}

export default function EdgeValidation() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [horizon, setHorizon] = useState(10)
  const [aboutOpen, setAboutOpen] = useState(false)

  const load = useCallback(async (h, force = false) => {
    setLoading(true); setError(null)
    try { setData(await getEdgeValidation({ horizon: h, force })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load(horizon, false) }, [load, horizon])

  const signals = data?.signals || []
  const family = data?.family || {}

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">Edge Validation</h1>
          <p className="text-surface-400 text-[13px] mt-1">
            Replays each setup over history and asks the only question that matters: is the edge real, or would you expect
            it by chance after trying this many ideas?
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center rounded-lg border border-surface-700/50 bg-surface-900/80 overflow-hidden">
            {HORIZONS.map(h => (
              <button key={h} onClick={() => setHorizon(h)}
                className={`px-2.5 py-1.5 text-[12px] font-medium transition ${horizon === h ? 'bg-accent/15 text-accent' : 'text-surface-400 hover:text-surface-100'}`}
                title={`Forward holding period: ${h} trading days`}>
                {h}d
              </button>
            ))}
          </div>
          <button onClick={() => load(horizon, true)} disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-[12px] font-medium hover:bg-accent/20 disabled:opacity-50 transition">
            {loading ? 'Replaying…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-3 text-sm text-red-200">{error}</div>}

      {/* Method */}
      <details className="rounded-2xl bg-surface-900/80 border border-surface-700/50" open={aboutOpen} onToggle={e => setAboutOpen(e.currentTarget.open)}>
        <summary className="cursor-pointer list-none px-5 py-3.5 flex items-center justify-between hover:bg-surface-800/40 rounded-2xl transition-colors">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="text-[14px] font-semibold text-surface-100">How the edge is measured — and why multiple testing matters</span>
          </div>
          <svg className={`w-4 h-4 text-surface-500 transition-transform ${aboutOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </summary>
        <div className="px-5 pb-5 pt-1 space-y-4 border-t border-surface-700/40">
          <p className="text-[13px] text-surface-300 leading-relaxed pt-3">
            Run enough screens and one will look brilliant by pure luck. This tool replays each signal across the cached
            history, scores its forward-return edge <span className="text-surface-100">over the tape</span>, then discounts
            that score for the fact that several signals were tested at once.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {METHOD.map(m => (
              <div key={m.title} className="rounded-lg bg-surface-950/40 border border-surface-700/40 p-3">
                <div className="text-[12px] font-semibold text-surface-100">{m.title}</div>
                <div className="text-[11px] text-surface-400 mt-1 leading-relaxed">{m.body}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-amber-500/5 border border-amber-400/20 p-3 text-[11.5px] text-amber-100/80 leading-relaxed">
            <span className="font-semibold text-amber-300/90">Caveats:</span> signals are daily-sampled, so their forward windows overlap — t-stats are optimistic. The universe is survivorship-biased (delisted names aren't cached). The reversal signal is simplified because the cache has no open price. Treat this as a discipline check, not a promise.
          </div>
        </div>
      </details>

      {/* Family summary */}
      {data && !data.error && family.n_tested > 0 && (
        <div className="rounded-xl border border-surface-700/50 bg-surface-900/80 px-4 py-3 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-[22px] font-mono font-semibold text-surface-100">{family.n_survivors}</span>
            <span className="text-[11px] text-surface-500 leading-tight">of {family.n_tested}<br />survive</span>
          </div>
          <div className="h-8 w-px bg-surface-700/60" />
          <div className="text-[12px] text-surface-300 flex-1 min-w-[240px]">{family.note}</div>
          <div className="text-[10.5px] text-surface-500">horizon {data.horizon}d · {data.counts?.days_available} days cached{data.from_cache ? ' · cached' : ''}</div>
        </div>
      )}

      {loading && !data && <div className="rounded-2xl bg-surface-900/60 border border-surface-700/40 p-12 text-center text-surface-300">Replaying signals over history…</div>}
      {data?.error && !loading && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 border-dashed p-10 text-center">
          <p className="text-surface-100 font-semibold text-base">Can't validate yet</p>
          <p className="text-surface-500 text-sm mt-2 max-w-md mx-auto">{data.error}</p>
        </div>
      )}

      {/* Signal cards */}
      {data && !data.error && signals.map(s => {
        if (s.insufficient) {
          return (
            <div key={s.key} className="rounded-2xl bg-surface-900/60 border border-surface-700/40 border-dashed px-5 py-4">
              <div className="flex items-center justify-between">
                <div className="text-[14px] font-semibold text-surface-300">{s.label}</div>
                <span className="text-[11px] text-surface-500">Not enough signal-days ({s.n_days}) to judge</span>
              </div>
            </div>
          )
        }
        const tone = TONE[s.verdict_tone] || TONE.bad
        return (
          <div key={s.key} className={`rounded-2xl bg-surface-900/80 border ${tone.card} p-5`}>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[15px] font-semibold text-surface-100">{s.label}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-surface-500 border border-surface-700/50 rounded px-1.5 py-px">{s.kind}</span>
                </div>
                <div className="text-[11.5px] text-surface-400 mt-1 max-w-2xl">{s.desc}</div>
              </div>
              <span className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border ${tone.badge}`}>{s.verdict}</span>
            </div>

            {/* Edge + CI */}
            <div className="rounded-lg bg-surface-950/40 border border-surface-700/40 px-3 py-2 mb-3">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-surface-500 uppercase tracking-wider font-semibold">Edge vs tape (per signal-day)</span>
                <span className={`font-mono font-semibold ${s.edge_pct > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {fmtPct(s.edge_pct)} <span className="text-surface-500 font-normal">95% CI [{fmtPct(s.edge_ci_lo_pct)}, {fmtPct(s.edge_ci_hi_pct)}]</span>
                </span>
              </div>
              <EdgeBar lo={s.edge_ci_lo_pct} hi={s.edge_ci_hi_pct} mean={s.edge_pct} />
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              <Stat label="Signals" value={fmtInt(s.n_signals)} hint={`${s.n_signals} entries over ${s.n_days} signal-days`} />
              <Stat label="Win rate" value={`${fmtNum(s.win_rate, 1)}%`} cls={s.win_rate >= 50 ? 'text-emerald-200' : 'text-surface-200'} />
              <Stat label="Payoff" value={s.payoff == null ? '—' : `${fmtNum(s.payoff)}×`} hint="Avg win ÷ avg loss" />
              <Stat label="Expectancy" value={fmtPct(s.expectancy_pct)} hint="Per-trade expected raw return" cls={s.expectancy_pct > 0 ? 'text-emerald-200' : 'text-rose-200'} />
              <Stat label="Sharpe" value={fmtNum(s.sharpe)} hint="Annualized Sharpe of the edge series" cls={s.sharpe > 0 ? 'text-surface-100' : 'text-rose-200'} />
              <Stat label="p-value" value={fmtNum(s.p_value, 3)} hint="Two-sided, on the mean edge" cls={s.p_value < 0.05 ? 'text-surface-100' : 'text-surface-500'} />
              <Stat label="Deflated Sharpe" value={fmtNum(s.dsr, 2)} hint="P(edge is real after accounting for the number of signals tried). ≥0.95 = survives." cls={s.dsr >= 0.95 ? 'text-emerald-300 font-semibold' : s.dsr >= 0.5 ? 'text-amber-300' : 'text-rose-300'} />
            </div>
            <div className="flex items-center gap-3 mt-2 text-[10.5px] text-surface-500">
              <span>PSR {fmtNum(s.psr, 2)}</span>
              <span>·</span>
              <span>FDR {s.pass_fdr ? <span className="text-emerald-300">pass</span> : <span className="text-surface-500">fail</span>}</span>
              <span>·</span>
              <span>avg fwd {fmtPct(s.avg_fwd_pct)}</span>
              <span>·</span>
              <span>DSR benchmark {fmtNum(s.sr0, 2)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
