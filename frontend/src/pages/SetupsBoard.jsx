import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSetupsBoard } from '../api/setupsBoard'
import TickerLink from '../components/TickerLink'
import RefreshControl from '../components/RefreshControl'

// ---------------------------------------------------------------------------
// "Setups Board" — the at-a-glance entry point to section 2 · Find Setups.
//
// Reads the (already warm-cached) results of the five setup scanners and lays
// them out as top-N lanes, with two things no single scanner page can give you:
//   • a risk-on/off regime banner (size up / be picky / stand down), and
//   • a confluence spotlight — the symbols flagged by 2+ scanners at once, which
//     is the highest-conviction read on the whole page.
// ---------------------------------------------------------------------------

// Literal Tailwind class sets per accent (JIT-safe — no dynamic class strings).
const ACCENT = {
  emerald: { dot: 'bg-emerald-400', text: 'text-emerald-300', chip: 'bg-emerald-500/10 text-emerald-300 border-emerald-400/30' },
  sky:     { dot: 'bg-sky-400',     text: 'text-sky-300',     chip: 'bg-sky-500/10 text-sky-300 border-sky-400/30' },
  violet:  { dot: 'bg-violet-400',  text: 'text-violet-300',  chip: 'bg-violet-500/10 text-violet-300 border-violet-400/30' },
  amber:   { dot: 'bg-amber-400',   text: 'text-amber-300',   chip: 'bg-amber-500/10 text-amber-300 border-amber-400/30' },
  rose:    { dot: 'bg-rose-400',    text: 'text-rose-300',    chip: 'bg-rose-500/10 text-rose-300 border-rose-400/30' },
}

// Regime tone from the situational stance level → banner color + one-word cue.
const REGIME_TONE = {
  emerald: { wrap: 'bg-emerald-500/10 border-emerald-400/30', pill: 'bg-emerald-500/20 text-emerald-200', text: 'text-emerald-100' },
  amber:   { wrap: 'bg-amber-500/10 border-amber-400/30',     pill: 'bg-amber-500/20 text-amber-200',     text: 'text-amber-100' },
  rose:    { wrap: 'bg-rose-500/10 border-rose-400/30',       pill: 'bg-rose-500/20 text-rose-200',       text: 'text-rose-100' },
}
function regimeTone(level) {
  const l = (level || '').toLowerCase()
  if (/(aggress|construct|risk-?on|expansion|green|bull)/.test(l)) return 'emerald'
  if (/(defens|cash|risk-?off|contraction|bear|stand)/.test(l)) return 'rose'
  return 'amber'
}

function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `$${Number(n).toFixed(2)}`
}

// Scanners agree on the trading day but report as_of in mixed date/datetime
// formats; show just the calendar date.
function fmtDate(s) {
  return typeof s === 'string' ? s.slice(0, 10) : s
}

export default function SetupsBoard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      setData(await getSetupsBoard({ force }))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(false) }, [load])

  const lanes = data?.lanes || []
  const confluence = data?.confluence || []
  const regime = data?.regime
  const totalIdeas = lanes.reduce((sum, l) => sum + (l.count || 0), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">
            Setups Board
          </h1>
          <p className="text-surface-400 text-[13px] mt-1">
            Today's best ideas across every Find-Setups scanner, ranked — with the symbols where multiple systems agree.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {data?.asOf && (
            <span className="text-[11px] text-surface-500">
              {totalIdeas} ideas · {fmtDate(data.asOf)}
            </span>
          )}
          <RefreshControl jobId="setups-board" onRefresh={() => load(true)} refreshing={loading} busyLabel="Refreshing…" />
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Regime banner */}
      {regime?.stance && (() => {
        const tone = REGIME_TONE[regimeTone(regime.stance.level)]
        const delta = regime.delta5d
        return (
          <div className={`rounded-xl border px-4 py-3 flex items-center gap-4 flex-wrap ${tone.wrap}`}>
            <div className={`text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded ${tone.pill}`}>
              {regime.stance.label || 'Regime'}
            </div>
            <div className={`text-[13px] font-medium ${tone.text}`}>
              {regime.stance.headline}
              {regime.stance.exposure && (
                <span className="text-surface-400 font-normal"> — {regime.stance.exposure}</span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-3 text-[12px]">
              {regime.score != null && (
                <span className="font-mono text-surface-300">
                  Exposure <span className={`font-semibold ${tone.text}`}>{regime.score}</span>/100
                </span>
              )}
              {delta != null && delta !== 0 && (
                <span className={`font-mono ${delta > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} · 5d
                </span>
              )}
              <Link to="/situational-awareness" className="text-surface-500 hover:text-surface-300 underline decoration-dotted underline-offset-2">
                Trade Today →
              </Link>
            </div>
          </div>
        )
      })()}

      {/* Confluence spotlight */}
      <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-surface-700/40 flex items-center gap-2.5">
          <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
          </svg>
          <span className="text-[14px] font-semibold text-surface-100">Confluence</span>
          <span className="text-[11px] text-surface-500">— flagged by 2 or more scanners today (highest conviction)</span>
          {confluence.length > 0 && (
            <span className="ml-auto text-[11px] font-mono text-accent">{confluence.length}</span>
          )}
        </div>
        {loading && !data ? (
          <div className="px-5 py-8 text-center text-surface-500 text-sm">Loading setups…</div>
        ) : confluence.length === 0 ? (
          <div className="px-5 py-6 text-center text-surface-500 text-[13px]">
            No multi-scanner confluence today — the setups aren't overlapping. Work the lanes below individually.
          </div>
        ) : (
          <div className="divide-y divide-surface-800/60">
            {confluence.slice(0, 12).map((c) => (
              <div key={c.symbol} className="px-5 py-2.5 flex items-center gap-3 hover:bg-surface-800/30">
                <span className="inline-flex items-center justify-center min-w-[26px] h-[22px] rounded-md bg-accent/15 text-accent text-[11px] font-bold font-mono">
                  {c.hits.length}
                </span>
                <TickerLink symbol={c.symbol} className="text-surface-100 font-semibold font-mono text-[13px] w-16" />
                <span className="text-surface-400 font-mono text-[12px] w-16">{fmtMoney(c.close)}</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {c.hits.map((h) => (
                    <span key={h.key} className={`text-[10.5px] px-2 py-0.5 rounded-full border ${ACCENT[h.accent]?.chip || ''}`}>
                      {h.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lanes grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(lanes.length ? lanes : LANE_SKELETON).map((lane) => {
          const accent = ACCENT[lane.accent] || ACCENT.emerald
          return (
            <div key={lane.key} className="rounded-2xl bg-surface-900/80 border border-surface-700/50 overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-surface-700/40 flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${accent.dot}`} />
                <Link to={lane.route} className="text-[13px] font-semibold text-surface-100 hover:text-white">
                  {lane.label}
                </Link>
                {lane.count != null && (
                  <span className="text-[11px] font-mono text-surface-500">{lane.count}</span>
                )}
                <Link to={lane.route} className="ml-auto text-[11px] text-surface-500 hover:text-surface-300">
                  all →
                </Link>
              </div>
              {lane.error ? (
                <div className="px-4 py-6 text-center text-surface-500 text-[12px]">Couldn't load — {lane.error}</div>
              ) : (lane.items || []).length === 0 ? (
                <div className="px-4 py-6 text-center text-surface-600 text-[12px]">
                  {loading && !data ? 'Loading…' : 'No setups today'}
                </div>
              ) : (
                <div className="divide-y divide-surface-800/50">
                  {lane.items.map((it) => (
                    <div key={it.symbol} className="px-4 py-2 flex items-center gap-3 hover:bg-surface-800/30">
                      <div className="w-14 shrink-0">
                        <TickerLink symbol={it.symbol} className="text-surface-100 font-semibold font-mono text-[12.5px]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={`text-[12px] font-medium truncate ${accent.text}`}>{it.headline}</div>
                        <div className="text-[10.5px] text-surface-500 truncate">{it.detail}</div>
                      </div>
                      {it.score != null ? (
                        <span className="shrink-0 text-[11px] font-mono font-semibold text-surface-200 tabular-nums">
                          {Math.round(it.score)}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[11px] font-mono text-surface-500 tabular-nums">{fmtMoney(it.close)}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="text-[10.5px] text-surface-500 flex items-center gap-2 px-1">
        <svg className="w-3 h-3 text-surface-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Reads each scanner's latest cached run — no recompute. Click a lane title to open the full scanner. Right-hand number is the setup's quality score (0–100); price shown where a scanner has no score.</span>
      </div>
    </div>
  )
}

// Placeholder lanes so the grid keeps its shape before the first load resolves.
const LANE_SKELETON = [
  { key: 'ma-reclaim', label: '200 MA Reclaim', route: '/ma-reclaim', accent: 'emerald', items: [], count: null },
  { key: 'stage-analysis', label: 'Stage 1→2', route: '/stage-analysis', accent: 'sky', items: [], count: null },
  { key: 'breakouts', label: 'Breakouts', route: '/breakouts', accent: 'violet', items: [], count: null },
  { key: 'scanner-9m', label: '$9M Scanner', route: '/scanner-9m', accent: 'amber', items: [], count: null },
  { key: 'reversal-setup', label: 'Reversal', route: '/reversal-setup', accent: 'rose', items: [], count: null },
]
