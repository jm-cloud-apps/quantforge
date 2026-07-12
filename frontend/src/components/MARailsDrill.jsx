import { useState } from 'react'
import { MA_DRILLS } from '../utils/tradingRules'
import { DRILL_CHARTS, RAIL_COLORS, railLabels } from './maRailsCharts'
import { Candle } from './MARailsVisuals'

// Rail Reps — active-recall drill for the MA Rails framework. Reading rules
// doesn't ingrain them; being shown a situation and making the call does.
// Scenario content lives in utils/tradingRules.js (MA_DRILLS), line-chart
// scenes in maRailsCharts.js; the two candle scenes (intraday wick vs daily
// close) are drawn here. Streak/rep counts persist in localStorage.

const STORE_KEY = 'qf:ma-drill:v1'

function loadStats() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY))
    return { reps: 0, streak: 0, best: 0, ...(raw || {}) }
  } catch {
    return { reps: 0, streak: 0, best: 0 }
  }
}

function saveStats(stats) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(stats)) } catch {}
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Fresh scenario order; re-deals when the deck runs out, avoiding an
// immediate repeat of the last scenario across the reshuffle boundary.
function dealDeck(avoidFirst = null) {
  let deck = shuffle(MA_DRILLS)
  if (avoidFirst && deck.length > 1 && deck[0].key === avoidFirst) {
    deck = [...deck.slice(1), deck[0]]
  }
  return deck
}

// ---------------------------------------------------------------- scenes

function LineScene({ chart, label }) {
  const labels = railLabels(chart.railEnds)
  return (
    <svg viewBox={`0 0 ${chart.w} ${chart.h}`} className="w-full h-auto block" role="img" aria-label={label}>
      {chart.rails.includes('sma50') && (
        <path d={chart.paths.sma50} fill="none" stroke={RAIL_COLORS.sma50} strokeWidth="2" strokeLinejoin="round" />
      )}
      {chart.rails.includes('ema20') && (
        <path d={chart.paths.ema20} fill="none" stroke={RAIL_COLORS.ema20} strokeWidth="2" strokeLinejoin="round" />
      )}
      {chart.rails.includes('ema10') && (
        <path d={chart.paths.ema10} fill="none" stroke={RAIL_COLORS.ema10} strokeWidth="2" strokeLinejoin="round" />
      )}
      <path d={chart.paths.price} fill="none" stroke={RAIL_COLORS.price} strokeWidth="2" strokeOpacity="0.9" strokeLinejoin="round" />
      {labels.map(l => (
        <text key={l.key} x={l.x + 5} y={l.y + 3.5} fontSize="10.5" fontWeight="700" fill={l.color} fontFamily="JetBrains Mono, monospace">
          {l.key}
        </text>
      ))}
      {/* the decision point — the tape ends here on purpose */}
      <circle cx={chart.marker.x} cy={chart.marker.y} r="7" fill="none" stroke={RAIL_COLORS.price} strokeWidth="1" strokeOpacity="0.5" className="animate-pulse-soft" />
      <circle cx={chart.marker.x} cy={chart.marker.y} r="2.6" fill={RAIL_COLORS.price} />
      <text x={chart.marker.x - 10} y={chart.marker.y - 8} fontSize="8.5" fontWeight="700" fill={RAIL_COLORS.muted} textAnchor="end" fontFamily="JetBrains Mono, monospace">
        NOW
      </text>
    </svg>
  )
}

// Intraday wick vs daily close — same setup as the iron-law panels but
// framed as a live decision.
function CandleScene({ variant }) {
  const wick = variant === 'wick'
  return (
    <svg
      viewBox="0 0 340 130"
      className="w-full h-auto block max-w-[420px] mx-auto"
      role="img"
      aria-label={wick
        ? 'Uptrending candles above the 20-day line; the latest candle wicked below it but trades back above, session still open'
        : 'Uptrending candles above the 20-day line; the final candle body closed below it at 4 PM'}
    >
      <line x1="10" y1="92" x2="330" y2="74" stroke={RAIL_COLORS.ema20} strokeWidth="2" />
      <text x="330" y="68" fontSize="10.5" fontWeight="700" fill={RAIL_COLORS.ema20} textAnchor="end" fontFamily="JetBrains Mono, monospace">20</text>
      <Candle x={55} top={54} bot={66} hi={48} lo={72} up w={13} />
      <Candle x={120} top={44} bot={57} hi={38} lo={62} up w={13} />
      {wick ? (
        <>
          <Candle x={185} top={40} bot={52} hi={34} lo={58} up w={13} />
          <Candle x={250} top={36} bot={50} hi={30} lo={112} up w={13} />
          <circle cx="250" cy="102" r="10" fill="none" stroke={RAIL_COLORS.muted} strokeWidth="1.2" strokeDasharray="3 2.5" />
          <text x="268" y="106" fontSize="8.5" fontWeight="700" fill={RAIL_COLORS.muted} fontFamily="JetBrains Mono, monospace">2:30 PM</text>
        </>
      ) : (
        <>
          <Candle x={185} top={48} bot={60} hi={42} lo={66} up={false} w={13} />
          <Candle x={250} top={62} bot={98} hi={56} lo={106} up={false} w={13} />
          <circle cx="250" cy="94" r="10" fill="none" stroke={RAIL_COLORS.danger} strokeWidth="1.3" />
          <text x="268" y="98" fontSize="8.5" fontWeight="700" fill={RAIL_COLORS.danger} fontFamily="JetBrains Mono, monospace">4:00 PM</text>
        </>
      )}
    </svg>
  )
}

// ------------------------------------------------------------------ drill

export default function MARailsDrill() {
  const [deck, setDeck] = useState(() => dealDeck())
  const [idx, setIdx] = useState(0)
  const [options, setOptions] = useState(() => shuffle(deck[0].options))
  const [picked, setPicked] = useState(null)
  const [stats, setStats] = useState(loadStats)

  const drill = deck[idx]
  const answered = picked !== null
  const wasCorrect = answered && picked.correct === true

  const pick = option => {
    if (answered) return
    setPicked(option)
    const correct = option.correct === true
    const streak = correct ? stats.streak + 1 : 0
    const next = {
      reps: stats.reps + 1,
      streak,
      best: Math.max(stats.best, streak),
    }
    setStats(next)
    saveStats(next)
  }

  const nextRep = () => {
    let d = deck
    let i = idx + 1
    if (i >= d.length) {
      d = dealDeck(drill.key)
      i = 0
      setDeck(d)
    }
    setIdx(i)
    setOptions(shuffle(d[i].options))
    setPicked(null)
  }

  return (
    <div className="rounded-xl border border-surface-700/50 bg-surface-900/50 px-4 py-3.5">
      <div className="flex items-center gap-2 flex-wrap mb-2.5">
        <svg className="w-4 h-4 text-warning shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span className="text-[11px] font-bold tracking-widest text-surface-200 uppercase">Rail reps — make the call</span>
        <span className="flex-1" />
        <span className="text-[10px] font-mono text-surface-500">
          reps <span className="text-surface-300">{stats.reps}</span>
          <span className="mx-1.5 text-surface-700">·</span>
          streak <span className={stats.streak > 0 ? 'text-accent' : 'text-surface-300'}>{stats.streak}</span>
          <span className="mx-1.5 text-surface-700">·</span>
          best <span className="text-surface-300">{stats.best}</span>
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <div className="rounded-lg border border-surface-700/40 bg-surface-950/60 px-2 py-2">
          {drill.chart === 'wick' || drill.chart === 'closeBelow' ? (
            <CandleScene variant={drill.chart} />
          ) : (
            <LineScene chart={DRILL_CHARTS[drill.chart]} label={drill.prompt} />
          )}
        </div>

        <div>
          <p className="text-[13px] text-surface-200 leading-snug font-medium">{drill.prompt}</p>
          <div className="mt-2.5 space-y-1.5">
            {options.map((o, i) => {
              const isPicked = picked === o
              const isCorrect = o.correct === true
              let cls = 'border-surface-700 bg-surface-900/60 text-surface-300 hover:border-surface-600 hover:text-surface-100'
              if (answered) {
                if (isCorrect) cls = 'border-accent/60 bg-accent/10 text-accent'
                else if (isPicked) cls = 'border-danger/60 bg-danger/10 text-danger'
                else cls = 'border-surface-700/50 bg-surface-900/40 text-surface-500'
              }
              return (
                <button
                  key={i}
                  type="button"
                  disabled={answered}
                  onClick={() => pick(o)}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-[12.5px] font-medium transition-colors ${cls} ${answered ? 'cursor-default' : ''}`}
                >
                  {o.text}
                </button>
              )
            })}
          </div>

          {answered && (
            <div className={`mt-2.5 rounded-lg border px-3 py-2.5 animate-fade-in ${wasCorrect ? 'border-accent/30 bg-accent/[0.06]' : 'border-danger/30 bg-danger/[0.06]'}`}>
              <div className={`text-[10px] font-bold tracking-widest uppercase mb-1 ${wasCorrect ? 'text-accent' : 'text-danger'}`}>
                {wasCorrect ? 'Correct' : 'Not this time'}
              </div>
              <p className="text-[12px] text-surface-300 leading-snug">{drill.explain}</p>
              <button
                type="button"
                onClick={nextRep}
                className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-surface-600 bg-surface-800/80 text-[12px] font-semibold text-surface-100 hover:border-surface-500 transition-colors"
              >
                Next rep
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
