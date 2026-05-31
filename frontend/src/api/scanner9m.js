const API_BASE = '/api/scanner/9m'

export async function get9MScan({
  minVolume = 9_000_000,
  minPrice = 3.0,
  requireCompression = false,
  requireNotLate = false,
  force = false,
} = {}) {
  const params = new URLSearchParams({
    min_volume: String(minVolume),
    min_price: String(minPrice),
  })
  if (requireCompression) params.set('require_compression', '1')
  if (requireNotLate) params.set('require_not_late', '1')
  if (force) params.set('force', '1')
  const res = await fetch(`${API_BASE}?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to run 9M scan')
  }
  return res.json()
}
