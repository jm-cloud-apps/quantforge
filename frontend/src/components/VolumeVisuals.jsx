import { useState } from 'react'
import { VOLUME_PHASES } from '../utils/tradingRules'
import { VOLUME_HERO, VOLUME_GLYPHS, VOL_COLORS } from './volumeCharts'

// SVG visuals for the Volume Patterns panel (VolumePatterns.jsx). Geometry is
// precomputed in volumeCharts.js — volume bars derived from the same price
// tape — so these components only draw. Bar identity (up/down) is carried by
// color *and* height *and* the card text, never color alone.

// Phase tones → the panel's semantic colors.
const PHASE_HEX = {
  good: VOL_COLORS.up,
  info: VOL_COLORS.hi,
  warn: '#F59E0B', // warning
  bad: VOL_COLORS.down,
}

function VolumeBars({ bars, colorFor }) {
  return (
    <>
      {bars.map((b, i) => (
        <rect
          key={i}
          x={b.x}
          y={b.y}
          width={b.w}
          height={Math.max(b.h, 1)}
          rx={Math.min(b.w / 2, 1.5)}
          fill={colorFor(b, i)}
        />
      ))}
    </>
  )
}

// ------------------------------------------------------------------ HERO
// One trade seen through volume, with numbered phase markers pinned to the
// tallest bar of each event and a hover/click caption strip below — mirrors
// the AnatomyChart interaction on the MA Rails panel.

export function VolumeHero() {
  const [pinned, setPinned] = useState(null)
  const [hovered, setHovered] = useState(null)
  const focusKey = hovered || pinned
  const detail = VOLUME_PHASES.find(p => p.key === focusKey) || null
  const h = VOLUME_HERO

  const colorFor = b => {
    if (b.up) return b.strong ? VOL_COLORS.up : VOL_COLORS.upSoft
    return b.strong ? VOL_COLORS.down : VOL_COLORS.downSoft
  }

  const togglePin = key => setPinned(k => (k === key ? null : key))

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-[9.5px] font-bold tracking-widest text-surface-500 uppercase">
          The volume signature of a winner — one trade, base to blow-off
        </div>
        <div className="text-[10px] text-surface-500">
          Grey = price · bars = volume · dashed = average
        </div>
      </div>

      <div className="mt-2 rounded-xl border border-surface-700/40 bg-surface-950/60 px-1 py-1">
        <svg
          viewBox={`0 0 ${h.w} ${h.h}`}
          className="w-full h-auto block"
          role="img"
          aria-label="Price line above a panel of volume bars: quiet dry-up through the base, a tall volume surge on the breakout, volume fading on the pullback to the rail, expansion on the next leg, and a climactic volume spike at the top"
        >
          {/* volume panel */}
          <line x1="6" y1={h.avgY} x2={h.w - 6} y2={h.avgY} stroke={VOL_COLORS.avg} strokeWidth="1" strokeDasharray="4 4" strokeOpacity="0.7" />
          <text x={h.w - 6} y={h.avgY - 4} fontSize="8.5" fill={VOL_COLORS.avg} textAnchor="end" fontFamily="JetBrains Mono, monospace">avg vol</text>
          <VolumeBars bars={h.bars} colorFor={colorFor} />

          {/* price + fast rail */}
          <path d={h.maD} fill="none" stroke={VOL_COLORS.ma} strokeWidth="1.6" strokeOpacity="0.6" strokeLinejoin="round" />
          <path d={h.priceD} fill="none" stroke={VOL_COLORS.price} strokeWidth="2.2" strokeLinejoin="round" />

          {/* numbered phase markers, pinned to each event's tallest bar */}
          {VOLUME_PHASES.map((p, i) => {
            const a = h.anno[i]
            if (!a) return null
            const tone = PHASE_HEX[p.tone]
            const active = focusKey === p.key
            const dim = focusKey && !active
            const cy = a.topY - 14
            return (
              <g
                key={p.key}
                opacity={dim ? 0.3 : 1}
                className="cursor-pointer transition-opacity"
                onMouseEnter={() => setHovered(p.key)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => togglePin(p.key)}
              >
                <line x1={a.x} y1={a.topY - 3} x2={a.x} y2={cy + 9} stroke={tone} strokeWidth="1" strokeOpacity="0.55" />
                <circle cx={a.x} cy={cy} r={active ? 10.5 : 9} fill="#0F1623" stroke={tone} strokeWidth={active ? 2 : 1.3} />
                <text x={a.x} y={cy + 3.5} fontSize="10" fontWeight="700" fill={tone} textAnchor="middle" fontFamily="JetBrains Mono, monospace">
                  {p.n}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Phase captions */}
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
        {VOLUME_PHASES.map(p => {
          const tone = PHASE_HEX[p.tone]
          const active = focusKey === p.key
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
            <span className="font-semibold" style={{ color: PHASE_HEX[detail.tone] }}>
              {detail.n} · {detail.title}.
            </span>{' '}
            {detail.text}
          </p>
        ) : (
          <p className="text-[12px] text-surface-500 leading-snug">
            Hover or tap ① to ⑤ — the volume story of a single trade. Green bars are up days, red are down; taller means heavier.
          </p>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ GLYPH
// Compact volume-bar signature inside each pattern card. Highlighted bars use
// the card's tone at full strength; the rest sit muted so the pattern pops.

export function VolumeGlyph({ glyphKey, tone }) {
  const g = VOLUME_GLYPHS[glyphKey]
  const hiHex = PHASE_HEX[tone]
  const colorFor = b => {
    if (b.hi) return hiHex
    if (b.up) return VOL_COLORS.upSoft
    return VOL_COLORS.downSoft
  }
  return (
    <svg
      viewBox={`0 0 ${g.w} ${g.h}`}
      className="w-full h-auto block rounded-lg bg-surface-950/60"
      role="img"
      aria-hidden="true"
    >
      {/* baseline */}
      <line x1="6" y1={g.base + 0.5} x2={g.w - 6} y2={g.base + 0.5} stroke={VOL_COLORS.avg} strokeWidth="0.75" strokeOpacity="0.4" />
      <VolumeBars bars={g.bars} colorFor={colorFor} />
      {g.priceD && (
        <path d={g.priceD} fill="none" stroke={VOL_COLORS.price} strokeWidth="1.4" strokeOpacity="0.75" strokeLinejoin="round" strokeLinecap="round" />
      )}
    </svg>
  )
}
