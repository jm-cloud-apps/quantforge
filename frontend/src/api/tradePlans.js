// Pre-trade discipline gate. A plan (setup + stop + target) must exist before
// the fill; the backend derives size off the stop and rejects no-setup / no-stop
// trades. See backend/trade_plans_router.py.
const API_BASE = '/api/trade-plans'

async function handle(res) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Trade-plan request failed (HTTP ${res.status})`)
  }
  return res.json()
}

export async function getConfig() {
  return handle(await fetch(`${API_BASE}/config`))
}

export async function saveConfig({ account_size, risk_pct }) {
  return handle(await fetch(`${API_BASE}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_size, risk_pct }),
  }))
}

export async function listPlans({ status, date } = {}) {
  const qs = new URLSearchParams()
  if (status) qs.set('status', status)
  if (date) qs.set('date', date)
  const suffix = qs.toString() ? `?${qs}` : ''
  return handle(await fetch(`${API_BASE}${suffix}`))
}

export async function createPlan(plan) {
  return handle(await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plan),
  }))
}

export async function setPlanStatus(id, status) {
  return handle(await fetch(`${API_BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  }))
}

export async function deletePlan(id) {
  return handle(await fetch(`${API_BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' }))
}

// Mirrors backend risk math for the live readout (backend is source of truth on save).
export function computeRisk({ direction, entry, stop, target, accountSize, riskPct }) {
  const e = Number(entry), s = Number(stop), t = Number(target)
  const acct = Number(accountSize), rpct = Number(riskPct)
  const riskPerShare = Math.abs(e - s)
  const dollarBudget = acct * (rpct / 100)
  const shares = riskPerShare > 0 ? Math.floor(dollarBudget / riskPerShare) : 0
  const positionValue = shares * e
  const dollarRisk = shares * riskPerShare
  const rr = (t > 0 && riskPerShare > 0) ? Math.abs(t - e) / riskPerShare : null
  const pctOfAccount = acct > 0 ? (positionValue / acct) * 100 : null
  return { riskPerShare, dollarBudget, shares, positionValue, dollarRisk, rr, pctOfAccount }
}
