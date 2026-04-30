const API_BASE = '/api'
const CACHE_TTL = 4 * 60 * 60 * 1000 // 4 hours

const CACHE_KEYS = {
  qullamaggie: 'advisor_qullamaggie_cache',
  adam_khoo: 'advisor_adam_khoo_cache',
}

function getCached(persona) {
  try {
    const raw = localStorage.getItem(CACHE_KEYS[persona])
    if (!raw) return null
    const { data, timestamp } = JSON.parse(raw)
    if (Date.now() - timestamp < CACHE_TTL) return data
    localStorage.removeItem(CACHE_KEYS[persona])
  } catch {
    // ignore
  }
  return null
}

function setCached(persona, data) {
  try {
    localStorage.setItem(CACHE_KEYS[persona], JSON.stringify({ data, timestamp: Date.now() }))
  } catch {
    // ignore
  }
}

export async function startScreening(persona, force = false) {
  if (!force) {
    const cached = getCached(persona)
    if (cached) return { ...cached, from_cache: true }
  }
  const url = `${API_BASE}/advisor/screen/${persona}${force ? '?force=true' : ''}`
  const res = await fetch(url)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to start screening')
  }
  return res.json()
}

export async function getProgress() {
  const res = await fetch(`${API_BASE}/advisor/progress`)
  if (!res.ok) return null
  return res.json()
}

export async function getResult(persona) {
  const res = await fetch(`${API_BASE}/advisor/screen/${persona}/result`)
  if (!res.ok) return null
  const data = await res.json()
  if (data?.picks) setCached(persona, data)
  return data
}

export async function getHistory(persona) {
  const res = await fetch(`${API_BASE}/advisor/history/${persona}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.records || []
}

export function clearAdvisorCache(persona) {
  if (persona) {
    localStorage.removeItem(CACHE_KEYS[persona])
  } else {
    Object.values(CACHE_KEYS).forEach((k) => localStorage.removeItem(k))
  }
}
