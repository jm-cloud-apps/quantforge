const API_BASE = '/api'

export async function getBreakouts({
  mode = 'breakout',
  limit = 20,
  minDollarVol = 5_000_000,
  minAdr = 0.05,
  includeMovers = false,
  enrichNews = true,
  enrichRsi = true,
  persist = true,
} = {}) {
  const params = new URLSearchParams({
    mode,
    limit,
    min_dollar_vol: minDollarVol,
    min_adr: minAdr,
    include_movers: includeMovers,
    enrich_news: enrichNews,
    enrich_rsi: enrichRsi,
    persist,
  })
  const res = await fetch(`${API_BASE}/screener/qullamaggie?${params}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Screener failed (HTTP ${res.status})`)
  }
  return res.json()
}

export async function getRecentDeveloping(days = 30) {
  const res = await fetch(`${API_BASE}/screener/qullamaggie/history/recent-developing?days=${days}`)
  if (!res.ok) throw new Error(`History fetch failed (HTTP ${res.status})`)
  return res.json()
}

export async function getSymbolHistory(symbol, days = 60) {
  const res = await fetch(`${API_BASE}/screener/qullamaggie/history/${encodeURIComponent(symbol)}?days=${days}`)
  if (!res.ok) throw new Error(`Symbol history failed (HTTP ${res.status})`)
  return res.json()
}

export async function getIntraday(symbol, daysBack = 2) {
  const res = await fetch(`${API_BASE}/screener/qullamaggie/intraday/${encodeURIComponent(symbol)}?days_back=${daysBack}`)
  if (!res.ok) throw new Error(`Intraday fetch failed (HTTP ${res.status})`)
  return res.json()
}

export async function getSnapshotStats() {
  const res = await fetch(`${API_BASE}/screener/qullamaggie/snapshot/stats`)
  if (!res.ok) throw new Error(`Snapshot stats failed (HTTP ${res.status})`)
  return res.json()
}
