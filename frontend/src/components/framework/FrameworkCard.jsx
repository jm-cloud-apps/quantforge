import Scene from './Scene'
import { TONE, SIGNAL_LABEL } from './tones'
import { useDensity } from './density'

// The standard framework card: tone-tinted shell, optional sequence-number
// chip, title/tagline + signal chip, a drawn Scene, the Looks like / Means
// pair, and "The rule" verdict box. Every scene panel's card (tells, rail
// candles, short side, base patterns, lifecycle phases) is this one layout.
//
//   t        — { tone, signal, title, tagline, what, why, rule }
//   spec     — the SCENES entry for the card's glyph
//   step     — optional 1-based sequence number (renders the 01/02/03 chip)
//   children — optional extra block rendered just above "The rule" (the Entries
//              panel uses it for the trigger/stop spec strip)

export default function FrameworkCard({ t, spec, step, children }) {
  const tone = TONE[t.tone]
  // In brief mode the card keeps its identity (title, tagline, signal) and its
  // verdict, and drops the scene + the Looks like / Means prose — the two parts
  // that make the page long. Anything a panel passes as children (the Entries
  // trigger/stop strip) is a spec, not prose, so it stays.
  const brief = useDensity() === 'brief'
  return (
    <div className={`relative rounded-2xl border overflow-hidden ${tone.border} ${tone.bgSoft} flex flex-col`}>
      <div className={`absolute left-0 right-0 top-0 h-0.5 ${tone.bar} opacity-80`} />
      <div className="p-4 flex flex-col h-full">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0">
            {step != null && (
              <div className={`shrink-0 w-7 h-7 rounded-lg bg-surface-800 border border-surface-700 flex items-center justify-center font-mono font-bold text-[11px] ${tone.text}`}>
                {String(step).padStart(2, '0')}
              </div>
            )}
            <div className="min-w-0">
              <div className={`text-[14px] font-bold tracking-tight ${tone.text}`}>{t.title}</div>
              <div className="text-[11px] text-surface-500 mt-0.5">{t.tagline}</div>
            </div>
          </div>
          <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${tone.chip}`}>
            {SIGNAL_LABEL[t.signal]}
          </span>
        </div>

        {!brief && (
          <>
            <div className="mt-3">
              <Scene spec={spec} toneHex={tone.hex} label={`${t.title}: ${t.what}`} />
            </div>

            <div className="mt-3 space-y-2">
              <div>
                <div className="text-[9px] font-bold tracking-widest text-surface-500 uppercase mb-0.5">Looks like</div>
                <p className="text-[12px] text-surface-300 leading-snug">{t.what}</p>
              </div>
              <div>
                <div className="text-[9px] font-bold tracking-widest text-surface-500 uppercase mb-0.5">Means</div>
                <p className="text-[12px] text-surface-400 leading-snug">{t.why}</p>
              </div>
            </div>
          </>
        )}

        <div className="flex-1" />

        {children}

        <div className={`mt-3 rounded-lg border ${tone.border} ${tone.bgSoft} px-3 py-2`}>
          <div className={`text-[9px] font-bold tracking-widest uppercase mb-0.5 ${tone.text}`}>The rule</div>
          <p className="text-[11.5px] text-surface-200 leading-snug">{t.rule}</p>
        </div>
      </div>
    </div>
  )
}
