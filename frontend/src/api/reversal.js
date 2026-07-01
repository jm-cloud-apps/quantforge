const API_BASE = '/api/scanner/reversal'

export async function getReversalScan({
  minVolume = 290_000,
  minPrice = 5.0,
  requireStrongTail = false,
  requireGreen = false,
  force = false,
} = {}) {
  const params = new URLSearchParams({
    min_volume: String(minVolume),
    min_price: String(minPrice),
  })
  if (requireStrongTail) params.set('require_strong_tail', '1')
  if (requireGreen) params.set('require_green', '1')
  if (force) params.set('force', '1')
  const res = await fetch(`${API_BASE}?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to run reversal scan')
  }
  return res.json()
}
