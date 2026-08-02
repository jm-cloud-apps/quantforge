// Process analytics: did the executed trade match the plan, is the holding
// period earning its keep, and is a setup still working. See
// backend/discipline.py (pure logic) + backend/discipline_router.py (shell).
const API_BASE = '/api/discipline'

async function handle(res) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Discipline request failed (HTTP ${res.status})`)
  }
  return res.json()
}

// The full process review. `windowDays: 0` means all time — the default is a
// trailing window on purpose, so a good year can't hide a bad quarter.
export async function getScorecard({ windowDays = 180, decayWindow, postExitSessions, force } = {}) {
  const qs = new URLSearchParams({ window_days: String(windowDays) })
  if (decayWindow) qs.set('decay_window', String(decayWindow))
  if (postExitSessions) qs.set('post_exit_sessions', String(postExitSessions))
  if (force) qs.set('force', '1')
  return handle(await fetch(`${API_BASE}/scorecard?${qs}`))
}

// Cheap per-day read for the Trade Today gate.
export async function getToday({ force } = {}) {
  const qs = force ? '?force=1' : ''
  return handle(await fetch(`${API_BASE}/today${qs}`))
}

// Mirrors review_notes_router.EXIT_REASONS. Split so the UI can group the
// exits your process chose from the ones you chose in the moment — the second
// group is the one worth auditing.
export const EXIT_REASONS = [
  { value: 'stop hit', group: 'Planned' },
  { value: 'target hit', group: 'Planned' },
  { value: 'time stop', group: 'Planned' },
  { value: 'trailed out', group: 'Planned' },
  { value: 'thesis broken', group: 'Discretionary' },
  { value: 'took profit early', group: 'Discretionary' },
  { value: 'cut early', group: 'Discretionary' },
  { value: 'panic / emotional', group: 'Discretionary' },
  { value: 'needed the capital', group: 'Discretionary' },
]

// Trailing-window presets for the scorecard header.
export const WINDOWS = [
  { days: 90, label: '90d' },
  { days: 180, label: '6mo' },
  { days: 365, label: '1yr' },
  { days: 0, label: 'All' },
]
