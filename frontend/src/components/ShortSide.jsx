import { SHORT_MIRROR, SHORT_SIDE, SHORT_ARC_LADDER } from '../utils/tradingRules'
import { Candle } from './MARailsVisuals'
import { VOL_COLORS } from './volumeCharts'
import { useDensity } from './framework/density'

// Short Side — the mirror panel: the lineage's one A+ short (the parabolic
// short) plus the backside re-short, taught against the long frameworks above
// it on the Rules page. Data lives in utils/tradingRules.js (SHORT_MIRROR /
// SHORT_SIDE / SHORT_ARC_LADDER); the scene specs below are the presentation
// half, drawn with the same Candle primitive as the sibling panels. The panel
// wears the danger palette on purpose — structure mirrors the long side, risk
// does not.

const TONE = {
  good: { text: 'text-accent', border: 'border-accent/40', bgSoft: 'bg-accent/[0.04]', bar: 'bg-accent', chip: 'bg-accent/10 text-accent border-accent/30', hex: '#10B981' },
  info: { text: 'text-cyan', border: 'border-cyan/40', bgSoft: 'bg-cyan/[0.04]', bar: 'bg-cyan', chip: 'bg-cyan/10 text-cyan border-cyan/30', hex: '#06B6D4' },
  warn: { text: 'text-warning', border: 'border-warning/40', bgSoft: 'bg-warning/[0.05]', bar: 'bg-warning', chip: 'bg-warning/10 text-warning border-warning/30', hex: '#F59E0B' },
  bad: { text: 'text-danger', border: 'border-danger/40', bgSoft: 'bg-danger/[0.05]', bar: 'bg-danger', chip: 'bg-danger/10 text-danger border-danger/30', hex: '#EF4444' },
}

const SIGNAL_LABEL = { confirm: 'CONFIRM', caution: 'CAUTION', context: 'CONTEXT' }

// Scene specs — viewBox 220×96, same stage as Candles × Rails. `rail` draws a
// sloped MA (here usually declining); `guides` are dashed reference levels —
// tone 'stop' renders in danger with a STOP tag; `mark` is the spotlight ring.
const SCENES = {
  // Day 1-3 vertical: accelerating green bars, closes near highs, volume building.
  frontside: {
    candles: [
      { x: 25, top: 52, bot: 58, hi: 49, lo: 61, up: true },
      { x: 65, top: 42, bot: 50, hi: 39, lo: 53, up: true },
      { x: 105, top: 30, bot: 40, hi: 27, lo: 43, up: true },
      { x: 145, top: 16, bot: 28, hi: 13, lo: 31, up: true },
      { x: 185, top: 7, bot: 15, hi: 5, lo: 18, up: true },
    ],
    vols: [0.3, 0.45, 0.6, 0.8, 1.0],
    hiVol: 4,
  },
  // Gap-up that fails: monster upper wick + red body on the run's peak volume.
  exhaust: {
    candles: [
      { x: 30, top: 40, bot: 48, hi: 37, lo: 51, up: true },
      { x: 70, top: 28, bot: 38, hi: 25, lo: 41, up: true },
      { x: 110, top: 16, bot: 26, hi: 13, lo: 29, up: true },
      { x: 170, top: 10, bot: 30, hi: 6, lo: 33, up: false }, // gap open, spike, collapse
    ],
    vols: [0.4, 0.55, 0.7, 1.0],
    hiVol: 3,
    mark: { x: 170, y: 14, r: 12 },
  },
  // Break of the signal bar's low; stop parked above the highs.
  strigger: {
    candles: [
      { x: 30, top: 20, bot: 28, hi: 17, lo: 31, up: true },
      { x: 75, top: 12, bot: 30, hi: 8, lo: 33, up: false },  // the signal bar
      { x: 125, top: 30, bot: 36, hi: 26, lo: 38, up: false },
      { x: 170, top: 34, bot: 52, hi: 31, lo: 56, up: false }, // the trigger break
    ],
    vols: [0.5, 0.8, 0.4, 0.9],
    hiVol: 3,
    guides: [
      { y: 33, x0: 75, x1: 205 },                 // signal-bar low = trigger
      { y: 8, x0: 75, x1: 205, tone: 'stop' },    // above the high = stop
    ],
    mark: { x: 170, y: 44, r: 11 },
  },
  // Cascading fade; the widest flush on spiking volume is the cover.
  cover: {
    candles: [
      { x: 35, top: 16, bot: 26, hi: 13, lo: 29, up: false },
      { x: 80, top: 26, bot: 36, hi: 23, lo: 39, up: false },
      { x: 125, top: 36, bot: 54, hi: 33, lo: 58, up: false }, // the panic flush
      { x: 170, top: 44, bot: 50, hi: 40, lo: 56, up: true },  // the bounce you covered into
    ],
    vols: [0.45, 0.55, 1.0, 0.5],
    hiVol: 2,
    mark: { x: 125, y: 46, r: 12 },
  },
  // Lower highs under the declining rail; the pop into it gets rejected.
  backside: {
    rail: { x0: 10, y0: 22, x1: 210, y1: 52, label: '10/20' },
    candles: [
      { x: 35, top: 34, bot: 44, hi: 30, lo: 47, up: false },
      { x: 80, top: 36, bot: 42, hi: 33, lo: 45, up: true },
      { x: 125, top: 34, bot: 40, hi: 28, lo: 42, up: true },   // pops into the rail
      { x: 170, top: 48, bot: 58, hi: 42, lo: 61, up: false },  // rejection
    ],
    vols: [0.5, 0.35, 0.4, 0.7],
    hiVol: 3,
    mark: { x: 170, y: 50, r: 12 },
  },
  // The reclaim through the stop — green bars forcing shorts to buy.
  squeeze: {
    candles: [
      { x: 30, top: 36, bot: 48, hi: 33, lo: 51, up: false },  // the entry day
      { x: 75, top: 34, bot: 42, hi: 30, lo: 45, up: true },
      { x: 120, top: 22, bot: 34, hi: 18, lo: 37, up: true },
      { x: 165, top: 8, bot: 22, hi: 5, lo: 25, up: true },    // closes through the stop
    ],
    vols: [0.5, 0.4, 0.6, 1.0],
    hiVol: 3,
    guides: [{ y: 12, x0: 20, x1: 205, tone: 'stop' }],
    mark: { x: 165, y: 12, r: 12 },
  },
}

const VOL_BASE = 90
const VOL_MAX_H = 20

function Scene({ spec, toneHex, label }) {
  return (
    <svg viewBox="0 0 220 96" className="w-full h-auto block rounded-lg bg-surface-950/60" role="img" aria-label={label}>
      {spec.rail && (
        <g>
          <line x1={spec.rail.x0} y1={spec.rail.y0} x2={spec.rail.x1} y2={spec.rail.y1}
            stroke={VOL_COLORS.ma} strokeWidth="1.8" strokeOpacity="0.85" strokeLinecap="round" />
          <text x={spec.rail.x1 - 2} y={spec.rail.y1 + 9} fontSize="7" fontWeight="700"
            fill={VOL_COLORS.ma} textAnchor="end" fontFamily="JetBrains Mono, monospace">
            {spec.rail.label}
          </text>
        </g>
      )}
      {spec.guides && spec.guides.map((g, i) => {
        const stop = g.tone === 'stop'
        const color = stop ? TONE.bad.hex : VOL_COLORS.avg
        return (
          <g key={`g${i}`}>
            <line x1={g.x0} y1={g.y} x2={g.x1} y2={g.y} stroke={color}
              strokeWidth="0.9" strokeDasharray="3 3" strokeOpacity={stop ? 0.85 : 0.7} />
            {stop && (
              <text x={g.x0 + 2} y={g.y - 2.5} fontSize="6.5" fontWeight="700" fill={color}
                fontFamily="JetBrains Mono, monospace">STOP</text>
            )}
          </g>
        )
      })}
      {spec.candles.map((c, i) => (
        <Candle key={i} x={c.x} top={c.top} bot={c.bot} hi={c.hi} lo={c.lo} up={c.up} w={c.w ?? 11} />
      ))}
      {spec.vols && spec.vols.map((m, i) => {
        const c = spec.candles[i]
        const h = m * VOL_MAX_H
        const hi = spec.hiVol === i
        return (
          <rect key={`v${i}`} x={c.x - 5} y={VOL_BASE - h} width={10} height={h} rx="1"
            fill={hi ? toneHex : VOL_COLORS.muted} fillOpacity={hi ? 0.9 : 0.55} />
        )
      })}
      {spec.mark && (
        <circle cx={spec.mark.x} cy={spec.mark.y} r={spec.mark.r} fill="none"
          stroke={toneHex} strokeWidth="1.2" strokeDasharray="3 2.5" strokeOpacity="0.9" />
      )}
    </svg>
  )
}

// One playbook card — same layout as the Candles × Rails cards, numbered so
// each side reads as a sequence.
function ShortCard({ t, step }) {
  const brief = useDensity() === 'brief'
  const tone = TONE[t.tone]
  return (
    <div className={`relative rounded-2xl border overflow-hidden ${tone.border} ${tone.bgSoft} flex flex-col`}>
      <div className={`absolute left-0 right-0 top-0 h-0.5 ${tone.bar} opacity-80`} />
      <div className="p-4 flex flex-col h-full">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className={`shrink-0 w-7 h-7 rounded-lg bg-surface-800 border border-surface-700 flex items-center justify-center font-mono font-bold text-[11px] ${tone.text}`}>
              {String(step).padStart(2, '0')}
            </div>
            <div className="min-w-0">
              <div className={`text-[14px] font-bold tracking-tight ${tone.text}`}>{t.title}</div>
              <div className="text-[11px] text-surface-500 mt-0.5">{t.tagline}</div>
            </div>
          </div>
          <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${tone.chip}`}>
            {SIGNAL_LABEL[t.signal]}
          </span>
        </div>

        {!brief && (<><div className="mt-3">
          <Scene spec={SCENES[t.glyph]} toneHex={tone.hex} label={`${t.title}: ${t.what}`} />
        </div>

        <div className="mt-3 space-y-2">
          <div>
            <div className="text-[9px] font-bold tracking-widest text-surface-500 uppercase mb-0.5">Looks like</div>
            <p className="text-[12px] text-surface-300 leading-snug">{t.what}</p>
          </div>
          <div>
            <div className="text-[9px] font-bold tracking-widest text-surface-500 uppercase mb-0.5">Means</div>
            <p className="text-[12px] text-surface-400 leading-snug">{t.why}</p>
          </div>
        </div></>)}

        <div className="flex-1" />

        <div className={`mt-3 rounded-lg border ${tone.border} ${tone.bgSoft} px-3 py-2`}>
          <div className={`text-[9px] font-bold tracking-widest uppercase mb-0.5 ${tone.text}`}>The rule</div>
          <p className="text-[11.5px] text-surface-200 leading-snug">{t.rule}</p>
        </div>
      </div>
    </div>
  )
}

export default function ShortSide({ collapsible = false, collapsed = false, onToggle, id }) {
  const expanded = !collapsible || !collapsed
  const setup = SHORT_SIDE.filter(t => t.side === 'setup')
  const manage = SHORT_SIDE.filter(t => t.side === 'manage')

  return (
    <section
      id={id}
      aria-labelledby="short-side-title"
      className="relative overflow-hidden rounded-3xl border border-danger/25 bg-gradient-to-br from-surface-900 via-surface-900 to-surface-950 scroll-mt-[116px] lg:scroll-mt-[64px]"
    >
      <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-danger via-warning to-purple opacity-70" />
      <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full bg-danger/10 blur-3xl pointer-events-none" />

      <div className="relative px-6 sm:px-7 py-6 sm:py-7">
        {/* Title row — doubles as the collapse toggle when embedded on Rules */}
        <div
          {...(collapsible ? { role: 'button', tabIndex: 0, 'aria-expanded': expanded, onClick: onToggle, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.() } } } : {})}
          className={`flex items-start justify-between gap-3 flex-wrap mb-1 ${collapsible ? 'cursor-pointer select-none' : ''}`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-danger/10 border border-danger/30 flex items-center justify-center text-danger">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7l6 6 4-4 8 8m0 0v-6m0 6h-6" />
              </svg>
            </div>
            <div>
              <h2 id="short-side-title" className="text-[16px] font-display font-bold text-surface-50 tracking-tight leading-tight">
                Short Side
              </h2>
              <div className="text-[11px] text-surface-500 mt-0.5">
                The parabolic short + the backside — the mirror of everything above, except the risk.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-danger/10 text-danger border-danger/30">
              SHORT
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-surface-800/60 text-surface-400 border-surface-700">
              FRAMEWORK
            </span>
            {collapsible && (
              <svg className={`w-4 h-4 text-surface-500 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </div>
        </div>

        {expanded && (
        <>
        {/* The thesis — structure mirrors, risk does not */}
        <div className="mt-5 rounded-xl border border-danger/20 bg-surface-900/30 px-4 py-3">
          <p className="text-[12px] text-surface-400 leading-snug">
            The short side <span className="text-surface-200">mirrors the structure</span> of every framework above —
            inverted rails, distribution instead of accumulation, the same candle math upside-down. What it does
            <span className="text-danger font-semibold"> not</span> mirror is the risk: a long can lose 100%, a short
            has <span className="text-surface-200">no ceiling</span>, and the crowd forced to buy back is what powers
            squeezes. So every rule here is stricter than its long twin — half the size, harder stops, faster covers,
            and exactly <span className="text-surface-200">one</span> A+ setup: the parabolic short.
          </p>
        </div>

        {/* The mirror map — connective tissue back to the long panels */}
        <div className="mt-4">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            The mirror — same page, flipped
          </div>
          <div className="rounded-xl border border-surface-700/40 bg-surface-900/30 divide-y divide-surface-700/40">
            {SHORT_MIRROR.map((row, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-1 sm:gap-3 px-4 py-2">
                <span className="text-[11.5px] text-surface-400 leading-snug">
                  <span className="sm:hidden text-[9px] font-bold tracking-widest text-accent/70 uppercase mr-1.5">Long</span>
                  {row.long}
                </span>
                <span className="hidden sm:block text-surface-600 text-[11px] font-mono">↔</span>
                <span className="text-[11.5px] text-surface-200 leading-snug">
                  <span className="sm:hidden text-[9px] font-bold tracking-widest text-danger/70 uppercase mr-1.5">Short</span>
                  {row.short}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* THE SETUP — the parabolic short, in order */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">The setup — parabolic short</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-danger/10 text-danger border-danger/30">SEQUENCE</span>
          <span className="text-[11px] text-surface-500">front side → exhaustion → trigger — skip a step and it’s a donation, not a trade</span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
          {setup.map((t, i) => (
            <ShortCard key={t.key} t={t} step={i + 1} />
          ))}
        </div>

        {/* MANAGING IT — covers, the backside, the squeeze */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">Managing it</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-warning/10 text-warning border-warning/30">DISCIPLINE</span>
          <span className="text-[11px] text-surface-500">shorts are paid in days — cover into panic, re-load on the backside, never argue with a squeeze</span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
          {manage.map((t, i) => (
            <ShortCard key={t.key} t={t} step={i + 1} />
          ))}
        </div>

        {/* The arc ladder — where in the move is it? */}
        <div className="mt-5">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            Where in the arc is it? — the one-glance verdict
          </div>
          <div className="rounded-xl border border-surface-700/40 bg-surface-900/30 divide-y divide-surface-700/40">
            {SHORT_ARC_LADDER.map(row => {
              const tone = TONE[row.tone]
              return (
                <div key={row.key} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 px-4 py-2.5">
                  <span className="font-mono text-[12px] text-surface-200 sm:w-[290px] shrink-0">{row.label}</span>
                  <span className={`inline-flex self-start items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border shrink-0 ${tone.chip}`}>
                    {row.verdict}
                  </span>
                  <p className="text-[11.5px] text-surface-400 leading-snug">{row.note}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* The asymmetry — the short-side iron law */}
        <div className="mt-4 rounded-xl border border-danger/25 bg-danger/[0.06] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <svg className="w-4 h-4 mt-[1px] shrink-0 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-[12.5px] text-surface-200 leading-snug">
              <span className="font-semibold text-danger">Short-side iron law:</span> half the size of your longs, a hard
              stop above the highs on <span className="font-semibold">every</span> short, never average up, never hold a
              squeezing short overnight. Small caps halt and gap through stops — the position must be small enough that
              the worst gap is an annoyance, not an account event. The daily-close rule still applies to every signal;
              the stop is the one thing that fires intraday.
            </p>
          </div>
        </div>

        {/* Lineage */}
        <div className="mt-4 pt-3 border-t border-surface-700/40">
          <p className="text-[11px] text-surface-500 leading-snug">
            <span className="font-bold tracking-widest uppercase text-surface-400">Lineage</span>
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">Qullamaggie</span> — the parabolic short (his third A+ setup): 3–5 straight
            vertical days, first sign of exhaustion, short the crack, cover into flushes
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">Weinstein</span> — Stage 4: shorts only below a declining 30-week, the
            inverse of the stage gate above.
            {' '}Validate against your own trade log — shorting mistakes compound faster than long ones.
          </p>
        </div>
        </>
        )}
      </div>
    </section>
  )
}
