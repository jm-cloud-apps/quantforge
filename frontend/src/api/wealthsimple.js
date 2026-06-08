const API_BASE = '/api/wealthsimple'

export async function getWealthsimpleSummary() {
  const res = await fetch(`${API_BASE}/summary`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load Wealthsimple data')
  }
  return res.json()
}

export async function getWealthsimpleTransactions(limit = 200) {
  const res = await fetch(`${API_BASE}/transactions?limit=${limit}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load Wealthsimple transactions')
  }
  return res.json()
}
