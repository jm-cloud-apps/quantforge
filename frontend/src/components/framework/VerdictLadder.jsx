import { TONE } from './tones'

// The three-row verdict table every framework panel ends on: a monospace
// situation label, a tone-chipped verdict, and the one-line note. Rows are
// { key, tone, label, verdict, note }.

export default function VerdictLadder({ rows }) {
  return (
    <div className="rounded-xl border border-surface-700/40 bg-surface-900/30 divide-y divide-surface-700/40">
      {rows.map(row => {
        const tone = TONE[row.tone]
        return (
          <div key={row.key} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 px-4 py-2.5">
            <span className="font-mono text-[12px] text-surface-200 sm:w-[290px] shrink-0">{row.label}</span>
            <span className={`inline-flex self-start items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border shrink-0 ${tone.chip}`}>
              {row.verdict}
            </span>
            <p className="text-[11.5px] text-surface-400 leading-snug">{row.note}</p>
          </div>
        )
      })}
    </div>
  )
}
