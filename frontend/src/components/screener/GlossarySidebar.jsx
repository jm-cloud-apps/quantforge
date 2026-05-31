import { useEffect, useState } from 'react'

// Sticky right-side glossary panel for the Unusual Volume tab. Always
// reachable while scrolling tiles. Each term is its own expandable card so the
// panel doesn't become a wall of text. Collapsed state persists across
// sessions; on narrow screens defaults to collapsed.
//
// Why a sidebar (vs. nested in About): the About panel is an introduction;
// the glossary is a reference. Reference content belongs adjacent to the work,
// not embedded in the doc you scrolled past 30 seconds ago.

const STORAGE_KEY = 'breakouts:glossaryOpen'

const GlossarySidebar = ({ terms }) => {
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored != null) return stored === '1'
      // Default: open on wide screens, closed on narrow.
      return typeof window !== 'undefined' && window.innerWidth >= 1280
    } catch { return false }
  })
  const [expandedTerm, setExpandedTerm] = useState(null)

  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  // Close-on-Escape for the open state.
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') toggleOpen() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) {
    // Collapsed: a thin vertical tab that pokes out the right edge. Click to
    // expand. Stays at viewport y-center via fixed positioning.
    return (
      <button
        onClick={toggleOpen}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-30 px-2 py-3 rounded-l-lg bg-accent/15 border border-accent/40 border-r-0 text-accent hover:bg-accent/25 transition-colors writing-vertical"
        style={{ writingMode: 'vertical-rl' }}
        title="Open the trading-terms glossary (Esc to close)"
        aria-label="Open glossary"
      >
        <span className="text-[11px] font-bold uppercase tracking-wider">? Glossary</span>
      </button>
    )
  }

  return (
    <aside
      className="fixed right-0 top-20 bottom-4 z-30 w-80 max-w-[90vw] rounded-l-xl bg-surface-950 border border-r-0 border-accent/30 shadow-2xl flex flex-col"
      aria-label="Trading glossary"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700/40">
        <div>
          <div className="text-xs uppercase tracking-wider text-accent font-bold">Glossary</div>
          <div className="text-[11px] text-surface-500">Click a term to expand</div>
        </div>
        <button
          onClick={toggleOpen}
          className="text-surface-400 hover:text-surface-100 text-xl leading-none px-2"
          title="Close (Esc)"
          aria-label="Close glossary"
        >
          ×
        </button>
      </div>

      {/* Scrollable term list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {terms.map((g) => {
          const isOpen = expandedTerm === g.term
          return (
            <div
              key={g.term}
              className={`rounded-lg border transition-colors ${
                isOpen ? 'border-accent/40 bg-accent/5' : 'border-surface-700/40 bg-surface-900/60 hover:border-surface-600'
              }`}
            >
              <button
                onClick={() => setExpandedTerm(isOpen ? null : g.term)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
                aria-expanded={isOpen}
              >
                <span className="text-[13px] font-bold text-surface-100 truncate">{g.term}</span>
                <span
                  className={`shrink-0 text-surface-400 text-sm transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                >
                  ⌃
                </span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 space-y-1.5 border-t border-accent/15">
                  <div className="text-[12px] text-surface-300 leading-snug mt-2">
                    <span className="text-surface-500 uppercase text-[10px] tracking-wider mr-1">What it is:</span>
                    {g.plain}
                  </div>
                  <div className="text-[12px] text-surface-400 leading-snug">
                    <span className="text-surface-500 uppercase text-[10px] tracking-wider mr-1">Why it matters:</span>
                    {g.why}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}

export default GlossarySidebar
