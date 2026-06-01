const API_BASE = '/api'

// Today's top gainers and losers across US stocks. Returns
// { gainers: [{symbol, price, change_pct}], losers: [...], as_of, provider }.
export async function getMovers({ limit = 10 } = {}) {
  const res = await fetch(`${API_BASE}/movers?limit=${limit}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load market movers')
  }
  return res.json()
}
