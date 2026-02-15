const API_BASE = '/api'

export async function connectBroker({ host, port, client_id, is_paper }) {
  const res = await fetch(`${API_BASE}/broker/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, port, client_id, is_paper }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to connect to broker')
  }
  return res.json()
}

export async function disconnectBroker() {
  const res = await fetch(`${API_BASE}/broker/disconnect`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to disconnect')
  }
  return res.json()
}

export async function getBrokerStatus() {
  const res = await fetch(`${API_BASE}/broker/status`)
  if (!res.ok) return { connected: false }
  return res.json()
}

export async function getAccountSummary() {
  const res = await fetch(`${API_BASE}/broker/account`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get account summary')
  }
  return res.json()
}

export async function getPositions() {
  const res = await fetch(`${API_BASE}/broker/positions`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get positions')
  }
  return res.json()
}

export async function getOrders() {
  const res = await fetch(`${API_BASE}/broker/orders`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to get orders')
  }
  return res.json()
}

export async function placeOrder({ symbol, action, quantity, order_type, limit_price, stop_price }) {
  const res = await fetch(`${API_BASE}/broker/orders/place`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, action, quantity, order_type, limit_price, stop_price }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to place order')
  }
  return res.json()
}

export async function cancelOrder(orderId) {
  const res = await fetch(`${API_BASE}/broker/orders/cancel/${orderId}`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to cancel order')
  }
  return res.json()
}
