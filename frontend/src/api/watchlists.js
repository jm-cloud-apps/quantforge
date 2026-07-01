// Single consolidated watchlist. Prices/returns are cached server-side and
// returned as-is by getWatchlist(); refreshWatchlist() re-fetches them.
const API_BASE = '/api/watchlist'

async function handle(res) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Watchlist request failed (HTTP ${res.status})`)
  }
  return res.json()
}

export async function getWatchlist() {
  return handle(await fetch(API_BASE))
}

export async function addSymbols(symbols) {
  return handle(await fetch(`${API_BASE}/symbols`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols: Array.isArray(symbols) ? symbols : [symbols] }),
  }))
}

export async function removeSymbol(symbol) {
  return handle(await fetch(`${API_BASE}/symbols/${encodeURIComponent(symbol)}`, {
    method: 'DELETE',
  }))
}

export async function refreshWatchlist() {
  return handle(await fetch(`${API_BASE}/refresh`, { method: 'POST' }))
}
