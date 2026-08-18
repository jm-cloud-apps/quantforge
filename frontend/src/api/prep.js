const API_BASE = '/api/prep'

async function req(path, options) {
  const res = await fetch(`${API_BASE}${path}`, options)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Prep request failed: ${path}`)
  }
  return res.json()
}

// 6M / 3M / 1M relative-strength leader lists off the shared breadth cache.
// Returns { as_of, horizons: [{key, label, blurb, sessions, rows}], confluence,
// universe, passed_liquidity, thresholds }.
export function getPrepLeaders({ fresh = false, topN } = {}) {
  const params = new URLSearchParams()
  if (fresh) params.set('fresh', '1')
  if (topN) params.set('top_n', String(topN))
  const qs = params.toString()
  return req(`/leaders${qs ? `?${qs}` : ''}`)
}

// Recent prep runs, newest first: { sessions, latest }.
export function getPrepSessions(limit = 30) {
  return req(`/session?limit=${limit}`)
}

// Upsert the prep run for a date (one record per day).
export function savePrepSession(body) {
  return req('/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function deletePrepSession(date) {
  return req(`/session/${encodeURIComponent(date)}`, { method: 'DELETE' })
}

// Leaders that keep appearing on the scan and never get traded. The scanners
// measure the stock; this measures the gap between what the scan surfaced and
// what you acted on. Always resolves — an empty ledger returns rows: [] with a
// reason, because a nudge that throws is worse than no nudge.
export function getPrepAttention({ lane = '', limit = 20 } = {}) {
  const q = new URLSearchParams({ limit: String(limit) })
  if (lane) q.set('lane', lane)
  return req(`/attention?${q}`)
}

// The single next step, from the market clock and from what you've actually
// done. Composition of endpoints that already exist; degrades to a weaker
// suggestion rather than failing when one of them is unavailable.
export function getRoutine() {
  return req('/routine')
}
