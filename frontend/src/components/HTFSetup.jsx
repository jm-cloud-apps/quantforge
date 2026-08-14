import { memo } from 'react'
import { Link } from 'react-router-dom'
import {
  HTF_PRIOR_CHART,
  HTF_SETUP_GATE,
  HTF_SETUP_LADDER,
} from '../utils/tradingRules'
import PanelShell from './framework/PanelShell'
import FrameworkCard from './framework/FrameworkCard'
import VerdictLadder from './framework/VerdictLadder'
import { TONE } from './framework/tones'

// The HTF Setup panel — the continuation family's answer to the EP Setup panel
// next door. That one asks what the chart looked like the day before the gap;
// this asks what it looked like before the POLE. Bases & Pivots defines the
// flag, Entries takes the trigger; this decides whether the name belonged on
// the list at all. Content lives in utils/tradingRules.js.

// Scene specs — viewBox 220×96, the shared stage. Each scene is the months of
// chart to the LEFT of the flag: the spotlight ring marks the precursor, not
// the entry, because the precursor is the thing this panel is about.
const SCENES = {
  // Quarters of flat under a flattening 30-week, then the thrust through it.
  stage2: {
    rail: { x0: 10, y0: 40, x1: 210, y1: 36, label: '30W' },
    candles: [
      { x: 20, top: 44, bot: 50, hi: 41, lo: 53, up: false, w: 8 },
      { x: 44, top: 45, bot: 49, hi: 42, lo: 52, up: true, w: 8 },
      { x: 68, top: 44, bot: 48, hi: 41, lo: 51, up: false, w: 8 },
      { x: 92, top: 44, bot: 48, hi: 42, lo: 51, up: true, w: 8 },
      { x: 116, top: 43, bot: 47, hi: 41, lo: 50, up: false, w: 8 },
      { x: 140, top: 42, bot: 46, hi: 40, lo: 49, up: true, w: 8 },
      { x: 168, top: 28, bot: 42, hi: 25, lo: 44, up: true, w: 10 }, // the turn
      { x: 196, top: 16, bot: 28, hi: 13, lo: 30, up: true, w: 10 },
    ],
    vols: [0.25, 0.22, 0.2, 0.18, 0.2, 0.25, 0.95, 0.7],
    hiVol: 6,
    volW: 8,
    mark: { x: 168, y: 34, r: 13 },
  },
  // The pole is a gap on news; the flag rides above it.
  epole: {
    candles: [
      { x: 22, top: 54, bot: 62, hi: 51, lo: 65, up: false, w: 8 },
      { x: 46, top: 44, bot: 50, hi: 41, lo: 53, up: true, w: 8 },
      { x: 72, top: 20, bot: 40, hi: 17, lo: 43, up: true, w: 11 }, // the gap
      { x: 100, top: 22, bot: 28, hi: 19, lo: 31, up: false, w: 8 },
      { x: 124, top: 24, bot: 29, hi: 21, lo: 32, up: true, w: 8 },
      { x: 148, top: 25, bot: 30, hi: 22, lo: 33, up: false, w: 8 },
      { x: 172, top: 26, bot: 30, hi: 23, lo: 33, up: true, w: 8 },
      { x: 200, top: 10, bot: 22, hi: 7, lo: 25, up: true, w: 10 },
    ],
    vols: [0.3, 0.25, 1.0, 0.4, 0.3, 0.25, 0.2, 0.8],
    hiVol: 2,
    volW: 8,
    guides: [{ y: 19, x0: 88, x1: 190, label: 'GAP HI' }],
    mark: { x: 72, y: 30, r: 13 },
  },
  // The market goes nowhere while this one steps up — RS before the pole.
  rslead: {
    candles: [
      { x: 20, top: 56, bot: 62, hi: 53, lo: 65, up: true, w: 8 },
      { x: 44, top: 50, bot: 57, hi: 47, lo: 60, up: true, w: 8 },
      { x: 68, top: 52, bot: 58, hi: 49, lo: 61, up: false, w: 8 },
      { x: 92, top: 44, bot: 52, hi: 41, lo: 55, up: true, w: 8 },
      { x: 116, top: 40, bot: 46, hi: 37, lo: 49, up: false, w: 8 },
      { x: 140, top: 32, bot: 42, hi: 29, lo: 45, up: true, w: 8 },
      { x: 168, top: 20, bot: 32, hi: 17, lo: 35, up: true, w: 10 },
      { x: 196, top: 12, bot: 20, hi: 9, lo: 23, up: true, w: 10 },
    ],
    vols: [0.3, 0.4, 0.3, 0.5, 0.35, 0.6, 0.9, 0.7],
    hiVol: 6,
    volW: 8,
    guides: [{ y: 47, x0: 12, x1: 210, label: 'MARKET' }],
    mark: { x: 92, y: 48, r: 13 },
  },
  // Rising rail, one prior base, shallow dips that get bought.
  railrun: {
    rail: { x0: 10, y0: 74, x1: 210, y1: 26, label: '10/20' },
    candles: [
      { x: 20, top: 62, bot: 70, hi: 59, lo: 72, up: true, w: 8 },
      { x: 44, top: 54, bot: 64, hi: 51, lo: 66, up: true, w: 8 },
      { x: 68, top: 56, bot: 62, hi: 53, lo: 65, up: false, w: 8 },
      { x: 92, top: 46, bot: 56, hi: 43, lo: 58, up: true, w: 8 },
      { x: 116, top: 42, bot: 50, hi: 39, lo: 52, up: true, w: 8 },
      { x: 140, top: 44, bot: 50, hi: 41, lo: 53, up: false, w: 8 }, // the dip
      { x: 168, top: 30, bot: 44, hi: 27, lo: 46, up: true, w: 10 },
      { x: 196, top: 20, bot: 30, hi: 17, lo: 33, up: true, w: 10 },
    ],
    vols: [0.4, 0.5, 0.25, 0.5, 0.45, 0.22, 0.8, 0.6],
    hiVol: 6,
    volW: 8,
    mark: { x: 140, y: 47, r: 12 },
  },
  // Dead flat at the lows on no volume, then straight vertical.
  nobase: {
    candles: [
      { x: 20, top: 64, bot: 68, hi: 62, lo: 70, up: false, w: 7 },
      { x: 42, top: 64, bot: 67, hi: 62, lo: 69, up: true, w: 7 },
      { x: 64, top: 63, bot: 67, hi: 61, lo: 69, up: false, w: 7 },
      { x: 86, top: 63, bot: 66, hi: 61, lo: 68, up: true, w: 7 },
      { x: 110, top: 48, bot: 64, hi: 45, lo: 66, up: true, w: 9 },
      { x: 134, top: 32, bot: 48, hi: 29, lo: 50, up: true, w: 9 },
      { x: 158, top: 18, bot: 32, hi: 15, lo: 34, up: true, w: 9 },
      { x: 186, top: 14, bot: 24, hi: 8, lo: 28, up: false, w: 10 },
    ],
    vols: [0.15, 0.12, 0.14, 0.13, 0.9, 1.0, 0.95, 0.85],
    hiVol: 5,
    volW: 7,
    mark: { x: 64, y: 65, r: 13 }, // the spotlight is on the missing base
  },
  // Legs getting steeper into a climax bar with an upper wick.
  late: {
    candles: [
      { x: 16, top: 66, bot: 72, hi: 63, lo: 74, up: true, w: 7 },
      { x: 38, top: 58, bot: 66, hi: 55, lo: 68, up: true, w: 7 },
      { x: 60, top: 60, bot: 65, hi: 57, lo: 67, up: false, w: 7 },
      { x: 82, top: 48, bot: 58, hi: 45, lo: 60, up: true, w: 7 },
      { x: 104, top: 50, bot: 56, hi: 47, lo: 58, up: false, w: 7 },
      { x: 126, top: 36, bot: 48, hi: 33, lo: 50, up: true, w: 7 },
      { x: 148, top: 26, bot: 36, hi: 23, lo: 39, up: true, w: 7 },
      { x: 170, top: 16, bot: 26, hi: 13, lo: 28, up: true, w: 7 },
      { x: 196, top: 8, bot: 18, hi: 4, lo: 24, up: false, w: 10 }, // climax
    ],
    vols: [0.3, 0.35, 0.25, 0.45, 0.3, 0.55, 0.7, 0.85, 1.0],
    hiVol: 8,
    volW: 7,
    mark: { x: 196, y: 12, r: 12 },
  },
  // Flat for months while the group made its highs; the pole never gets there.
  laggard: {
    candles: [
      { x: 22, top: 54, bot: 60, hi: 51, lo: 63, up: false, w: 8 },
      { x: 48, top: 55, bot: 60, hi: 52, lo: 63, up: true, w: 8 },
      { x: 74, top: 54, bot: 59, hi: 51, lo: 62, up: false, w: 8 },
      { x: 100, top: 53, bot: 58, hi: 50, lo: 61, up: true, w: 8 },
      { x: 126, top: 48, bot: 56, hi: 45, lo: 58, up: true, w: 8 },
      { x: 152, top: 38, bot: 48, hi: 35, lo: 50, up: true, w: 8 },
      { x: 180, top: 30, bot: 40, hi: 26, lo: 43, up: true, w: 10 },
    ],
    vols: [0.25, 0.22, 0.2, 0.25, 0.5, 0.7, 0.8],
    hiVol: 6,
    volW: 8,
    guides: [{ y: 16, x0: 12, x1: 210, label: 'GROUP HI' }],
    mark: { x: 180, y: 34, r: 12 },
  },
  // The pole runs straight into the shelf it broke down from last year.
  supply: {
    candles: [
      { x: 20, top: 24, bot: 32, hi: 20, lo: 35, up: false, w: 8 },
      { x: 44, top: 30, bot: 52, hi: 27, lo: 55, up: false, w: 8 }, // breakdown
      { x: 70, top: 54, bot: 62, hi: 51, lo: 65, up: false, w: 8 },
      { x: 96, top: 58, bot: 64, hi: 55, lo: 66, up: true, w: 8 },
      { x: 122, top: 56, bot: 62, hi: 53, lo: 65, up: false, w: 8 },
      { x: 148, top: 44, bot: 56, hi: 41, lo: 58, up: true, w: 8 },
      { x: 174, top: 30, bot: 44, hi: 27, lo: 46, up: true, w: 8 },
      { x: 198, top: 24, bot: 32, hi: 20, lo: 36, up: false, w: 10 }, // stalls
    ],
    vols: [0.4, 0.9, 0.4, 0.3, 0.25, 0.6, 0.8, 0.85],
    hiVol: 1,
    volW: 8,
    guides: [{ y: 18, x0: 12, x1: 210, label: 'SUPPLY' }],
    mark: { x: 198, y: 27, r: 12 },
  },
}

function HTFSetup({ collapsible = false, collapsed = false, onToggle, id }) {
  const want = HTF_PRIOR_CHART.filter(c => c.side === 'want')
  const avoid = HTF_PRIOR_CHART.filter(c => c.side === 'avoid')

  return (
    <PanelShell
      id={id}
      titleId="htf-setup-title"
      title="HTF Setup"
      subtitle={<>The chart <span className="text-surface-300">before</span> the pole — the months that decide whether a flag is a young trend’s second leg or an old one’s last gasp.</>}
      icon={(
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 20V10m0 0l4-4m-4 4l4 4M4 20h16M11 16V6m0 0l3.5 2M11 6L7.5 8m10.5 8V4" />
        </svg>
      )}
      iconTone="bg-purple/10 border-purple/30 text-purple"
      border="border-purple/25"
      accent="from-purple via-cyan to-accent"
      orb="bg-purple/10"
      orbSide="left"
      badges={[
        { text: 'HTF SETUP', cls: 'bg-purple/10 text-purple border-purple/30' },
        { text: 'FRAMEWORK', cls: 'bg-surface-800/60 text-surface-400 border-surface-700' },
      ]}
      collapsible={collapsible}
      collapsed={collapsed}
      onToggle={onToggle}
    >
      <>
        {/* The thesis — why the pole is not the setup */}
        <div className="mt-5 rounded-xl border border-surface-700/40 bg-surface-900/30 px-4 py-3">
          <p className="text-[12px] text-surface-400 leading-snug">
            <span className="text-surface-200">The pole is not the setup.</span> Every flag on your screen sits on a big,
            fast advance, and that advance tells you what happened last week — it says almost nothing about the next
            three months. What does say something is the chart{' '}
            <span className="text-surface-200">behind</span> the pole: which stage the name is in, how many bases it has
            already spent, whether it led or followed, and whether anything is waiting overhead. That half is knowable
            in advance, on a weekend, before a single tick of risk. This panel is the mirror of{' '}
            <span className="text-surface-200">EP Setup</span> next door: same question, asked of the continuation
            family instead of the gap.
          </p>
        </div>

        {/* PRE-POLE CHART — what you want to see */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">The chart before the pole</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-accent/10 text-accent border-accent/30">WANT</span>
          <span className="text-[11px] text-surface-500">ranked — the first is worth the full unit, the fourth is a normal swing</span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {want.map(c => (
            <FrameworkCard key={c.key} t={c} spec={SCENES[c.glyph]} />
          ))}
        </div>

        {/* PRE-POLE CHART — what kills it */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">Same flag, dead chart</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-danger/10 text-danger border-danger/30">AVOID</span>
          <span className="text-[11px] text-surface-500">the consolidation looks textbook in all four — the difference is entirely to the left of it</span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {avoid.map(c => (
            <FrameworkCard key={c.key} t={c} spec={SCENES[c.glyph]} />
          ))}
        </div>

        {/* The EP → HTF handoff */}
        <div className="mt-4 rounded-xl border border-warning/25 bg-warning/[0.06] px-4 py-3">
          <div className="text-[10px] font-bold tracking-widest text-warning uppercase mb-1">Where EP and HTF meet</div>
          <p className="text-[12px] text-surface-300 leading-snug">
            The two families are not separate hunting grounds — they are two moments in one life cycle. An episodic pivot
            that <span className="text-surface-100">holds its gap</span> spends the next few weeks building a flag, and
            that flag is an HTF with something no ordinary pole has: a documented reason, a visible floor, and a street
            still revising its numbers upward. So the best pre-HTF chart is frequently an{' '}
            <Link to="/rules#ep-setup" className="text-warning hover:text-amber-300 underline underline-offset-2">EP</Link>{' '}
            you already screened, and the entry for it is the{' '}
            <Link to="/rules#entries" className="text-warning hover:text-amber-300 underline underline-offset-2">“base above the gap”</Link>{' '}
            trigger. Missing the gap is not the end of that trade — it is the start of a better-defined one.
          </p>
        </div>

        {/* The quantified gate */}
        <div className="mt-5">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase">The pre-pole gate — checkable on the weekend</span>
            <span className="text-[11px] text-surface-500">most of it is already computed for you on</span>
            <Link to="/prep" className="text-[11px] text-accent hover:text-accent-bright underline underline-offset-2">Prep</Link>
            <span className="text-[11px] text-surface-500">and</span>
            <Link to="/stage-analysis" className="text-[11px] text-accent hover:text-accent-bright underline underline-offset-2">Stage Analysis</Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {HTF_SETUP_GATE.map(m => {
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

        {/* The verdict ladder */}
        <div className="mt-5">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            Same flag — six different charts behind it
          </div>
          <VerdictLadder rows={HTF_SETUP_LADDER} />
          <p className="mt-2 text-[11.5px] text-surface-500 leading-snug">
            Read the last two rows twice. On the morning you see them the consolidation is textbook — tight, orderly,
            drying up — and everything wrong with the trade happened months earlier, off the right edge of your screen.
          </p>
        </div>

        {/* Iron law */}
        <div className="mt-4 rounded-xl border border-purple/25 bg-purple/[0.06] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <svg className="w-4 h-4 mt-[1px] shrink-0 text-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-[12.5px] text-surface-200 leading-snug">
              <span className="font-semibold text-purple">Look left before you look at the flag.</span> Stage, base
              count, relative strength and overhead supply are all decided before the pole exists — and once you are
              staring at a tight consolidation near the highs, every one of them is easy to forget and none of them have
              changed.
            </p>
          </div>
        </div>

        {/* Lineage */}
        <div className="mt-4 pt-3 border-t border-surface-700/40">
          <p className="text-[11px] text-surface-500 leading-snug">
            <span className="font-bold tracking-widest uppercase text-surface-400">Lineage</span>
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">Weinstein</span> — stage analysis and the 30-week line
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">O’Neil / Minervini</span> — base counting and the prior-uptrend
            requirement
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">Qullamaggie</span> — RS leadership before the move, ADR and liquidity
            floors. Thresholds are lineage conventions — the per-setup breakdown in{' '}
            <Link to="/trading-analysis" className="text-surface-300 hover:text-surface-100 underline underline-offset-2">Trading Analysis</Link>{' '}
            is what tells you whether they are yours.
          </p>
        </div>
      </>
    </PanelShell>
  )
}

export default memo(HTFSetup)
