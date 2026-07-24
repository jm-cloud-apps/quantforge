// The framework-panel chrome every section on the Rules page shares: the
// rounded section shell with its identity border, the gradient top accent, the
// decorative orb, and the title row that doubles as the collapse toggle
// (keyboard-accessible, chevron state). Children render only while expanded —
// collapsed panels unmount their content, which is what keeps the collapsed
// page cheap.
//
// All class-name props are full literal Tailwind strings supplied by each
// panel (JIT needs literals at the call site):
//   border   — section border  (e.g. 'border-danger/25')
//   accent   — top gradient    (e.g. 'from-danger via-warning to-purple')
//   orb      — orb tint        (e.g. 'bg-danger/10')
//   orbSide  — 'left' | 'right'
//   iconTone — icon plate      (e.g. 'bg-danger/10 border-danger/30 text-danger')
//   badges   — [{ text, cls }] chips on the right of the title row

export default function PanelShell({
  id,
  titleId,
  title,
  subtitle,
  icon,
  iconTone,
  border,
  accent,
  orb,
  orbSide = 'left',
  badges = [],
  collapsible = false,
  collapsed = false,
  onToggle,
  children,
}) {
  const expanded = !collapsible || !collapsed
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={`relative overflow-hidden rounded-3xl border ${border} bg-gradient-to-br from-surface-900 via-surface-900 to-surface-950 scroll-mt-[116px] lg:scroll-mt-[64px]`}
    >
      <div className={`absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r ${accent} opacity-70`} />
      <div className={`absolute -top-16 ${orbSide === 'right' ? '-right-16' : '-left-16'} w-72 h-72 rounded-full ${orb} blur-3xl pointer-events-none`} />

      <div className="relative px-6 sm:px-7 py-6 sm:py-7">
        {/* Title row — doubles as the collapse toggle when embedded on Rules */}
        <div
          {...(collapsible ? { role: 'button', tabIndex: 0, 'aria-expanded': expanded, onClick: onToggle, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.() } } } : {})}
          className={`flex items-start justify-between gap-3 flex-wrap mb-1 ${collapsible ? 'cursor-pointer select-none' : ''}`}
        >
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${iconTone}`}>
              {icon}
            </div>
            <div>
              <h2 id={titleId} className="text-[16px] font-display font-bold text-surface-50 tracking-tight leading-tight">
                {title}
              </h2>
              <div className="text-[11px] text-surface-500 mt-0.5">{subtitle}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {badges.map(b => (
              <span key={b.text} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${b.cls}`}>
                {b.text}
              </span>
            ))}
            {collapsible && (
              <svg className={`w-4 h-4 text-surface-500 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </div>
        </div>

        {expanded && children}
      </div>
    </section>
  )
}
