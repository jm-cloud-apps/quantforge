/**
 * Earnings session glyph. A sun marks before-open (BMO) reports and a moon
 * marks after-close (AMC) reports. Returns null for unknown / TBD sessions so
 * the caller's slot is simply left blank rather than showing a meaningless mark.
 *
 * Pass sizing/spacing through `className` (e.g. "w-3 h-3 shrink-0").
 */
export default function EarningsSessionIcon({ time, className = '' }) {
  if (time === 'bmo') {
    return (
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        role="img"
        aria-label="Before open"
        className={`text-warning ${className}`}
      >
        <title>Before open</title>
        <path d="M10 2a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2zM10 15a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 15zM10 7a3 3 0 100 6 3 3 0 000-6zM4.343 5.404a.75.75 0 011.06 0l1.061 1.06a.75.75 0 01-1.06 1.061L4.343 6.465a.75.75 0 010-1.06zM13.536 14.596a.75.75 0 011.06 0l1.06 1.06a.75.75 0 11-1.06 1.061l-1.06-1.06a.75.75 0 010-1.061zM2 10a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5A.75.75 0 012 10zM15 10a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5A.75.75 0 0115 10zM5.404 15.657a.75.75 0 010-1.06l1.06-1.061a.75.75 0 011.061 1.06l-1.06 1.061a.75.75 0 01-1.061 0zM14.596 6.464a.75.75 0 010-1.06l1.06-1.06a.75.75 0 111.06 1.06l-1.06 1.06a.75.75 0 01-1.06 0z" />
      </svg>
    )
  }
  if (time === 'amc') {
    return (
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        role="img"
        aria-label="After close"
        className={`text-purple ${className}`}
      >
        <title>After close</title>
        <path
          fillRule="evenodd"
          d="M7.455 2.004a.75.75 0 01.26.77 7 7 0 009.958 7.967.75.75 0 011.067.853A8.5 8.5 0 116.647 1.921a.75.75 0 01.808.083z"
          clipRule="evenodd"
        />
      </svg>
    )
  }
  return null
}
