import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Lightweight, instant tooltip. The native `title` attribute waits ~1s before
 * the browser shows it; this appears the moment the pointer enters the trigger.
 *
 * The bubble is rendered through a portal into <body> and positioned with
 * `position: fixed`, so it is never clipped by a card's `overflow-hidden` and
 * never disturbs the trigger's own (often flex) layout. Pass layout/typography
 * classes through `className` — they apply to the trigger, exactly like the
 * <span> it replaces.
 */
export default function InfoTip({ label, children, className = '' }) {
  const triggerRef = useRef(null)
  const [coords, setCoords] = useState(null)

  function show() {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setCoords({ x: r.left + r.width / 2, y: r.top })
  }
  function hide() {
    setCoords(null)
  }

  return (
    <span
      ref={triggerRef}
      className={`cursor-help ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {coords &&
        createPortal(
          <span
            role="tooltip"
            style={{
              position: 'fixed',
              left: coords.x,
              top: coords.y - 8,
              transform: 'translate(-50%, -100%)',
              zIndex: 9999,
            }}
            className="pointer-events-none w-max max-w-[240px] rounded-md border border-surface-700 bg-surface-950 px-2.5 py-1.5 text-left text-[11px] font-normal normal-case leading-snug text-surface-200 shadow-xl"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  )
}
