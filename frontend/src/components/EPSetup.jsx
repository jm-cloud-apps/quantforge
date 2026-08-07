import { memo } from 'react'
import { Link } from 'react-router-dom'
import {
  EP_PRIOR_CHART,
  EP_CHART_GATE,
  EP_GAP_GATE,
  EP_NUMBERS,
  EP_NON_EARNINGS,
  EP_NUMBERS_LADDER,
  EP_DISQUALIFIERS,
} from '../utils/tradingRules'
import PanelShell from './framework/PanelShell'
import FrameworkCard from './framework/FrameworkCard'
import VerdictLadder from './framework/VerdictLadder'
import { TONE } from './framework/tones'

// The EP Setup — the panel that sits *before* the Catalyst Hierarchy in the
// reading order: that one ranks the WHY, this one answers the two questions
// that decide whether a given gap is worth risk. What did the chart look like
// the day before the news, and do the numbers behind the headline actually
// move the forward model? Data in utils/tradingRules.js; the scenes below are
// the presentation half, drawn by the shared framework kit.

// Scene specs — viewBox 220×96, same stage as the sibling panels. Every scene
// is the same story told six ways: the last candle is the gap, and what came
// before it is the whole argument.
const SCENES = {
  // Months of narrow, dull bars, then the gap clears the range high entirely.
  forgotten: {
    candles: [
      { x: 16, top: 42, bot: 47, hi: 39, lo: 50, up: false, w: 8 },
      { x: 36, top: 43, bot: 47, hi: 40, lo: 51, up: true, w: 8 },
      { x: 56, top: 41, bot: 45, hi: 38, lo: 49, up: false, w: 8 },
      { x: 76, top: 43, bot: 46, hi: 40, lo: 50, up: true, w: 8 },
      { x: 96, top: 42, bot: 46, hi: 39, lo: 49, up: false, w: 8 },
      { x: 116, top: 41, bot: 45, hi: 39, lo: 48, up: true, w: 8 },
      { x: 136, top: 42, bot: 46, hi: 40, lo: 49, up: false, w: 8 },
      { x: 156, top: 41, bot: 44, hi: 39, lo: 47, up: true, w: 8 },
      { x: 190, top: 10, bot: 30, hi: 7, lo: 33, up: true, w: 12 }, // the gap
    ],
    vols: [0.2, 0.18, 0.22, 0.15, 0.2, 0.16, 0.14, 0.18, 1.0],
    hiVol: 8,
    volW: 8,
    guides: [{ y: 37, x0: 12, x1: 205, label: 'RANGE HI' }],
    mark: { x: 190, y: 20, r: 13 },
  },
  // Long decline that goes flat under a flattening 200; the gap crosses it.
  bottoming: {
    rail: { x0: 10, y0: 26, x1: 210, y1: 42, label: '200' },
    candles: [
      { x: 18, top: 30, bot: 38, hi: 27, lo: 41, up: false, w: 8 },
      { x: 38, top: 40, bot: 50, hi: 37, lo: 53, up: false, w: 8 },
      { x: 58, top: 52, bot: 60, hi: 49, lo: 63, up: false, w: 8 },
      { x: 78, top: 56, bot: 61, hi: 53, lo: 64, up: true, w: 8 },
      { x: 98, top: 56, bot: 60, hi: 53, lo: 63, up: false, w: 8 },
      { x: 118, top: 55, bot: 59, hi: 52, lo: 62, up: true, w: 8 },
      { x: 138, top: 55, bot: 60, hi: 52, lo: 63, up: false, w: 8 },
      { x: 158, top: 54, bot: 58, hi: 51, lo: 61, up: true, w: 8 },
      { x: 190, top: 20, bot: 40, hi: 16, lo: 43, up: true, w: 12 }, // crosses the 200
    ],
    vols: [0.5, 0.45, 0.4, 0.25, 0.2, 0.18, 0.15, 0.17, 1.0],
    hiVol: 8,
    volW: 8,
    mark: { x: 190, y: 30, r: 13 },
  },
  // Tight coil under the 52-week high, then the gap into empty chart.
  bluesky: {
    candles: [
      { x: 20, top: 46, bot: 54, hi: 43, lo: 57, up: true, w: 8 },
      { x: 42, top: 38, bot: 47, hi: 35, lo: 50, up: true, w: 8 },
      { x: 64, top: 34, bot: 40, hi: 31, lo: 44, up: false, w: 8 },
      { x: 86, top: 33, bot: 38, hi: 30, lo: 41, up: true, w: 8 },
      { x: 108, top: 32, bot: 36, hi: 30, lo: 39, up: false, w: 8 },
      { x: 130, top: 32, bot: 35, hi: 30, lo: 38, up: true, w: 8 },
      { x: 152, top: 31, bot: 34, hi: 29, lo: 37, up: false, w: 8 },
      { x: 188, top: 8, bot: 24, hi: 5, lo: 27, up: true, w: 12 },
    ],
    vols: [0.4, 0.35, 0.3, 0.22, 0.18, 0.15, 0.13, 1.0],
    hiVol: 7,
    volW: 8,
    guides: [{ y: 28, x0: 14, x1: 205, label: '52W HI' }],
    mark: { x: 188, y: 16, r: 12 },
  },
  // Rising rail, a shallow two-week pullback into it, then the continuation gap.
  trend: {
    rail: { x0: 10, y0: 70, x1: 210, y1: 34, label: '20/50' },
    candles: [
      { x: 25, top: 56, bot: 64, hi: 53, lo: 67, up: true },
      { x: 60, top: 46, bot: 56, hi: 43, lo: 59, up: true },
      { x: 95, top: 44, bot: 50, hi: 41, lo: 53, up: false },
      { x: 130, top: 46, bot: 51, hi: 43, lo: 54, up: false }, // the rail tag
      { x: 175, top: 20, bot: 38, hi: 16, lo: 41, up: true, w: 12 },
    ],
    vols: [0.4, 0.5, 0.3, 0.25, 0.9],
    hiVol: 4,
    mark: { x: 175, y: 28, r: 12 },
  },
  // The gap opens straight into the shelf where it broke down — wick, red close.
  supply: {
    candles: [
      { x: 20, top: 26, bot: 34, hi: 22, lo: 37, up: true, w: 9 },
      { x: 42, top: 28, bot: 52, hi: 25, lo: 56, up: false, w: 9 }, // the breakdown
      { x: 66, top: 52, bot: 60, hi: 48, lo: 63, up: false, w: 9 },
      { x: 90, top: 56, bot: 62, hi: 53, lo: 65, up: true, w: 9 },
      { x: 114, top: 56, bot: 61, hi: 53, lo: 64, up: false, w: 9 },
      { x: 138, top: 55, bot: 60, hi: 52, lo: 63, up: true, w: 9 },
      { x: 180, top: 30, bot: 44, hi: 24, lo: 47, up: false, w: 12 }, // gap into it
    ],
    vols: [0.5, 1.0, 0.5, 0.3, 0.25, 0.22, 0.85],
    hiVol: 1,
    volW: 9,
    guides: [{ y: 25, x0: 14, x1: 205, label: 'SUPPLY' }],
    mark: { x: 180, y: 33, r: 12 },
  },
  // Lower lows straight into the print; the gap opens into a declining 200.
  knife: {
    rail: { x0: 10, y0: 20, x1: 210, y1: 56, label: '200' },
    candles: [
      { x: 22, top: 26, bot: 34, hi: 23, lo: 37, up: false, w: 9 },
      { x: 50, top: 34, bot: 44, hi: 31, lo: 47, up: false, w: 9 },
      { x: 78, top: 44, bot: 52, hi: 41, lo: 56, up: false, w: 9 },
      { x: 106, top: 52, bot: 60, hi: 49, lo: 64, up: false, w: 9 },
      { x: 134, top: 58, bot: 66, hi: 55, lo: 68, up: false, w: 9 },
      { x: 176, top: 40, bot: 52, hi: 34, lo: 56, up: false, w: 12 }, // gap, closes red
    ],
    vols: [0.4, 0.45, 0.5, 0.55, 0.6, 0.9],
    hiVol: 5,
    volW: 9,
    mark: { x: 176, y: 45, r: 12 },
  },
  // Good base, modest gap, no volume — the range takes it straight back.
  novol: {
    candles: [
      { x: 22, top: 44, bot: 48, hi: 41, lo: 51, up: false, w: 9 },
      { x: 48, top: 43, bot: 47, hi: 40, lo: 50, up: true, w: 9 },
      { x: 74, top: 44, bot: 48, hi: 41, lo: 51, up: false, w: 9 },
      { x: 100, top: 43, bot: 46, hi: 40, lo: 49, up: true, w: 9 },
      { x: 132, top: 26, bot: 36, hi: 23, lo: 40, up: false, w: 11 }, // the thin gap
      { x: 166, top: 34, bot: 44, hi: 31, lo: 48, up: false, w: 11 },
      { x: 196, top: 42, bot: 50, hi: 39, lo: 53, up: false, w: 11 }, // filled
    ],
    vols: [0.25, 0.22, 0.2, 0.18, 0.5, 0.4, 0.35],
    hiVol: 4,
    volW: 9,
    guides: [{ y: 39, x0: 14, x1: 205, label: 'RANGE HI' }],
    mark: { x: 196, y: 46, r: 11 },
  },
  // Weeks of advance into the print, then the gap gets sold and closes red.
  extended: {
    candles: [
      { x: 22, top: 58, bot: 66, hi: 55, lo: 68, up: true, w: 9 },
      { x: 52, top: 48, bot: 58, hi: 45, lo: 60, up: true, w: 9 },
      { x: 82, top: 38, bot: 48, hi: 35, lo: 51, up: true, w: 9 },
      { x: 112, top: 28, bot: 38, hi: 25, lo: 41, up: true, w: 9 },
      { x: 142, top: 22, bot: 30, hi: 19, lo: 33, up: true, w: 9 },
      { x: 182, top: 12, bot: 26, hi: 6, lo: 30, up: false, w: 12 }, // gap, sold
    ],
    vols: [0.35, 0.45, 0.55, 0.65, 0.8, 1.0],
    hiVol: 5,
    volW: 9,
    mark: { x: 182, y: 17, r: 12 },
  },
}

function EPSetup({ collapsible = false, collapsed = false, onToggle, id }) {
  const want = EP_PRIOR_CHART.filter(c => c.side === 'want')
  const avoid = EP_PRIOR_CHART.filter(c => c.side === 'avoid')

  return (
    <PanelShell
      id={id}
      titleId="ep-setup-title"
      title="EP Setup"
      subtitle={<>The chart <span className="text-surface-300">before</span> the gap, and the numbers behind the headline — the two things that decide whether an EP pays.</>}
      icon={(
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 17h4l3-1 3 1M3 13h4l3-1 3 1m4-9v10m0-10l-3 3m3-3l3 3M14 20h7" />
        </svg>
      )}
      iconTone="bg-warning/10 border-warning/30 text-warning"
      border="border-warning/25"
      accent="from-warning via-accent to-cyan"
      orb="bg-warning/10"
      orbSide="left"
      badges={[
        { text: 'EP SETUP', cls: 'bg-warning/10 text-warning border-warning/30' },
        { text: 'FRAMEWORK', cls: 'bg-surface-800/60 text-surface-400 border-surface-700' },
      ]}
      collapsible={collapsible}
      collapsed={collapsed}
      onToggle={onToggle}
    >
      <>
        {/* The thesis — why a separate panel from the catalyst hierarchy */}
        <div className="mt-5 rounded-xl border border-surface-700/40 bg-surface-900/30 px-4 py-3">
          <p className="text-[12px] text-surface-400 leading-snug">
            An episodic pivot is not “a stock that gapped on news”. It is a{' '}
            <span className="text-surface-200">re-rating</span>: a name nobody wanted becomes a name that has to be
            owned, in one session. That needs two things at once — a chart with{' '}
            <span className="text-surface-200">no supply in the way</span>, and numbers that move the{' '}
            <span className="text-surface-200">forward</span> model, not the last quarter. The Catalyst Hierarchy panel
            below ranks the <em>why</em>; this one checks the chart it lands on and the arithmetic behind it.
          </p>
        </div>

        {/* PRE-GAP CHART — what you want to see */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">The chart before the gap</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-accent/10 text-accent border-accent/30">WANT</span>
          <span className="text-[11px] text-surface-500">one idea in four shapes: nobody left to sell into the move</span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {want.map(c => (
            <FrameworkCard key={c.key} t={c} spec={SCENES[c.glyph]} />
          ))}
        </div>

        {/* PRE-GAP CHART — what kills it */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">Same headline, dead chart</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-danger/10 text-danger border-danger/30">AVOID</span>
          <span className="text-[11px] text-surface-500">these look identical at 9:31 — the difference is entirely to the left of the gap</span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {avoid.map(c => (
            <FrameworkCard key={c.key} t={c} spec={SCENES[c.glyph]} />
          ))}
        </div>

        {/* Beaten down vs gapping over the MAs — the question the panel exists to answer */}
        <div className="mt-4 rounded-xl border border-cyan/25 bg-cyan/[0.05] px-4 py-3">
          <div className="text-[10px] font-bold tracking-widest text-cyan uppercase mb-1">Beaten down, or gapping over the MAs?</div>
          <p className="text-[12px] text-surface-300 leading-snug">
            Both — and they are the same condition seen from two sides.{' '}
            <span className="text-surface-100">Beaten down or ignored</span> is what guarantees there is no eager
            seller above; <span className="text-surface-100">gapping over every MA in one bar</span> is the proof that
            the re-rating actually happened. What you do <em>not</em> want is the third combination: already above the
            MAs and already extended, where the gap merely adds to a move the market made without you. The ideal EP
            starts the day at or under a flattening 200-day and ends it well above all of them.
          </p>
        </div>

        {/* The quantified chart gate */}
        <div className="mt-5">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            The pre-gap gate — checkable the night before
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {EP_CHART_GATE.map(m => {
              const tone = TONE[m.tone]
              return (
                <div key={m.key} className={`rounded-xl border ${tone.border} ${tone.bgSoft} px-3.5 py-3`}>
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-[10px] font-bold tracking-widest text-surface-400 uppercase">{m.label}</span>
                    <span className={`font-mono font-bold text-[12px] ${tone.text}`}>{m.value}</span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-surface-400 leading-snug">{m.note}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* The gap-day gate */}
        <div className="mt-4">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase">The gap-day gate</span>
            <span className="text-[11px] text-surface-500">the same bands the EP scorer grades — see the</span>
            <Link to="/scanner-9m" className="text-[11px] text-accent hover:text-accent-bright underline underline-offset-2">$9M Scanner</Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {EP_GAP_GATE.map(m => {
              const tone = TONE[m.tone]
              return (
                <div key={m.key} className={`rounded-xl border ${tone.border} ${tone.bgSoft} px-3.5 py-3`}>
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-[10px] font-bold tracking-widest text-surface-400 uppercase">{m.label}</span>
                    <span className={`font-mono font-bold text-[12px] ${tone.text}`}>{m.value}</span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-surface-400 leading-snug">{m.note}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* THE NUMBERS — ranked by what actually re-rates */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">The numbers, ranked</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-warning/10 text-warning border-warning/30">EARNINGS EP</span>
          <span className="text-[11px] text-surface-500">read them in this order — a beat this far down the list cannot rescue a miss above it</span>
        </div>
        <ol className="mt-2 space-y-1.5">
          {EP_NUMBERS.map(n => {
            const tone = TONE[n.tone]
            const top = n.rank === 1
            return (
              <li
                key={n.key}
                className={`relative rounded-xl border ${top ? `${tone.border} ${tone.bgSoft}` : 'border-surface-700/40 bg-surface-900/40'}`}
              >
                <div className="flex items-start gap-3 px-3 py-2.5 sm:px-4">
                  <div
                    className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-[12px] tabular-nums ${
                      top ? `bg-warning/15 ${tone.text} border border-warning/40` : 'bg-surface-800 text-surface-400 border border-surface-700'
                    }`}
                  >
                    {String(n.rank).padStart(2, '0')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className={`text-[13.5px] font-semibold tracking-tight ${top ? 'text-surface-50' : 'text-surface-200'}`}>
                        {n.label}
                      </span>
                      <span className="text-[9.5px] uppercase tracking-widest text-surface-500 font-bold">{n.weight}</span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                      <div className="flex gap-2">
                        <span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                        <p className="text-[11.5px] text-surface-300 leading-snug">
                          <span className="text-accent font-semibold">Want · </span>{n.want}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-danger shrink-0" />
                        <p className="text-[11.5px] text-surface-400 leading-snug">
                          <span className="text-danger font-semibold">Avoid · </span>{n.avoid}
                        </p>
                      </div>
                    </div>
                    <p className="mt-1.5 text-[11px] text-surface-500 leading-snug italic">{n.why}</p>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>

        {/* YoY, not QoQ — the single most misread comparison */}
        <div className="mt-3 rounded-xl border border-surface-700/40 bg-surface-900/40 px-4 py-3">
          <p className="text-[12px] text-surface-400 leading-snug">
            <span className="text-surface-200 font-semibold">Always year-over-year.</span> QoQ moves with seasonality
            and tells you almost nothing; YoY isolates demand. The number that matters is not the beat — most companies
            beat, because the bar is set to be beaten — it is{' '}
            <span className="text-surface-200">revenue growth that is high and getting higher, with a raised guide
            behind it</span>. Revenue over EPS, guidance over both.
          </p>
        </div>

        {/* Non-earnings catalysts — the same size test */}
        <div className="mt-5">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase">When the catalyst is not earnings</span>
            <span className="text-[11px] text-surface-500">same question: is the number big enough to change the forward model?</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {EP_NON_EARNINGS.map(c => {
              const tone = TONE[c.tone]
              return (
                <div key={c.key} className={`rounded-xl border ${tone.border} ${tone.bgSoft} px-4 py-3`}>
                  <div className={`text-[12.5px] font-bold tracking-tight ${tone.text}`}>{c.label}</div>
                  <p className="mt-1.5 text-[11.5px] text-surface-300 leading-snug">{c.test}</p>
                  <p className="mt-1.5 text-[11px] text-surface-500 leading-snug">{c.note}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* The combined verdict ladder */}
        <div className="mt-5">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            Same earnings morning — six different calls
          </div>
          <VerdictLadder rows={EP_NUMBERS_LADDER} />
          <p className="mt-2 text-[11.5px] text-surface-500 leading-snug">
            Read the last row twice: perfect numbers on a chart that already moved is the most expensive EP there is,
            because everything about the headline says buy.
          </p>
        </div>

        {/* Instant disqualifiers */}
        <div className="mt-4 rounded-xl border border-danger/25 bg-danger/[0.05] px-4 py-3">
          <div className="text-[10px] font-bold tracking-widest text-danger uppercase mb-2">Instant no — check these first, they are cheap</div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {EP_DISQUALIFIERS.map((d, i) => (
              <li key={i} className="flex gap-2 text-[11.5px] text-surface-300 leading-snug">
                <span className="mt-[6px] w-1 h-1 rounded-full bg-danger shrink-0" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Iron law */}
        <div className="mt-4 rounded-xl border border-warning/25 bg-warning/[0.06] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <svg className="w-4 h-4 mt-[1px] shrink-0 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-[12.5px] text-surface-200 leading-snug">
              <span className="font-semibold text-warning">Chart first, then numbers:</span> the pre-gap base is a
              veto, not a tiebreaker. A blowout quarter on an extended chart is a fade; a merely good quarter on a
              twelve-month forgotten base is the trade. And you are always{' '}
              <span className="font-semibold">reacting to the print, never holding into it</span>.
            </p>
          </div>
        </div>

        {/* Lineage */}
        <div className="mt-4 pt-3 border-t border-surface-700/40">
          <p className="text-[11px] text-surface-500 leading-snug">
            <span className="font-bold tracking-widest uppercase text-surface-400">Lineage</span>
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">Stockbee (Pradeep Bonde)</span> — the episodic pivot itself, and the
            $9M method’s compression / not-late filters
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">Qullamaggie</span> — trade the gap only when the stock was beaten down
            or ignored beforehand
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">O’Neil / CAN SLIM</span> — the +25% earnings and accelerating-growth
            conventions. Thresholds are lineage conventions — validate them against your own log in{' '}
            <Link to="/trading-analysis" className="text-surface-300 hover:text-surface-100 underline underline-offset-2">Trading Analysis</Link>.
          </p>
        </div>
      </>
    </PanelShell>
  )
}

export default memo(EPSetup)
