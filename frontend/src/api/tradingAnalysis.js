const API_BASE = '/api'

export async function getFileStatus() {
  const res = await fetch(`${API_BASE}/trading-analysis/file-status`)

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get file status')
  }

  return res.json()
}

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

export async function getEmotionPerformance(tradeData) {
  const res = await fetch(`${API_BASE}/trading-analysis/emotion-performance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get emotion performance')
  }

  return res.json()
}

export async function getCalendarHeatmap(tradeData) {
  const res = await fetch(`${API_BASE}/trading-analysis/calendar-heatmap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get calendar heatmap')
  }

  return res.json()
}

// ---------------------------------------------------------------------------
// Trade Log Formatter
// ---------------------------------------------------------------------------

export async function getFormatterMonths() {
  const res = await fetch(`${API_BASE}/formatter/months`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get available months')
  }
  return res.json()
}

/**
 * Run the trade log formatter for a given month, streaming log lines via SSE.
 * Returns an AbortController — call .abort() to cancel.
 */
export function runFormatter(dateStr, opts = {}) {
  const { onMessage, onDone, onError, onMode, confirm = 'no' } = opts
  const controller = new AbortController()

  const params = new URLSearchParams({ confirm })

  fetch(`${API_BASE}/formatter/run/${encodeURIComponent(dateStr)}?${params}`, {
    method: 'POST',
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Formatter request failed')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)

          if (payload === '__DONE__') {
            onDone?.()
            return
          }
          if (payload.startsWith('__ERROR__')) {
            onError?.(payload.slice(9))
            return
          }
          if (payload.startsWith('__MODE__')) {
            onMode?.(payload.slice(8)) // 'preview' | 'applied'
            continue
          }
          // Unescape newlines that were escaped server-side
          onMessage?.(payload.replace(/\\n/g, '\n'))
        }
      }
      // Stream ended without __DONE__ sentinel
      onDone?.()
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError?.(err.message)
      }
    })

  return controller
}

/**
 * Run the full daily pipeline (Gmail fetch → format → summarize) via SSE.
 * Returns an AbortController — call .abort() to cancel.
 */
export function runDaily(month, opts = {}) {
  const { onMessage, onDone, onError, onMode, confirm = 'yes' } = opts
  const controller = new AbortController()

  const params = new URLSearchParams({ confirm })

  fetch(`${API_BASE}/formatter/run-daily/${encodeURIComponent(month)}?${params}`, {
    method: 'POST',
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Run-daily request failed')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)

          if (payload === '__DONE__') {
            onDone?.()
            return
          }
          if (payload.startsWith('__ERROR__')) {
            onError?.(payload.slice(9))
            return
          }
          if (payload.startsWith('__MODE__')) {
            onMode?.(payload.slice(8))
            continue
          }
          onMessage?.(payload.replace(/\\n/g, '\n'))
        }
      }
      onDone?.()
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError?.(err.message)
      }
    })

  return controller
}

/**
 * Reset the master sheet, streaming log lines via SSE.
 */
export function resetFormatter({ onMessage, onDone, onError, onMode }) {
  const controller = new AbortController()

  fetch(`${API_BASE}/formatter/reset`, {
    method: 'POST',
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Reset request failed')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)

          if (payload === '__DONE__') {
            onDone?.()
            return
          }
          if (payload.startsWith('__ERROR__')) {
            onError?.(payload.slice(9))
            return
          }
          if (payload.startsWith('__MODE__')) {
            onMode?.(payload.slice(8))
            continue
          }
          onMessage?.(payload.replace(/\\n/g, '\n'))
        }
      }
      onDone?.()
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError?.(err.message)
      }
    })

  return controller
}

export async function getEdgeInsights(tradeData) {
  const res = await fetch(`${API_BASE}/trading-analysis/edge-insights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trades: tradeData }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get edge insights')
  }
  return res.json()
}
