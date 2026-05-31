// Market-clock helpers — mirror of backend/market_clock.py.
//
// When the US market isn't actively trading, the underlying data is frozen,
// so all the localStorage caches across the app can extend their TTL.
//
// "Active" window per user spec:
//   - US weekday (Mon-Fri)
//   - NOT a full NYSE holiday
//   - BEFORE 2:00 PM Pacific (5:00 PM Eastern — covers regular session + 1h
//     of after-hours grace)
//
// Default TTLs:
//   - active session: 10 minutes  (matches backend qullamaggie response cache)
//   - closed:          4 hours
//
// Keep this list in sync with backend/market_clock.py::_NYSE_HOLIDAYS.

const NYSE_HOLIDAYS = new Set([
  // 2025
  '2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18',
  '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27',
  '2025-12-25',
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
])

/** Decompose `now` into PT date + weekday + hour parts using Intl. */
function ptParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  // Intl returns "24" for midnight in hour12: false in some browsers — normalize.
  let hour = parseInt(parts.hour, 10)
  if (hour === 24) hour = 0
  return {
    weekday: parts.weekday,                                              // "Mon"..."Sun"
    iso: `${parts.year}-${parts.month}-${parts.day}`,                    // "YYYY-MM-DD"
    hour,                                                                 // 0..23
  }
}

export function isMarketActiveNow() {
  const { weekday, iso, hour } = ptParts()
  if (weekday === 'Sat' || weekday === 'Sun') return false
  if (NYSE_HOLIDAYS.has(iso)) return false
  if (hour >= 14) return false   // 2pm PT cutoff per user spec
  return true
}

/** Cache TTL in ms. Active session uses `activeTtlMs`; otherwise `closedTtlMs`. */
export function effectiveCacheTtlMs(activeTtlMs, closedTtlMs = 4 * 60 * 60 * 1000) {
  return isMarketActiveNow() ? activeTtlMs : closedTtlMs
}

// Human-readable status for UI badges ("Market closed · cache extended" etc.).
export function marketStatusLabel() {
  const { weekday, iso, hour } = ptParts()
  if (weekday === 'Sat' || weekday === 'Sun') return 'Weekend'
  if (NYSE_HOLIDAYS.has(iso)) return 'US holiday'
  if (hour >= 14) return 'After hours'
  return 'Open'
}
