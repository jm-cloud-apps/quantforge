const API_BASE = '/api/scanner/parabolic'

export async function getParabolicScan({
  minPrice = 3.0,
  minDollarVolume = 3_000_000,
  minGainLargePct = 50,
  minGainSmallPct = 100,
  largeCapPrice = 20,
  minUpDays = 3,
  runLookback = 20,
  requireExtended = false,
  requireAccelerating = false,
  force = false,
} = {}) {
  const params = new URLSearchParams({
    min_price: String(minPrice),
    min_dollar_volume: String(minDollarVolume),
    min_gain_large_pct: String(minGainLargePct),
    min_gain_small_pct: String(minGainSmallPct),
    large_cap_price: String(largeCapPrice),
    min_up_days: String(minUpDays),
    run_lookback: String(runLookback),
  })
  if (requireExtended) params.set('require_extended', '1')
  if (requireAccelerating) params.set('require_accelerating', '1')
  if (force) params.set('force', '1')
  const res = await fetch(`${API_BASE}?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to run parabolic scan')
  }
  return res.json()
}
