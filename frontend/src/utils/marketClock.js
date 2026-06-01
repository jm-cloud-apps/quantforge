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

/** Decompose `now` into PT date + weekday + hour/minute parts using Intl. */
function ptParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  // Intl returns "24" for midnight in hour12: false in some browsers — normalize.
  let hour = parseInt(parts.hour, 10)
  if (hour === 24) hour = 0
  return {
    weekday: parts.weekday,                                              // "Mon"..."Sun"
    iso: `${parts.year}-${parts.month}-${parts.day}`,                    // "YYYY-MM-DD"
    hour,                                                                 // 0..23
    minute: parseInt(parts.minute, 10),                                  // 0..59
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Shift a "YYYY-MM-DD" PT date string back `days` days, returning the new
 *  iso string + weekday. Anchored at noon UTC so DST never flips the day. */
function shiftIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12))
  dt.setUTCDate(dt.getUTCDate() - days)
  return { iso: dt.toISOString().slice(0, 10), weekday: WEEKDAYS[dt.getUTCDay()] }
}

const isTradingDay = (iso, weekday) =>
  weekday !== 'Sat' && weekday !== 'Sun' && !NYSE_HOLIDAYS.has(iso)

// The post-close snapshot boundary: 1:30 PM Pacific (30 min after the 1:00 PM
// PT / 4:00 PM ET close). Used for off-hours cache validity.
const CLOSE_SNAPSHOT_MINUTES = 13 * 60 + 30

/**
 * Epoch-ms of the most recent post-close snapshot boundary — 1:30 PM PT on the
 * most recent *trading* day at or before `now`. Off-hours the screener serves
 * any cache written at/after this instant (the end-of-day snapshot) and only
 * re-runs when no such snapshot exists, so weekends/after-hours don't trigger
 * a fresh scan.
 *
 * Computed by anchoring on now's epoch and PT wall-clock minutes, so it's
 * correct across time zones without constructing a PT-local Date.
 */
export function lastCloseSnapshotMs(now = new Date()) {
  const { iso, hour, minute } = ptParts(now)
  const nowPtMinutes = hour * 60 + minute
  for (let d = 0; d < 10; d++) {
    const day = d === 0 ? { iso, weekday: ptParts(now).weekday } : shiftIso(iso, d)
    if (!isTradingDay(day.iso, day.weekday)) continue
    // Today only counts once 1:30 PM PT has actually passed.
    if (d === 0 && nowPtMinutes < CLOSE_SNAPSHOT_MINUTES) continue
    const deltaMinutes = nowPtMinutes + d * 1440 - CLOSE_SNAPSHOT_MINUTES
    return now.getTime() - deltaMinutes * 60_000
  }
  // Fallback (shouldn't happen): a week ago.
  return now.getTime() - 7 * 24 * 60 * 60 * 1000
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
