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

export async function getSectorPerformance() {
  // Check frontend cache first
  const cached = getCachedData()
  if (cached) {
    return { ...cached, from_cache: true }
  }

  const res = await fetch(`${API_BASE}/screener/sector-performance`)

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
