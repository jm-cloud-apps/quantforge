const API_BASE = '/api'

export async function loadDefaultTrades() {
  const res = await fetch(`${API_BASE}/trading-analysis/load-default`)

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load default trades')
  }

  return res.json()
}

export async function uploadTradeData(file) {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_BASE}/trading-analysis/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to upload trade data')
  }

  return res.json()
}

export async function analyzeTradeData(tradeData) {
  const res = await fetch(`${API_BASE}/trading-analysis/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to analyze trade data')
  }

  return res.json()
}

export async function getTradeStatistics(tradeData) {
  const res = await fetch(`${API_BASE}/trading-analysis/statistics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get trade statistics')
  }

  return res.json()
}

export async function getSetupStatistics(tradeData) {
  const res = await fetch(`${API_BASE}/trading-analysis/setup-statistics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get setup statistics')
  }

  return res.json()
}

export async function getSymbolStatistics(tradeData) {
  const res = await fetch(`${API_BASE}/trading-analysis/symbol-statistics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get symbol statistics')
  }

  return res.json()
}

export async function getDrawdownAnalysis(tradeData) {
  const res = await fetch(`${API_BASE}/trading-analysis/drawdown-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get drawdown analysis')
  }

  return res.json()
}

export async function getTimePerformance(tradeData) {
  const res = await fetch(`${API_BASE}/trading-analysis/time-performance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get time performance')
  }

  return res.json()
}

export async function getRollingPerformance(tradeData) {
  const res = await fetch(`${API_BASE}/trading-analysis/rolling-performance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get rolling performance')
  }

  return res.json()
}

export async function getAdvancedMetrics(tradeData) {
  const res = await fetch(`${API_BASE}/trading-analysis/advanced-metrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get advanced metrics')
  }

  return res.json()
}

export async function getEntryTimingAnalysis(tradeData) {
  const res = await fetch(`${API_BASE}/trading-analysis/entry-timing-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get entry timing analysis')
  }

  return res.json()
}

export async function getStreakDetection(tradeData) {
  const res = await fetch(`${API_BASE}/trading-analysis/streak-detection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get streak detection')
  }

  return res.json()
}

export async function getMarketCapPerformance(tradeData) {
  const res = await fetch(`${API_BASE}/trading-analysis/market-cap-performance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get market cap performance')
  }

  return res.json()
}

export async function getBenchmarkComparison(tradeData) {
  const res = await fetch(`${API_BASE}/trading-analysis/benchmark-comparison`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get benchmark comparison')
  }

  return res.json()
}

export async function getRMultipleAnalysis(tradeData, initialCapital = 100000) {
  const res = await fetch(`${API_BASE}/trading-analysis/r-multiple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData, initial_capital: initialCapital }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get R-multiple analysis')
  }

  return res.json()
}
