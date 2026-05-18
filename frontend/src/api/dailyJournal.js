const API_BASE = '/api/journal/daily'

async function handle(res) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Daily journal request failed (HTTP ${res.status})`)
  }
  return res.json()
}

export async function listDailyEntries(limit = 60) {
  return handle(await fetch(`${API_BASE}?limit=${limit}`))
}

export async function getDailyEntry(date) {
  return handle(await fetch(`${API_BASE}/${encodeURIComponent(date)}`))
}

export async function saveDailyEntry(date, payload) {
  return handle(await fetch(`${API_BASE}/${encodeURIComponent(date)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, date }),
  }))
}

export async function deleteDailyEntry(date) {
  return handle(await fetch(`${API_BASE}/${encodeURIComponent(date)}`, { method: 'DELETE' }))
}
