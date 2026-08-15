// Missed Book client — the omission side of the discipline loop.
// Backend: backend/missed_router.py

const API_BASE = '/api'

async function unwrap(res, what) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to ${what}`)
  }
  return res.json()
}

export async function getMissedEntries() {
  return unwrap(await fetch(`${API_BASE}/missed/entries`), 'load missed entries')
}

export async function getMissedSummary() {
  return unwrap(await fetch(`${API_BASE}/missed/summary`), 'load the missed summary')
}

// Fills the two price fields from the local grouped-price cache instead of from
// memory. Always resolves — `{available:false, reason}` when the cache can't
// cover it, so the form degrades to manual entry rather than blocking the log.
export async function priceCheck({ symbol, date, direction = 'long', sessions }) {
  const q = new URLSearchParams({ symbol, date, direction })
  if (sessions) q.set('sessions', sessions)
  return unwrap(await fetch(`${API_BASE}/missed/price-check?${q}`), 'price the setup')
}

// Names shortlisted on Prep, never traded, that then went somewhere. Always
// resolves to a list (possibly empty with a `reason`) — a suggestion engine is
// an assistant, so it must never take the page down with it.
export async function getMissedSuggestions({ days = 90, minMove } = {}) {
  const q = new URLSearchParams({ days })
  if (minMove != null) q.set('min_move', minMove)
  return unwrap(await fetch(`${API_BASE}/missed/suggestions?${q}`), 'load suggestions')
}

// How far forward the price check measures. A flag resolves in days; a long
// base can need two months, and 20 sessions would quietly clip the move.
export const HORIZONS = [
  { value: 20, label: '20 sessions', hint: 'A month — flags and EPs' },
  { value: 40, label: '40 sessions', hint: 'Two months — bases' },
  { value: 60, label: '60 sessions', hint: 'A quarter — the full leg' },
]

export async function createMissedEntry(formData) {
  return unwrap(await fetch(`${API_BASE}/missed/entries`, { method: 'POST', body: formData }), 'save the entry')
}

export async function updateMissedEntry(id, formData) {
  return unwrap(await fetch(`${API_BASE}/missed/entries/${id}`, { method: 'PATCH', body: formData }), 'update the entry')
}

export async function deleteMissedEntry(id) {
  return unwrap(await fetch(`${API_BASE}/missed/entries/${id}`, { method: 'DELETE' }), 'delete the entry')
}

export function missedScreenshotUrl(filename) {
  return `${API_BASE}/missed/screenshots/${filename}`
}

// Mirrors missed_router.VERDICTS / REASON_GROUPS. Keep in sync — the backend
// coerces an unknown verdict to "missed", and an unknown reason lands in the
// summary's "other" group rather than being rejected.
export const VERDICTS = [
  { value: 'missed', label: 'Missed it', hint: 'A real opportunity you should have taken' },
  { value: 'passed', label: 'Correct pass', hint: 'The rules declined it — the process worked' },
  { value: 'unclear', label: 'Unclear', hint: 'Not sure yet — revisit it later' },
]

export const REASON_GROUPS = [
  { group: 'process', label: 'Process — it never reached you', items: [
    'not on the watchlist', 'no plan written', 'scan missed it',
  ] },
  { group: 'execution', label: 'Execution — you had it and didn’t act', items: [
    'saw it, hesitated', 'away from the screen', 'entry already gone — wouldn’t chase',
    'stopped out earlier, wouldn’t re-enter', 'waited for a better price',
  ] },
  { group: 'capacity', label: 'Capacity — you couldn’t take it', items: [
    'at max positions', 'risk budget spent', 'no buying power',
  ] },
  { group: 'correct', label: 'Correct — the rules said no', items: [
    'regime gate said no', 'rules said no — correct pass', 'setup wasn’t clean enough',
  ] },
]

export const ALL_REASONS = REASON_GROUPS.flatMap(g => g.items)

// Mirrors the sanctioned taxonomy in components/TradePlanGate.jsx and
// pages/Playbook.jsx — a miss has to be taggable with the same setup names the
// taken trades use, or the two books can't be compared.
export const SETUP_GROUPS = [
  { group: 'HTF', items: ['HTF - Long Base Break', 'HTF - Symmetrical Flag', 'HTF - Down Flat Flag', 'HTF - Up Flat Flag', 'HTF - Channel'] },
  { group: 'EP', items: ['EP - Earnings Gap Up', 'EP - Thematic / Macro', 'EP - Financing / Strategic', 'EP - Structural / Milestone', 'EP - Product / Tech', 'EP - Analyst / Narrative'] },
]

export const GROUP_TONE = {
  process:   { text: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/30', bar: 'bg-warning' },
  execution: { text: 'text-danger',  bg: 'bg-danger/10',  border: 'border-danger/30',  bar: 'bg-danger' },
  capacity:  { text: 'text-cyan',    bg: 'bg-cyan/10',    border: 'border-cyan/30',    bar: 'bg-cyan' },
  correct:   { text: 'text-accent',  bg: 'bg-accent/10',  border: 'border-accent/30',  bar: 'bg-accent' },
  other:     { text: 'text-surface-300', bg: 'bg-surface-800/60', border: 'border-surface-700', bar: 'bg-surface-500' },
}

export const GROUP_FIX = {
  process:   'Fix the scan, not the trader. These never reached your screen.',
  execution: 'The setup arrived and you didn’t act — the most fixable kind, and the most repeated.',
  capacity:  'You were structurally unable. Cost of concentration, not a discipline failure.',
  correct:   'The filters worked. These are not costs — they are the tax that buys the edge.',
  other:     'Untagged reasons.',
}
