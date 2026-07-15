// Client for /api/sector-rotation/* — internals, RRG quadrants, leaders.

const API_BASE = '/api/sector-rotation'

async function get(path) {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Request failed: ${path}`)
  }
  return res.json()
}

export const getInternals = (force = false) => get(`/internals${force ? '?force=1' : ''}`)
export const getRRG = (force = false) => get(`/rrg${force ? '?force=1' : ''}`)
export const getLeaders = (sector) => get(`/leaders/${encodeURIComponent(sector)}`)
export const getMappingProgress = () => get('/mapping/progress')
