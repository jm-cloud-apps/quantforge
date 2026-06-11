const API_BASE = '/api/ai-trader'

export async function getAITraderIdeas({ budget = 500, minAdr = 0.03, fresh = false } = {}) {
  const params = new URLSearchParams({
    budget: String(budget),
    min_adr: String(minAdr),
    fresh: fresh ? '1' : '0',
  })
  const res = await fetch(`${API_BASE}/ideas?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load AI Trader ideas')
  }
  return res.json()
}

export async function getAITraderHistory({ fresh = false } = {}) {
  const res = await fetch(`${API_BASE}/history?fresh=${fresh ? '1' : '0'}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load AI Trader history')
  }
  return res.json()
}
