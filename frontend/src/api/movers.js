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

// Session-aware gainers/losers — labels reflect pre-market / after-hours /
// regular based on /v1/marketstatus/now.
export async function getExtendedMovers({ limit = 5 } = {}) {
  const res = await fetch(`${API_BASE}/movers/extended?limit=${limit}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load extended-hours movers')
  }
  return res.json()
}

// Full-market gap scanner. Returns rows with `earnings_today_bmo` flag.
export async function getGapMovers({ minPct = 5, minVolume = 500_000, limit = 12 } = {}) {
  const params = new URLSearchParams({
    min_pct: String(minPct),
    min_volume: String(minVolume),
    limit: String(limit),
  })
  const res = await fetch(`${API_BASE}/movers/gap?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load gap movers')
  }
  return res.json()
}
