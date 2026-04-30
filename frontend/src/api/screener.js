const API_BASE = '/api'
const CACHE_KEY = 'sector_performance_cache'
const CACHE_TTL = 2 * 60 * 60 * 1000  // 2 hours in ms

// Check localStorage cache first to avoid re-fetching on page switches
function getCachedData() {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (!cached) return null
    const { data, timestamp } = JSON.parse(cached)
    if (Date.now() - timestamp < CACHE_TTL) {
      return data
    }
    localStorage.removeItem(CACHE_KEY)
  } catch {
    localStorage.removeItem(CACHE_KEY)
  }
  return null
}

function setCachedData(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }))
  } catch {
    // localStorage full or unavailable
  }
}

export async function getSectorPerformance({ forceRefresh = false } = {}) {
  // On force refresh, clear frontend cache so we always hit the backend
  if (forceRefresh) {
    localStorage.removeItem(CACHE_KEY)
  } else {
    // Check frontend cache first
    const cached = getCachedData()
    if (cached) {
      return { ...cached, from_cache: true }
    }
  }

  const url = forceRefresh
    ? `${API_BASE}/screener/sector-performance?force=1`
    : `${API_BASE}/screener/sector-performance`

  const res = await fetch(url)

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to fetch sector performance')
  }

  const data = await res.json()

  // Cache all data in localStorage (including demo) to prevent refetching on page switches/refreshes
  setCachedData(data)

  return data
}

export async function getFetchProgress() {
  const res = await fetch(`${API_BASE}/screener/sector-performance/progress`)
  if (!res.ok) return null
  return res.json()
}

// --- Weekly Snapshot System ---
const SNAPSHOT_KEY = 'sector_snapshots'
const MAX_SNAPSHOTS = 8

function getISOWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

export function saveSnapshot(sectors) {
  try {
    const now = new Date()
    const week = getISOWeek(now)
    const existing = getSnapshots()

    // One snapshot per calendar week
    if (existing.some(s => s.week === week)) return false

    const snapshot = {
      date: now.toISOString().split('T')[0],
      week,
      sectors: sectors.map(s => ({
        ticker: s.ticker,
        sector: s.sector,
        '5D': s.returns['5D'],
        '1M': s.returns['1M'],
        '3M': s.returns['3M'],
      })),
    }

    const updated = [...existing, snapshot].slice(-MAX_SNAPSHOTS)
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(updated))
    return true
  } catch {
    return false
  }
}

export function getSnapshots() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}
