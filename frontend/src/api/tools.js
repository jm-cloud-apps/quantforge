const API_BASE = '/api'

export async function calculatePositionSize(params) {
  const res = await fetch(`${API_BASE}/tools/position-size`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to calculate position size')
  }
  return res.json()
}

export async function getChecklistTemplate() {
  const res = await fetch(`${API_BASE}/tools/checklist/template`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load checklist')
  }
  return res.json()
}

export async function saveChecklistTemplate(items) {
  const res = await fetch(`${API_BASE}/tools/checklist/template`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to save checklist')
  }
  return res.json()
}
