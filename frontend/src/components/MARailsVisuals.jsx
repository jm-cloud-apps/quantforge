import { useState } from 'react'
import { MA_ANATOMY_PHASES } from '../utils/tradingRules'
import {
  HERO,
  GLYPHS,
  MINI_STACKED,
  MINI_TANGLED,
  RAIL_COLORS,
  railLabels,
} from './maRailsCharts'

// SVG visuals for the MA Rails panel (MARails.jsx). All geometry comes
// precomputed from maRailsCharts.js — real EMAs/SMA over a synthetic tape —
// so these components only draw. Colors are the rail-entity tones pinned in
// RAIL_COLORS; identity is never color-alone (every rail line is direct-
// labeled 10/20/50 and every marker is numbered or captioned).

const PHASE_TONE = {
  base: RAIL_COLORS.muted,
  breakout: RAIL_COLORS.price,
  surf: RAIL_COLORS.ema10,
  pb20: RAIL_COLORS.ema20,
  tag50: RAIL_COLORS.sma50,
  exit: RAIL_COLORS.danger,
}

function RailPaths({ paths, priceWidth = 2 }) {
  return (
    <>
      <path d={paths.sma50} fill="none" stroke={RAIL_COLORS.sma50} strokeWidth="2" strokeLinejoin="round" />
      <path d={paths.ema20} fill="none" stroke={RAIL_COLORS.ema20} strokeWidth="2" strokeLinejoin="round" />
      <path d={paths.ema10} fill="none" stroke={RAIL_COLORS.ema10} strokeWidth="2" strokeLinejoin="round" />
      <path d={paths.price} fill="none" stroke={RAIL_COLORS.price} strokeWidth={priceWidth} strokeOpacity="0.9" strokeLinejoin="round" />
    </>
  )
}

// ---------------------------------------------------------------- ANATOMY
// The hero: one full trade, base → exit, with numbered phase markers that
// sync with the moment selector and a caption strip below. `momentKeys` is
// the set of phase keys the currently selected workflow moment owns.

export function AnatomyChart({ momentKeys }) {
  const [pinned, setPinned] = useState(null)
  const [hovered, setHovered] = useState(null)

  const focusKey = hovered || pinned
  const activeKeys = focusKey ? [focusKey] : momentKeys || []
  const detail = MA_ANATOMY_PHASES.find(p => p.key === focusKey) || null

  const togglePin = key => setPinned(k => (k === key ? null : key))
  const labels = railLabels(HERO.railEnds)

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase">
          Anatomy of a leader — one trade, base to exit
        </div>
        <div className="text-[10px] text-surface-500">
          Grey = price · colored rails = 10 / 20 / 50-day
        </div>
      </div>

      <div className="mt-2 rounded-xl border border-surface-700/40 bg-surface-950/60 px-1 py-1">
        <svg
          viewBox={`0 0 ${HERO.w} ${HERO.h}`}
          className="w-full h-auto block"
          role="img"
          aria-label="Annotated chart of a full momentum trade: base, breakout, riding the 10-day, pullback to the 20-day, tag of the 50-day, exit on a close below the rail"
        >
          <RailPaths paths={HERO.paths} priceWidth={2.2} />

          {labels.map(l => (
            <text key={l.key} x={l.x + 5} y={l.y + 3.5} fontSize="11" fontWeight="700" fill={l.color} fontFamily="JetBrains Mono, monospace">
              {l.key}
            </text>
          ))}

          {HERO.markers.map(m => {
            const phase = MA_ANATOMY_PHASES.find(p => p.key === m.key)
            const tone = PHASE_TONE[m.key]
            const active = activeKeys.includes(m.key)
            const dim = activeKeys.length > 0 && !active
            return (
              <g
                key={m.key}
                opacity={dim ? 0.3 : 1}
                className="cursor-pointer transition-opacity"
                onMouseEnter={() => setHovered(m.key)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => togglePin(m.key)}
              >
                {/* pin: dot on the geometry, leader line, numbered chip above */}
                <circle cx={m.x} cy={m.y} r="3" fill={tone} />
                <line x1={m.x} y1={m.y - 4} x2={m.x} y2={m.y - 12} stroke={tone} strokeWidth="1" strokeOpacity="0.6" />
                <circle cx={m.x} cy={m.y - 21} r={active ? 10.5 : 9} fill="#0F1623" stroke={tone} strokeWidth={active ? 2 : 1.3} />
                <text x={m.x} y={m.y - 17.5} fontSize="10" fontWeight="700" fill={tone} textAnchor="middle" fontFamily="JetBrains Mono, monospace">
                  {phase.n}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Phase captions — hover previews, click pins, moment selection lights up its phases */}
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
        {MA_ANATOMY_PHASES.map(p => {
          const tone = PHASE_TONE[p.key]
          const active = activeKeys.includes(p.key)
          return (
            <button
              key={p.key}
              type="button"
              onMouseEnter={() => setHovered(p.key)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => togglePin(p.key)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-left transition-colors ${
                active ? 'bg-surface-800/80' : 'bg-surface-900/50 hover:bg-surface-800/60'
              }`}
              style={{ borderColor: active ? tone : 'rgba(30,41,59,0.6)' }}
            >
              <span
                className="w-4 h-4 rounded-full border flex items-center justify-center text-[9px] font-mono font-bold shrink-0"
                style={{ color: tone, borderColor: tone }}
              >
                {p.n}
              </span>
              <span className={`text-[10.5px] font-semibold leading-tight ${active ? 'text-surface-100' : 'text-surface-400'}`}>
                {p.title}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-1.5 min-h-[42px] rounded-lg border border-surface-700/40 bg-surface-900/40 px-3 py-2">
        {detail ? (
          <p className="text-[12px] text-surface-300 leading-snug animate-fade-in">
            <span className="font-semibold" style={{ color: PHASE_TONE[detail.key] }}>
              {detail.n} · {detail.title}.
            </span>{' '}
            {detail.text}
          </p>
        ) : (
          <p className="text-[12px] text-surface-500 leading-snug">
            Hover or tap a phase — ① to ⑥ trace one full trade. Pick a moment below and the phases it owns light up.
          </p>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ GLYPH
// Compact per-rail pattern inside each rail card: shaded hold zone above the
// rail, the touch that matters (add/buy) and the break that ends the trade.

export function RailGlyph({ railKey, tone, touchLabel }) {
  const g = GLYPHS[railKey]
  return (
    <svg
      viewBox={`0 0 ${g.w} ${g.h}`}
      className="w-full h-auto block rounded-lg bg-surface-950/60"
      role="img"
      aria-label={`Price pattern against the ${railKey}-day line: hold while closing above, ${touchLabel.toLowerCase()} on the touch, exit on the first close below`}
    >
      <path d={g.bandPath} fill={tone} fillOpacity="0.08" />
      <path d={g.railPath} fill="none" stroke={tone} strokeWidth="1.8" strokeLinejoin="round" />
      <path d={g.pricePath} fill="none" stroke={RAIL_COLORS.price} strokeWidth="1.6" strokeOpacity="0.85" strokeLinejoin="round" />

      {g.touch && (
        <g>
          <circle cx={g.touch.x} cy={g.touch.y} r="4.5" fill="none" stroke={tone} strokeWidth="1.2" strokeOpacity="0.7" />
          <circle cx={g.touch.x} cy={g.touch.y} r="2.2" fill={tone} />
          <text x={g.touch.x} y={g.touch.y + 13} fontSize="7.5" fontWeight="700" fill={tone} textAnchor="middle" fontFamily="JetBrains Mono, monospace">
            {touchLabel}
          </text>
        </g>
      )}

      <g>
        <path
          d={`M${g.exit.x - 3.5} ${g.exit.y - 3.5}L${g.exit.x + 3.5} ${g.exit.y + 3.5}M${g.exit.x - 3.5} ${g.exit.y + 3.5}L${g.exit.x + 3.5} ${g.exit.y - 3.5}`}
          stroke={RAIL_COLORS.danger}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <text x={g.exit.x} y={g.exit.y + 13} fontSize="7.5" fontWeight="700" fill={RAIL_COLORS.danger} textAnchor="middle" fontFamily="JetBrains Mono, monospace">
          EXIT
        </text>
      </g>
    </svg>
  )
}

// ------------------------------------------------------------- SCAN FILTER
// Stacked-and-fanning vs braided chop — the two-second visual test that
// decides whether the rails mean anything at all on this chart.

function MiniPanel({ data, label }) {
  const labels = railLabels(data.railEnds)
  return (
    <svg viewBox={`0 0 ${data.w} ${data.h}`} className="w-full h-auto block" role="img" aria-label={label}>
      <RailPaths paths={data.paths} priceWidth={1.4} />
      {labels.map(l => (
        <text key={l.key} x={l.x + 4} y={l.y + 3} fontSize="9.5" fontWeight="700" fill={l.color} fontFamily="JetBrains Mono, monospace">
          {l.key}
        </text>
      ))}
    </svg>
  )
}

export function StackedVsTangled() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="rounded-xl border border-accent/25 bg-accent/[0.03] px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <svg className="w-3.5 h-3.5 text-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          <span className="text-[10px] font-bold tracking-widest text-accent uppercase">Tradeable — stacked &amp; fanning</span>
        </div>
        <MiniPanel data={MINI_STACKED} label="Rails stacked in order, 10 above 20 above 50, all rising and fanning apart under price" />
        <p className="mt-1 text-[11px] text-surface-400 leading-snug">
          10 &gt; 20 &gt; 50, all rising, price on top. Pullbacks have a floor — the rails mean something here.
        </p>
      </div>
      <div className="rounded-xl border border-danger/20 bg-danger/[0.03] px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <svg className="w-3.5 h-3.5 text-danger shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="text-[10px] font-bold tracking-widest text-danger/90 uppercase">Skip — braided chop</span>
        </div>
        <MiniPanel data={MINI_TANGLED} label="Rails braided and crossing repeatedly through sideways price — no trend to lean on" />
        <p className="mt-1 text-[11px] text-surface-400 leading-snug">
          Rails crossing back and forth through price. No rail is support; every touch is a coin flip. Not a candidate.
        </p>
      </div>
    </div>
  )
}

// --------------------------------------------------------------- IRON LAW
// Wick-through vs close-below, drawn as candles against the 20-day rail —
// the visual version of "only the daily close counts".

export function Candle({ x, top, bot, hi, lo, up, w = 9 }) {
  const color = up ? RAIL_COLORS.ema10 : RAIL_COLORS.danger
  return (
    <g>
      <line x1={x} y1={hi} x2={x} y2={lo} stroke={color} strokeWidth="1.2" />
      <rect x={x - w / 2} y={top} width={w} height={Math.max(bot - top, 1.5)} rx="1" fill={up ? '#0F1623' : color} stroke={color} strokeWidth="1.2" />
    </g>
  )
}

export function WickVsClose() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2.5">
      <div className="rounded-lg border border-surface-700/50 bg-surface-950/50 px-3 py-2.5">
        <svg viewBox="0 0 150 80" className="w-full h-auto block max-w-[260px] mx-auto" role="img" aria-label="Candle wicks below the rail but closes above it — noise, keep holding">
          <line x1="4" y1="61" x2="146" y2="50" stroke={RAIL_COLORS.ema20} strokeWidth="1.8" />
          <text x="146" y="46" fontSize="8.5" fontWeight="700" fill={RAIL_COLORS.ema20} textAnchor="end" fontFamily="JetBrains Mono, monospace">20</text>
          <Candle x={25} top={40} bot={48} hi={36} lo={52} up />
          <Candle x={55} top={34} bot={43} hi={30} lo={47} up />
          <Candle x={85} top={30} bot={40} hi={26} lo={70} up />
          <Candle x={115} top={24} bot={33} hi={20} lo={37} up />
          <circle cx="85" cy="63" r="7.5" fill="none" stroke={RAIL_COLORS.muted} strokeWidth="1" strokeDasharray="2.5 2" />
        </svg>
        <p className="mt-1.5 text-[11px] text-surface-400 leading-snug text-center">
          Wick pierces the rail, <span className="text-surface-200 font-semibold">closes back above</span> → noise. Hold.
        </p>
      </div>
      <div className="rounded-lg border border-danger/25 bg-danger/[0.04] px-3 py-2.5">
        <svg viewBox="0 0 150 80" className="w-full h-auto block max-w-[260px] mx-auto" role="img" aria-label="Candle body closes below the rail — signal, act on it">
          <line x1="4" y1="55" x2="146" y2="47" stroke={RAIL_COLORS.ema20} strokeWidth="1.8" />
          <text x="146" y="43" fontSize="8.5" fontWeight="700" fill={RAIL_COLORS.ema20} textAnchor="end" fontFamily="JetBrains Mono, monospace">20</text>
          <Candle x={25} top={32} bot={40} hi={28} lo={44} up />
          <Candle x={55} top={30} bot={38} hi={26} lo={42} up />
          <Candle x={85} top={36} bot={46} hi={32} lo={50} up={false} />
          <Candle x={115} top={46} bot={64} hi={42} lo={68} up={false} />
          <circle cx="115" cy="60" r="7.5" fill="none" stroke={RAIL_COLORS.danger} strokeWidth="1.2" />
        </svg>
        <p className="mt-1.5 text-[11px] text-surface-400 leading-snug text-center">
          Body <span className="text-danger font-semibold">closes below at 4:00 PM</span> → signal. Act on it.
        </p>
      </div>
    </div>
  )
}
