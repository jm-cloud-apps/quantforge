// Shared display formatters for the scanner / analytics pages.
//
// These were copy-pasted verbatim across every Find-Setups scanner page
// (ReversalSetup, Scanner9M, MAReclaim, StageAnalysis, ParabolicShort, …). One
// canonical source keeps the tables consistent — same em-dash for missing
// values, same thousands separators, same "just now / 5m ago" freshness copy —
// and means a new scanner page imports instead of re-deriving them.
//
// All are null/NaN-safe and return the em-dash placeholder for missing values.

const MISSING = '—'

function isMissing(n) {
  return n === null || n === undefined || Number.isNaN(n)
}

// Whole number with locale grouping: 1234567 → "1,234,567".
export function fmtInt(n) {
  if (isMissing(n)) return MISSING
  return Number(n).toLocaleString('en-US')
}

// Fixed-decimal dollars: 49.4 → "$49.40".
export function fmtMoney(n, digits = 2) {
  if (isMissing(n)) return MISSING
  return `$${Number(n).toFixed(digits)}`
}

// Abbreviated dollars for large magnitudes: 23_119_335 → "$23.1M".
export function fmtCompactDollars(n) {
  if (isMissing(n)) return MISSING
  const v = Math.abs(Number(n))
  if (v >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${Number(n).toFixed(0)}`
}

// A scan is considered stale (worth a visual "Stale" flag) after this many
// minutes — the underlying data refreshes far more often than this in-session.
export const STALE_AFTER_MIN = 90

// Compact relative age of an ISO timestamp for the "Updated …" freshness label.
// Returns null past 24h (the caller falls back to the absolute date).
export function fmtRelativeAge(iso) {
  if (!iso) return null
  try {
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return null
    const diffMs = Date.now() - then
    if (diffMs < 0) return 'just now'
    const sec = Math.floor(diffMs / 1000)
    if (sec < 60) return 'just now'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    return null
  } catch {
    return null
  }
}

// True when a scan's timestamp is older than `staleAfterMin` minutes.
export function isScanStale(iso, staleAfterMin = STALE_AFTER_MIN) {
  if (!iso) return false
  try {
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return false
    return (Date.now() - then) / 60000 > staleAfterMin
  } catch {
    return false
  }
}
