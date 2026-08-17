import { LIFECYCLE, EXPOSURE_LADDER } from '../utils/tradingRules'
import { Candle } from './MARailsVisuals'
import { VOL_COLORS } from './volumeCharts'
import { useDensity } from './framework/density'

// Trade Lifecycle — the management framework: entry day to resolution as a
// day-by-day protocol (day-0 discipline, the day-1–3 partial + breakeven, the
// day-3–5 time stop, adds at structure, the earnings gate, the gap exception),
// plus the progressive-exposure ladder that sizes the whole book off your own
// recent results. Data in utils/tradingRules.js; scenes drawn with the shared
// Candle primitive.

const TONE = {
  good: { text: 'text-accent', border: 'border-accent/40', bgSoft: 'bg-accent/[0.04]', bar: 'bg-accent', chip: 'bg-accent/10 text-accent border-accent/30', hex: '#10B981' },
  info: { text: 'text-cyan', border: 'border-cyan/40', bgSoft: 'bg-cyan/[0.04]', bar: 'bg-cyan', chip: 'bg-cyan/10 text-cyan border-cyan/30', hex: '#06B6D4' },
  warn: { text: 'text-warning', border: 'border-warning/40', bgSoft: 'bg-warning/[0.05]', bar: 'bg-warning', chip: 'bg-warning/10 text-warning border-warning/30', hex: '#F59E0B' },
  bad: { text: 'text-danger', border: 'border-danger/40', bgSoft: 'bg-danger/[0.05]', bar: 'bg-danger', chip: 'bg-danger/10 text-danger border-danger/30', hex: '#EF4444' },
}

const SIGNAL_LABEL = { confirm: 'CONFIRM', caution: 'CAUTION', context: 'CONTEXT' }

// Scene specs — viewBox 220×96. `rail` = sloped MA; `guides` = dashed levels
// (tone 'stop' renders red with a STOP tag; `label` renders any other tag);
// `vlines` = dashed vertical markers (the earnings date); `mark` = spotlight.
const SCENES = {
  // Tight base, the pivot guide, the breakout bar, the stop under its low.
  entry: {
    candles: [
      { x: 30, top: 34, bot: 39, hi: 31, lo: 42, up: true },
      { x: 55, top: 36, bot: 40, hi: 33, lo: 43, up: false },
      { x: 80, top: 34, bot: 38, hi: 31, lo: 41, up: true },
      { x: 105, top: 35, bot: 39, hi: 32, lo: 42, up: false },
      { x: 140, top: 14, bot: 36, hi: 10, lo: 40, up: true }, // the entry print
    ],
    vols: [0.3, 0.25, 0.3, 0.22, 1.0],
    hiVol: 4,
    guides: [
      { y: 31, x0: 20, x1: 205 },                     // the pivot
      { y: 40, x0: 120, x1: 205, tone: 'stop' },      // stop under the day-0 low
    ],
    mark: { x: 140, y: 22, r: 13 },
  },
  // Follow-through days; the partial into strength; breakeven line behind it.
  partial: {
    candles: [
      { x: 35, top: 40, bot: 52, hi: 36, lo: 55, up: true }, // day 0
      { x: 75, top: 28, bot: 38, hi: 24, lo: 41, up: true },
      { x: 115, top: 16, bot: 26, hi: 12, lo: 30, up: true }, // the strength to sell
      { x: 155, top: 18, bot: 22, hi: 14, lo: 25, up: false },
      { x: 190, top: 14, bot: 18, hi: 11, lo: 21, up: true },
    ],
    vols: [0.9, 0.6, 0.85, 0.3, 0.35],
    hiVol: 2,
    guides: [{ y: 40, x0: 25, x1: 205, label: 'BE' }], // stop moved to entry
    mark: { x: 115, y: 21, r: 12 },
  },
  // The breakout that never follows through — drift on dying volume.
  timestop: {
    candles: [
      { x: 35, top: 24, bot: 40, hi: 20, lo: 44, up: true }, // day 0
      { x: 70, top: 26, bot: 30, hi: 23, lo: 33, up: false },
      { x: 100, top: 28, bot: 31, hi: 25, lo: 34, up: false },
      { x: 130, top: 27, bot: 30, hi: 24, lo: 33, up: true },
      { x: 160, top: 29, bot: 32, hi: 26, lo: 35, up: false },
      { x: 190, top: 30, bot: 33, hi: 27, lo: 36, up: false },
    ],
    vols: [1.0, 0.35, 0.3, 0.28, 0.25, 0.22],
    hiVol: 0,
    guides: [{ y: 40, x0: 25, x1: 205 }], // the pivot it's sinking back toward
    mark: { x: 145, y: 30, r: 16 },
  },
  // The add at structure: first pullback onto the rising rail, turn, resume.
  add: {
    rail: { x0: 10, y0: 64, x1: 210, y1: 34, label: '10/20' },
    candles: [
      { x: 30, top: 38, bot: 46, hi: 34, lo: 49, up: true },
      { x: 70, top: 30, bot: 38, hi: 26, lo: 41, up: true },
      { x: 110, top: 36, bot: 42, hi: 33, lo: 50, up: false }, // eases onto the rail
      { x: 145, top: 30, bot: 36, hi: 27, lo: 44, up: true },  // the turn bar = the add
      { x: 185, top: 20, bot: 30, hi: 16, lo: 33, up: true },
    ],
    vols: [0.5, 0.55, 0.3, 0.45, 0.7],
    hiVol: 4,
    mark: { x: 145, y: 37, r: 12 },
  },
  // The scheduled reprice: the E-line, then the overnight air pocket.
  earnings: {
    candles: [
      { x: 30, top: 28, bot: 36, hi: 25, lo: 39, up: true },
      { x: 65, top: 24, bot: 32, hi: 21, lo: 35, up: true },
      { x: 100, top: 22, bot: 28, hi: 19, lo: 31, up: true },
      { x: 155, top: 52, bot: 66, hi: 48, lo: 69, up: false }, // the gap down
      { x: 190, top: 54, bot: 58, hi: 50, lo: 61, up: false },
    ],
    vols: [0.4, 0.45, 0.4, 1.0, 0.6],
    hiVol: 3,
    vlines: [{ x: 126, label: 'E' }],
    mark: { x: 155, y: 58, r: 13 },
  },
  // Opens through the stop — the one intraday exception to the close rule.
  gap: {
    candles: [
      { x: 30, top: 24, bot: 32, hi: 21, lo: 35, up: true },
      { x: 65, top: 22, bot: 30, hi: 19, lo: 33, up: true },
      { x: 100, top: 26, bot: 32, hi: 23, lo: 35, up: false },
      { x: 150, top: 54, bot: 64, hi: 50, lo: 67, up: false }, // opens far below the stop
      { x: 185, top: 56, bot: 60, hi: 52, lo: 63, up: false },
    ],
    vols: [0.4, 0.45, 0.5, 1.0, 0.5],
    hiVol: 3,
    guides: [{ y: 38, x0: 20, x1: 205, tone: 'stop' }],
    mark: { x: 150, y: 57, r: 12 },
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
            {spec.rail.label}
          </text>
        </g>
      )}
      {spec.vlines && spec.vlines.map((v, i) => (
        <g key={`vl${i}`}>
          <line x1={v.x} y1="6" x2={v.x} y2="84" stroke={VOL_COLORS.avg}
            strokeWidth="0.9" strokeDasharray="3 3" strokeOpacity="0.7" />
          <text x={v.x} y="94" fontSize="7" fontWeight="700" fill={VOL_COLORS.avg}
            textAnchor="middle" fontFamily="JetBrains Mono, monospace">{v.label}</text>
        </g>
      ))}
      {spec.guides && spec.guides.map((g, i) => {
        const stop = g.tone === 'stop'
        const color = stop ? TONE.bad.hex : VOL_COLORS.avg
        const tag = stop ? 'STOP' : g.label
        return (
          <g key={`g${i}`}>
            <line x1={g.x0} y1={g.y} x2={g.x1} y2={g.y} stroke={color}
              strokeWidth="0.9" strokeDasharray="3 3" strokeOpacity={stop ? 0.85 : 0.7} />
            {tag && (
              <text x={g.x0 + 2} y={g.y - 2.5} fontSize="6.5" fontWeight="700" fill={color}
                fontFamily="JetBrains Mono, monospace">{tag}</text>
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

function PhaseCard({ t, step }) {
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

export default function TradeLifecycle({ collapsible = false, collapsed = false, onToggle, id }) {
  const expanded = !collapsible || !collapsed
  const early = LIFECYCLE.filter(t => t.side === 'early')
  const campaign = LIFECYCLE.filter(t => t.side === 'campaign')

  return (
    <section
      id={id}
      aria-labelledby="trade-lifecycle-title"
      className="relative overflow-hidden rounded-3xl border border-cyan/25 bg-gradient-to-br from-surface-900 via-surface-900 to-surface-950 scroll-mt-[116px] lg:scroll-mt-[64px]"
    >
      <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-cyan via-warning to-accent opacity-70" />
      <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full bg-cyan/10 blur-3xl pointer-events-none" />

      <div className="relative px-6 sm:px-7 py-6 sm:py-7">
        {/* Title row — doubles as the collapse toggle when embedded on Rules */}
        <div
          {...(collapsible ? { role: 'button', tabIndex: 0, 'aria-expanded': expanded, onClick: onToggle, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.() } } } : {})}
          className={`flex items-start justify-between gap-3 flex-wrap mb-1 ${collapsible ? 'cursor-pointer select-none' : ''}`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan/10 border border-cyan/30 flex items-center justify-center text-cyan">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3M4 12a8 8 0 108-8M4 4v4h4" />
              </svg>
            </div>
            <div>
              <h2 id="trade-lifecycle-title" className="text-[16px] font-display font-bold text-surface-50 tracking-tight leading-tight">
                Trade Lifecycle
              </h2>
              <div className="text-[11px] text-surface-500 mt-0.5">
                Entry day to resolution — management as a pre-written protocol, not a mood.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-cyan/10 text-cyan border-cyan/30">
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
            Entries get all the study; <span className="text-surface-200">management is where the money is decided</span>.
            The panels above end at the fill — this one is everything after it, as a day-numbered protocol: what happens
            on day 0, what strength in the first three days is worth, when time itself is the stop, and the three
            campaign calls (adds, earnings, gaps) that decide whether a good entry becomes a good trade.
          </p>
        </div>

        {/* THE FIRST DAYS — they decide */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">The first days decide</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-cyan/10 text-cyan border-cyan/30">SEQUENCE</span>
          <span className="text-[11px] text-surface-500">day 0 → the day-1–3 partial → the day-3–5 time stop</span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
          {early.map((t, i) => (
            <PhaseCard key={t.key} t={t} step={i + 1} />
          ))}
        </div>

        {/* THE CAMPAIGN — adds, earnings, gaps */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">The campaign</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-warning/10 text-warning border-warning/30">DISCIPLINE</span>
          <span className="text-[11px] text-surface-500">adds at structure · the earnings gate · the one intraday exception</span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
          {campaign.map((t, i) => (
            <PhaseCard key={t.key} t={t} step={i + 1} />
          ))}
        </div>

        {/* Progressive exposure — sizing the whole book off recent results */}
        <div className="mt-5">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            Progressive exposure — your last 10 trades are the regime
          </div>
          <div className="rounded-xl border border-surface-700/40 bg-surface-900/30 divide-y divide-surface-700/40">
            {EXPOSURE_LADDER.map(row => {
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
          <p className="mt-2 text-[11.5px] text-surface-500 leading-snug px-1">
            Before pressing size, read your own tape: mostly working → press; mostly stopped → the market already told
            you. The gauge that never lags is your own fill history — the indices only confirm it later.
          </p>
        </div>

        {/* Iron law */}
        <div className="mt-4 rounded-xl border border-warning/25 bg-warning/[0.06] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <svg className="w-4 h-4 mt-[1px] shrink-0 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-[12.5px] text-surface-200 leading-snug">
              <span className="font-semibold text-warning">Iron law:</span> management is{' '}
              <span className="font-semibold">pre-decided</span> — the partial size, the breakeven trigger, the time-stop
              day, the add spots, and the earnings call are all written at entry (that’s what the Trade Plan gate is
              for), never negotiated live with P&amp;L on the screen. The gap rule is the single intraday exception;
              everything else waits for the close.
            </p>
          </div>
        </div>

        {/* Lineage */}
        <div className="mt-4 pt-3 border-t border-surface-700/40">
          <p className="text-[11px] text-surface-500 leading-snug">
            <span className="font-bold tracking-widest uppercase text-surface-400">Lineage</span>
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">Qullamaggie</span> — sell into strength days 1–3, time-based exits,
            free-rolled runners
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">Minervini</span> — progressive exposure, breakeven discipline
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">O’Neil</span> — earnings rules, follow-through as the verdict.
            {' '}Validate the day counts against your own trade log.
          </p>
        </div>
        </>
        )}
      </div>
    </section>
  )
}
