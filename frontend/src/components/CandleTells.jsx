import { CANDLE_TELLS } from '../utils/tradingRules'
import { Candle } from './MARailsVisuals'
import { VOL_COLORS } from './volumeCharts'

// Candle Tells — how the momentum lineage reads candles: supply/demand math
// (range × close location × volume), not named Japanese patterns. Data lives
// in utils/tradingRules.js (CANDLE_TELLS); the scene specs below are the
// presentation half — hand-placed candles + volume sticks per tell, drawn
// with the same Candle primitive as the MA Rails iron-law panels.

const TONE = {
  good: { text: 'text-accent', border: 'border-accent/40', bgSoft: 'bg-accent/[0.04]', bar: 'bg-accent', chip: 'bg-accent/10 text-accent border-accent/30', hex: '#10B981' },
  info: { text: 'text-cyan', border: 'border-cyan/40', bgSoft: 'bg-cyan/[0.04]', bar: 'bg-cyan', chip: 'bg-cyan/10 text-cyan border-cyan/30', hex: '#06B6D4' },
  warn: { text: 'text-warning', border: 'border-warning/40', bgSoft: 'bg-warning/[0.05]', bar: 'bg-warning', chip: 'bg-warning/10 text-warning border-warning/30', hex: '#F59E0B' },
  bad: { text: 'text-danger', border: 'border-danger/40', bgSoft: 'bg-danger/[0.05]', bar: 'bg-danger', chip: 'bg-danger/10 text-danger border-danger/30', hex: '#EF4444' },
}

const SIGNAL_LABEL = { confirm: 'CONFIRM', caution: 'CAUTION', context: 'CONTEXT' }

// Scene specs — viewBox 220×96. Candles occupy y 5–62; volume sticks (when
// present) rise from y=90; `mark` draws a dashed spotlight ring; `line`
// draws a support/rail level; `guide` a dashed horizontal reference.
const SCENES = {
  demand: {
    candles: [
      { x: 25, top: 46, bot: 54, hi: 42, lo: 58, up: true },
      { x: 65, top: 40, bot: 48, hi: 36, lo: 52, up: true },
      { x: 105, top: 34, bot: 42, hi: 30, lo: 46, up: true },
      { x: 145, top: 28, bot: 38, hi: 24, lo: 42, up: true },
      { x: 185, top: 8, bot: 32, hi: 5, lo: 36, up: true }, // the demand bar
    ],
    vols: [0.25, 0.3, 0.28, 0.33, 1.0],
    hiVol: 4,
    mark: { x: 185, y: 20, r: 15 },
  },
  inside: {
    candles: [
      { x: 35, top: 12, bot: 46, hi: 8, lo: 50, up: true }, // the thrust
      { x: 85, top: 16, bot: 24, hi: 13, lo: 27, up: true },
      { x: 130, top: 18, bot: 26, hi: 15, lo: 29, up: false },
      { x: 175, top: 16, bot: 23, hi: 13, lo: 26, up: true },
    ],
    vols: [1.0, 0.35, 0.25, 0.18],
    guide: { y: 12, x0: 35, x1: 205 }, // prior high the tights hold under
  },
  wick: {
    candles: [
      { x: 30, top: 44, bot: 52, hi: 40, lo: 56, up: true },
      { x: 70, top: 36, bot: 44, hi: 32, lo: 48, up: true },
      { x: 110, top: 28, bot: 36, hi: 24, lo: 40, up: true },
      { x: 165, top: 30, bot: 40, hi: 6, lo: 44, up: false }, // long topping tail
    ],
    vols: [0.3, 0.35, 0.4, 0.95],
    hiVol: 3,
    mark: { x: 165, y: 14, r: 12 },
  },
  reclaim: {
    line: { y: 40 }, // the rail / obvious level
    candles: [
      { x: 35, top: 26, bot: 34, hi: 22, lo: 38, up: true },
      { x: 80, top: 28, bot: 36, hi: 24, lo: 39, up: true },
      { x: 125, top: 26, bot: 36, hi: 22, lo: 58, up: true }, // flush + reclaim
      { x: 170, top: 18, bot: 28, hi: 14, lo: 32, up: true },
    ],
    vols: [0.3, 0.45, 0.85, 0.4],
    hiVol: 2,
    mark: { x: 125, y: 52, r: 11 },
  },
  churn: {
    candles: [
      { x: 30, top: 46, bot: 54, hi: 42, lo: 58, up: true },
      { x: 70, top: 36, bot: 44, hi: 32, lo: 48, up: true },
      { x: 110, top: 24, bot: 34, hi: 20, lo: 38, up: true },
      { x: 165, top: 17, bot: 20, hi: 10, lo: 28, up: false }, // huge effort, no result
    ],
    vols: [0.3, 0.4, 0.5, 1.0],
    hiVol: 3,
    mark: { x: 165, y: 18, r: 12 },
  },
  // Three up bars, then the last bar engulfs the prior day and closes below its low.
  outside: {
    candles: [
      { x: 30, top: 44, bot: 52, hi: 40, lo: 56, up: true },
      { x: 75, top: 34, bot: 42, hi: 30, lo: 46, up: true },
      { x: 120, top: 24, bot: 32, hi: 20, lo: 36, up: true },
      { x: 170, top: 16, bot: 44, hi: 10, lo: 48, up: false }, // engulfs the prior bar
    ],
    vols: [0.3, 0.35, 0.4, 1.0],
    hiVol: 3,
    mark: { x: 170, y: 30, r: 14 },
  },
  // Demand bar, then tight bars holding its top third (guide = top-third line).
  follow: {
    candles: [
      { x: 35, top: 14, bot: 52, hi: 10, lo: 56, up: true }, // the demand bar
      { x: 85, top: 16, bot: 23, hi: 12, lo: 26, up: true },
      { x: 130, top: 19, bot: 25, hi: 15, lo: 28, up: false },
      { x: 175, top: 14, bot: 21, hi: 11, lo: 24, up: true },
    ],
    vols: [1.0, 0.45, 0.3, 0.5],
    hiVol: 0,
    guide: { y: 27, x0: 35, x1: 205 }, // top third of the breakout bar
  },
  // Gap up (marked void), then bars building on the open instead of filling.
  gap: {
    candles: [
      { x: 30, top: 46, bot: 54, hi: 42, lo: 58, up: true },
      { x: 70, top: 42, bot: 50, hi: 38, lo: 54, up: true },
      { x: 125, top: 18, bot: 26, hi: 14, lo: 28, up: true }, // gap bar — holds its open
      { x: 170, top: 12, bot: 20, hi: 8, lo: 24, up: true },
    ],
    vols: [0.3, 0.35, 1.0, 0.5],
    hiVol: 2,
    guide: { y: 26, x0: 125, x1: 205 }, // the gap-day open it must hold
    mark: { x: 97, y: 33, r: 10 },      // the gap void itself
  },
  // Five dailies compress into one weekly bar with a topping tail.
  weekly: {
    candles: [
      { x: 22, top: 60, bot: 68, hi: 56, lo: 72, up: true, w: 8 },
      { x: 44, top: 52, bot: 60, hi: 48, lo: 64, up: true, w: 8 },
      { x: 66, top: 42, bot: 50, hi: 38, lo: 54, up: true, w: 8 },
      { x: 88, top: 48, bot: 58, hi: 42, lo: 62, up: false, w: 8 },
      { x: 110, top: 58, bot: 70, hi: 52, lo: 74, up: false, w: 8 },
      { x: 180, top: 66, bot: 71, hi: 38, lo: 74, up: false, w: 16 }, // the week
    ],
    dayLabels: [
      { x: 22, t: 'M' }, { x: 44, t: 'T' }, { x: 66, t: 'W' }, { x: 88, t: 'T' }, { x: 110, t: 'F' },
      { x: 180, t: 'WEEK' },
    ],
    arrow: { x0: 128, x1: 156, y: 52 },
  },
}

const VOL_BASE = 90
const VOL_MAX_H = 20

function Scene({ spec, toneHex, label }) {
  return (
    <svg viewBox="0 0 220 96" className="w-full h-auto block rounded-lg bg-surface-950/60" role="img" aria-label={label}>
      {spec.line && (
        <line x1="10" y1={spec.line.y} x2="210" y2={spec.line.y} stroke={VOL_COLORS.ma} strokeWidth="1.6" strokeOpacity="0.8" />
      )}
      {spec.guide && (
        <line x1={spec.guide.x0} y1={spec.guide.y} x2={spec.guide.x1} y2={spec.guide.y} stroke={VOL_COLORS.avg} strokeWidth="0.9" strokeDasharray="3 3" strokeOpacity="0.7" />
      )}
      {spec.candles.map((c, i) => (
        <Candle key={i} x={c.x} top={c.top} bot={c.bot} hi={c.hi} lo={c.lo} up={c.up} w={c.w ?? 11} />
      ))}
      {spec.vols && spec.vols.map((m, i) => {
        const c = spec.candles[i]
        const h = m * VOL_MAX_H
        const hi = spec.hiVol === i
        return (
          <rect
            key={`v${i}`}
            x={c.x - 5}
            y={VOL_BASE - h}
            width={10}
            height={h}
            rx="1"
            fill={hi ? toneHex : VOL_COLORS.muted}
            fillOpacity={hi ? 0.9 : 0.55}
          />
        )
      })}
      {spec.mark && (
        <circle cx={spec.mark.x} cy={spec.mark.y} r={spec.mark.r} fill="none" stroke={toneHex} strokeWidth="1.2" strokeDasharray="3 2.5" strokeOpacity="0.9" />
      )}
      {spec.dayLabels && spec.dayLabels.map((d, i) => (
        <text key={`d${i}`} x={d.x} y="88" fontSize="7.5" fontWeight="700" fill={VOL_COLORS.avg} textAnchor="middle" fontFamily="JetBrains Mono, monospace">
          {d.t}
        </text>
      ))}
      {spec.arrow && (
        <g stroke={VOL_COLORS.avg} strokeWidth="1.4" strokeLinecap="round">
          <line x1={spec.arrow.x0} y1={spec.arrow.y} x2={spec.arrow.x1} y2={spec.arrow.y} />
          <line x1={spec.arrow.x1 - 5} y1={spec.arrow.y - 4} x2={spec.arrow.x1} y2={spec.arrow.y} />
          <line x1={spec.arrow.x1 - 5} y1={spec.arrow.y + 4} x2={spec.arrow.x1} y2={spec.arrow.y} />
        </g>
      )}
    </svg>
  )
}

// "Reading one bar" — the vocabulary the tells are built from. One annotated
// candle (OHLC + body/wick anatomy) plus the four dimensions every tell below
// mixes: range, close location, body vs wicks, volume.
function AnatomyBar() {
  const L = { mono: 'JetBrains Mono, monospace' }
  return (
    <svg viewBox="0 0 190 112" className="w-full h-auto block rounded-lg bg-surface-950/60" role="img"
      aria-label="Anatomy of a candle: high, close, open, low; upper wick, body, lower wick">
      {/* the candle — a green (up) bar: open at bottom of body, close at top */}
      <line x1="92" y1="10" x2="92" y2="102" stroke={TONE.good.hex} strokeWidth="1.6" />
      <rect x="83" y="32" width="18" height="46" rx="1.5" fill="#0F1623" stroke={TONE.good.hex} strokeWidth="1.6" />
      {/* right side — OHLC leader lines */}
      {[
        { y: 10, t: 'HIGH' },
        { y: 32, t: 'CLOSE' },
        { y: 78, t: 'OPEN' },
        { y: 102, t: 'LOW' },
      ].map(m => (
        <g key={m.t}>
          <line x1="104" y1={m.y} x2="126" y2={m.y} stroke={VOL_COLORS.avg} strokeWidth="0.8" strokeDasharray="2 2" />
          <text x="130" y={m.y + 2.5} fontSize="7.5" fontWeight="700" fill={VOL_COLORS.avg} fontFamily={L.mono}>{m.t}</text>
        </g>
      ))}
      {/* left side — anatomy labels */}
      {[
        { y: 21, t: 'upper wick', s: 'the fight' },
        { y: 55, t: 'body', s: 'the verdict' },
        { y: 90, t: 'lower wick', s: 'the defense' },
      ].map(m => (
        <g key={m.t}>
          <text x="74" y={m.y} fontSize="7.5" fontWeight="700" fill="#CBD5E1" textAnchor="end" fontFamily={L.mono}>{m.t}</text>
          <text x="74" y={m.y + 9} fontSize="6.5" fill={VOL_COLORS.avg} textAnchor="end" fontFamily={L.mono}>{m.s}</text>
        </g>
      ))}
    </svg>
  )
}

const ANATOMY_DIMS = [
  { k: 'Range', t: 'High − low = conviction. Wide bars are statements; narrow bars are pauses.' },
  { k: 'Close location', t: 'Where in the range it closed = who won at the bell. Top quarter: buyers. Bottom quarter: sellers.' },
  { k: 'Body vs wicks', t: 'The body is what held; a wick is an excursion that got rejected. Long tails mark where the other side showed up.' },
  { k: 'Volume', t: 'How many voted. The identical bar on 3× average volume is a different — and far louder — bar.' },
]

function TellCard({ t }) {
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

export default function CandleTells({ collapsible = false, collapsed = false, onToggle, id }) {
  const expanded = !collapsible || !collapsed
  return (
    <section
      id={id}
      aria-labelledby="candle-tells-title"
      className="relative overflow-hidden rounded-3xl border border-warning/25 bg-gradient-to-br from-surface-900 via-surface-900 to-surface-950 scroll-mt-[116px] lg:scroll-mt-[64px]"
    >
      <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-warning via-accent to-cyan opacity-70" />
      <div className="absolute -top-16 -left-16 w-72 h-72 rounded-full bg-warning/10 blur-3xl pointer-events-none" />

      <div className="relative px-6 sm:px-7 py-6 sm:py-7">
        {/* Title row — doubles as the collapse toggle when embedded on Rules */}
        <div
          {...(collapsible ? { role: 'button', tabIndex: 0, 'aria-expanded': expanded, onClick: onToggle, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.() } } } : {})}
          className={`flex items-start justify-between gap-3 flex-wrap mb-1 ${collapsible ? 'cursor-pointer select-none' : ''}`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-warning/10 border border-warning/30 flex items-center justify-center text-warning">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 4v3m0 10v3m0-13h0a2 2 0 012 2v7a2 2 0 01-2 2h0a2 2 0 01-2-2V9a2 2 0 012-2zM16 2v4m0 12v4m0-16h0a2 2 0 012 2v8a2 2 0 01-2 2h0a2 2 0 01-2-2V8a2 2 0 012-2z" />
              </svg>
            </div>
            <div>
              <h2 id="candle-tells-title" className="text-[16px] font-display font-bold text-surface-50 tracking-tight leading-tight">
                Candle Tells
              </h2>
              <div className="text-[11px] text-surface-500 mt-0.5">
                Range × close × volume. The lineage doesn’t trade named patterns — a candle is supply/demand math.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-warning/10 text-warning border-warning/30">
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
        {/* Reading one bar — the vocabulary before the tells */}
        <div className="mt-5 rounded-2xl border border-surface-700/40 bg-surface-900/40 p-4 sm:p-5">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-3">
            Reading one bar — the four dimensions
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[210px_1fr] gap-4 items-center">
            <AnatomyBar />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ANATOMY_DIMS.map(d => (
                <div key={d.k} className="rounded-lg border border-surface-700/40 bg-surface-950/40 px-3 py-2">
                  <div className="text-[10px] font-bold tracking-widest text-surface-300 uppercase mb-0.5">{d.k}</div>
                  <p className="text-[11.5px] text-surface-400 leading-snug">{d.t}</p>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 text-[11.5px] text-surface-500 leading-snug">
            Every tell below is just these four dimensions in combination — no named patterns to memorize,
            only the question <span className="text-surface-300">“who was in control when the bar finished, and how many showed up?”</span>
          </p>
        </div>

        {/* Tell cards */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {CANDLE_TELLS.map(t => (
            <TellCard key={t.key} t={t} />
          ))}
        </div>

        {/* Ties back to the iron law */}
        <div className="mt-4 rounded-xl border border-warning/25 bg-warning/[0.06] px-4 py-3 flex items-start gap-2.5">
          <svg className="w-4 h-4 mt-[1px] shrink-0 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-[12.5px] text-surface-200 leading-snug">
            Every tell obeys the same iron law as the rails: <span className="font-semibold">nothing is true until the
            close prints</span> — 4:00 PM for a daily candle, Friday for a weekly one. Mid-bar shapes are rough drafts.
          </p>
        </div>
        </>
        )}
      </div>
    </section>
  )
}
