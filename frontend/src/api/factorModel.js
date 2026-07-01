const API_BASE = '/api/analyze/factors'

// Cross-sectional price/volume factor model — z-scores, composite ranking,
// factor rotation and factor correlation off the breadth cache.
export async function getFactorModel({ minPrice = 5.0, minDollarVolume = 3_000_000, force = false } = {}) {
  const params = new URLSearchParams({ min_price: String(minPrice), min_dollar_volume: String(minDollarVolume) })
  if (force) params.set('force', '1')
  const res = await fetch(`${API_BASE}?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load factor model')
  }
  return res.json()
}
