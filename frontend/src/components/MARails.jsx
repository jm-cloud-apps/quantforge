import { useState } from 'react'
import { MA_RAILS, WEEKLY_RAILS, MA_CROSSOVERS, MA_MOMENTS, MA_ANATOMY_PHASES } from '../utils/tradingRules'
import { AnatomyChart, RailGlyph, StackedVsTangled, WickVsClose } from './MARailsVisuals'
import MARailsDrill from './MARailsDrill'

// Moving Average Rails — the 10/20/50 framework panel on the Rules page.
// Data lives in utils/tradingRules.js (MA_RAILS / MA_MOMENTS /
// MA_ANATOMY_PHASES) and the chart geometry in maRailsCharts.js; this file
// is pure presentation. Structure mirrors the CatalystHierarchy panel: a
// framework, not a one-line rule, because the *mapping* (which rail, which
// timeframe, at which workflow moment) is the whole insight.

// Tailwind needs literal class names, so tones are enumerated like
// CATEGORY_META in Rules.jsx rather than built from the color name. `hex`
// mirrors tailwind.config.js for the SVG glyphs; `touchLabel` names the
// rail-touch event drawn in each card's glyph.
const TONE = {
  ma10: {
    text: 'text-accent',
    bg: 'bg-accent/10',
    bgSoft: 'bg-accent/[0.04]',
    border: 'border-accent/40',
    chipBorder: 'border-accent/30',
    bar: 'bg-accent',
    hex: '#10B981',
    touchLabel: 'ADD',
  },
  ma20: {
    text: 'text-cyan',
    bg: 'bg-cyan/10',
    bgSoft: 'bg-cyan/[0.04]',
    border: 'border-cyan/40',
    chipBorder: 'border-cyan/30',
    bar: 'bg-cyan',
    hex: '#06B6D4',
    touchLabel: 'ADD',
  },
  ma50: {
    text: 'text-purple',
    bg: 'bg-purple/10',
    bgSoft: 'bg-purple/[0.04]',
    border: 'border-purple/40',
    chipBorder: 'border-purple/30',
    bar: 'bg-purple',
    hex: '#8B5CF6',
    touchLabel: 'BUY',
  },
  // Weekly rails — a distinct palette so the weekly row reads as its own
  // framework, not a recolor of the daily one. 10w echoes the daily 50 (purple)
  // because it's the same line one zoom out; the 30w stage gate gets amber to
  // stand out as the buy/no-buy decision line.
  wk10: {
    text: 'text-purple',
    bg: 'bg-purple/10',
    bgSoft: 'bg-purple/[0.04]',
    border: 'border-purple/40',
    chipBorder: 'border-purple/30',
    bar: 'bg-purple',
  },
  wk30: {
    text: 'text-warning',
    bg: 'bg-warning/10',
    bgSoft: 'bg-warning/[0.04]',
    border: 'border-warning/40',
    chipBorder: 'border-warning/30',
    bar: 'bg-warning',
  },
  wk40: {
    text: 'text-cyan',
    bg: 'bg-cyan/10',
    bgSoft: 'bg-cyan/[0.04]',
    border: 'border-cyan/40',
    chipBorder: 'border-cyan/30',
    bar: 'bg-cyan',
  },
}

// Crossover verdict tones — the one-word call on whether a cross changes the
// trade. Kept literal for Tailwind.
const VERDICT_TONE = {
  gate: 'bg-cyan/10 text-cyan border-cyan/30',
  confirm: 'bg-accent/10 text-accent border-accent/30',
  context: 'bg-warning/10 text-warning border-warning/30',
  backdrop: 'bg-surface-700/40 text-surface-300 border-surface-600',
}

// emphasis: null = no moment selected (all rails neutral),
// true = relevant to the selected moment, false = dimmed.
function RailCard({ rail, emphasis }) {
  const tone = TONE[rail.tone]
  const dimmed = emphasis === false
  return (
    <div
      className={`relative rounded-2xl border overflow-hidden transition-all duration-200 ${
        emphasis ? `${tone.border} ${tone.bgSoft}` : 'border-surface-700/40 bg-surface-900/40'
      } ${dimmed ? 'opacity-40' : ''}`}
    >
      <div className={`absolute left-0 right-0 top-0 h-0.5 ${tone.bar} ${dimmed ? 'opacity-30' : 'opacity-80'} transition-opacity`} />

      <div className="p-4 sm:p-5 flex flex-col h-full">
        {/* Rail identity */}
        <div className="flex items-baseline gap-2">
          <span className={`font-mono font-bold text-[30px] leading-none tabular-nums ${tone.text}`}>
            {rail.period}
          </span>
          <span className="text-[10px] font-bold tracking-widest text-surface-500">{rail.type}</span>
          <span className="flex-1" />
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${tone.bg} ${tone.text} ${tone.chipBorder}`}>
            DAILY
          </span>
        </div>
        <div className={`mt-1 text-[13.5px] font-semibold tracking-tight ${tone.text}`}>
          {rail.tagline}
        </div>

        {/* The pattern — hold above, add on the touch, exit on the close below */}
        <div className="mt-3">
          <RailGlyph railKey={rail.key} tone={tone.hex} touchLabel={tone.touchLabel} />
        </div>

        {/* Who rides it */}
        <div className="mt-3">
          <div className="text-[9px] font-bold tracking-widest text-surface-500 uppercase mb-1">Who rides it</div>
          <p className="text-[12px] text-surface-300 leading-snug">{rail.rider}</p>
        </div>

        {/* Daily role */}
        <ul className="mt-3 space-y-1.5">
          {rail.daily.map((line, i) => (
            <li key={i} className="flex gap-2 text-[12px] text-surface-300 leading-snug">
              <span className={`mt-[6px] w-1 h-1 rounded-full shrink-0 ${tone.bar}`} />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div className="flex-1" />

        {/* Break rule — the invalidation, visually loud on purpose */}
        <div className="mt-3.5 rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2">
          <div className="text-[9px] font-bold tracking-widest text-danger/80 uppercase mb-0.5">Break rule</div>
          <p className="text-[11.5px] text-surface-200 leading-snug">{rail.breakRule}</p>
        </div>

        {/* Weekly translation */}
        <div className="mt-2.5 flex gap-2 items-start">
          <span className="mt-px inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-surface-800/60 text-surface-400 border-surface-700 shrink-0">
            WEEKLY
          </span>
          <p className="text-[11px] text-surface-500 leading-snug italic">{rail.weeklyNote}</p>
        </div>
      </div>
    </div>
  )
}

// Weekly-rail card — the context companion to RailCard. No glyph (weekly rails
// aren't trailed bar by bar); the emphasis is the role, what a break means, and
// how the line maps back to daily execution. Mirror of RailCard with the
// DAILY/WEEKLY badges swapped and the break box in amber, not red — a weekly
// break reassesses, it doesn't hard-stop the trade.
function WeeklyRailCard({ rail }) {
  const tone = TONE[rail.tone]
  return (
    <div className="relative rounded-2xl border overflow-hidden border-surface-700/40 bg-surface-900/40">
      <div className={`absolute left-0 right-0 top-0 h-0.5 ${tone.bar} opacity-80`} />
      <div className="p-4 sm:p-5 flex flex-col h-full">
        {/* Rail identity */}
        <div className="flex items-baseline gap-2">
          <span className={`font-mono font-bold text-[30px] leading-none tabular-nums ${tone.text}`}>
            {rail.period}<span className="text-[15px] font-semibold">w</span>
          </span>
          <span className="text-[10px] font-bold tracking-widest text-surface-500">{rail.type}</span>
          <span className="flex-1" />
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${tone.bg} ${tone.text} ${tone.chipBorder}`}>
            WEEKLY
          </span>
        </div>
        <div className={`mt-1 text-[13.5px] font-semibold tracking-tight ${tone.text}`}>
          {rail.tagline}
        </div>

        {/* Who watches it */}
        <div className="mt-3">
          <div className="text-[9px] font-bold tracking-widest text-surface-500 uppercase mb-1">Who watches it</div>
          <p className="text-[12px] text-surface-300 leading-snug">{rail.rider}</p>
        </div>

        {/* Weekly role */}
        <ul className="mt-3 space-y-1.5">
          {rail.lines.map((line, i) => (
            <li key={i} className="flex gap-2 text-[12px] text-surface-300 leading-snug">
              <span className={`mt-[6px] w-1 h-1 rounded-full shrink-0 ${tone.bar}`} />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div className="flex-1" />

        {/* When it breaks — amber, not red: a weekly break reassesses, it doesn't hard-stop */}
        <div className="mt-3.5 rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2">
          <div className="text-[9px] font-bold tracking-widest text-warning/80 uppercase mb-0.5">When it breaks</div>
          <p className="text-[11.5px] text-surface-200 leading-snug">{rail.breakRule}</p>
        </div>

        {/* Daily translation — the inverse of the daily card's weekly note */}
        <div className="mt-2.5 flex gap-2 items-start">
          <span className="mt-px inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-surface-800/60 text-surface-400 border-surface-700 shrink-0">
            DAILY
          </span>
          <p className="text-[11px] text-surface-500 leading-snug italic">{rail.dailyNote}</p>
        </div>
      </div>
    </div>
  )
}

// One crossover event — the cross, what it means, and the one-word verdict on
// whether it changes the trade. The chip carries the call; the two lines are
// "what it is" then "what to do."
function CrossoverRow({ cross }) {
  return (
    <div className="rounded-xl border border-surface-700/40 bg-surface-900/40 px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono font-bold text-[13px] text-surface-100 tabular-nums">{cross.pair}</span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-surface-800/60 text-surface-400 border-surface-700">
          {cross.scope}
        </span>
        <span className="text-[12px] text-surface-400">· {cross.title}</span>
        <span className="flex-1" />
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${VERDICT_TONE[cross.tone]}`}>
          {cross.verdict.label}
        </span>
      </div>
      <p className="mt-1.5 text-[12px] text-surface-300 leading-snug">{cross.meaning}</p>
      <p className="mt-1 text-[11.5px] text-surface-400 leading-snug">{cross.verdict.text}</p>
    </div>
  )
}

export default function MARails({ collapsible = false, collapsed = false, onToggle, id }) {
  const [momentKey, setMomentKey] = useState(null)
  const moment = MA_MOMENTS.find(m => m.key === momentKey) || null
  // Phases of the anatomy chart owned by the selected moment — lights up the
  // matching numbered markers on the hero.
  const momentPhaseKeys = moment
    ? MA_ANATOMY_PHASES.filter(p => p.moments.includes(moment.key)).map(p => p.key)
    : null

  const expanded = !collapsible || !collapsed

  return (
    <section
      id={id}
      aria-labelledby="ma-rails-title"
      className="relative overflow-hidden rounded-3xl border border-cyan/25 bg-gradient-to-br from-surface-900 via-surface-900 to-surface-950 scroll-mt-[116px] lg:scroll-mt-[64px]"
    >
      {/* Decorative top accent — same visual language as the Catalyst panel */}
      <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-cyan via-accent to-purple opacity-70" />
      <div className="absolute -top-16 -left-16 w-72 h-72 rounded-full bg-cyan/10 blur-3xl pointer-events-none" />

      <div className="relative px-6 sm:px-7 py-6 sm:py-7">
        {/* Title row — doubles as the collapse toggle when embedded on Rules */}
        <div
          {...(collapsible ? { role: 'button', tabIndex: 0, 'aria-expanded': expanded, onClick: onToggle, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.() } } } : {})}
          className={`flex items-start justify-between gap-3 flex-wrap mb-1 ${collapsible ? 'cursor-pointer select-none' : ''}`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan/10 border border-cyan/30 flex items-center justify-center text-cyan">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 17c3-1 5-6 9-6s6 4 9 2M3 12c3-2 5-7 9-7s6 5 9 4" />
              </svg>
            </div>
            <div>
              <h2 id="ma-rails-title" className="text-[16px] font-display font-bold text-surface-50 tracking-tight leading-tight">
                Moving Average Rails
              </h2>
              <div className="text-[11px] text-surface-500 mt-0.5">
                10 / 20 / 50 — which line to trust, on which chart, at which moment.
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
        {/* The big picture — annotated lifecycle of one full trade */}
        <div className="mt-5">
          <AnatomyChart momentKeys={momentPhaseKeys} />
        </div>

        {/* Moment selector — "what am I doing right now?" */}
        <div className="mt-5">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            What am I doing right now?
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {MA_MOMENTS.map(m => {
              const active = momentKey === m.key
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMomentKey(active ? null : m.key)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                    active
                      ? 'bg-cyan/15 text-cyan border-cyan/40'
                      : 'bg-surface-900/60 text-surface-400 border-surface-700 hover:text-surface-200 hover:border-surface-600'
                  }`}
                >
                  {m.label}
                </button>
              )
            })}
            {moment && (
              <button
                type="button"
                onClick={() => setMomentKey(null)}
                className="text-[11px] text-surface-500 hover:text-surface-200 underline-offset-2 hover:underline px-1"
              >
                Clear
              </button>
            )}
          </div>

          {/* Moment checklist */}
          {moment && (
            <div className="mt-3 rounded-xl border border-cyan/20 bg-surface-900/60 px-4 py-3.5 animate-fade-in">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="text-[12.5px] font-semibold text-surface-100">{moment.label}</span>
                <span className="text-[11px] text-surface-500">· {moment.hint}</span>
                <span className="flex-1" />
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-cyan/10 text-cyan border-cyan/30">
                  {moment.timeframe.toUpperCase()}
                </span>
              </div>
              <ul className="space-y-1.5">
                {moment.checklist.map((line, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] text-surface-300 leading-snug">
                    <svg className="w-3.5 h-3.5 mt-[2px] shrink-0 text-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* The three daily rails — execution */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">Daily rails</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-accent/10 text-accent border-accent/30">EXECUTION</span>
          <span className="text-[11px] text-surface-500">entries · trails · exits — every acted-on signal</span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
          {MA_RAILS.map(rail => (
            <RailCard
              key={rail.key}
              rail={rail}
              emphasis={moment ? rail.moments.includes(moment.key) : null}
            />
          ))}
        </div>

        {/* The three weekly rails — context. Parallel row so the two timeframes
            read as separate frameworks: the daily executes, the weekly decides
            whether there's anything worth executing. */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">Weekly rails</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-purple/10 text-purple border-purple/30">CONTEXT</span>
          <span className="text-[11px] text-surface-500">trend · stage · regime — read on the weekend, never trailed</span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
          {WEEKLY_RAILS.map(rail => (
            <WeeklyRailCard key={rail.key} rail={rail} />
          ))}
        </div>

        {/* The first filter — stacked or skip */}
        <div className="mt-4">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            The two-second filter — stacked or skip
          </div>
          <StackedVsTangled />
        </div>

        {/* Crossovers — the alignment idea as events: what a cross means, and
            whether it actually changes the trade. */}
        <div className="mt-4">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            Crossovers — does the cross change the trade?
          </div>
          <div className="rounded-xl border border-surface-700/40 bg-surface-900/30 p-3">
            <p className="text-[11.5px] text-surface-400 leading-snug mb-3">
              A cross <span className="text-surface-200">confirms or gates — it never triggers</span>. The entry is
              always the pivot; the exit is always a daily close below the rail. A cross only tells you which way
              the odds tilted.
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
              {MA_CROSSOVERS.map(cross => (
                <CrossoverRow key={cross.key} cross={cross} />
              ))}
            </div>
          </div>
        </div>

        {/* Daily vs weekly — which chart answers which question */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-surface-700/40 bg-surface-900/40 px-4 py-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-bold tracking-widest text-surface-200 uppercase">Daily</span>
              <span className="text-[10px] font-mono text-surface-500">= execution · read after 4:00 PM</span>
            </div>
            <p className="text-[12px] text-surface-400 leading-snug">
              Entries, stops, rails, exits — every acted-on signal lives here. All three
              rails are judged on daily closes; an intraday touch of an MA is not a signal.
              The daily is also the only bar that finishes printing every session — when the
              daily and the half-formed weekly disagree mid-week, the daily is the one that’s real.
            </p>
          </div>
          <div className="rounded-xl border border-surface-700/40 bg-surface-900/40 px-4 py-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-bold tracking-widest text-surface-200 uppercase">Weekly</span>
              <span className="text-[10px] font-mono text-surface-500">= context · read on the weekend</span>
            </div>
            <p className="text-[12px] text-surface-400 leading-snug">
              Stage, structure, base quality — the chart that decides whether the daily is
              worth trading at all. Scan weekly first (stage-2 structure, tightening base,
              rising 10-week), then drop to the daily for the trigger. Mid-week the weekly
              bar isn’t done printing; never exit off it — the only weekly close is Friday’s,
              so weekly candles are judged on the weekend, full stop.
            </p>
          </div>
        </div>

        {/* Two zooms — the same lines translated across timeframes */}
        <div className="mt-3 rounded-xl border border-surface-700/40 bg-surface-900/40 px-4 py-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[10px] font-bold tracking-widest text-surface-200 uppercase shrink-0">Same lines, two zooms</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-mono font-semibold border bg-purple/10 text-purple border-purple/30">10W ≈ 50D</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-mono font-semibold border bg-surface-800/60 text-surface-300 border-surface-700">30W ≈ 150D</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-mono font-semibold border bg-surface-800/60 text-surface-300 border-surface-700">40W ≈ 200D</span>
          </div>
          <p className="mt-1.5 text-[12px] text-surface-400 leading-snug">
            The weekly MAs aren’t new lines — they’re the daily ones zoomed out (≈5 sessions per
            weekly bar). The weekend verdict is made against the 10-week; the exit that enforces it
            is a <span className="text-surface-200">daily close</span> below the 50. Same line, two jobs.
          </p>
          <p className="mt-1.5 text-[12px] text-surface-400 leading-snug">
            The <span className="text-purple font-semibold">10-week</span> is also the only weekly rail worth
            riding: true leaders surf it for months, and the <span className="text-surface-200">first weekly
            close below it after a long advance</span> is a character change — lighten the core hold. Swings are
            never trailed on weekly rails; a weekly line gives back a month of gains before it speaks.
          </p>
        </div>

        {/* EMA vs SMA — why each rail wears the flavor it does */}
        <div className="mt-3 rounded-xl border border-surface-700/40 bg-surface-900/40 px-4 py-3">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[10px] font-bold tracking-widest text-surface-200 uppercase">EMA vs SMA</span>
            <span className="text-[10px] font-mono text-surface-500">— does the flavor matter?</span>
          </div>
          <p className="text-[12px] text-surface-400 leading-snug">
            An EMA front-weights recent closes (a 10-EMA gives today ~18% of the line), so it hugs a
            fast move tighter; an SMA weighs every bar equally and turns slower. That’s why the trail
            rails are EMAs — <span className="text-accent font-semibold">10</span>/<span className="text-cyan font-semibold">20</span> need
            speed to ride a vertical leg — while the <span className="text-purple font-semibold">50</span> stays
            an SMA because it’s the convention funds and screeners watch: that line works partly
            <span className="text-surface-200"> because everyone is looking at the same one</span>.
          </p>
          <p className="mt-1.5 text-[12px] text-surface-400 leading-snug">
            Flexible? Yes. On a 10- or 20-day window the two flavors usually differ by less than a
            normal day’s range, so if you prefer SMAs, use SMAs — the edge is acting on the
            <span className="text-surface-200"> same line, same timeframe, every time</span>, not the
            averaging math. The only real mistake is switching flavors mid-trade because one of them
            lets you avoid a signal. Keep the 50 as SMA; pick one flavor for 10/20 and write it in the plan.
          </p>
        </div>

        {/* The longer lines — stage filters, not trade rails */}
        <div className="mt-3 rounded-xl border border-surface-700/40 bg-surface-900/40 px-4 py-3">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[10px] font-bold tracking-widest text-surface-200 uppercase">The 100 / 150 / 200</span>
            <span className="text-[10px] font-mono text-surface-500">— stage lines, not rails</span>
          </div>
          <p className="text-[12px] text-surface-400 leading-snug">
            The <span className="text-surface-200">150- and 200-day</span> (≈ the 30- and 40-week) are stage
            lines, not trade rails — Minervini’s trend template wants price above both, the 50 above the 150
            above the 200, and the 200 rising for at least a month. They decide whether a chart is even
            <span className="text-surface-200"> scannable</span>; they never manage a swing.
          </p>
          <p className="mt-1.5 text-[12px] text-surface-400 leading-snug">
            The <span className="text-surface-200">100-day</span> is deliberately absent from this system: it’s
            a hope line sitting between the real ones. If the 50 is lost and you’re waiting to “defend the 100,”
            the swing thesis already ended — whatever happens down there belongs to stage analysis, not trade
            management. Fewer lines, consistently obeyed, beat more lines rationalized.
          </p>
        </div>

        {/* The 200 — its own read: for this line slope and distance matter far
            more than a touch does, so it gets three reads rather than a touch rule. */}
        <div className="mt-3 rounded-xl border border-surface-700/40 bg-surface-900/40 px-4 py-3">
          <div className="flex items-center gap-2 mb-2.5 flex-wrap">
            <span className="text-[10px] font-bold tracking-widest text-surface-200 uppercase">The 200</span>
            <span className="text-[10px] font-mono text-surface-500">— slope &amp; extension, not a rail you trail</span>
            <span className="flex-1" />
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-warning/10 text-warning border-warning/30">GATE</span>
          </div>
          <p className="text-[12px] text-surface-400 leading-snug mb-3">
            A swing is never trailed on the 200 — by the time it speaks it has given back the whole move. Its
            three jobs are all read <span className="text-surface-200">before</span> the trade: is the regime long,
            am I already late, and is the trend being eaten. Always the <span className="text-surface-200">200-SMA</span>
            {' '}— the institutional line everyone watches; a 200-EMA is a line nobody trades against.
          </p>
          <ul className="space-y-2.5">
            <li className="flex gap-2.5">
              <span className="mt-px inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-surface-800/60 text-surface-300 border-surface-700 shrink-0">SLOPE</span>
              <p className="text-[12px] text-surface-400 leading-snug">
                Direction is the gate, not the cross. Price above a <span className="text-surface-200">falling</span> 200
                is a bounce in a downtrend; price above a <span className="text-surface-200">rising</span> 200 (up ≥ 1 month)
                is stage 2. The rising-200 requirement is the single biggest filter — it’s what makes a chart scannable at all.
              </p>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-px inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-surface-800/60 text-surface-300 border-surface-700 shrink-0">EXTENSION</span>
              <p className="text-[12px] text-surface-400 leading-snug">
                Distance from the 200 is the exhaustion gauge. Stretched to an extreme % above it (per-name, ~2× the
                stock’s normal range) means you’re <span className="text-surface-200">late</span> — a trim / no-chase read,
                not an entry. The long-timeframe cousin of the “reach that gets sold” candle tell.
              </p>
            </li>
            <li className="flex gap-2.5">
              <span className="mt-px inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-surface-800/60 text-surface-300 border-surface-700 shrink-0">REGIME</span>
              <p className="text-[12px] text-surface-400 leading-snug">
                The 200 is the underlying’s line in the sand. The <span className="text-surface-200">first</span> clean test
                of a rising 200 after a long advance is often a base-builder; <span className="text-surface-200">repeated</span>
                {' '}tests in a few weeks mean the trend is being eaten — the same “third tag” logic the 10/20 use, one zoom out.
              </p>
            </li>
          </ul>
        </div>

        {/* Anchored VWAP — the one "line to trust" that isn't a moving average.
            Sits at the end of the rail family because it does the same job (a
            dynamic support/resistance line) from a different input: volume-
            weighted price from a chosen bar, i.e. the crowd's cost basis. */}
        <div className="mt-3 rounded-xl border border-cyan/25 bg-surface-900/40 px-4 py-3">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[10px] font-bold tracking-widest text-surface-200 uppercase">Anchored VWAP</span>
            <span className="text-[10px] font-mono text-surface-500">— the cost-basis rail</span>
            <span className="flex-1" />
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-cyan/10 text-cyan border-cyan/30">NOT AN MA</span>
          </div>
          <p className="text-[12px] text-surface-400 leading-snug">
            An MA averages <span className="text-surface-200">price over time</span>; an anchored VWAP averages
            <span className="text-surface-200"> price weighted by volume</span> from a bar you pick — so it reads as the
            actual <span className="text-surface-200">cost basis of everyone who bought since that event</span>. Anchor it to
            the moment that reset the stock: the breakout day, the earnings gap, the 52-week high, or a major pivot low.
          </p>
          <p className="mt-1.5 text-[12px] text-surface-400 leading-snug">
            Above the anchor, the average buyer since the event is in profit — supporters, not sellers — so pullbacks to the
            line get bought; a <span className="text-surface-200">reclaim of the earnings-gap VWAP</span> is a classic EP
            re-entry. Lose it on a daily close and the crowd from that event is now underwater and trapped overhead. Same job
            as a rail — <span className="text-surface-200">where, and whether to believe the hold</span> — read on the daily
            close like every other line here. It complements the 10/20/50, it doesn’t replace them: use it to grade a rail
            touch, not as a second trail to rationalize into.
          </p>
        </div>

        {/* Iron law */}
        <div className="mt-4 rounded-xl border border-warning/25 bg-warning/[0.06] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <svg className="w-4 h-4 mt-[1px] shrink-0 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-[12.5px] text-surface-200 leading-snug">
              <span className="font-semibold text-warning">Iron law:</span> every rule on this panel
              fires on the <span className="font-semibold">daily close</span>. A wick through a rail
              during the session means nothing until 4:00 PM prints — acting on the wick is how a
              planned trade turns into a Random one.
            </p>
          </div>
          <WickVsClose />
        </div>

        {/* Rail reps — the framework only ingrains through retrieval, so the
            panel ends by making you use it. */}
        <div className="mt-4">
          <MARailsDrill />
        </div>

        {/* Lineage — where these rules come from, and their standing */}
        <div className="mt-4 pt-3 border-t border-surface-700/40">
          <p className="text-[11px] text-surface-500 leading-snug">
            <span className="font-bold tracking-widest uppercase text-surface-400">Lineage</span>
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">Qullamaggie</span> — 10/20 EMA trail, breakout &amp; EP playbook
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">O’Neil / CANSLIM</span> — the 50-day, volume dry-up &amp; climax
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">Minervini</span> — trend template (50 &gt; 150 &gt; 200)
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">Weinstein</span> — weekly stage analysis, 10/30-week.
            {' '}Conventions from their published playbooks — validate the numbers against your own trade log.
          </p>
        </div>
        </>
        )}
      </div>
    </section>
  )
}
