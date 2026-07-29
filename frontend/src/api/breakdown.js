const API_BASE = '/api/scanner/breakdown'

export async function getBreakdownScan({
  minPrice = 5.0,
  minDollarVolume = 5_000_000,
  requireAtRail = false,
  requireBelow200 = false,
  force = false,
} = {}) {
  const params = new URLSearchParams({
    min_price: String(minPrice),
    min_dollar_volume: String(minDollarVolume),
  })
  if (requireAtRail) params.set('require_at_rail', '1')
  if (requireBelow200) params.set('require_below_200', '1')
  if (force) params.set('force', '1')
  const res = await fetch(`${API_BASE}?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to run breakdown scan')
  }
  return res.json()
}
