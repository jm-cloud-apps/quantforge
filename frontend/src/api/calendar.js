const API_BASE = '/api/calendar'

export async function getEarnings({ days = 7, wlId = null, force = false } = {}) {
  const params = new URLSearchParams({ days: String(days) })
  if (wlId) params.set('wl_id', wlId)
  if (force) params.set('force', '1')
  const res = await fetch(`${API_BASE}/earnings?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load earnings calendar')
  }
  return res.json()
}
