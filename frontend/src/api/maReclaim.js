const API_BASE = '/api/scanner/ma-reclaim'

export async function getMAReclaimScan({
  minPrice = 5.0,
  minDollarVolume = 5_000_000,
  requireMaTurning = false,
  requireRs = false,
  excludeExtended = false,
  force = false,
} = {}) {
  const params = new URLSearchParams({
    min_price: String(minPrice),
    min_dollar_volume: String(minDollarVolume),
  })
  if (requireMaTurning) params.set('require_ma_turning', '1')
  if (requireRs) params.set('require_rs', '1')
  if (excludeExtended) params.set('exclude_extended', '1')
  if (force) params.set('force', '1')
  const res = await fetch(`${API_BASE}?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to run MA reclaim scan')
  }
  return res.json()
}
