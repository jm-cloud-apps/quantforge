const API_BASE = '/api/theme-radar'

export async function getThemeRadarAnalysis({ fresh = false } = {}) {
  const res = await fetch(`${API_BASE}/analysis?fresh=${fresh ? '1' : '0'}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load Theme Radar analysis')
  }
  return res.json()
}
