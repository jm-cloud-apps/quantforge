import { useState, useEffect, useCallback } from 'react'
import { getThemeRadarAnalysis } from '../api/themeRadar'

const signPct = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(d)}%`)
const tone = (v) => (v == null ? 'text-surface-500' : v > 0 ? 'text-success' : v < 0 ? 'text-danger' : 'text-surface-400')

const POSTURE = {
  sweet_spot: { label: 'Sweet spot', cls: 'bg-success/15 text-success border-success/30' },
  expanding: { label: 'Expanding', cls: 'bg-accent/15 text-accent border-accent/30' },
  trap: { label: 'Trap', cls: 'bg-danger/15 text-danger border-danger/30' },
  distribution: { label: 'Distribution', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  neutral: { label: 'Neutral', cls: 'bg-surface-700 text-surface-400 border-surface-600' },
}

function Chip({ label, value, tone = 'text-surface-200' }) {
  return (
    <div className="rounded-md bg-surface-800/60 px-2 py-1 text-center">
      <div className="text-[9px] uppercase tracking-wider text-surface-500">{label}</div>
      <div className={`text-xs font-mono font-semibold ${tone}`}>{value}</div>
    </div>
  )
}

function MatrixCard({ row }) {
  const m = row.metrics || {}
  const p = POSTURE[m.posture] || POSTURE.neutral
  return (
    <div className="rounded-xl bg-surface-900/70 border border-surface-700/50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-bold text-surface-50">{row.name}</h3>
            {row.lead_etf && (
              <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(row.lead_etf)}`}
                 target="_blank" rel="noreferrer"
                 className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-800 text-accent hover:bg-surface-700">
                {row.lead_etf}
              </a>
            )}
            {m.rank_ret_3m && <span className="text-[10px] text-surface-500">3M&nbsp;rank&nbsp;#{m.rank_ret_3m}</span>}
          </div>
          <p className="text-xs text-surface-400 mt-1 leading-snug">{row.theme}</p>
        </div>
        <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded border ${p.cls}`}>{p.label}</span>
      </div>

      {row.tape_profile && (
        <p className="text-[13px] text-surface-200 leading-relaxed border-l-2 border-accent/40 pl-2.5">{row.tape_profile}</p>
      )}

      <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
        <Chip label="3M" value={signPct(m.ret_3m)} tone={tone(m.ret_3m)} />
        <Chip label="1M" value={signPct(m.ret_1m)} tone={tone(m.ret_1m)} />
        <Chip label="5D" value={signPct(m.ret_5d)} tone={tone(m.ret_5d)} />
        <Chip label="Intra" value={signPct(m.intraday_med)} tone={tone(m.intraday_med)} />
        <Chip label=">20MA" value={m.breadth_above_20ma != null ? `${m.breadth_above_20ma}%` : '—'}
          tone={m.breadth_above_20ma >= 60 ? 'text-success' : 'text-surface-300'} />
        <Chip label={`${m.lead_etf || 'ETF'} open`} value={signPct(m.etf_intraday)} tone={tone(m.etf_intraday)} />
        <Chip label="ETF 5D" value={signPct(m.etf_5d)} tone={tone(m.etf_5d)} />
      </div>

      {Array.isArray(m.leaders) && m.leaders.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {m.leaders.map((l) => (
            <a key={l.ticker} href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(l.ticker)}`}
               target="_blank" rel="noreferrer"
               className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-800/60 text-surface-300 hover:text-accent">
              {l.ticker} <span className={tone(l.ret_1m)}>{signPct(l.ret_1m)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function Commentary({ title, items, accent, blurb }) {
  if (!items || items.length === 0) return null
  return (
    <div className={`rounded-xl border ${accent} p-4`}>
      <h3 className="font-display font-semibold text-surface-50 mb-0.5">{title}</h3>
      {blurb && <p className="text-[11px] text-surface-500 mb-2.5">{blurb}</p>}
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="text-[13px]">
            <span className="font-semibold text-surface-100">{it.name}</span>
            {it.why && <span className="text-surface-400"> — {it.why}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function AllThemesTable({ themes }) {
  if (!themes || themes.length === 0) return null
  const sorted = [...themes].sort((a, b) => (a.rank_ret_3m || 99) - (b.rank_ret_3m || 99))
  return (
    <details className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-4">
      <summary className="cursor-pointer font-display font-semibold text-surface-100">All themes · ranked grid</summary>
      <div className="overflow-x-auto mt-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-surface-500 text-left">
              <th className="py-1 pr-2 font-medium">Theme</th>
              <th className="py-1 px-2 font-medium text-right">3M</th>
              <th className="py-1 px-2 font-medium text-right">1M</th>
              <th className="py-1 px-2 font-medium text-right">5D</th>
              <th className="py-1 px-2 font-medium text-right">Intra</th>
              <th className="py-1 px-2 font-medium text-right">&gt;20MA</th>
              <th className="py-1 px-2 font-medium text-right">Shift</th>
              <th className="py-1 pl-2 font-medium">Posture</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const p = POSTURE[r.posture] || POSTURE.neutral
              return (
                <tr key={r.name} className="border-t border-surface-800/40">
                  <td className="py-1.5 pr-2 text-surface-100">{r.name} <span className="text-surface-600">#{r.rank_ret_3m}</span></td>
                  <td className={`py-1.5 px-2 text-right font-mono ${tone(r.ret_3m)}`}>{signPct(r.ret_3m)}</td>
                  <td className={`py-1.5 px-2 text-right font-mono ${tone(r.ret_1m)}`}>{signPct(r.ret_1m)}</td>
                  <td className={`py-1.5 px-2 text-right font-mono ${tone(r.ret_5d)}`}>{signPct(r.ret_5d)}</td>
                  <td className={`py-1.5 px-2 text-right font-mono ${tone(r.intraday_med)}`}>{signPct(r.intraday_med)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-surface-300">{r.breadth_above_20ma != null ? `${r.breadth_above_20ma}%` : '—'}</td>
                  <td className={`py-1.5 px-2 text-right font-mono ${r.rank_shift_3m_5d > 0 ? 'text-amber-300' : r.rank_shift_3m_5d < 0 ? 'text-success' : 'text-surface-500'}`}>
                    {r.rank_shift_3m_5d != null ? (r.rank_shift_3m_5d > 0 ? `+${r.rank_shift_3m_5d}` : r.rank_shift_3m_5d) : '—'}
                  </td>
                  <td className="py-1.5 pl-2"><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${p.cls}`}>{p.label}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-surface-500 mt-2">
        Shift = 3M-rank minus 5D-rank. <span className="text-amber-300">+</span> = immediate tape cooler than the structural anchor (pullback);
        <span className="text-success"> −</span> = immediate tape stronger (accelerating).
      </p>
    </details>
  )
}

export default function ThemeRadar() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async (fresh = false) => {
    setLoading(true)
    setError(null)
    try {
      setData(await getThemeRadarAnalysis({ fresh }))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(false) }, [load])

  const matrix = data?.matrix || []

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-surface-50">Theme Radar</h1>
          <p className="text-sm text-surface-400 mt-1">
            Structural theme strength × real-time tape velocity → the <span className="text-surface-200">near-term velocity matrix</span>
          </p>
        </div>
        <button onClick={() => load(true)} disabled={loading}
          className="rounded-lg bg-accent text-white text-sm font-semibold px-4 py-2 hover:bg-accent/90 disabled:opacity-50 transition-colors">
          {loading ? 'Analyzing…' : 'Refresh'}
        </button>
      </div>

      {data && !loading && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className={`px-2 py-0.5 rounded-full font-semibold ${data.market_active ? 'bg-success/15 text-success' : 'bg-surface-700 text-surface-400'}`}>
            Market {data.market_active ? 'open' : 'closed'}
          </span>
          <span className="text-surface-500">as of {new Date(data.as_of).toLocaleString()}</span>
          <span className="text-surface-600">·</span>
          <span className="text-surface-500">{data.themes_considered} themes</span>
          {data.cached && <span className="text-surface-600">· cached {Math.round((data.cache_age_seconds || 0) / 60)}m ago</span>}
          {data.ai_available
            ? <span className="px-2 py-0.5 rounded-full bg-accent/15 text-accent font-semibold">AI analyst</span>
            : <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-semibold">rule-based</span>}
        </div>
      )}

      {data && !data.ai_available && data.error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200/90">
          <span className="font-semibold">AI analyst unavailable.</span> {data.error}
        </div>
      )}

      {loading && (
        <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-12 text-center">
          <div className="inline-block w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-3" />
          <p className="text-surface-300 text-sm">Cross-referencing theme strength &amp; the tape…</p>
          <p className="text-surface-500 text-xs mt-1">Fetching ~115 names — give it ~15 seconds.</p>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-danger/30 bg-danger/[0.06] p-6 text-center text-danger text-sm">{error}</div>
      )}

      {!loading && data && (
        <>
          {data.market_note && (
            <p className="text-[13px] text-surface-300 bg-surface-800/30 border border-surface-700/40 rounded-lg px-4 py-2.5">{data.market_note}</p>
          )}

          {matrix.length > 0 && (
            <div>
              <h2 className="font-display font-semibold text-lg text-surface-50 mb-3">Near-term velocity matrix</h2>
              <div className="space-y-3">
                {matrix.map((row, i) => <MatrixCard key={`${row.name}-${i}`} row={row} />)}
              </div>
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-3">
            <Commentary title="Velocity sweet spot" items={data.sweet_spots} accent="border-success/30 bg-success/[0.05]"
              blurb="Elite anchors absorbing short-term selling; tape turning up." />
            <Commentary title="High-breadth pipelines" items={data.pipelines} accent="border-accent/30 bg-accent/[0.05]"
              blurb="Broad participation in tandem with the ETF — real sponsorship." />
            <Commentary title="Distribution & traps" items={data.traps} accent="border-amber-500/30 bg-amber-500/[0.05]"
              blurb="Anchors hold but rolling distribution underneath — avoid." />
          </div>

          <AllThemesTable themes={data.themes} />
        </>
      )}

      <p className="text-[11px] text-surface-600 text-center pt-2">
        Research tool, not financial advice. Themes are curated narrative baskets, not GICS sectors.
      </p>
    </div>
  )
}
