import { memo } from 'react'
import { Link } from 'react-router-dom'
import {
  ENTRY_EP_TRIGGERS,
  ENTRY_HTF_TRIGGERS,
  ENTRY_MECHANICS,
  ENTRY_LADDER,
  ENTRY_SIZE_ASSUMPTIONS,
  ENTRY_SIZE_SCENARIOS,
  ENTRY_SIZE_CAPS,
  ENTRY_REENTRY,
  ENTRY_DISQUALIFIERS,
} from '../utils/tradingRules'
import { positionSize } from '../utils/riskMath'
import { fmtMoney } from '../utils/format'
import PanelShell from './framework/PanelShell'
import FrameworkCard from './framework/FrameworkCard'
import VerdictLadder from './framework/VerdictLadder'
import { TONE } from './framework/tones'

// The Entries panel — the trigger half of the page. Everything above it decides
// whether a name deserves risk; this one decides the two numbers that turn it
// into a position: where the order goes and where the trade is wrong. Split by
// the only two setup families the Playbook sanctions (EP, HTF), because the
// structures differ even though the mechanics barely do. Content lives in
// utils/tradingRules.js; the scenes below are the presentation half.

// Scene specs — viewBox 220×96, the same stage the sibling panels draw on. Every
// scene says the same thing twice: a dashed line at the trigger, a red STOP line
// under the low it came from, and the bar that crossed one of them.
const SCENES = {
  // Gap open, one tiny 1-min bar, chop inside it, then the break of its high.
  orb1: {
    candles: [
      { x: 30, top: 40, bot: 52, hi: 36, lo: 56, up: true, w: 9 },
      { x: 60, top: 44, bot: 50, hi: 41, lo: 54, up: false, w: 9 },
      { x: 90, top: 45, bot: 49, hi: 42, lo: 53, up: true, w: 9 },
      { x: 120, top: 42, bot: 47, hi: 39, lo: 51, up: true, w: 9 },
      { x: 155, top: 26, bot: 38, hi: 23, lo: 40, up: true, w: 11 }, // the break
      { x: 188, top: 14, bot: 26, hi: 11, lo: 29, up: true, w: 11 },
    ],
    vols: [1.0, 0.5, 0.4, 0.35, 0.8, 0.6],
    hiVol: 4,
    volW: 9,
    guides: [
      { y: 36, x0: 14, x1: 205, label: '1M HI' },
      { y: 56, x0: 14, x1: 205, tone: 'stop' },
    ],
    mark: { x: 155, y: 31, r: 12 },
  },
  // A wider opening bar, two inside bars, then the break — the default entry.
  orb5: {
    candles: [
      { x: 32, top: 34, bot: 54, hi: 30, lo: 58, up: true, w: 10 },
      { x: 72, top: 40, bot: 50, hi: 36, lo: 54, up: false, w: 10 },
      { x: 112, top: 38, bot: 46, hi: 34, lo: 50, up: true, w: 10 },
      { x: 155, top: 22, bot: 34, hi: 18, lo: 37, up: true, w: 12 }, // the break
      { x: 192, top: 12, bot: 22, hi: 9, lo: 25, up: true, w: 12 },
    ],
    vols: [1.0, 0.45, 0.4, 0.85, 0.6],
    hiVol: 3,
    volW: 10,
    guides: [
      { y: 30, x0: 14, x1: 205, label: '5M HI' },
      { y: 58, x0: 14, x1: 205, tone: 'stop' },
    ],
    mark: { x: 155, y: 28, r: 12 },
  },
  // A two-sided, whipsawing first hour — both extremes run — then the break.
  orb60: {
    candles: [
      { x: 26, top: 34, bot: 52, hi: 27, lo: 58, up: false, w: 9 },
      { x: 52, top: 36, bot: 48, hi: 25, lo: 60, up: true, w: 9 },
      { x: 78, top: 40, bot: 50, hi: 34, lo: 58, up: false, w: 9 },
      { x: 112, top: 38, bot: 44, hi: 34, lo: 48, up: true, w: 9 },
      { x: 142, top: 32, bot: 40, hi: 28, lo: 44, up: true, w: 9 },
      { x: 182, top: 12, bot: 24, hi: 9, lo: 28, up: true, w: 11 }, // the break
    ],
    vols: [0.9, 1.0, 0.7, 0.45, 0.5, 0.85],
    hiVol: 5,
    volW: 9,
    guides: [
      { y: 24, x0: 14, x1: 205, label: '60M HI' },
      { y: 60, x0: 14, x1: 205, tone: 'stop' },
    ],
    mark: { x: 182, y: 18, r: 12 },
  },
  // Missed day 1: the gap, then a tight shelf above it, then the day-1 high.
  basegap: {
    candles: [
      { x: 24, top: 52, bot: 62, hi: 49, lo: 64, up: false, w: 8 },
      { x: 50, top: 26, bot: 44, hi: 23, lo: 47, up: true, w: 10 }, // the gap
      { x: 76, top: 28, bot: 34, hi: 25, lo: 38, up: false, w: 8 },
      { x: 98, top: 29, bot: 34, hi: 26, lo: 38, up: true, w: 8 },
      { x: 120, top: 28, bot: 33, hi: 25, lo: 36, up: false, w: 8 },
      { x: 142, top: 28, bot: 32, hi: 26, lo: 35, up: true, w: 8 },
      { x: 164, top: 27, bot: 31, hi: 25, lo: 34, up: false, w: 8 },
      { x: 194, top: 10, bot: 24, hi: 7, lo: 27, up: true, w: 11 }, // the break
    ],
    vols: [0.3, 1.0, 0.4, 0.35, 0.3, 0.28, 0.25, 0.75],
    hiVol: 7,
    volW: 8,
    guides: [
      { y: 23, x0: 62, x1: 205, label: 'DAY-1 HI' },
      { y: 38, x0: 62, x1: 205, tone: 'stop' },
    ],
    mark: { x: 194, y: 16, r: 12 },
  },
  // Months of flat range contracting into the right edge, then the pivot.
  longbase: {
    candles: [
      { x: 18, top: 40, bot: 46, hi: 37, lo: 49, up: false, w: 8 },
      { x: 39, top: 41, bot: 45, hi: 38, lo: 49, up: true, w: 8 },
      { x: 60, top: 40, bot: 45, hi: 37, lo: 48, up: false, w: 8 },
      { x: 81, top: 41, bot: 44, hi: 38, lo: 47, up: true, w: 8 },
      { x: 102, top: 40, bot: 44, hi: 38, lo: 47, up: false, w: 8 },
      { x: 123, top: 40, bot: 43, hi: 38, lo: 46, up: true, w: 8 },
      { x: 144, top: 39, bot: 42, hi: 37, lo: 45, up: false, w: 8 },
      { x: 165, top: 39, bot: 42, hi: 37, lo: 44, up: true, w: 8 },
      { x: 196, top: 20, bot: 36, hi: 17, lo: 38, up: true, w: 11 }, // the pivot
    ],
    vols: [0.35, 0.3, 0.28, 0.25, 0.22, 0.2, 0.18, 0.16, 1.0],
    hiVol: 8,
    volW: 8,
    guides: [
      { y: 36, x0: 12, x1: 210, label: 'PIVOT' },
      { y: 50, x0: 12, x1: 210, tone: 'stop' },
    ],
    mark: { x: 196, y: 26, r: 12 },
  },
  // Pole, then a downward drift on drying volume, then the prior day's high.
  downflag: {
    rail: { x0: 10, y0: 80, x1: 210, y1: 44, label: '10/20' },
    candles: [
      { x: 18, top: 60, bot: 70, hi: 57, lo: 72, up: true, w: 8 },
      { x: 40, top: 42, bot: 60, hi: 39, lo: 62, up: true, w: 8 },
      { x: 62, top: 22, bot: 42, hi: 18, lo: 44, up: true, w: 8 },
      { x: 86, top: 24, bot: 32, hi: 21, lo: 35, up: false, w: 8 },
      { x: 108, top: 28, bot: 34, hi: 25, lo: 37, up: false, w: 8 },
      { x: 130, top: 30, bot: 36, hi: 27, lo: 39, up: true, w: 8 },
      { x: 152, top: 32, bot: 38, hi: 29, lo: 41, up: false, w: 8 },
      { x: 184, top: 14, bot: 30, hi: 11, lo: 33, up: true, w: 11 }, // the trigger
    ],
    vols: [0.7, 0.9, 1.0, 0.45, 0.35, 0.28, 0.22, 0.85],
    hiVol: 7,
    volW: 8,
    guides: [
      { y: 29, x0: 78, x1: 205, label: 'PRIOR HI' },
      { y: 41, x0: 78, x1: 205, tone: 'stop' },
    ],
    mark: { x: 184, y: 20, r: 12 },
  },
  // Lower highs and higher lows squeezing into the apex, then the break.
  symflag: {
    candles: [
      { x: 20, top: 58, bot: 70, hi: 55, lo: 72, up: true, w: 8 },
      { x: 42, top: 40, bot: 58, hi: 37, lo: 60, up: true, w: 8 },
      { x: 64, top: 24, bot: 40, hi: 20, lo: 42, up: true, w: 8 },
      { x: 88, top: 26, bot: 38, hi: 22, lo: 42, up: false, w: 8 },
      { x: 110, top: 30, bot: 36, hi: 25, lo: 39, up: true, w: 8 },
      { x: 132, top: 30, bot: 34, hi: 27, lo: 36, up: false, w: 8 },
      { x: 152, top: 31, bot: 33, hi: 29, lo: 34, up: true, w: 8 }, // the apex
      { x: 186, top: 12, bot: 26, hi: 9, lo: 29, up: true, w: 11 },
    ],
    vols: [0.6, 0.8, 0.9, 0.5, 0.4, 0.3, 0.22, 0.95],
    hiVol: 7,
    volW: 8,
    // The coil is only a few points deep, so the STOP line starts mid-coil —
    // stacked at the same x its label would sit on top of the APEX HI one.
    guides: [
      { y: 29, x0: 80, x1: 205, label: 'APEX HI' },
      { y: 38, x0: 118, x1: 205, tone: 'stop' },
    ],
    mark: { x: 186, y: 18, r: 12 },
  },
  // A long, orderly parallel channel — weeks, not days — then the upper edge.
  channel: {
    candles: [
      { x: 16, top: 62, bot: 72, hi: 59, lo: 74, up: true, w: 7 },
      { x: 34, top: 44, bot: 62, hi: 41, lo: 64, up: true, w: 7 },
      { x: 52, top: 26, bot: 44, hi: 22, lo: 46, up: true, w: 7 },
      { x: 72, top: 28, bot: 34, hi: 24, lo: 38, up: false, w: 7 },
      { x: 92, top: 30, bot: 36, hi: 26, lo: 40, up: true, w: 7 },
      { x: 112, top: 32, bot: 38, hi: 28, lo: 42, up: false, w: 7 },
      { x: 132, top: 34, bot: 40, hi: 30, lo: 44, up: true, w: 7 },
      { x: 152, top: 36, bot: 42, hi: 32, lo: 46, up: false, w: 7 },
      { x: 172, top: 37, bot: 43, hi: 34, lo: 48, up: true, w: 7 },
      { x: 200, top: 18, bot: 32, hi: 15, lo: 35, up: true, w: 10 }, // the break
    ],
    vols: [0.6, 0.8, 0.95, 0.4, 0.35, 0.3, 0.28, 0.25, 0.22, 0.9],
    hiVol: 9,
    volW: 7,
    guides: [
      { y: 34, x0: 64, x1: 190, label: 'PRIOR HI' },
      { y: 48, x0: 64, x1: 190, tone: 'stop' },
    ],
    mark: { x: 200, y: 24, r: 11 },
  },
  // The wedge: higher highs AND higher lows on thin volume, break with a wick.
  upflag: {
    candles: [
      { x: 18, top: 58, bot: 70, hi: 55, lo: 72, up: true, w: 8 },
      { x: 40, top: 40, bot: 58, hi: 37, lo: 60, up: true, w: 8 },
      { x: 62, top: 24, bot: 40, hi: 20, lo: 42, up: true, w: 8 },
      { x: 86, top: 26, bot: 34, hi: 22, lo: 37, up: false, w: 8 },
      { x: 108, top: 24, bot: 31, hi: 21, lo: 34, up: true, w: 8 },
      { x: 130, top: 22, bot: 28, hi: 19, lo: 31, up: true, w: 8 },
      { x: 152, top: 20, bot: 26, hi: 17, lo: 29, up: true, w: 8 },
      { x: 184, top: 12, bot: 20, hi: 6, lo: 24, up: true, w: 11 }, // thin break
    ],
    vols: [0.7, 0.85, 1.0, 0.4, 0.35, 0.32, 0.3, 0.5],
    hiVol: 7,
    volW: 8,
    guides: [
      { y: 17, x0: 78, x1: 205, label: 'FLAG HI' },
      { y: 29, x0: 78, x1: 205, tone: 'stop' },
    ],
    mark: { x: 184, y: 15, r: 11 },
  },
}

// The two numbers the card exists to give you, printed like a ticket. Rendered
// inside FrameworkCard, directly above "The rule".
function TriggerSpec({ t }) {
  const tone = TONE[t.tone]
  return (
    <div className="mt-3 rounded-lg border border-surface-700/50 bg-surface-950/50 divide-y divide-surface-700/40">
      <div className="flex items-baseline gap-2 px-3 py-1.5">
        <span className="text-[9px] font-bold tracking-widest text-surface-500 uppercase w-[52px] shrink-0">Trigger</span>
        <span className={`font-mono text-[11px] leading-snug ${tone.text}`}>{t.trigger}</span>
      </div>
      <div className="flex items-baseline gap-2 px-3 py-1.5">
        <span className="text-[9px] font-bold tracking-widest text-surface-500 uppercase w-[52px] shrink-0">Stop</span>
        <span className="font-mono text-[11px] leading-snug text-danger/90">{t.stop}</span>
      </div>
    </div>
  )
}

// Whole dollars with separators. This is a worked example, so the exact figure
// carries the argument better than a compact one ("$21,050", not "$21.1K").
const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`

// The worked example. One $42 stock, one entry, four stops — priced by the same
// riskMath.positionSize() the Trade Plan gate sizes with, so these numbers are
// the ones the app would actually hand you. The dollar-risk column is identical
// in every row by construction; the overnight column is not, and that gap is
// the whole reason the section exists.
function SizeTable() {
  const { account, riskPct, gapPct, capPct } = ENTRY_SIZE_ASSUMPTIONS
  const oneR = account * (riskPct / 100)
  const capValue = account * (capPct / 100)

  const rows = ENTRY_SIZE_SCENARIOS.map(s => {
    const p = positionSize({ account, riskPct, entry: s.entry, stop: s.stop })
    const gapR = (p.positionValue * (gapPct / 100)) / oneR
    const capped = p.positionPctOfAccount > capPct
    const capShares = capped ? Math.floor(capValue / s.entry) : null
    return { ...s, p, gapR, capShares, capRisk: capShares != null ? (capShares * p.perShare) / oneR : null }
  })

  const gapTone = (r) => (r >= 8 ? 'text-danger' : r >= 4 ? 'text-warning' : 'text-surface-300')

  return (
    <div>
      <div className="text-[11px] text-surface-500 mb-2">
        {usd(account)} account · {riskPct}% risk = <span className="font-mono text-surface-300">{usd(oneR)}</span> per trade
        (1R) · one entry at <span className="font-mono text-surface-300">{fmtMoney(ENTRY_SIZE_SCENARIOS[0].entry)}</span>,
        four different stops.
      </div>
      <div className="rounded-xl border border-surface-700/40 bg-surface-900/30 overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse">
          <thead>
            <tr className="text-[9px] font-bold tracking-widest text-surface-500 uppercase border-b border-surface-700/40">
              <th className="text-left font-bold px-3 py-2">Trigger</th>
              <th className="text-right font-bold px-3 py-2">Stop</th>
              <th className="text-right font-bold px-3 py-2">Shares</th>
              <th className="text-right font-bold px-3 py-2">Position</th>
              <th className="text-right font-bold px-3 py-2">% of acct</th>
              <th className="text-right font-bold px-3 py-2">−{gapPct}% gap</th>
              <th className="text-right font-bold px-3 py-2">After the {capPct}% cap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-700/40">
            {rows.map(r => (
              <tr key={r.key} className="text-[11.5px]">
                <td className="px-3 py-2 text-surface-200">{r.label}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-surface-400">
                  {fmtMoney(r.stop)} <span className="text-surface-600">·</span> {r.p.stopDistancePct.toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-surface-200">{r.p.shares}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-surface-200">{usd(r.p.positionValue)}</td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums font-bold ${r.p.positionPctOfAccount > capPct ? 'text-danger' : 'text-surface-300'}`}>
                  {r.p.positionPctOfAccount.toFixed(0)}%
                </td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${gapTone(r.gapR)}`}>
                  −{usd(r.p.positionValue * (gapPct / 100))} <span className="font-bold">· {r.gapR.toFixed(1)}R</span>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-surface-400">
                  {r.capShares != null
                    ? <>{r.capShares} sh <span className="text-surface-600">·</span> risk {r.capRisk.toFixed(2)}R</>
                    : <span className="text-accent">no cap needed</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11.5px] text-surface-500 leading-snug">
        Every row risks exactly {usd(oneR)} if the stop works. The first row owns{' '}
        <span className="text-surface-300">{rows[0].p.positionPctOfAccount.toFixed(0)}% of the account</span> to do it, and
        a single bad overnight print costs it <span className="text-danger font-semibold">{rows[0].gapR.toFixed(0)}R</span> —
        a month of good work, on the trade that looked like the tightest risk on the page. Note the last column: capping
        the size does not widen the stop, it takes the dollar risk <em>down</em> to{' '}
        <span className="text-surface-300">{rows[0].capRisk.toFixed(2)}R</span>. The cap only ever costs you upside.
      </p>
    </div>
  )
}

function Entries({ collapsible = false, collapsed = false, onToggle, id }) {
  return (
    <PanelShell
      id={id}
      titleId="entries-title"
      title="Entries"
      subtitle={<>Where the order actually goes — the trigger and the stop for every <span className="text-surface-300">EP</span> and <span className="text-surface-300">HTF</span> setup you are allowed to trade.</>}
      icon={(
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3.5m0 11V21m9-9h-3.5M6.5 12H3m15 0a6 6 0 11-12 0 6 6 0 0112 0z" />
        </svg>
      )}
      iconTone="bg-accent/10 border-accent/30 text-accent"
      border="border-accent/25"
      accent="from-accent via-cyan to-purple"
      orb="bg-accent/10"
      orbSide="right"
      badges={[
        { text: 'ENTRIES', cls: 'bg-accent/10 text-accent border-accent/30' },
        { text: 'FRAMEWORK', cls: 'bg-surface-800/60 text-surface-400 border-surface-700' },
      ]}
      collapsible={collapsible}
      collapsed={collapsed}
      onToggle={onToggle}
    >
      <>
        {/* The thesis — why entries get their own panel */}
        <div className="mt-5 rounded-xl border border-surface-700/40 bg-surface-900/30 px-4 py-3">
          <p className="text-[12px] text-surface-400 leading-snug">
            Every panel above answers <span className="text-surface-200">whether</span> a name deserves risk — the rails
            qualify it, the base gives it structure, the EP panel prices the catalyst. This one answers{' '}
            <span className="text-surface-200">where</span>: the exact price that turns a watchlist line into a position,
            and the exact price that says you were wrong. Both are horizontal levels taken off a bar that already
            printed — an <span className="text-surface-200">opening-range high</span> or a{' '}
            <span className="text-surface-200">prior day’s high</span> — and both are written down before the bell. The
            setups differ; the mechanics barely do.
          </p>
        </div>

        {/* EP ENTRIES */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">EP entries</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-warning/10 text-warning border-warning/30">REACTING TO A GAP</span>
          <span className="text-[11px] text-surface-500">the opening range defines the risk — pick the one the open earns</span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {ENTRY_EP_TRIGGERS.map(t => (
            <FrameworkCard key={t.key} t={t} spec={SCENES[t.glyph]}>
              <TriggerSpec t={t} />
            </FrameworkCard>
          ))}
        </div>

        {/* Which opening range — the one decision that varies */}
        <div className="mt-4 rounded-xl border border-cyan/25 bg-cyan/[0.05] px-4 py-3">
          <div className="text-[10px] font-bold tracking-widest text-cyan uppercase mb-1">Which opening range?</div>
          <p className="text-[12px] text-surface-300 leading-snug">
            The range is chosen by <span className="text-surface-100">how disorderly the open is</span>, never by how much
            you like the trade. A clean, one-directional open clears in a minute, so the 1-min bar is a real level; a
            two-sided fight breaks every short range in both directions, so the hour is the first honest one. The trade-off
            is fixed and unavoidable: shorter range → tighter stop → bigger size → more shakeouts. Pick the range first,
            then let the arithmetic set the size — never the reverse.
          </p>
        </div>

        {/* HTF ENTRIES */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">HTF entries</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-accent/10 text-accent border-accent/30">CONTINUATION</span>
          <span className="text-[11px] text-surface-500">
            the five variants in your <Link to="/playbook" className="text-accent hover:text-accent-bright underline underline-offset-2">Playbook</Link> taxonomy — best odds first
          </span>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {ENTRY_HTF_TRIGGERS.map(t => (
            <FrameworkCard key={t.key} t={t} spec={SCENES[t.glyph]}>
              <TriggerSpec t={t} />
            </FrameworkCard>
          ))}
        </div>

        {/* A price, not a trendline */}
        <div className="mt-4 rounded-xl border border-purple/25 bg-purple/[0.05] px-4 py-3">
          <div className="text-[10px] font-bold tracking-widest text-purple uppercase mb-1">A price, not a trendline</div>
          <p className="text-[12px] text-surface-300 leading-snug">
            All five HTF variants are drawn with sloping boundaries, and none of them are traded that way. The trigger is
            always the <span className="text-surface-100">prior day’s high</span> (or the base high, or the apex bar’s
            high) — a number you can type into an order ticket the night before. A trendline moves every time you redraw
            it, which means an entry taken off one can never be graded: you cannot tell later whether you followed the
            plan or drew a new one. Use the channel to <em>find</em> the setup; use the last printed high to{' '}
            <em>trade</em> it.
          </p>
        </div>

        {/* THE MECHANICS — the numbers shared by every card above */}
        <div className="mt-5">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase">The mechanics</span>
            <span className="text-[11px] text-surface-500">the same three numbers the</span>
            <Link to="/situational-awareness" className="text-[11px] text-accent hover:text-accent-bright underline underline-offset-2">Trade Plan gate</Link>
            <span className="text-[11px] text-surface-500">asks for — decided here, not at the ticket</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {ENTRY_MECHANICS.map(m => {
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

        {/* SIZE — the constraint the trigger panel itself creates */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">Size it twice</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-danger/10 text-danger border-danger/30">THE CAP</span>
          <span className="text-[11px] text-surface-500">the tighter the stop, the bigger the position the formula asks for</span>
        </div>
        <div className="mt-2 rounded-xl border border-danger/25 bg-danger/[0.05] px-4 py-3">
          <p className="text-[12px] text-surface-300 leading-snug">
            <span className="text-surface-100 font-semibold">A stop is a daytime instrument.</span> Sizing off it assumes
            continuous prices — and between 4:00 PM and 9:30 AM there are none, which is the one assumption an
            opening-range entry leans on hardest. So size every trade twice: once assuming the stop holds, once assuming
            a gap skips straight past it. Take the smaller number. The second calculation is the only thing standing
            between a 0.25% risk unit and a position worth most of the account.
          </p>
        </div>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {ENTRY_SIZE_CAPS.map(c => {
            const tone = TONE[c.tone]
            return (
              <div key={c.key} className={`rounded-xl border ${tone.border} ${tone.bgSoft} px-3.5 py-3`}>
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="text-[10px] font-bold tracking-widest text-surface-400 uppercase">{c.label}</span>
                  <span className={`font-mono font-bold text-[12px] ${tone.text}`}>{c.value}</span>
                </div>
                <p className="mt-1.5 text-[11px] text-surface-400 leading-snug">{c.note}</p>
              </div>
            )
          })}
        </div>

        {/* The worked example — same arithmetic the gate runs */}
        <div className="mt-4">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase">Worked example</span>
            <span className="text-[11px] text-surface-500">one stock, one entry, four stops — priced by the same math the</span>
            <Link to="/risk" className="text-[11px] text-accent hover:text-accent-bright underline underline-offset-2">Risk Management</Link>
            <span className="text-[11px] text-surface-500">page and the plan gate use</span>
          </div>
          <SizeTable />
        </div>

        {/* The verdict ladder */}
        <div className="mt-5">
          <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase mb-2">
            Same setup — six different mornings
          </div>
          <VerdictLadder rows={ENTRY_LADDER} />
          <p className="mt-2 text-[11.5px] text-surface-500 leading-snug">
            Read the rows as one question: not “is this a good setup” — you answered that last night — but{' '}
            <span className="text-surface-300">“is the trigger still where the plan put it?”</span> When it isn’t, the
            size changes or the trade doesn’t happen. Those are the only two options.
          </p>
        </div>

        {/* RE-ENTRY — what the second attempt is allowed to be */}
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <span className="text-[9.5px] font-bold tracking-widest text-surface-400 uppercase">When the trigger fails</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-cyan/10 text-cyan border-cyan/30">RE-ENTRY</span>
          <span className="text-[11px] text-surface-500">a stop is not a verdict on the idea — but it is a charge against its budget</span>
        </div>
        <div className="mt-2">
          <VerdictLadder rows={ENTRY_REENTRY} />
        </div>
        <div className="mt-3 rounded-xl border border-cyan/25 bg-cyan/[0.05] px-4 py-3">
          <div className="text-[10px] font-bold tracking-widest text-cyan uppercase mb-1">The budget belongs to the idea, not the attempt</div>
          <p className="text-[12px] text-surface-300 leading-snug">
            Decide before the bell what the whole idea is worth — one risk unit — and divide it across the attempts you
            allow yourself. Two attempts means <span className="text-surface-100">half a unit each</span>; it does not
            mean two units. This is the rule that separates a trader who took one wrong idea for −1R from one who took
            the same wrong idea for −3R and called it discipline because every individual stop was honoured. The counter
            resets on new structure — a new base, a new pole, a new catalyst — never on a new hour.
          </p>
        </div>

        {/* Instant disqualifiers */}
        <div className="mt-4 rounded-xl border border-danger/25 bg-danger/[0.05] px-4 py-3">
          <div className="text-[10px] font-bold tracking-widest text-danger uppercase mb-2">Instant no — execution errors, the cheapest kind to delete</div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {ENTRY_DISQUALIFIERS.map((d, i) => (
              <li key={i} className="flex gap-2 text-[11.5px] text-surface-300 leading-snug">
                <span className="mt-[6px] w-1 h-1 rounded-full bg-danger shrink-0" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Iron law */}
        <div className="mt-4 rounded-xl border border-accent/25 bg-accent/[0.06] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <svg className="w-4 h-4 mt-[1px] shrink-0 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-[12.5px] text-surface-200 leading-snug">
              <span className="font-semibold text-accent">Three numbers, written before the bell:</span> trigger, stop,
              size. The market’s only job is to hit the first one — and if it never does, there was no trade. That is a
              successful morning, not a missed one.
            </p>
          </div>
        </div>

        {/* Lineage */}
        <div className="mt-4 pt-3 border-t border-surface-700/40">
          <p className="text-[11px] text-surface-500 leading-snug">
            <span className="font-bold tracking-widest uppercase text-surface-400">Lineage</span>
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">Qullamaggie</span> — the 1/5/60-minute opening-range entry and the
            prior-day-high trigger on flags
            <span className="mx-1.5">·</span>
            <span className="text-surface-300">Stockbee (Pradeep Bonde)</span> — reacting to the gap rather than holding
            into it
            <span className="mx-1.5">·</span>
            The setup names match the groups in the Trade Plan gate and the Playbook, so what you read here is what you
            tag — and the per-setup numbers in{' '}
            <Link to="/trading-analysis" className="text-surface-300 hover:text-surface-100 underline underline-offset-2">Trading Analysis</Link>{' '}
            are the only verdict on whether these thresholds are yours or just the lineage’s.
          </p>
        </div>
      </>
    </PanelShell>
  )
}

export default memo(Entries)
