import { useEffect, useMemo, useState } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, ReferenceLine, Tooltip, ResponsiveContainer,
} from 'recharts'
import { getInternals, getRRG, getLeaders, getMappingProgress } from '../../api/sectorRotation'

// Sector Rotation Intelligence — the three quant layers on the Sector Scan page:
//   1. Internals table  — per-sector breadth computed from MEMBERS (not the ETF):
//      the stealth-accumulation detector.
//   2. RRG quadrants    — RS-ratio × RS-momentum vs SPY with weekly trails:
//      catch sectors crossing into "Improving" before the return columns see it.
//   3. Leaders drill-down — click a sector row → its strongest members, RS-ranked:
//      the rotation read ends in tickers, not a mood.

const QUAD = {
  improving:  { color: '#06B6D4', label: 'Improving',  hint: 'RS below avg, turning up — the entry quadrant' },
  leading:    { color: '#10B981', label: 'Leading',    hint: 'strong & rising — ride, don’t initiate late' },
  weakening:  { color: '#F59E0B', label: 'Weakening',  hint: 'strong but rolling over — tighten up' },
  lagging:    { color: '#EF4444', label: 'Lagging',    hint: 'weak & falling — no longs' },
}

const VERDICT_CLS = {
  ACCUMULATING: 'bg-accent/10 text-accent border-accent/30',
  NEUTRAL: 'bg-surface-800/60 text-surface-400 border-surface-700',
  DISTRIBUTING: 'bg-danger/10 text-danger border-danger/30',
}

const SHAPE_CLS = {
  BROAD: 'bg-accent/10 text-accent border-accent/30',
  MIXED: 'bg-surface-800/60 text-surface-400 border-surface-700',
  NARROW: 'bg-warning/10 text-warning border-warning/30',
}

const fmtSigned = (v, digits = 1) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`)
const tvLink = (sym) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}`

// ── RRG chart pieces ─────────────────────────────────────────────────────

function RRGTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  if (!p?.label) return null
  const q = QUAD[p.quadrant]
  return (
    <div className="rounded-lg border border-surface-600 bg-surface-900/95 px-3 py-2 text-[11px] shadow-xl">
      <div className="font-semibold text-surface-100">{p.label} <span className="font-mono text-surface-500">{p.ticker}</span></div>
      <div style={{ color: q.color }} className="font-semibold">{q.label}</div>
      <div className="text-surface-400 font-mono">RS {p.x?.toFixed(1)} · Mom {p.y?.toFixed(1)}</div>
    </div>
  )
}

// Current-position dot: filled circle + ticker label. Trails render as thin
// lines with no dots, so only "now" carries a marker.
function CurrentDot(props) {
  const { cx, cy, payload } = props
  if (cx == null || cy == null) return null
  const color = QUAD[payload.quadrant]?.color || '#9CA3AF'
  return (
    <g>
      <circle cx={cx} cy={cy} r={payload.group === 'sector' ? 5.5 : 4} fill={color} stroke="#0B1220" strokeWidth={1.5} />
      <text x={cx + 7} y={cy + 3} fontSize={10} fill={color} fontFamily="ui-monospace, monospace">
        {payload.ticker}
      </text>
    </g>
  )
}

function RRGChart({ points }) {
  const { domain, currentBySeries } = useMemo(() => {
    let vals = []
    for (const p of points) for (const [r, m] of p.trail) vals.push(r, m)
    const lo = Math.floor(Math.min(...vals, 98)) - 1
    const hi = Math.ceil(Math.max(...vals, 102)) + 1
    return {
      domain: [lo, hi],
      currentBySeries: points.map(p => ({
        ...p,
        trailData: p.trail.map(([x, y]) => ({ x, y })),
        current: [{ x: p.rs_ratio, y: p.rs_mom, label: p.label, ticker: p.ticker, quadrant: p.quadrant, group: p.group }],
      })),
    }
  }, [points])

  return (
    <div className="relative h-[440px]">
      {/* Quadrant corner labels */}
      <div className="absolute top-2 left-12 text-[10px] font-bold tracking-widest uppercase" style={{ color: QUAD.improving.color, opacity: 0.7 }}>Improving</div>
      <div className="absolute top-2 right-4 text-[10px] font-bold tracking-widest uppercase" style={{ color: QUAD.leading.color, opacity: 0.7 }}>Leading</div>
      <div className="absolute bottom-8 left-12 text-[10px] font-bold tracking-widest uppercase" style={{ color: QUAD.lagging.color, opacity: 0.7 }}>Lagging</div>
      <div className="absolute bottom-8 right-4 text-[10px] font-bold tracking-widest uppercase" style={{ color: QUAD.weakening.color, opacity: 0.7 }}>Weakening</div>

      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 18, right: 30, bottom: 10, left: -18 }}>
          <XAxis type="number" dataKey="x" domain={domain} tick={{ fontSize: 10, fill: '#6B7280' }}
                 tickCount={8} stroke="#374151" label={undefined} allowDataOverflow />
          <YAxis type="number" dataKey="y" domain={domain} tick={{ fontSize: 10, fill: '#6B7280' }}
                 tickCount={8} stroke="#374151" allowDataOverflow />
          <ZAxis range={[30, 30]} />
          <ReferenceLine x={100} stroke="#4B5563" strokeDasharray="4 4" />
          <ReferenceLine y={100} stroke="#4B5563" strokeDasharray="4 4" />
          <Tooltip content={<RRGTooltip />} cursor={{ strokeDasharray: '3 3', stroke: '#4B5563' }} />
          {currentBySeries.map(p => (
            <Scatter key={`${p.ticker}-trail`} data={p.trailData} fill="none"
                     line={{ stroke: QUAD[p.quadrant].color, strokeWidth: 1, strokeOpacity: 0.18 }}
                     shape={() => null} isAnimationActive={false} />
          ))}
          {currentBySeries.map(p => (
            <Scatter key={`${p.ticker}-now`} data={p.current} shape={<CurrentDot />} isAnimationActive={false} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Leaders drill-down table ─────────────────────────────────────────────

function LeadersTable({ data, loading, error }) {
  if (loading) return <div className="px-6 py-4 text-[12px] text-surface-400 animate-pulse">Ranking members by relative strength…</div>
  if (error) return <div className="px-6 py-4 text-[12px] text-danger">{error}</div>
  if (!data?.leaders?.length) return <div className="px-6 py-4 text-[12px] text-surface-400">No members with enough history.</div>
  return (
    <div className="px-4 pb-4 overflow-x-auto">
      <div className="px-2 py-2 text-[10.5px] text-surface-500">
        Top {data.leaders.length} of {data.member_count} members · RS rank is the percentile of 3-month return across the whole liquid universe — trade the leaders of the leading group.
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-surface-500 border-b border-surface-700/50">
            <th className="text-left px-2 py-1.5">Symbol</th>
            <th className="text-left px-2 py-1.5 hidden md:table-cell">Name</th>
            <th className="text-right px-2 py-1.5">RS</th>
            <th className="text-right px-2 py-1.5">1M</th>
            <th className="text-right px-2 py-1.5">3M</th>
            <th className="text-center px-2 py-1.5" title="Above a rising 50-day MA">50MA</th>
            <th className="text-right px-2 py-1.5" title="% off 63-day high">Off&nbsp;High</th>
            <th className="text-right px-2 py-1.5" title="Up/down dollar-volume ratio, 20d">U/D&nbsp;$Vol</th>
            <th className="text-right px-2 py-1.5" title="Average daily range, 20d">ADR</th>
            <th className="text-right px-2 py-1.5" title="Median daily dollar volume, 20d">$Vol</th>
          </tr>
        </thead>
        <tbody>
          {data.leaders.map(l => (
            <tr key={l.symbol} className={`border-b border-surface-800/60 hover:bg-surface-800/40 ${!l.liquid ? 'opacity-45' : ''}`}>
              <td className="px-2 py-1.5">
                <a href={tvLink(l.symbol)} target="_blank" rel="noreferrer"
                   className="font-mono font-semibold text-accent hover:underline underline-offset-2">{l.symbol}</a>
                {!l.liquid && <span className="ml-1.5 text-[9px] text-surface-500" title="Below the $5M daily dollar-volume rule">illiquid</span>}
              </td>
              <td className="px-2 py-1.5 text-surface-400 hidden md:table-cell truncate max-w-[220px]">{l.name}</td>
              <td className="px-2 py-1.5 text-right font-mono font-bold text-surface-100">{l.rs_rank?.toFixed(0)}</td>
              <td className={`px-2 py-1.5 text-right font-mono ${l.ret21 > 0 ? 'text-success' : 'text-danger'}`}>{fmtSigned(l.ret21)}%</td>
              <td className={`px-2 py-1.5 text-right font-mono ${l.ret63 > 0 ? 'text-success' : 'text-danger'}`}>{fmtSigned(l.ret63)}%</td>
              <td className="px-2 py-1.5 text-center">{l.above_50ma && l.ma50_rising ? <span className="text-accent">✓</span> : <span className="text-surface-600">—</span>}</td>
              <td className="px-2 py-1.5 text-right font-mono text-surface-300">{l.pct_off_high?.toFixed(1)}%</td>
              <td className={`px-2 py-1.5 text-right font-mono ${(l.ud_vol_ratio || 0) >= 1.5 ? 'text-accent' : 'text-surface-300'}`}>{l.ud_vol_ratio ?? '—'}</td>
              <td className="px-2 py-1.5 text-right font-mono text-surface-300">{l.adr20}%</td>
              <td className="px-2 py-1.5 text-right font-mono text-surface-400">${l.dollar_vol_m}M</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main section ─────────────────────────────────────────────────────────

export default function SectorRotationIntel() {
  const [internals, setInternals] = useState(null)
  const [rrg, setRrg] = useState(null)
  const [error, setError] = useState(null)
  const [warmProgress, setWarmProgress] = useState(null)
  const [openSector, setOpenSector] = useState(null)
  const [leaders, setLeaders] = useState({})       // sector → payload
  const [leadersBusy, setLeadersBusy] = useState(null)
  const [leadersErr, setLeadersErr] = useState({})

  const load = async () => {
    try {
      const [i, r] = await Promise.all([getInternals(), getRRG()])
      setInternals(i)
      setRrg(r)
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { load() }, [])

  // While the sector map warms (first run: ~1,500 reference calls), poll
  // progress and refetch when it lands.
  useEffect(() => {
    if (!internals?.warming) return
    const t = setInterval(async () => {
      try {
        const p = await getMappingProgress()
        setWarmProgress(p)
        if (!p.running) {
          clearInterval(t)
          load()
        }
      } catch { /* keep polling */ }
    }, 4000)
    return () => clearInterval(t)
  }, [internals?.warming])

  const toggleSector = async (sector) => {
    const next = openSector === sector ? null : sector
    setOpenSector(next)
    if (next && !leaders[next]) {
      setLeadersBusy(next)
      try {
        const data = await getLeaders(next)
        setLeaders(prev => ({ ...prev, [next]: data }))
      } catch (e) {
        setLeadersErr(prev => ({ ...prev, [next]: e.message }))
      } finally {
        setLeadersBusy(null)
      }
    }
  }

  const quadrantChips = useMemo(() => {
    if (!rrg?.points) return null
    const by = { improving: [], leading: [], weakening: [], lagging: [] }
    for (const p of rrg.points) by[p.quadrant].push(p)
    return by
  }, [rrg])

  if (error) {
    return (
      <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 px-6 py-4">
        <p className="text-[12px] text-danger">Sector rotation intelligence unavailable: {error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Layer 1: Sector Internals ─────────────────────────────────── */}
      <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 backdrop-blur-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-700/50 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display font-semibold text-lg text-surface-50">Sector Internals — is big money in the group?</h2>
            <p className="text-[11px] text-surface-500 mt-0.5">
              Breadth computed from each sector's <span className="text-surface-300">members</span>, not the cap-weighted ETF —
              accumulation shows up here before it shows up in return rankings. Click a row for its leaders.
            </p>
          </div>
          {internals?.as_of && (
            <span className="text-[10px] font-mono text-surface-500 mt-1">as of {internals.as_of} · {internals?.sectors?.[0] ? 'top-1500 liquid names' : ''}</span>
          )}
        </div>

        {internals?.warming && (
          <div className="px-6 py-3 bg-cyan/5 border-b border-cyan/20 text-[12px] text-cyan flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-cyan animate-pulse" />
            Building the symbol→sector map (one-time warm)…
            {warmProgress?.total ? <span className="font-mono">{warmProgress.done}/{warmProgress.total}</span> : null}
          </div>
        )}

        {!internals ? (
          <div className="px-6 py-8 text-[12px] text-surface-400 animate-pulse">Computing sector internals from the local OHLCV cache…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-surface-500 border-b border-surface-700/50">
                  <th className="text-left px-4 py-2">Sector</th>
                  <th className="text-left px-2 py-2" title="Rank composite of level + change + volume + thrust">Score</th>
                  <th className="text-left px-2 py-2">Verdict</th>
                  <th className="text-right px-2 py-2" title="% of members above their 50-day SMA (Δ vs 5 sessions ago)">%&gt;50MA</th>
                  <th className="text-right px-2 py-2" title="Up-day vs down-day dollar volume, last 10 sessions. >1.2 = buyers paying up">U/D&nbsp;$Vol</th>
                  <th className="text-right px-2 py-2" title="Members' +4% days minus −4% days, last 10 sessions">Net&nbsp;4%</th>
                  <th className="text-right px-2 py-2" title="% of members within 2% of a 3-month high">Near&nbsp;High</th>
                  <th className="text-right px-2 py-2 hidden lg:table-cell" title="Median member 1-month return vs the ETF's — broad beats narrow">Median↔ETF</th>
                  <th className="text-left px-2 py-2 hidden md:table-cell">Shape</th>
                </tr>
              </thead>
              <tbody>
                {internals.sectors.map(s => (
                  <SectorRow key={s.sector} s={s}
                             open={openSector === s.sector}
                             onToggle={() => toggleSector(s.sector)}
                             leaders={leaders[s.sector]}
                             busy={leadersBusy === s.sector}
                             err={leadersErr[s.sector]} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Layer 2: RRG quadrants ────────────────────────────────────── */}
      <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 backdrop-blur-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-700/50 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display font-semibold text-lg text-surface-50">RS Rotation Quadrants (RRG)</h2>
            <p className="text-[11px] text-surface-500 mt-0.5">
              Relative strength vs SPY (x) × its momentum (y), weekly trail. Sectors orbit clockwise:
              the tradeable moment is the <span style={{ color: QUAD.improving.color }}>Improving</span> entry — RS still below
              average but already turning — not the Leading confirmation everyone can see.
            </p>
          </div>
          {rrg?.as_of && <span className="text-[10px] font-mono text-surface-500 mt-1">as of {rrg.as_of}</span>}
        </div>
        {!rrg ? (
          <div className="px-6 py-8 text-[12px] text-surface-400 animate-pulse">Computing relative-strength orbits…</div>
        ) : (
          <div className="p-4">
            <RRGChart points={rrg.points} />
            {quadrantChips && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {Object.entries(QUAD).map(([q, meta]) => (
                  <div key={q} className="rounded-lg border border-surface-700/40 bg-surface-900/40 px-3 py-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: meta.color }} />
                      <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: meta.color }}>{meta.label}</span>
                      <span className="text-[9.5px] text-surface-600 hidden xl:inline">· {meta.hint}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {quadrantChips[q].length === 0 && <span className="text-[10.5px] text-surface-600">—</span>}
                      {quadrantChips[q].map(p => (
                        <span key={p.ticker} title={p.label}
                              className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-mono border border-surface-700 bg-surface-800/60 text-surface-300">
                          {p.ticker}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SectorRow({ s, open, onToggle, leaders, busy, err }) {
  const div = s.etf_ret21 != null ? s.median_ret21 - s.etf_ret21 : null
  return (
    <>
      <tr onClick={onToggle}
          className={`cursor-pointer border-b border-surface-800/60 transition-colors ${open ? 'bg-surface-800/50' : 'hover:bg-surface-800/30'}`}>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <svg className={`w-3 h-3 text-surface-500 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="font-semibold text-surface-100">{s.sector}</span>
            <span className="text-[9.5px] font-mono text-surface-500">{s.etf}</span>
            {s.stealth && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-cyan/10 text-cyan border-cyan/30"
                    title="Internals turning up hard while the ETF's return rank is still unremarkable — members firming before the index.">
                ⚡ STEALTH
              </span>
            )}
          </div>
        </td>
        <td className="px-2 py-2.5 w-[110px]">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-surface-800 rounded-full overflow-hidden min-w-[48px]">
              <div className={`h-full rounded-full ${s.score >= 70 ? 'bg-accent' : s.score <= 30 ? 'bg-danger' : 'bg-surface-500'}`}
                   style={{ width: `${s.score}%` }} />
            </div>
            <span className="font-mono font-bold text-surface-200 text-[12px] w-6 text-right">{s.score}</span>
          </div>
        </td>
        <td className="px-2 py-2.5">
          <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${VERDICT_CLS[s.verdict]}`}>{s.verdict}</span>
        </td>
        <td className="px-2 py-2.5 text-right font-mono">
          <span className="text-surface-200">{s.pct_above_50}%</span>
          <span className={`ml-1 text-[10.5px] ${s.delta_above_50 > 0 ? 'text-success' : s.delta_above_50 < 0 ? 'text-danger' : 'text-surface-500'}`}>
            {fmtSigned(s.delta_above_50)}
          </span>
        </td>
        <td className={`px-2 py-2.5 text-right font-mono ${(s.ud_vol_ratio || 0) >= 1.2 ? 'text-accent' : (s.ud_vol_ratio || 1) < 0.85 ? 'text-danger' : 'text-surface-300'}`}>
          {s.ud_vol_ratio ?? '—'}
        </td>
        <td className={`px-2 py-2.5 text-right font-mono ${s.net_4pct_10d > 0 ? 'text-success' : s.net_4pct_10d < 0 ? 'text-danger' : 'text-surface-400'}`}>
          {fmtSigned(s.net_4pct_10d, 0)}
        </td>
        <td className="px-2 py-2.5 text-right font-mono text-surface-300">{s.new_high_pct}%</td>
        <td className="px-2 py-2.5 text-right font-mono text-surface-300 hidden lg:table-cell" title={`median member ${fmtSigned(s.median_ret21)}% vs ${s.etf} ${fmtSigned(s.etf_ret21)}%`}>
          {div != null ? `${fmtSigned(div)}pp` : '—'}
        </td>
        <td className="px-2 py-2.5 hidden md:table-cell">
          <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${SHAPE_CLS[s.breadth_shape]}`}>{s.breadth_shape}</span>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-surface-800/60 bg-surface-950/40">
          <td colSpan={9} className="p-0">
            <LeadersTable data={leaders} loading={busy} error={err} />
          </td>
        </tr>
      )}
    </>
  )
}
