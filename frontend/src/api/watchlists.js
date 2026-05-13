const API_BASE = '/api/watchlists'

async function handle(res) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Watchlist request failed (HTTP ${res.status})`)
  }
  return res.json()
}

export async function listWatchlists() {
  return handle(await fetch(API_BASE))
}

export async function createWatchlist({ name, symbols = [] }) {
  return handle(await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, symbols }),
  }))
}

export async function updateWatchlist(id, patch) {
  return handle(await fetch(`${API_BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
}

export async function deleteWatchlist(id) {
  return handle(await fetch(`${API_BASE}/${id}`, { method: 'DELETE' }))
}

export async function addSymbols(id, symbols) {
  return handle(await fetch(`${API_BASE}/${id}/symbols`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols: Array.isArray(symbols) ? symbols : [symbols] }),
  }))
}

export async function removeSymbol(id, symbol) {
  return handle(await fetch(`${API_BASE}/${id}/symbols/${encodeURIComponent(symbol)}`, {
    method: 'DELETE',
  }))
}
