import { useCallback, useEffect, useMemo, useState } from 'react'
import { getFactorModel } from '../api/factorModel'
import TickerLink from '../components/TickerLink'

// ---------------------------------------------------------------------------
// Cross-sectional factor model — ranks the liquid universe on price/volume style
// factors (momentum, trend quality, relative strength, low-vol, short reversal,
// liquidity), turns each into a z-score + percentile, and blends the four
// "leadership" factors into a composite. Backend: analytics/factor_model.py.
// ---------------------------------------------------------------------------

const FACTOR_KEYS = ['mom', 'trend', 'rs', 'lvol', 'str', 'liq']
const SHORT = { mom: 'Mom', trend: 'Trend', rs: 'RS', lvol: 'LoVol', str: 'Rev', liq: 'Liq' }

function fmtMoney(n) { return n == null || Number.isNaN(n) ? '—' : `$${Number(n).toFixed(2)}` }
function fmtPctSigned(n, d = 2) { return n == null || Number.isNaN(n) ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(d)}%` }
function fmtRelAge(iso) {
  if (!iso) return null
  try {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (s < 60) return 'just now'; const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60); return h < 24 ? `${h}h ago` : null
  } catch { return null }
}

// Percentile → heat classes (green high, red low).
function pctClass(p) {
  if (p == null) return 'text-surface-600'
  if (p >= 80) return 'text-emerald-300 font-semibold'
  if (p >= 60) return 'text-emerald-200/80'
  if (p >= 40) return 'text-surface-300'
  if (p >= 20) return 'text-amber-300/90'
  return 'text-rose-300/80'
}
function pctBg(p) {
  if (p == null) return ''
  if (p >= 80) return 'bg-emerald-500/15'
  if (p >= 60) return 'bg-emerald-500/8'
  if (p < 20) return 'bg-rose-500/10'
  if (p < 40) return 'bg-amber-500/8'
  return ''
}

export default function FactorModel() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [sort, setSort] = useState({ key: 'composite', dir: 'desc' })

  const load = useCallback(async (force = false) => {
    setLoading(true); setError(null)
    try { setData(await getFactorModel({ force })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load(false) }, [load])

  const rows = data?.rows || []
  const factors = data?.factors || []
  const counts = data?.counts || {}
  const th = data?.thresholds || {}
  const weights = data?.composite_weights || {}
  const labelOf = useMemo(() => Object.fromEntries((factors).map(f => [f.key, f.label])), [factors])
  const descOf = useMemo(() => Object.fromEntries((factors).map(f => [f.key, f.desc])), [factors])

  const sortedRows = useMemo(() => {
    const val = (r) => sort.key === 'composite' ? r.composite_z
      : sort.key === 'symbol' ? r.symbol
      : sort.key === 'close' ? r.close
      : r[`${sort.key}_pct`]
    const mul = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av == null) return 1; if (bv == null) return -1
      if (typeof av === 'string') return mul * av.localeCompare(bv)
      return mul * (av - bv)
    })
  }, [rows, sort])

  const toggleSort = (key) => setSort(s => s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' })
  const rel = fmtRelAge(data?.generated_at)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">Factor Model</h1>
          <p className="text-surface-400 text-[13px] mt-1">
            One cross-sectional ranking of the liquid universe on price/volume style factors — so a pile of separate
            screens becomes a single relative-value view.
          </p>
        </div>
        <button onClick={() => load(true)} disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-[12px] font-medium hover:bg-accent/20 disabled:opacity-50 transition">
          {loading ? 'Computing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-3 text-sm text-red-200">{error}</div>}

      {/* About */}
      <details className="rounded-2xl bg-surface-900/80 border border-surface-700/50" open={aboutOpen} onToggle={e => setAboutOpen(e.currentTarget.open)}>
        <summary className="cursor-pointer list-none px-5 py-3.5 flex items-center justify-between hover:bg-surface-800/40 rounded-2xl transition-colors">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="text-[14px] font-semibold text-surface-100">The factors — and what a z-score means</span>
            <span className="text-[11px] text-surface-500">— definitions, composite, caveats</span>
          </div>
          <svg className={`w-4 h-4 text-surface-500 transition-transform ${aboutOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </summary>
        <div className="px-5 pb-5 pt-1 space-y-4 border-t border-surface-700/40">
          <p className="text-[13px] text-surface-300 leading-relaxed pt-3">
            Each factor is computed for every liquid name, winsorised, then expressed as a{' '}
            <span className="text-surface-100">z-score</span> (standard deviations from the cross-sectional mean) and a{' '}
            <span className="text-surface-100">percentile (1–100)</span>. The <span className="text-surface-100">composite</span>{' '}
            blends the four leadership factors — momentum {pct(weights.mom)}, trend {pct(weights.trend)}, relative strength{' '}
            {pct(weights.rs)}, low-vol {pct(weights.lvol)} — into one score. Sort by any factor to slice the universe on that axis.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {factors.map(f => (
              <div key={f.key} className="rounded-lg bg-surface-950/40 border border-surface-700/40 p-3">
                <div className="text-[12px] font-semibold text-surface-100">{f.label}</div>
                <div className="text-[11px] text-surface-400 mt-1 leading-relaxed">{f.desc}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-amber-500/5 border border-amber-400/20 p-3">
            <div className="text-[11px] uppercase tracking-wider text-amber-300/80 font-semibold mb-1">Deliberately not included: value &amp; quality</div>
            <div className="text-[12px] text-amber-100/80 leading-relaxed">
              Value (P/E, P/B) and quality (ROE, margins, leverage) need fundamentals, which this OHLCV pipeline doesn't carry.
              Surfacing a "value" score from price alone would be dishonest — it's a known extension, not an oversight.
            </div>
          </div>
        </div>
      </details>

      {/* What's working now (factor rotation) */}
      {data && !data.error && data.factor_rotation?.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">
            What's working now <span className="normal-case text-surface-600">— top-minus-bottom quintile return, last month</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {data.factor_rotation.map(r => {
              const pos = r.spread_pct >= 0
              return (
                <div key={r.key} className="rounded-xl border border-surface-700/50 bg-surface-900/80 p-3" title={descOf[r.key]}>
                  <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold truncate">{r.label}</div>
                  <div className={`mt-1 text-[16px] font-mono font-semibold tabular-nums ${pos ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {fmtPctSigned(r.spread_pct)}
                  </div>
                  <div className="text-[9.5px] text-surface-500 mt-0.5">top {fmtPctSigned(r.top_q_pct, 1)} · bot {fmtPctSigned(r.bottom_q_pct, 1)}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Meta */}
      {data && !data.error && (
        <div className="text-[10.5px] text-surface-500 flex items-center gap-2 flex-wrap">
          <span>{counts.ranked?.toLocaleString?.()} names ranked · showing top {counts.returned} by composite · {data.as_of}{rel ? ` · ${rel}` : ''}{data.from_cache ? ' · cached' : ''}</span>
          <span className="text-surface-600">· universe is survivorship-biased (delisted names aren't cached)</span>
        </div>
      )}

      {loading && !data && (
        <div className="rounded-2xl bg-surface-900/60 border border-surface-700/40 p-12 text-center text-surface-300">Computing factor scores…</div>
      )}
      {data?.error && !loading && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 border-dashed p-10 text-center">
          <p className="text-surface-100 font-semibold text-base">Can't compute the factor model yet</p>
          <p className="text-surface-500 text-sm mt-2 max-w-md mx-auto">{data.error}</p>
        </div>
      )}

      {/* Table */}
      {data && !data.error && sortedRows.length > 0 && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-[12px]">
              <thead className="bg-surface-950/50 text-[10px] uppercase tracking-wide text-surface-500">
                <tr>
                  <th onClick={() => toggleSort('composite')} className={`px-3 py-2 text-left font-semibold cursor-pointer hover:text-surface-300 ${sort.key === 'composite' ? 'text-accent' : ''}`} title="Composite z-score: weighted blend of momentum, trend, relative strength and low-vol. Sort default.">
                    Composite{sort.key === 'composite' ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </th>
                  <th onClick={() => toggleSort('symbol')} className={`px-3 py-2 text-left font-semibold cursor-pointer hover:text-surface-300 ${sort.key === 'symbol' ? 'text-accent' : ''}`}>Symbol{sort.key === 'symbol' ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}</th>
                  <th onClick={() => toggleSort('close')} className={`px-3 py-2 text-right font-semibold cursor-pointer hover:text-surface-300 ${sort.key === 'close' ? 'text-accent' : ''}`}>Close{sort.key === 'close' ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}</th>
                  {FACTOR_KEYS.map(k => (
                    <th key={k} onClick={() => toggleSort(k)} title={`${labelOf[k] || k} — ${descOf[k] || ''} (percentile 1-100)`}
                      className={`px-3 py-2 text-right font-semibold cursor-pointer whitespace-nowrap hover:text-surface-300 ${sort.key === k ? 'text-accent' : ''}`}>
                      {SHORT[k]}{sort.key === k ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono">
                {sortedRows.map(r => (
                  <tr key={r.symbol} className="border-t border-surface-800/60 hover:bg-surface-800/30">
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        <span className="text-surface-200 font-semibold tabular-nums w-9">{r.composite_z?.toFixed(2)}</span>
                        <span className="text-[10px] text-surface-500">#{r.composite_pct}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 font-semibold"><TickerLink symbol={r.symbol} className="text-surface-100" /></td>
                    <td className="px-3 py-2 text-right text-surface-300">{fmtMoney(r.close)}</td>
                    {FACTOR_KEYS.map(k => {
                      const p = r[`${k}_pct`]
                      return (
                        <td key={k} className={`px-3 py-2 text-right tabular-nums ${pctClass(p)} ${pctBg(p)}`} title={`${labelOf[k]}: percentile ${p}, z ${r[`${k}_z`]}`}>
                          {p == null ? '—' : p}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Factor correlation */}
      {data && !data.error && data.factor_correlation && Object.keys(data.factor_correlation).length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">
            Factor correlation <span className="normal-case text-surface-600">— which factors are the same bet (Spearman)</span>
          </div>
          <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 overflow-x-auto inline-block max-w-full">
            <table className="text-[11px] font-mono">
              <thead>
                <tr className="text-surface-500">
                  <th className="px-3 py-2" />
                  {FACTOR_KEYS.map(k => <th key={k} className="px-3 py-2 text-right font-semibold">{SHORT[k]}</th>)}
                </tr>
              </thead>
              <tbody>
                {FACTOR_KEYS.map(a => (
                  <tr key={a} className="border-t border-surface-800/60">
                    <td className="px-3 py-1.5 text-surface-400 font-semibold">{SHORT[a]}</td>
                    {FACTOR_KEYS.map(b => {
                      const v = data.factor_correlation[a]?.[b]
                      const strong = v != null && Math.abs(v) >= 0.4 && a !== b
                      return (
                        <td key={b} className={`px-3 py-1.5 text-right tabular-nums ${a === b ? 'text-surface-600' : strong ? (v > 0 ? 'text-emerald-300 font-semibold' : 'text-rose-300 font-semibold') : 'text-surface-300'}`}>
                          {v == null ? '—' : v.toFixed(2)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[10.5px] text-surface-500 mt-1.5">High momentum↔RS↔trend correlation is expected — they're flavours of the same trend bet; low-vol / reversal / liquidity add orthogonal information.</div>
        </div>
      )}
    </div>
  )
}

function pct(w) { return w == null ? '' : `(${Math.round(w * 100)}%)` }
