const API_BASE = '/api'

export async function getBreadthSnapshot() {
  const res = await fetch(`${API_BASE}/breadth/snapshot`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load breadth snapshot')
  }
  return res.json()
}

export async function getBreadthHistory(days = 15) {
  const res = await fetch(`${API_BASE}/breadth/history?days=${days}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load breadth history')
  }
  return res.json()
}

export async function getSituationalAwareness(trendDays = 30) {
  const res = await fetch(`${API_BASE}/breadth/situational?trend_days=${trendDays}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load situational awareness')
  }
  return res.json()
}

export async function getSituationalHistory(days = 365) {
  const res = await fetch(`${API_BASE}/breadth/situational/history?days=${days}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load situational history')
  }
  return res.json()
}

export async function getRegimeBacktest() {
  const res = await fetch(`${API_BASE}/breadth/regime-backtest`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load regime backtest')
  }
  return res.json()
}

export async function getBreadthVerify() {
  const res = await fetch(`${API_BASE}/breadth/verify`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to verify breadth pipeline')
  }
  return res.json()
}

export async function refreshBreadth({ lookbackDays = 130, refreshUniverse = false } = {}) {
  const res = await fetch(`${API_BASE}/breadth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lookback_days: lookbackDays,
      refresh_universe: refreshUniverse,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Breadth refresh failed')
  }
  return res.json()
}
