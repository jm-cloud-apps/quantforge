import { Candle } from '../MARailsVisuals'
import { VOL_COLORS } from '../volumeCharts'
import { TONE } from './tones'

// Unified scene renderer for the framework panels — one 220×96 stage that
// covers every drawing feature the per-panel Scene copies had grown:
//
//   candles   [{x, top, bot, hi, lo, up, w?}]           — via the shared Candle
//   vols      [0..1 heights] + hiVol (highlighted idx)  — volume sticks from y=90
//   volW      stick width (default 10; dense scenes use 8)
//   rail      {x0,y0,x1,y1,label?}   — sloped MA; label auto-sits above a rising
//                                      rail and below a declining one
//   line      {y}                    — flat full-width level (MA tone)
//   guide     {…} or guides [{y,x0,x1,tone?:'stop',label?}]
//                                    — dashed reference levels; tone 'stop'
//                                      renders red with a STOP tag
//   vlines    [{x,label}]            — dashed vertical event markers (earnings)
//   dayLabels [{x,t}] + arrow {x0,x1,y} — the weekly-compression scene
//   mark      {x,y,r}                — the dashed spotlight ring
//
// `toneHex` colors the highlighted volume stick + the mark ring.

const VOL_BASE = 90
const VOL_MAX_H = 20
const MONO = 'JetBrains Mono, monospace'

export default function Scene({ spec, toneHex, label }) {
  const guides = spec.guides || (spec.guide ? [spec.guide] : [])
  const railLabelBelow = spec.rail && spec.rail.y1 > spec.rail.y0 // declining rail
  return (
    <svg viewBox="0 0 220 96" className="w-full h-auto block rounded-lg bg-surface-950/60" role="img" aria-label={label}>
      {spec.line && (
        <line x1="10" y1={spec.line.y} x2="210" y2={spec.line.y}
          stroke={VOL_COLORS.ma} strokeWidth="1.6" strokeOpacity="0.8" />
      )}
      {spec.rail && (
        <g>
          <line x1={spec.rail.x0} y1={spec.rail.y0} x2={spec.rail.x1} y2={spec.rail.y1}
            stroke={VOL_COLORS.ma} strokeWidth="1.8" strokeOpacity="0.85" strokeLinecap="round" />
          {spec.rail.label && (
            <text x={spec.rail.x1 - 2} y={railLabelBelow ? spec.rail.y1 + 9 : spec.rail.y1 - 4}
              fontSize="7" fontWeight="700" fill={VOL_COLORS.ma} textAnchor="end" fontFamily={MONO}>
              {spec.rail.label}
            </text>
          )}
        </g>
      )}
      {spec.vlines && spec.vlines.map((v, i) => (
        <g key={`vl${i}`}>
          <line x1={v.x} y1="6" x2={v.x} y2="84" stroke={VOL_COLORS.avg}
            strokeWidth="0.9" strokeDasharray="3 3" strokeOpacity="0.7" />
          <text x={v.x} y="94" fontSize="7" fontWeight="700" fill={VOL_COLORS.avg}
            textAnchor="middle" fontFamily={MONO}>{v.label}</text>
        </g>
      ))}
      {guides.map((g, i) => {
        const stop = g.tone === 'stop'
        const color = stop ? TONE.bad.hex : VOL_COLORS.avg
        const tag = stop ? 'STOP' : g.label
        return (
          <g key={`g${i}`}>
            <line x1={g.x0} y1={g.y} x2={g.x1} y2={g.y} stroke={color}
              strokeWidth="0.9" strokeDasharray="3 3" strokeOpacity={stop ? 0.85 : 0.7} />
            {tag && (
              <text x={g.x0 + 2} y={g.y - 2.5} fontSize="6.5" fontWeight="700" fill={color} fontFamily={MONO}>
                {tag}
              </text>
            )}
          </g>
        )
      })}
      {spec.candles.map((c, i) => (
        <Candle key={i} x={c.x} top={c.top} bot={c.bot} hi={c.hi} lo={c.lo} up={c.up} w={c.w ?? 11} />
      ))}
      {spec.vols && spec.vols.map((m, i) => {
        const c = spec.candles[i]
        const w = spec.volW ?? 10
        const h = m * VOL_MAX_H
        const hi = spec.hiVol === i
        return (
          <rect key={`v${i}`} x={c.x - w / 2} y={VOL_BASE - h} width={w} height={h} rx="1"
            fill={hi ? toneHex : VOL_COLORS.muted} fillOpacity={hi ? 0.9 : 0.55} />
        )
      })}
      {spec.mark && (
        <circle cx={spec.mark.x} cy={spec.mark.y} r={spec.mark.r} fill="none"
          stroke={toneHex} strokeWidth="1.2" strokeDasharray="3 2.5" strokeOpacity="0.9" />
      )}
      {spec.dayLabels && spec.dayLabels.map((d, i) => (
        <text key={`d${i}`} x={d.x} y="88" fontSize="7.5" fontWeight="700" fill={VOL_COLORS.avg}
          textAnchor="middle" fontFamily={MONO}>
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
