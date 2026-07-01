const API_BASE = '/api/scanner/stage'

// Stan Weinstein Stage Analysis — classify liquid US names into Stage 1-4 off a
// 30-week-MA proxy, with Stage 1→2 breakouts and fresh Stage 2 advancers first.
export async function getStageScan({
  minPrice = 5.0,
  minDollarVolume = 5_000_000,
  force = false,
} = {}) {
  const params = new URLSearchParams({
    min_price: String(minPrice),
    min_dollar_volume: String(minDollarVolume),
  })
  if (force) params.set('force', '1')
  const res = await fetch(`${API_BASE}?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to run stage scan')
  }
  return res.json()
}
