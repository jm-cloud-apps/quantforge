const API_BASE = '/api/ai-trader'

export async function getAITraderIdeas({ budget = 500, minAdr = 0.03, account = 25000, riskPct = 1.0, fresh = false } = {}) {
  const params = new URLSearchParams({
    budget: String(budget),
    min_adr: String(minAdr),
    account: String(account),
    risk_pct: String(riskPct),
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

export async function getAITraderBacktest({ asOf, budget = 500, account = 25000, riskPct = 1.0, minAdr = 0.03 } = {}) {
  const params = new URLSearchParams({
    as_of: asOf,
    budget: String(budget),
    account: String(account),
    risk_pct: String(riskPct),
    min_adr: String(minAdr),
  })
  const res = await fetch(`${API_BASE}/backtest?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to run backtest')
  }
  return res.json()
}

export async function getAITraderBacktestHistory({ fresh = false } = {}) {
  const res = await fetch(`${API_BASE}/backtest/history?fresh=${fresh ? '1' : '0'}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load backtest history')
  }
  return res.json()
}

export async function getAITraderWalkforward({ start, end, stepDays = 7, budget = 500, account = 25000, riskPct = 1.0, minAdr = 0.03, fresh = false } = {}) {
  const params = new URLSearchParams({
    step_days: String(stepDays),
    budget: String(budget),
    account: String(account),
    risk_pct: String(riskPct),
    min_adr: String(minAdr),
    fresh: fresh ? '1' : '0',
  })
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  const res = await fetch(`${API_BASE}/backtest/walkforward?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to run walk-forward backtest')
  }
  return res.json()
}
