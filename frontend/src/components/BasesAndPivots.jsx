import { Link } from 'react-router-dom'
import { BASE_PATTERNS, BASE_QUALITY, BASE_COUNT_LADDER, POLE_FORK, SETUP_MATRIX } from '../utils/tradingRules'
import { Candle } from './MARailsVisuals'
import { VOL_COLORS } from './volumeCharts'
import { useDensity } from './framework/density'

// Bases & Pivots — the structure framework. Every other panel reads the
// *moment* (rails, volume, candles, their interaction); this one defines the
// *structure* the moment triggers out of: what a valid base looks like
// (VCP / flag / cup-with-handle), the quantified quality gate, base counting,
// and pivot quality. Data in utils/tradingRules.js; scenes drawn with the
// shared Candle primitive.

const TONE = {
  good: { text: 'text-accent', border: 'border-accent/40', bgSoft: 'bg-accent/[0.04]', bar: 'bg-accent', chip: 'bg-accent/10 text-accent border-accent/30', hex: '#10B981' },
  info: { text: 'text-cyan', border: 'border-cyan/40', bgSoft: 'bg-cyan/[0.04]', bar: 'bg-cyan', chip: 'bg-cyan/10 text-cyan border-cyan/30', hex: '#06B6D4' },
  warn: { text: 'text-warning', border: 'border-warning/40', bgSoft: 'bg-warning/[0.05]', bar: 'bg-warning', chip: 'bg-warning/10 text-warning border-warning/30', hex: '#F59E0B' },
  bad: { text: 'text-danger', border: 'border-danger/40', bgSoft: 'bg-danger/[0.05]', bar: 'bg-danger', chip: 'bg-danger/10 text-danger border-danger/30', hex: '#EF4444' },
  purple: { text: 'text-purple', border: 'border-purple/40', bgSoft: 'bg-purple/[0.04]', bar: 'bg-purple', chip: 'bg-purple/10 text-purple border-purple/30', hex: '#8B5CF6' },
}

const SIGNAL_LABEL = { confirm: 'CONFIRM', caution: 'CAUTION', context: 'CONTEXT' }

// Scene specs — viewBox 220×96 like the sibling panels. `guides` are dashed
// reference levels (the pivot); `mark` is the dashed spotlight ring.
const SCENES = {
  // Three contractions, each shallower, coiling into the pivot on drying volume.
  vcp: {
    candles: [
      { x: 18, top: 18, bot: 26, hi: 14, lo: 30, up: true, w: 9 },
      { x: 38, top: 30, bot: 44, hi: 26, lo: 48, up: false, w: 9 },  // pullback 1 — deep
      { x: 58, top: 24, bot: 36, hi: 20, lo: 40, up: true, w: 9 },
      { x: 78, top: 16, bot: 24, hi: 13, lo: 27, up: true, w: 9 },
      { x: 98, top: 26, bot: 34, hi: 22, lo: 38, up: false, w: 9 },  // pullback 2 — shallower
      { x: 122, top: 18, bot: 26, hi: 15, lo: 30, up: true, w: 9 },
      { x: 146, top: 22, bot: 26, hi: 19, lo: 29, up: false, w: 9 }, // pullback 3 — tiny
      { x: 168, top: 18, bot: 22, hi: 16, lo: 25, up: true, w: 9 },
      { x: 188, top: 16, bot: 20, hi: 14, lo: 22, up: true, w: 9 },  // the coil
    ],
    vols: [0.8, 0.9, 0.6, 0.55, 0.6, 0.4, 0.3, 0.2, 0.15],
    guides: [{ y: 13, x0: 14, x1: 205 }], // the pivot
    mark: { x: 180, y: 19, r: 13 },
  },
  // A vertical pole, then a tight flag holding its upper third on dry volume.
  htf: {
    candles: [
      { x: 25, top: 48, bot: 60, hi: 45, lo: 63, up: true, w: 10 },
      { x: 45, top: 32, bot: 46, hi: 29, lo: 49, up: true, w: 10 },
      { x: 65, top: 16, bot: 30, hi: 13, lo: 33, up: true, w: 10 },  // the pole
      { x: 90, top: 18, bot: 23, hi: 15, lo: 26, up: false, w: 10 },
      { x: 112, top: 20, bot: 24, hi: 17, lo: 27, up: false, w: 10 },
      { x: 134, top: 21, bot: 25, hi: 18, lo: 27, up: false, w: 10 },
      { x: 156, top: 19, bot: 23, hi: 16, lo: 26, up: true, w: 10 }, // the flag
    ],
    vols: [0.7, 0.85, 1.0, 0.35, 0.28, 0.22, 0.2],
    hiVol: 2,
    guides: [{ y: 13, x0: 65, x1: 205 }],
    mark: { x: 123, y: 22, r: 14 },
  },
  // The rounded turn, right rim, and the handle drifting down in the upper half.
  cup: {
    candles: [
      { x: 18, top: 14, bot: 20, hi: 11, lo: 23, up: false, w: 9 },  // left rim
      { x: 36, top: 24, bot: 32, hi: 21, lo: 35, up: false, w: 9 },
      { x: 54, top: 36, bot: 42, hi: 33, lo: 45, up: false, w: 9 },
      { x: 72, top: 44, bot: 48, hi: 41, lo: 51, up: false, w: 9 },  // the low
      { x: 90, top: 45, bot: 49, hi: 42, lo: 52, up: true, w: 9 },   // rounding
      { x: 108, top: 40, bot: 46, hi: 37, lo: 49, up: true, w: 9 },
      { x: 126, top: 30, bot: 38, hi: 27, lo: 41, up: true, w: 9 },
      { x: 144, top: 20, bot: 28, hi: 17, lo: 31, up: true, w: 9 },  // right rim
      { x: 164, top: 22, bot: 26, hi: 19, lo: 29, up: false, w: 9 }, // the handle
      { x: 182, top: 24, bot: 27, hi: 21, lo: 30, up: false, w: 9 },
    ],
    vols: [0.6, 0.5, 0.4, 0.3, 0.25, 0.35, 0.45, 0.55, 0.25, 0.2],
    guides: [{ y: 17, x0: 144, x1: 210 }], // handle high = the pivot
    mark: { x: 173, y: 25, r: 12 },
  },
}

const VOL_BASE = 90
const VOL_MAX_H = 20

function Scene({ spec, toneHex, label }) {
  return (
    <svg viewBox="0 0 220 96" className="w-full h-auto block rounded-lg bg-surface-950/60" role="img" aria-label={label}>
      {spec.guides && spec.guides.map((g, i) => (
        <line key={`g${i}`} x1={g.x0} y1={g.y} x2={g.x1} y2={g.y}
          stroke={VOL_COLORS.avg} strokeWidth="0.9" strokeDasharray="3 3" strokeOpacity="0.7" />
      ))}
      {spec.candles.map((c, i) => (
        <Candle key={i} x={c.x} top={c.top} bot={c.bot} hi={c.hi} lo={c.lo} up={c.up} w={c.w ?? 11} />
      ))}
      {spec.vols && spec.vols.map((m, i) => {
        const c = spec.candles[i]
        const h = m * VOL_MAX_H
        const hi = spec.hiVol === i
        return (
          <rect key={`v${i}`} x={c.x - 4} y={VOL_BASE - h} width={8} height={h} rx="1"
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

// One shared pole, then the fork. Drawn as paths rather than candles because
// the point is the SHAPE of the two resolutions, not any individual bar.
function ForkScene() {
  const GOOD = TONE.good.hex
  const BAD = TONE.bad.hex
  const MONO = 'JetBrains Mono, monospace'
  return (
    <svg viewBox="0 0 260 108" className="w-full h-auto block rounded-lg bg-surface-950/60" role="img"
      aria-label="One vertical pole forking into two outcomes: a tight quiet flag that breaks out, or a climax that rolls over.">
      {/* the shared pole */}
      <path d="M14 94 L92 26" stroke={VOL_COLORS.avg} strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <text x="16" y="86" fontSize="7.5" fontWeight="700" fill={VOL_COLORS.avg} fontFamily={MONO}>THE POLE</text>
      <circle cx="92" cy="26" r="3.2" fill="none" stroke={VOL_COLORS.avg} strokeWidth="1.4" />

      {/* branch A — tight flag, then break out (green) */}
      <path d="M92 26 L106 33 L118 30 L130 36 L142 33 L154 38" stroke={GOOD} strokeWidth="1.8" fill="none"
        strokeLinecap="round" strokeLinejoin="round" />
      <path d="M154 38 L196 12" stroke={GOOD} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M196 12 l-1 -7 l7 3" stroke={GOOD} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <text x="200" y="16" fontSize="7.5" fontWeight="700" fill={GOOD} fontFamily={MONO}>FLAG</text>
      <text x="200" y="25" fontSize="6.5" fill={GOOD} fillOpacity="0.75" fontFamily={MONO}>dry-up</text>

      {/* branch B — keeps accelerating, then rolls over (red) */}
      <path d="M92 26 L108 16 L120 9" stroke={BAD} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M120 9 C 138 8, 146 30, 158 48 C 168 63, 182 74, 196 82" stroke={BAD} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M196 82 l-7 0 l3 -6" stroke={BAD} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <text x="200" y="84" fontSize="7.5" fontWeight="700" fill={BAD} fontFamily={MONO}>CLIMAX</text>
      <text x="200" y="93" fontSize="6.5" fill={BAD} fillOpacity="0.75" fontFamily={MONO}>then cracks</text>
    </svg>
  )
}

function PatternCard({ t }) {
  const brief = useDensity() === 'brief'
  const tone = TONE[t.tone]
  return (
    <div className={`relative rounded-2xl border overflow-hidden ${tone.border} ${tone.bgSoft} flex flex-col`}>
      <div className={`absolute left-0 right-0 top-0 h-0.5 ${tone.bar} opacity-80`} />
      <div className="p-4 flex flex-col h-full">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className={`text-[14px] font-bold tracking-tight ${tone.text}`}>{t.title}</div>
            <div className="text-[11px] text-surface-500 mt-0.5">{t.tagline}</div>
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

export default function BasesAndPivots({ collapsible = false, collapsed = false, onToggle, id }) {
  const expanded = !collapsible || !collapsed

  return (
    <section
      id={id}
      aria-labelledby="bases-pivots-title"
      className="relative overflow-hidden rounded-3xl border border-accent/25 bg-gradient-to-br from-surface-900 via-surface-900 to-surface-950 scroll-mt-[116px] lg:scroll-mt-[64px]"
    >
      <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-accent via-cyan to-purple opacity-70" />
      <div className="absolute -top-16 -left-16 w-72 h-72 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

      <div className="relative px-6 sm:px-7 py-6 sm:py-7">
        {/* Title row — doubles as the collapse toggle when embedded on Rules */}
        <div
          {...(collapsible ? { role: 'button', tabIndex: 0, 'aria-expanded': expanded, onClick: onToggle, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.() } } } : {})}
          className={`flex items-start justify-between gap-3 flex-wrap mb-1 ${collapsible ? 'cursor-pointer select-none' : ''}`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center text-accent">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 18c2.5 0 2.5-2.5 2.5-5S9 8 11 8s2 2.5 2 5 0 5 2.5 5 2.5-2.5 2.5-5M20 6v12" />
              </svg>
            </div>
            <div>
              <h2 id="bases-pivots-title" className="text-[16px] font-display font-bold text-surface-50 tracking-tight leading-tight">
                Bases &amp; Pivots
              </h2>
              <div className="text-[11px] text-surface-500 mt-0.5">
                The structure behind every pivot — what a valid base looks like, and when it’s too late in the story.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-accent/10 text-accent border-accent/30">
              SWING
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
        {/* The thesis */}
        <div className="mt-5 rounded-xl border border-surface-700/40 bg-surface-900/30 px-4 py-3">
          <p className="text-[12px] text-surface-400 leading-snug">
            Every panel above reads the <span className="text-surface-200">moment</span> — the rail, the volume bar, the
            candle at the line. This one defines the <span className="text-surface-200">structure</span> those moments
            trigger out of. A pivot without a valid base is just a price poking a high: the base is where the float
            transfers from weak hands to strong ones, and the breakout borrows every bit of its meaning from that work.
          </p>
        </div>

        {/* The three structures */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">The three structures</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-accent/10 text-accent border-accent/30">PATTERNS</span>
          <span className="text-[11px] text-surface-500">one idea in three shapes: supply exhausting into a tight spot under the pivot</span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
          {BASE_PATTERNS.map(t => (
            <PatternCard key={t.key} t={t} />
          ))}
        </div>

        {/* The quality gate */}
        <div className="mt-5">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            The quality gate — is the base even valid?
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {BASE_QUALITY.map(m => {
              const tone = TONE[m.tone]
              return (
                <div key={m.key} className={`rounded-xl border ${tone.border} ${tone.bgSoft} px-3.5 py-3`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] font-bold tracking-widest text-surface-400 uppercase">{m.label}</span>
                    <span className={`font-mono font-bold text-[13px] ${tone.text}`}>{m.value}</span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-surface-400 leading-snug">{m.note}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Base count ladder */}
        <div className="mt-5">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            Base count — how far along is the story?
          </div>
          <div className="rounded-xl border border-surface-700/40 bg-surface-900/30 divide-y divide-surface-700/40">
            {BASE_COUNT_LADDER.map(row => {
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

        {/* Same pole, two outcomes — the HTF-vs-parabolic fork. The most common
            confusion on this page: they aren't inverses, they're two exits from
            the same doorway. Volume is the tell. */}
        <div className="mt-5">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase">Same pole, two outcomes</span>
            <span className="text-[11px] text-surface-500">the HTF and the parabolic short start identically</span>
          </div>

          <div className="rounded-2xl border border-surface-700/40 bg-surface-900/40 p-4">
            <ForkScene />
            <p className="mt-3 text-[12px] text-surface-400 leading-snug">
              A huge, fast advance is <span className="text-surface-200">not a directional signal</span> — the pole is
              common to both trades. What decides the direction is how it <span className="text-surface-200">resolves</span>,
              and volume is the cleanest tell: <span className="text-accent">dry-up = rest</span>,{' '}
              <span className="text-danger">climax = exhaustion</span> — the same pair the Volume panel teaches.
            </p>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {POLE_FORK.map(f => {
                const tone = TONE[f.tone]
                return (
                  <div key={f.key} className={`rounded-xl border ${tone.border} ${tone.bgSoft} px-4 py-3`}>
                    <div className="text-[9px] font-bold tracking-widest text-surface-500 uppercase">{f.label}</div>
                    <div className={`mt-0.5 text-[13.5px] font-bold tracking-tight ${tone.text}`}>{f.outcome}</div>
                    <p className="mt-2 text-[12px] text-surface-300 leading-snug">{f.what}</p>
                    <div className="mt-2 flex items-baseline gap-1.5">
                      <span className="text-[9px] font-bold tracking-widest text-surface-500 uppercase shrink-0">Volume</span>
                      <span className={`text-[12px] font-semibold ${tone.text}`}>{f.volume}</span>
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-surface-500 leading-snug italic">{f.means}</p>
                    <p className="mt-2 text-[12px] text-surface-200 leading-snug">{f.action}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* The four setups as one map — shows at a glance that the HTF's mirror
            is the bear flag, not the parabolic. */}
        <div className="mt-4">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase">The four setups, mapped</span>
            <span className="text-[11px] text-surface-500">trading with the move, or fading its exhaustion</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {SETUP_MATRIX.map(s => {
              const tone = TONE[s.tone]
              return (
                <Link
                  key={s.key}
                  to={s.to}
                  className={`block rounded-xl border ${tone.border} ${tone.bgSoft} px-4 py-3 hover:brightness-125 transition-all`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-surface-800/60 text-surface-400 border-surface-700 uppercase">
                      {s.axis}
                    </span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${tone.chip}`}>
                      {s.side}
                    </span>
                    <span className={`text-[13px] font-bold tracking-tight ${tone.text}`}>{s.name}</span>
                  </div>
                  <p className="mt-1.5 text-[11.5px] text-surface-400 leading-snug">{s.note}</p>
                </Link>
              )
            })}
          </div>
          <p className="mt-2 text-[11.5px] text-surface-500 leading-snug">
            Read across the rows: the HTF's mirror is the <span className="text-surface-300">bear flag</span> (Breakdown
            Short), not the parabolic. The parabolic's mirror is the{' '}
            <span className="text-surface-300">Reversal Setup</span> — both fade exhaustion, just at opposite ends.
          </p>
        </div>

        {/* Pivot quality — where the entry actually goes */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-surface-700/40 bg-surface-900/40 px-4 py-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-bold tracking-widest text-surface-200 uppercase">The standard pivot</span>
              <span className="text-[10px] font-mono text-surface-500">= the base / flag / handle high</span>
            </div>
            <p className="text-[12px] text-surface-400 leading-snug">
              Buy the break of the structure high — and the breakout bar must be the{' '}
              <span className="text-surface-200">demand bar</span> from the Candles panel: wide range, strong close,
              1.5–3× volume. Stop under the breakout-day low or the handle low. No volume, no trust — the pivot without
              the bar is a poke, not a break.
            </p>
          </div>
          <div className="rounded-xl border border-surface-700/40 bg-surface-900/40 px-4 py-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-bold tracking-widest text-surface-200 uppercase">The cheat</span>
              <span className="text-[10px] font-mono text-surface-500">= earlier, tighter, stricter</span>
            </div>
            <p className="text-[12px] text-surface-400 leading-snug">
              Entry inside the base at the break of the final contraction’s downtrend line — earlier fill, tighter stop,
              but reserved for <span className="text-surface-200">A+ structures only</span>. Cheat everything and you’ve
              just bought early everywhere. And past the pivot: more than 2–3% through it is a{' '}
              <span className="text-surface-200">chase</span> — wait for the first pullback setup instead.
            </p>
          </div>
        </div>

        {/* Iron law */}
        <div className="mt-4 rounded-xl border border-accent/25 bg-accent/[0.05] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <svg className="w-4 h-4 mt-[1px] shrink-0 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-[12.5px] text-surface-200 leading-snug">
              <span className="font-semibold text-accent">Structure before trigger:</span> no valid base, no trade — no
              matter how loud the breakout bar. And <span className="font-semibold">base count trumps pattern beauty</span>:
              the prettiest 4th-stage base is still a 4th-stage base.
            </p>
          </div>
        </div>

        {/* Lineage */}
        <div className="mt-4 pt-3 border-t border-surface-700/40">
          <p className="text-[11px] text-surface-500 leading-snug">
            <span className="font-bold tracking-widest uppercase text-surface-400">Lineage</span>
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">Minervini</span> — VCP, cheat entries, trend-template context
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">O’Neil</span> — cup-with-handle, the high-tight flag, base counting
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">Qullamaggie</span> — flags &amp; HTFs as the bread-and-butter swing setups.
            {' '}Thresholds are lineage conventions — validate against your own trade log.
          </p>
        </div>
        </>
        )}
      </div>
    </section>
  )
}
