import { memo } from 'react'
import { RAIL_CANDLES, RAIL_TOUCH_LADDER } from '../utils/tradingRules'
import PanelShell from './framework/PanelShell'
import FrameworkCard from './framework/FrameworkCard'
import VerdictLadder from './framework/VerdictLadder'

// Candles at the Rails — the interaction layer between the MA Rails and
// Candle Tells frameworks: the rail says WHERE to look, the candle says WHEN
// to act. Data lives in utils/tradingRules.js (RAIL_CANDLES /
// RAIL_TOUCH_LADDER); the scene specs below are the presentation half, drawn
// by the shared framework kit (components/framework/).

// Scene specs — viewBox 220×96 with a *sloped* rail (a rising 10/20).
const SCENES = {
  // Shrinking red bodies drifting down onto the rising rail, volume dying.
  approach: {
    rail: { x0: 10, y0: 72, x1: 210, y1: 44, label: '10/20' },
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
    rail: { x0: 10, y0: 70, x1: 210, y1: 42, label: '10/20' },
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
    rail: { x0: 10, y0: 68, x1: 210, y1: 40, label: '10/20' },
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
    rail: { x0: 10, y0: 80, x1: 210, y1: 62, label: '10/20' },
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
    rail: { x0: 10, y0: 58, x1: 210, y1: 38, label: '10/20' },
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
    rail: { x0: 10, y0: 52, x1: 210, y1: 42, label: '10/20' },
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

function CandlesAtRails({ collapsible = false, collapsed = false, onToggle, id }) {
  const buySide = RAIL_CANDLES.filter(t => t.side === 'buy')
  const sellSide = RAIL_CANDLES.filter(t => t.side === 'sell')

  return (
    <PanelShell
      id={id}
      titleId="candles-at-rails-title"
      title="Candles at the Rails"
      subtitle={<>The rail says <span className="text-surface-300">where</span> — the candle says <span className="text-surface-300">when</span>. How rail buys and rail exits actually print.</>}
      icon={(
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16c3-1 5-4 9-4s6 3 9 1M8 6v3m0 8v2m0-10h0a2 2 0 012 2v3a2 2 0 01-2 2h0a2 2 0 01-2-2v-3a2 2 0 012-2zM16 3v3m0 7v3m0-10h0a2 2 0 012 2v4a2 2 0 01-2 2h0a2 2 0 01-2-2V8a2 2 0 012-2z" />
        </svg>
      )}
      iconTone="bg-purple/10 border-purple/30 text-purple"
      border="border-purple/25"
      accent="from-purple via-warning to-accent"
      orb="bg-purple/10"
      orbSide="right"
      badges={[
        { text: 'SWING', cls: 'bg-purple/10 text-purple border-purple/30' },
        { text: 'FRAMEWORK', cls: 'bg-surface-800/60 text-surface-400 border-surface-700' },
      ]}
      collapsible={collapsible}
      collapsed={collapsed}
      onToggle={onToggle}
    >
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
            <FrameworkCard key={t.key} t={t} spec={SCENES[t.glyph]} step={i + 1} />
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
            <FrameworkCard key={t.key} t={t} spec={SCENES[t.glyph]} step={i + 1} />
          ))}
        </div>

        {/* The verdict ladder — reading the 4:00 PM close on any rail touch */}
        <div className="mt-5">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            The 4:00 PM verdict — same touch, three different calls
          </div>
          <VerdictLadder rows={RAIL_TOUCH_LADDER} />
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
    </PanelShell>
  )
}

export default memo(CandlesAtRails)
