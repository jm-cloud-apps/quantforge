import { VOLUME_PATTERNS } from '../utils/tradingRules'
import { VolumeHero, VolumeGlyph } from './VolumeVisuals'

// Volume Patterns — the "second opinion" framework panel on the Rules page,
// deliberately paired with MA Rails (components/MARails.jsx): the rail says
// where, volume says whether to believe it. Data lives in
// utils/tradingRules.js (VOLUME_PATTERNS / VOLUME_PHASES) and geometry in
// volumeCharts.js; this file is presentation only.

// Tailwind needs literal class names, so per-tone classes are enumerated
// rather than built from the color. `glyph` tone is passed straight through.
const TONE = {
  good: { text: 'text-accent', border: 'border-accent/40', bgSoft: 'bg-accent/[0.04]', bar: 'bg-accent', chip: 'bg-accent/10 text-accent border-accent/30' },
  info: { text: 'text-cyan', border: 'border-cyan/40', bgSoft: 'bg-cyan/[0.04]', bar: 'bg-cyan', chip: 'bg-cyan/10 text-cyan border-cyan/30' },
  warn: { text: 'text-warning', border: 'border-warning/40', bgSoft: 'bg-warning/[0.05]', bar: 'bg-warning', chip: 'bg-warning/10 text-warning border-warning/30' },
  bad: { text: 'text-danger', border: 'border-danger/40', bgSoft: 'bg-danger/[0.05]', bar: 'bg-danger', chip: 'bg-danger/10 text-danger border-danger/30' },
}

const SIGNAL_LABEL = { confirm: 'CONFIRM', caution: 'CAUTION' }

function PatternCard({ p }) {
  const tone = TONE[p.tone]
  return (
    <div className={`relative rounded-2xl border overflow-hidden ${tone.border} ${tone.bgSoft} flex flex-col`}>
      <div className={`absolute left-0 right-0 top-0 h-0.5 ${tone.bar} opacity-80`} />
      <div className="p-4 flex flex-col h-full">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className={`text-[14px] font-bold tracking-tight ${tone.text}`}>{p.title}</div>
            <div className="text-[11px] text-surface-500 mt-0.5">{p.tagline}</div>
          </div>
          <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${tone.chip}`}>
            {SIGNAL_LABEL[p.signal]}
          </span>
        </div>

        <div className="mt-3">
          <VolumeGlyph glyphKey={p.glyph} tone={p.tone} />
        </div>

        <div className="mt-3 space-y-2">
          <div>
            <div className="text-[9px] font-bold tracking-widest text-surface-500 uppercase mb-0.5">Looks like</div>
            <p className="text-[12px] text-surface-300 leading-snug">{p.what}</p>
          </div>
          <div>
            <div className="text-[9px] font-bold tracking-widest text-surface-500 uppercase mb-0.5">Means</div>
            <p className="text-[12px] text-surface-400 leading-snug">{p.why}</p>
          </div>
        </div>

        <div className="flex-1" />

        <div className={`mt-3 rounded-lg border ${tone.border} ${tone.bgSoft} px-3 py-2`}>
          <div className={`text-[9px] font-bold tracking-widest uppercase mb-0.5 ${tone.text}`}>The rule</div>
          <p className="text-[11.5px] text-surface-200 leading-snug">{p.rule}</p>
        </div>
      </div>
    </div>
  )
}

export default function VolumePatterns() {
  return (
    <section
      aria-labelledby="volume-patterns-title"
      className="relative overflow-hidden rounded-3xl border border-accent/25 bg-gradient-to-br from-surface-900 via-surface-900 to-surface-950"
    >
      <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-accent via-cyan to-warning opacity-70" />
      <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

      <div className="relative px-6 sm:px-7 py-6 sm:py-7">
        {/* Title row */}
        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center text-accent">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125h3.75v6.75H3v-6.75zM9.75 8.625h3.75v11.25H9.75V8.625zM16.5 4.125h3.75v15.75H16.5V4.125z" />
              </svg>
            </div>
            <div>
              <h2 id="volume-patterns-title" className="text-[16px] font-display font-bold text-surface-50 tracking-tight leading-tight">
                Volume Patterns
              </h2>
              <div className="text-[11px] text-surface-500 mt-0.5">
                The second opinion on every rail signal — the chart says where, volume says whether to believe it.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-accent/10 text-accent border-accent/30">
              SWING
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border bg-surface-800/60 text-surface-400 border-surface-700">
              FRAMEWORK
            </span>
          </div>
        </div>

        {/* Hero — the volume signature of one full trade */}
        <div className="mt-5">
          <VolumeHero />
        </div>

        {/* Pattern cards */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {VOLUME_PATTERNS.map(p => (
            <PatternCard key={p.key} p={p} />
          ))}
        </div>

        {/* Pairs with the rails */}
        <div className="mt-4 rounded-xl border border-cyan/25 bg-cyan/[0.05] px-4 py-3 flex items-start gap-2.5">
          <svg className="w-4 h-4 mt-[1px] shrink-0 text-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
          <p className="text-[12.5px] text-surface-200 leading-snug">
            <span className="font-semibold text-cyan">Pairs with the rails:</span> volume grades every rail signal.
            Dry-up into the pivot, a <span className="font-semibold">surge</span> on the break, light volume on the
            pullback-to-add, and <span className="font-semibold">heavy</span> volume on the close-below-to-exit. A rail
            event on the wrong volume is a half-signal — wait for both to agree.
          </p>
        </div>
      </div>
    </section>
  )
}
