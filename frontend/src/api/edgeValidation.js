const API_BASE = '/api/analyze/edge-validation'

// Event-study edge validation with multiple-testing correction (bootstrap CIs,
// deflated Sharpe, BH-FDR) — quantifies how much of a setup's edge is data-mining.
export async function getEdgeValidation({ horizon = 10, minPrice = 5.0, minDollarVolume = 3_000_000, force = false } = {}) {
  const params = new URLSearchParams({
    horizon: String(horizon), min_price: String(minPrice), min_dollar_volume: String(minDollarVolume),
  })
  if (force) params.set('force', '1')
  const res = await fetch(`${API_BASE}?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to run edge validation')
  }
  return res.json()
}
