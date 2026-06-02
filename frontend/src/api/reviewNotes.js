const API_BASE = '/api/review'

// Full map of trade_key -> note record. Small payload — call once per page.
export async function getReviewNotes() {
  const res = await fetch(`${API_BASE}/notes`)
  if (!res.ok) throw new Error('Failed to load review notes')
  return res.json()
}

// OHLC bars for the review chart. time is epoch-seconds (intraday) or
// 'YYYY-MM-DD' (daily). See backend /api/review/bars.
export async function getReviewBars({ symbol, frm, to, multiplier = 5, timespan = 'minute' }) {
  const params = new URLSearchParams({
    symbol, frm, to, multiplier: String(multiplier), timespan,
  })
  const res = await fetch(`${API_BASE}/bars?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load chart bars')
  }
  return res.json()
}

// Upsert. Server derives the trade_key from symbol + entry_date + entry_price + quantity.
export async function saveReviewNote({
  symbol,
  entry_date,
  entry_price,
  quantity,
  ...fields
}) {
  const res = await fetch(`${API_BASE}/notes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, entry_date, entry_price, quantity, ...fields }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to save review note')
  }
  return res.json()
}

export async function deleteReviewNote(key) {
  const res = await fetch(`${API_BASE}/notes/${encodeURIComponent(key)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete review note')
  return res.json()
}

// Build the same composite key the server uses so the UI can match trades
// against the notes map client-side.
export function buildTradeKey(trade) {
  const sym = (trade.symbol || '').toUpperCase().trim()
  let edate = trade.entry_date || ''
  if (typeof edate === 'string' && edate.includes('T')) edate = edate.split('T')[0]
  const eprice = Number(trade.entry_price || 0)
  const qty = Number(trade.quantity || 0)
  if (!sym || !edate) return null
  return `${sym}|${edate}|${eprice.toFixed(4)}|${qty.toFixed(0)}`
}
