import { RAIL_CANDLES, RAIL_TOUCH_LADDER } from '../utils/tradingRules'
import { Candle } from './MARailsVisuals'
import { VOL_COLORS } from './volumeCharts'

// Candles at the Rails — the interaction layer between the MA Rails and
// Candle Tells frameworks: the rail says WHERE to look, the candle says WHEN
// to act. Data lives in utils/tradingRules.js (RAIL_CANDLES /
// RAIL_TOUCH_LADDER); the scene specs below are the presentation half —
// hand-placed candles around a sloped rail, drawn with the same Candle
// primitive as the sibling panels.

const TONE = {
  good: { text: 'text-accent', border: 'border-accent/40', bgSoft: 'bg-accent/[0.04]', bar: 'bg-accent', chip: 'bg-accent/10 text-accent border-accent/30', hex: '#10B981' },
  info: { text: 'text-cyan', border: 'border-cyan/40', bgSoft: 'bg-cyan/[0.04]', bar: 'bg-cyan', chip: 'bg-cyan/10 text-cyan border-cyan/30', hex: '#06B6D4' },
  warn: { text: 'text-warning', border: 'border-warning/40', bgSoft: 'bg-warning/[0.05]', bar: 'bg-warning', chip: 'bg-warning/10 text-warning border-warning/30', hex: '#F59E0B' },
  bad: { text: 'text-danger', border: 'border-danger/40', bgSoft: 'bg-danger/[0.05]', bar: 'bg-danger', chip: 'bg-danger/10 text-danger border-danger/30', hex: '#EF4444' },
}

const SIGNAL_LABEL = { confirm: 'CONFIRM', caution: 'CAUTION', context: 'CONTEXT' }

// Scene specs — viewBox 220×96, same stage as the Candle Tells scenes but with
// a *sloped* rail (a rising 10/20) instead of a flat level. Candles occupy
// y 5–66; volume sticks rise from y=90; `mark` is the dashed spotlight;
// `guide` a dashed horizontal reference (e.g. the turn-bar high).
const SCENES = {
  // Shrinking red bodies drifting down onto the rising rail, volume dying.
  approach: {
    rail: { x0: 10, y0: 72, x1: 210, y1: 44 },
    candles: [
      { x: 35, top: 16, bot: 28, hi: 12, lo: 31, up: false },
      { x: 80, top: 26, bot: 35, hi: 22, lo: 38, up: false },
      { x: 125, top: 36, bot: 42, hi: 32, lo: 45, up: false },
      { x: 170, top: 44, bot: 48, hi: 41, lo: 51, up: false },
    ],
    vols: [0.7, 0.5, 0.35, 0.2],
  },
  // The tag: lower wick into the rail, close in the upper half.
  turn: {
    rail: { x0: 10, y0: 70, x1: 210, y1: 42 },
    candles: [
      { x: 30, top: 24, bot: 33, hi: 20, lo: 36, up: false },
      { x: 75, top: 34, bot: 41, hi: 30, lo: 44, up: false },
      { x: 120, top: 42, bot: 47, hi: 38, lo: 50, up: false },
      { x: 165, top: 38, bot: 44, hi: 35, lo: 58, up: true }, // the turn bar
    ],
    vols: [0.5, 0.4, 0.3, 0.55],
    hiVol: 3,
    mark: { x: 165, y: 52, r: 10 },
  },
  // Green bar breaking the turn-bar high (guide), back above the rail.
  trigger: {
    rail: { x0: 10, y0: 68, x1: 210, y1: 40 },
    candles: [
      { x: 30, top: 32, bot: 39, hi: 28, lo: 42, up: false },
      { x: 72, top: 40, bot: 45, hi: 36, lo: 48, up: false },
      { x: 115, top: 40, bot: 46, hi: 37, lo: 58, up: true }, // turn bar
      { x: 165, top: 22, bot: 36, hi: 18, lo: 39, up: true }, // the trigger
    ],
    vols: [0.4, 0.3, 0.45, 0.85],
    hiVol: 3,
    guide: { y: 37, x0: 115, x1: 205 }, // the turn-bar high
    mark: { x: 165, y: 28, r: 11 },
  },
  // Bars accelerating away from the rail — the reach that gets sold.
  stretch: {
    rail: { x0: 10, y0: 80, x1: 210, y1: 62 },
    candles: [
      { x: 30, top: 56, bot: 63, hi: 52, lo: 66, up: true },
      { x: 75, top: 44, bot: 54, hi: 40, lo: 57, up: true },
      { x: 120, top: 28, bot: 42, hi: 24, lo: 45, up: true },
      { x: 170, top: 8, bot: 26, hi: 5, lo: 30, up: true }, // the vertical reach
    ],
    vols: [0.35, 0.45, 0.6, 0.95],
    hiVol: 3,
    mark: { x: 170, y: 14, r: 12 },
  },
  // The flush through the rail that closes back above it.
  shakeout: {
    rail: { x0: 10, y0: 58, x1: 210, y1: 38 },
    candles: [
      { x: 35, top: 40, bot: 47, hi: 36, lo: 50, up: true },
      { x: 80, top: 34, bot: 41, hi: 30, lo: 45, up: true },
      { x: 125, top: 28, bot: 36, hi: 24, lo: 60, up: true }, // flush + reclaim
      { x: 170, top: 20, bot: 28, hi: 16, lo: 32, up: true },
    ],
    vols: [0.35, 0.4, 0.9, 0.45],
    hiVol: 2,
    mark: { x: 125, y: 52, r: 11 },
  },
  // A full body closing decisively below the rail on the heaviest volume.
  exitbody: {
    rail: { x0: 10, y0: 52, x1: 210, y1: 42 },
    candles: [
      { x: 35, top: 30, bot: 37, hi: 26, lo: 40, up: true },
      { x: 80, top: 32, bot: 39, hi: 28, lo: 43, up: false },
      { x: 125, top: 36, bot: 43, hi: 32, lo: 46, up: false },
      { x: 170, top: 48, bot: 66, hi: 40, lo: 70, up: false }, // the exit body
    ],
    vols: [0.4, 0.45, 0.5, 1.0],
    hiVol: 3,
    mark: { x: 170, y: 56, r: 13 },
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
          <text x={spec.rail.x1 - 2} y={spec.rail.y1 - 4} fontSize="7" fontWeight="700"
            fill={VOL_COLORS.ma} textAnchor="end" fontFamily="JetBrains Mono, monospace">
            10/20
          </text>
        </g>
      )}
      {spec.guide && (
        <line x1={spec.guide.x0} y1={spec.guide.y} x2={spec.guide.x1} y2={spec.guide.y}
          stroke={VOL_COLORS.avg} strokeWidth="0.9" strokeDasharray="3 3" strokeOpacity="0.7" />
      )}
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

// One scenario card — same layout as a Candle Tell card plus the step number
// that makes each side read as a sequence, not a grab bag.
function RailCandleCard({ t, step }) {
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

        <div className="mt-3">
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
        </div>

        <div className="flex-1" />

        <div className={`mt-3 rounded-lg border ${tone.border} ${tone.bgSoft} px-3 py-2`}>
          <div className={`text-[9px] font-bold tracking-widest uppercase mb-0.5 ${tone.text}`}>The rule</div>
          <p className="text-[11.5px] text-surface-200 leading-snug">{t.rule}</p>
        </div>
      </div>
    </div>
  )
}

export default function CandlesAtRails({ collapsible = false, collapsed = false, onToggle, id }) {
  const expanded = !collapsible || !collapsed
  const buySide = RAIL_CANDLES.filter(t => t.side === 'buy')
  const sellSide = RAIL_CANDLES.filter(t => t.side === 'sell')

  return (
    <section
      id={id}
      aria-labelledby="candles-at-rails-title"
      className="relative overflow-hidden rounded-3xl border border-purple/25 bg-gradient-to-br from-surface-900 via-surface-900 to-surface-950 scroll-mt-[116px] lg:scroll-mt-[64px]"
    >
      <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-purple via-warning to-accent opacity-70" />
      <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full bg-purple/10 blur-3xl pointer-events-none" />

      <div className="relative px-6 sm:px-7 py-6 sm:py-7">
        {/* Title row — doubles as the collapse toggle when embedded on Rules */}
        <div
          {...(collapsible ? { role: 'button', tabIndex: 0, 'aria-expanded': expanded, onClick: onToggle, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.() } } } : {})}
          className={`flex items-start justify-between gap-3 flex-wrap mb-1 ${collapsible ? 'cursor-pointer select-none' : ''}`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple/10 border border-purple/30 flex items-center justify-center text-purple">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16c3-1 5-4 9-4s6 3 9 1M8 6v3m0 8v2m0-10h0a2 2 0 012 2v3a2 2 0 01-2 2h0a2 2 0 01-2-2v-3a2 2 0 012-2zM16 3v3m0 7v3m0-10h0a2 2 0 012 2v4a2 2 0 01-2 2h0a2 2 0 01-2-2V8a2 2 0 012-2z" />
              </svg>
            </div>
            <div>
              <h2 id="candles-at-rails-title" className="text-[16px] font-display font-bold text-surface-50 tracking-tight leading-tight">
                Candles at the Rails
              </h2>
              <div className="text-[11px] text-surface-500 mt-0.5">
                The rail says <span className="text-surface-300">where</span> — the candle says <span className="text-surface-300">when</span>. How rail buys and rail exits actually print.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-purple/10 text-purple border-purple/30">
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
        {/* The thesis — why this panel exists between the other two */}
        <div className="mt-5 rounded-xl border border-surface-700/40 bg-surface-900/30 px-4 py-3">
          <p className="text-[12px] text-surface-400 leading-snug">
            An MA touch is <span className="text-surface-200">a location, not a signal</span> — thousands of touches
            fail every week. What separates the buyable tag from the breakdown is the candle that prints at the line:
            its range, where it closed, and on how much volume. This panel is that translation — the rails framework
            and the candle framework meeting at the exact spot where money changes hands.
          </p>
        </div>

        {/* BUY SIDE — anatomy of the pullback buy */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">Buying at the rail</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-accent/10 text-accent border-accent/30">SEQUENCE</span>
          <span className="text-[11px] text-surface-500">approach → turn bar → trigger — skip a step and it’s a guess, not a setup</span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
          {buySide.map((t, i) => (
            <RailCandleCard key={t.key} t={t} step={i + 1} />
          ))}
        </div>

        {/* SELL SIDE — selling around the rail */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">Selling around the rail</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-warning/10 text-warning border-warning/30">DISCIPLINE</span>
          <span className="text-[11px] text-surface-500">strength gets sold above the rail — weakness gets confirmed below it</span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
          {sellSide.map((t, i) => (
            <RailCandleCard key={t.key} t={t} step={i + 1} />
          ))}
        </div>

        {/* The verdict ladder — reading the 4:00 PM close on any rail touch */}
        <div className="mt-5">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            The 4:00 PM verdict — same touch, three different calls
          </div>
          <div className="rounded-xl border border-surface-700/40 bg-surface-900/30 divide-y divide-surface-700/40">
            {RAIL_TOUCH_LADDER.map(row => {
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

        {/* Touch math + the iron law tie-in */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-surface-700/40 bg-surface-900/40 px-4 py-3">
            <div className="text-[10px] font-bold tracking-widest text-surface-200 uppercase mb-1">Touch math</div>
            <p className="text-[12px] text-surface-400 leading-snug">
              The <span className="text-surface-200">first tag</span> of a rising rail after a fresh leg is the
              one you buy — demand is intact and every dip-buyer is watching the same line. By the
              <span className="text-surface-200"> third test in a few weeks</span>, the rail is being eaten:
              each retest consumes the demand sitting there. Frequency of touches weakens the line, not strengthens it.
            </p>
          </div>
          <div className="rounded-xl border border-warning/25 bg-warning/[0.06] px-4 py-3">
            <div className="flex items-start gap-2.5">
              <svg className="w-4 h-4 mt-[1px] shrink-0 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-[12.5px] text-surface-200 leading-snug">
                <span className="font-semibold text-warning">Same iron law:</span> every verdict on this panel is a
                <span className="font-semibold"> daily close</span>. The turn bar, the shakeout, the exit body —
                none of them exist until 4:00 PM prints. Mid-session, a rail touch is a rough draft.
              </p>
            </div>
          </div>
        </div>
        </>
        )}
      </div>
    </section>
  )
}
