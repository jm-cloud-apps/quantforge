const API_BASE = '/api'

export async function getJournalEntries() {
  const res = await fetch(`${API_BASE}/journal/entries`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load journal entries')
  }
  return res.json()
}

export async function getJournalEntry(tradeId) {
  const res = await fetch(`${API_BASE}/journal/entries/${encodeURIComponent(tradeId)}`)
  if (!res.ok) {
    if (res.status === 404) return null
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load journal entry')
  }
  return res.json()
}

export async function saveJournalEntry(entry) {
  const res = await fetch(`${API_BASE}/journal/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to save journal entry')
  }
  return res.json()
}

export async function deleteJournalEntry(tradeId) {
  const res = await fetch(`${API_BASE}/journal/entries/${encodeURIComponent(tradeId)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to delete journal entry')
  }
  return res.json()
}

export async function getJournalStats() {
  const res = await fetch(`${API_BASE}/journal/stats`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load journal stats')
  }
  return res.json()
}

export async function searchJournal(query) {
  const res = await fetch(`${API_BASE}/journal/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to search journal')
  }
  return res.json()
}
