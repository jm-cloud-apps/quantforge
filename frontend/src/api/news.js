const API_BASE = '/api'

export async function fetchNews(tickers) {
  const tickerStr = tickers.map(t => t.trim().toUpperCase()).filter(Boolean).join(',')
  if (!tickerStr) throw new Error('No tickers provided')

  const res = await fetch(`${API_BASE}/news?tickers=${encodeURIComponent(tickerStr)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to fetch news')
  }
  return res.json()
}

export async function getNewsCache() {
  const res = await fetch(`${API_BASE}/news/cache`)
  if (!res.ok) throw new Error('Failed to load search history')
  const data = await res.json()
  return data.history || []
}

export async function saveNewsCache(tickers, articles, earnings, epScores) {
  const res = await fetch(`${API_BASE}/news/cache`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers, articles, earnings, epScores: epScores || {} }),
  })
  if (!res.ok) throw new Error('Failed to save search cache')
}

export async function deleteNewsCacheEntry(index) {
  await fetch(`${API_BASE}/news/cache/${index}`, { method: 'DELETE' })
}

export async function clearNewsCache() {
  await fetch(`${API_BASE}/news/cache`, { method: 'DELETE' })
}

export async function getEpScore(ticker) {
  const sym = ticker.trim().toUpperCase()
  if (!sym) throw new Error('Ticker required')
  const res = await fetch(`${API_BASE}/analysis/qulla-ep/${encodeURIComponent(sym)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to score ticker')
  }
  return res.json()
}

export async function getPremarket(ticker) {
  const sym = ticker.trim().toUpperCase()
  if (!sym) throw new Error('Ticker required')
  const res = await fetch(`${API_BASE}/analysis/premarket/${encodeURIComponent(sym)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to fetch pre-market snapshot')
  }
  return res.json()
}

export async function refreshNewsCachePrices(symbols) {
  if (!symbols?.length) return { prices: {}, as_of: null }
  const res = await fetch(`${API_BASE}/news/cache/refresh-prices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols }),
  })
  if (!res.ok) throw new Error('Refresh prices failed')
  return res.json()
}

export async function fetchCriteriaCheck(ticker) {
  const res = await fetch(`${API_BASE}/analysis/criteria-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker: ticker.trim().toUpperCase() }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Claude analysis failed')
  }
  return res.json()
}
