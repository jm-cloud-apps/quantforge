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
