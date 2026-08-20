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

// ---------------------------------------------------------------------------
// Which book is in season?
//
// The board shows a stance and then rendered both books at identical weight —
// 95 short candidates sitting under a banner that says "press exposure", with a
// header telling you to go check Trade Today and gate them yourself. The read is
// already in hand, so the page applies it: the out-of-season book folds to one
// line and its count.
//
// The permission comes from `day_verdict`'s per-direction answer, NOT from the
// stance label. Those differ on purpose: a Defensive tape does not mean shorts
// are on — the verdict only says yes once the Shorts/Hedges family has its own
// green, because a weak long read is not a short signal.
//
// It folds, it never hides: the count stays visible, one click opens it, and a
// missing verdict leaves both books open. An existing position still needs its
// data, so this withholds attention, not information — the same fail-open rule
// the discipline breaker follows.
// ---------------------------------------------------------------------------
function bookGate(verdict, dir) {
  const permission = dir === 'short' ? verdict?.newShort : verdict?.newLong
  const other = dir === 'short' ? 'shorting' : 'buying'
  if (permission === 'no') {
    return {
      permission: 'no',
      tone: 'text-surface-500',
      note: verdict?.label ? `out of season · today's read: ${verdict.label}` : 'out of season — no new risk this side',
      folded: verdict?.why || `Today's read is against new ${other}.`,
    }
  }
  if (permission === 'stalk') {
    return {
      permission: 'stalk',
      tone: 'text-amber-300/90',
      note: 'stalk only — wait for the trigger, don\'t initiate on the scan alone',
    }
  }
  if (permission === 'yes') {
    return { permission: 'yes', tone: 'text-emerald-300/90', note: 'in season' }
  }
  // No verdict (degraded payload) → fail open, exactly as before.
  return {
    permission: null,
    tone: 'text-surface-500',
    note: dir === 'short'
      ? 'check the Trade Today read before shorting anything here'
      : 'the default book',
  }
}

// Tone → text color for the driver ledger (mirrors Trade Today's map).
const TONE_TEXT = { bull: 'text-emerald-300', bear: 'text-danger', warn: 'text-amber-300', neutral: 'text-surface-400' }

// ---------------------------------------------------------------------------
// "Why are we in this stance?" — the argument behind the banner's conclusion.
//
// The banner alone states a verdict ("Aggressive · press exposure") with no way
// to tell a tape carried by broad quarterly leadership from one riding a single
// thrust print, and no sense of how close the read is to flipping. That matters
// on THIS page: the stance is what tells you whether to take the lanes below at
// full size, so "because of what?" is the next question every time.
//
// It renders the same ledger `situational` computed — neutral 50, each factor's
// signed contribution, the total — and the band edges. No arithmetic of its own:
// a second implementation of the reasoning is how two surfaces drift apart.
// Collapsed by default; the verdict stays the loudest thing on the page.
// ---------------------------------------------------------------------------
function RegimeWhy({ regime, tone }) {
  const [open, setOpen] = useState(false)
  const drivers = regime?.drivers || []
  const ex = regime?.explanation
  if (!drivers.length && !ex?.summary) return null

  return (
    <div className="basis-full">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] text-surface-400 hover:text-surface-200 flex items-center gap-1.5 underline decoration-dotted underline-offset-2"
      >
        <span>{open ? 'Hide' : 'Why'} this stance</span>
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="mt-3 rounded-lg bg-surface-950/40 border border-surface-700/40 px-4 py-3 space-y-3">
          {ex?.summary && (
            <p className="text-[12.5px] text-surface-300 leading-relaxed">{ex.summary}</p>
          )}

          {/* The ledger: 50 baseline, one row per factor that moved it, the total. */}
          {drivers.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-surface-600 font-semibold mb-1.5">
                What moved the score
              </div>
              <div className="divide-y divide-surface-800/50">
                <div className="flex items-baseline gap-3 py-1 text-[12px]">
                  <span className="font-mono w-9 shrink-0 text-surface-500">50</span>
                  <span className="text-surface-500">Neutral baseline</span>
                </div>
                {drivers.map((d, i) => (
                  <div key={i} className="flex items-baseline gap-3 py-1">
                    <span className={`font-mono w-9 shrink-0 text-[12px] font-semibold ${TONE_TEXT[d.tone] || TONE_TEXT.neutral}`}>
                      {d.points > 0 ? '+' : '−'}{Math.abs(d.points)}
                    </span>
                    <div className="min-w-0">
                      <span className="text-[12px] text-surface-200">{d.label}</span>
                      {d.detail && (
                        <span className="text-[11.5px] text-surface-500"> · {d.detail}</span>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex items-baseline gap-3 pt-1.5 text-[12px]">
                  <span className={`font-mono w-9 shrink-0 font-bold ${tone.text}`}>{regime.score}</span>
                  <span className="text-surface-400">
                    Exposure score — the {regime.stance?.label} band
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* A stance is a band, not a point: say what would tip it either way. */}
          {(ex?.toUp || ex?.toDown) && (
            <div className="text-[11.5px] text-surface-500 flex flex-wrap gap-x-5 gap-y-1 pt-1 border-t border-surface-800/60">
              {ex.toUp && (
                <span>
                  <span className="text-emerald-400 font-mono">+{ex.toUp.gain_needed}</span>
                  {' '}(≥ {ex.toUp.threshold}) → {ex.toUp.label}
                </span>
              )}
              {ex.toDown && (
                <span>
                  below <span className="text-rose-400 font-mono">{ex.toDown.threshold}</span> → {ex.toDown.label}
                </span>
              )}
              <Link to="/situational-awareness" className="ml-auto text-surface-500 hover:text-surface-300 underline decoration-dotted underline-offset-2">
                Full breadth read →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
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
  // Per-book override — folding is a nudge, and one click undoes it.
  const [openBooks, setOpenBooks] = useState({ long: false, short: false })

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
  const conflicts = data?.conflicts || []
  const regime = data?.regime
  // Deliberately NOT the sum of every lane's count. That totalled 614 on a
  // normal day — 286 Stage-2 transitions and 87 reversals nobody opens — which
  // is a big number standing in for a useful one. What the board actually put
  // in front of you is the shown rows; what it wants you to look at first is
  // the confluence set. Count those.
  const shownIdeas = lanes.reduce((sum, l) => sum + (l.items?.length || 0), 0)

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
              {confluence.length > 0 && (
                <span className="text-accent">{confluence.length} confluence · </span>
              )}
              {shownIdeas} shown · {fmtDate(data.asOf)}
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
            <RegimeWhy regime={regime} tone={tone} />
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
          <span className="text-[11px] text-surface-500">— 2+ scanners agreeing on the same direction (highest conviction)</span>
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
                <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded border uppercase shrink-0 ${
                  c.direction === 'short'
                    ? 'bg-rose-500/10 text-rose-300 border-rose-400/30'
                    : 'bg-emerald-500/10 text-emerald-300 border-emerald-400/30'
                }`}>{c.direction || 'long'}</span>
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

      {/* Conflicts — a symbol flagged BOTH long and short. Not conviction: two
          scanners disagreeing, usually a violently extended name. Surfaced so it
          is visible, never mixed into the confluence list. */}
      {conflicts.length > 0 && (
        <div className="rounded-2xl bg-amber-500/[0.06] border border-amber-400/30 overflow-hidden">
          <div className="px-5 py-3 border-b border-amber-400/20 flex items-center gap-2.5">
            <svg className="w-4 h-4 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <span className="text-[14px] font-semibold text-surface-100">Conflicted</span>
            <span className="text-[11px] text-surface-400">— flagged long <em>and</em> short. Disagreement, not conviction — skip unless you know which side you're on.</span>
            <span className="ml-auto text-[11px] font-mono text-amber-300">{conflicts.length}</span>
          </div>
          <div className="divide-y divide-amber-400/10">
            {conflicts.slice(0, 8).map((c) => (
              <div key={c.symbol} className="px-5 py-2.5 flex items-center gap-3 flex-wrap">
                <TickerLink symbol={c.symbol} className="text-surface-100 font-semibold font-mono text-[13px] w-16" />
                <span className="text-surface-400 font-mono text-[12px] w-16">{fmtMoney(c.close)}</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[...c.long, ...c.short].map((h) => (
                    <span key={h.key} className={`text-[10.5px] px-2 py-0.5 rounded-full border ${
                      h.direction === 'short'
                        ? 'bg-rose-500/10 text-rose-300 border-rose-400/30'
                        : 'bg-emerald-500/10 text-emerald-300 border-emerald-400/30'
                    }`}>{h.label}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lanes grid — grouped by direction so the board reads as two books */}
      {['long', 'short'].map((dir) => {
        const group = (lanes.length ? lanes : LANE_SKELETON).filter(
          (l) => (l.direction || 'long') === dir)
        if (!group.length) return null
        const gate = bookGate(regime?.verdict, dir)
        const ideas = group.reduce((n, l) => n + (l.count || 0), 0)
        const folded = gate.permission === 'no' && !openBooks[dir]
        return (
          <div key={dir}>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">
                {dir === 'short' ? 'Short setups' : 'Long setups'}
              </span>
              <span className={`text-[11px] ${gate.tone}`}>{gate.note}</span>
              {folded && (
                <button
                  onClick={() => setOpenBooks((o) => ({ ...o, [dir]: true }))}
                  className="text-[11px] text-surface-400 hover:text-surface-200 underline decoration-dotted underline-offset-2"
                >
                  Show {ideas} anyway →
                </button>
              )}
              {gate.permission === 'no' && openBooks[dir] && (
                <button
                  onClick={() => setOpenBooks((o) => ({ ...o, [dir]: false }))}
                  className="text-[11px] text-surface-500 hover:text-surface-300 underline decoration-dotted underline-offset-2"
                >
                  Fold away
                </button>
              )}
            </div>
            {folded ? (
              <div className="rounded-2xl bg-surface-900/40 border border-dashed border-surface-700/50 px-5 py-4 text-[12px] text-surface-500">
                {gate.folded}
              </div>
            ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.map((lane) => {
          const accent = ACCENT[lane.accent] || ACCENT.emerald
          return (
            <div key={lane.key} className="rounded-2xl bg-surface-900/80 border border-surface-700/50 overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-surface-700/40 flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full ${accent.dot}`} />
                <Link to={lane.route} className="text-[13px] font-semibold text-surface-100 hover:text-white">
                  {lane.label}
                </Link>
                {/* A bare "286" next to eight rows reads as the lane's size, not
                    as how much of it you're being shown. Say both. */}
                {lane.count != null && (
                  <span className="text-[11px] font-mono text-surface-500">
                    {lane.count > (lane.items?.length || 0)
                      ? `top ${lane.items.length} of ${lane.count}`
                      : lane.count}
                  </span>
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
            )}
          </div>
        )
      })}

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
// `direction` is required, not decoration: the render groups by it, so a
// skeleton without it put every lane in the long book and dropped the short
// section entirely — the page then jumped when data landed.
const LANE_SKELETON = [
  { key: 'ma-reclaim', label: '200 MA Reclaim', route: '/ma-reclaim', accent: 'emerald', direction: 'long', items: [], count: null },
  { key: 'stage-analysis', label: 'Stage 1→2', route: '/stage-analysis', accent: 'sky', direction: 'long', items: [], count: null },
  { key: 'breakouts', label: 'Breakouts', route: '/breakouts', accent: 'violet', direction: 'long', items: [], count: null },
  { key: 'scanner-9m', label: '$9M Scanner', route: '/scanner-9m', accent: 'amber', direction: 'long', items: [], count: null },
  { key: 'reversal-setup', label: 'Reversal', route: '/reversal-setup', accent: 'rose', direction: 'long', items: [], count: null },
  { key: 'parabolic-short', label: 'Parabolic Short', route: '/parabolic-short', accent: 'rose', direction: 'short', items: [], count: null },
  { key: 'breakdown-short', label: 'Breakdown Short', route: '/breakdown-short', accent: 'rose', direction: 'short', items: [], count: null },
]
