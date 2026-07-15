import { useEffect, useMemo, useState } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, ReferenceLine, Tooltip, ResponsiveContainer,
} from 'recharts'
import { getInternals, getRRG, getLeaders, getMappingProgress } from '../../api/sectorRotation'
import InfoTip from '../InfoTip'

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

// Plain-language explainers for every metric column, surfaced as instant
// InfoTip hovers on the headers — the numbers are useless if you have to
// remember what they mean.
const INTERNALS_TIPS = {
  score: 'Composite 0–100 rank vs the other sectors, weighted toward CHANGE (Δ%>50MA, up/down volume, 4% thrust) over level — rotation detection cares about the turn, not the crowd that already arrived.',
  verdict: 'The one-word read of the score: ≥70 = ACCUMULATING (broad buying across members), ≤30 = DISTRIBUTING (broad selling), else NEUTRAL. Computed from member breadth, never from the ETF price.',
  above50: 'Percent of the sector’s member stocks above their own 50-day moving average — the trend health of the group. The small ± is the change vs 5 sessions ago: a rising number means members are getting bought before the index shows it.',
  udvol: 'Dollar volume on members’ up days ÷ down days, last 10 sessions. Above ~1.2 = buyers are paying up (accumulation); below ~0.85 = sellers dominate the tape.',
  net4: 'Members’ +4% days minus −4% days over the last 10 sessions. Big positive = real momentum thrust inside the group; big negative = heavy institutional selling.',
  nearHigh: 'Percent of members within 2% of their 3-month high — how much of the group is set up at highs, which is where leaders actually break out from.',
  medianEtf: 'Median member 1-month return minus the ETF’s, in percentage points. Positive = the AVERAGE stock beats the index (broad, institutional participation). Negative = a few mega-caps carrying a weak group.',
  shape: 'BROAD = the whole group participates — the institutional signature. NARROW = the ETF is up but the median member isn’t (mega-caps masking weakness). MIXED = in between.',
}

const LEADERS_TIPS = {
  rs: 'Relative-strength rank: percentile of 3-month return across the ENTIRE ~1,500-name liquid universe, not just this sector. 90+ = a market leader, not merely a sector leader.',
  m1: 'Price return over the last month (21 sessions).',
  m3: 'Price return over the last 3 months (63 sessions) — this is what the RS rank is computed from.',
  ma50: '✓ = price above a RISING 50-day moving average — the long qualifier (“longs only above a rising 50”). — = fails it.',
  offHigh: 'Percent below its 3-month high. Near 0 = sitting at highs (breakout zone); deeply negative = still basing, or broken.',
  udvol: 'Up-day vs down-day dollar volume for this stock, last 20 sessions. ≥1.5 (highlighted) = individual-name accumulation.',
  adr: 'Average daily range over 20 sessions — the volatility that pays. The entry rule wants roughly 5%+ for momentum names.',
  dvol: 'Median daily dollar volume, 20 sessions. The liquidity floor is $5M/day — names below it are dimmed as illiquid.',
}

// Header cell with an instant explainer. The dotted underline signals
// "hover me" without shouting.
function Th({ tip, align = 'right', className = '', children }) {
  return (
    <th className={`text-${align} px-2 py-2 ${className}`}>
      {tip ? (
        <InfoTip label={tip}>
          <span className="border-b border-dotted border-surface-600">{children}</span>
        </InfoTip>
      ) : children}
    </th>
  )
}

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
            <Th tip={LEADERS_TIPS.rs}>RS</Th>
            <Th tip={LEADERS_TIPS.m1}>1M</Th>
            <Th tip={LEADERS_TIPS.m3}>3M</Th>
            <Th align="center" tip={LEADERS_TIPS.ma50}>50MA</Th>
            <Th tip={LEADERS_TIPS.offHigh}>Off&nbsp;High</Th>
            <Th tip={LEADERS_TIPS.udvol}>U/D&nbsp;$Vol</Th>
            <Th tip={LEADERS_TIPS.adr}>ADR</Th>
            <Th tip={LEADERS_TIPS.dvol}>$Vol</Th>
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

  // Early Flow watch — the direct answer to "where is big money STARTING to
  // flow?". The strict ⚡ STEALTH flag can sit dark for weeks, so this ranks
  // sectors by how many *change* signals fire at once (breadth turn, buyers
  // paying up, thrust, RRG Improving) and always gives a directional read.
  const earlyFlow = useMemo(() => {
    if (!internals?.sectors?.length) return null
    const quadByEtf = {}
    for (const p of rrg?.points || []) quadByEtf[p.ticker] = p.quadrant
    const candidates = internals.sectors.map(s => {
      const reasons = []
      if (s.stealth) reasons.push('⚡ members firming before the index')
      if (s.delta_above_50 >= 3) reasons.push(`Δ${fmtSigned(s.delta_above_50)}pp >50MA this week`)
      if ((s.ud_vol_ratio || 0) >= 1.15) reasons.push(`buyers paying up (U/D ${s.ud_vol_ratio})`)
      if (s.net_4pct_10d >= 5) reasons.push(`+${s.net_4pct_10d} net 4%-day thrust`)
      if (quadByEtf[s.etf] === 'improving') reasons.push('RRG Improving')
      return { sector: s.sector, etf: s.etf, reasons, delta: s.delta_above_50, stealth: s.stealth }
    }).filter(c => c.reasons.length >= 2)
    candidates.sort((a, b) => (b.stealth - a.stealth) || (b.reasons.length - a.reasons.length) || (b.delta - a.delta))
    return candidates.slice(0, 3)
  }, [internals, rrg])

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

        {/* Early Flow watch — the "starting to flow" read, always answered */}
        {earlyFlow !== null && (
          <div className="px-6 py-3 border-b border-surface-700/50 bg-cyan/[0.04]">
            <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
              <InfoTip label="Sectors showing at least TWO change signals at once — breadth turning up (Δ%>50MA), buyers paying up (U/D $vol), 4%-day thrust, or an RRG Improving cross. Change signals precede return rankings: this is where accumulation looks like it's STARTING, not where it already happened. Click one to open its leaders.">
                <span className="text-[10px] font-bold tracking-widest uppercase text-cyan border-b border-dotted border-cyan/40 shrink-0">
                  Early flow watch
                </span>
              </InfoTip>
              {earlyFlow.length === 0 ? (
                <span className="text-[11.5px] text-surface-500 italic">
                  no early-accumulation signature right now — nothing shows ≥2 change signals; watch for a Δ%>50MA turn with U/D volume &gt; 1.15
                </span>
              ) : earlyFlow.map(c => (
                <button
                  key={c.sector}
                  type="button"
                  onClick={() => toggleSector(c.sector)}
                  title="Open this sector's leaders"
                  className="inline-flex items-baseline gap-1.5 rounded-lg border border-cyan/25 bg-cyan/[0.06] hover:bg-cyan/[0.12] px-2.5 py-1 text-left transition-colors"
                >
                  <span className="text-[12px] font-semibold text-surface-100">{c.sector}</span>
                  <span className="text-[10.5px] text-surface-400">{c.reasons.join(' · ')}</span>
                </button>
              ))}
            </div>
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
                  <Th align="left" tip={INTERNALS_TIPS.score}>Score</Th>
                  <Th align="left" tip={INTERNALS_TIPS.verdict}>Verdict</Th>
                  <Th tip={INTERNALS_TIPS.above50}>%&gt;50MA</Th>
                  <Th tip={INTERNALS_TIPS.udvol}>U/D&nbsp;$Vol</Th>
                  <Th tip={INTERNALS_TIPS.net4}>Net&nbsp;4%</Th>
                  <Th tip={INTERNALS_TIPS.nearHigh}>Near&nbsp;High</Th>
                  <Th tip={INTERNALS_TIPS.medianEtf} className="hidden lg:table-cell">Median↔ETF</Th>
                  <Th align="left" tip={INTERNALS_TIPS.shape} className="hidden md:table-cell">Shape</Th>
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
              <InfoTip label="Stealth accumulation: internals turning up hard (Δ%>50MA ≥ +5pp, U/D volume ≥ 1.2) while the ETF's return rank is still bottom-half — members are being bought before the index shows it. The strongest early-flow tell on this table.">
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-cyan/10 text-cyan border-cyan/30">
                  ⚡ STEALTH
                </span>
              </InfoTip>
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
