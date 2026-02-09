const API_BASE = '/api'

export async function fetchStrategies() {
  const res = await fetch(`${API_BASE}/strategies`)
  if (!res.ok) throw new Error('Failed to fetch strategies')
  return res.json()
}

export async function runBacktest({ symbol, strategy_id, start_date, end_date, initial_capital = 100000, params = {} }) {
  const res = await fetch(`${API_BASE}/backtest/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol: symbol.toUpperCase().trim(),
      strategy_id,
      start_date,
      end_date,
      initial_capital,
      params,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Backtest failed')
  }
  return res.json()
}

export async function runBreakoutBacktest({
  holdings,
  start_date,
  end_date,
  initial_capital = 100000,
  risk_pct = 1,
  max_position_pct = 25,
}) {
  const res = await fetch(`${API_BASE}/backtest/breakout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      holdings,
      start_date,
      end_date,
      initial_capital,
      risk_pct,
      max_position_pct,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Breakout backtest failed')
  }
  return res.json()
}

export async function runMultiBacktest({ symbols, strategy_id, start_date, end_date, initial_capital = 100000, params = {} }) {
  const res = await fetch(`${API_BASE}/backtest/run-multi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbols: symbols.map(s => s.toUpperCase().trim()),
      strategy_id,
      start_date,
      end_date,
      initial_capital,
      params,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Backtest failed')
  }
  return res.json()
}
