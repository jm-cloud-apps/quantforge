const API_BASE = '/api'

export async function getOptionsFlow(underlying, {
  minVolume = 10, includeSweeps = false, sweepTopN = 10, fresh = false,
} = {}) {
  const params = new URLSearchParams({
    min_volume: minVolume,
    include_sweeps: includeSweeps,
    sweep_top_n: sweepTopN,
    fresh,
  })
  const res = await fetch(`${API_BASE}/flow/${encodeURIComponent(underlying.toUpperCase())}?${params}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const detail = body?.detail
    // FastAPI wraps detail; our router now emits structured {code, message, hint}.
    if (detail && typeof detail === 'object') {
      const e = new Error(detail.message || `Flow fetch failed (HTTP ${res.status})`)
      e.code = detail.code
      e.hint = detail.hint
      e.endpointName = detail.endpoint_name
      e.status = res.status
      throw e
    }
    throw new Error(detail || `Flow fetch failed (HTTP ${res.status})`)
  }
  return res.json()
}
