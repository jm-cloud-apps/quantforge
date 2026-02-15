const API_BASE = '/api'

export async function getPlaybookEntries() {
  const res = await fetch(`${API_BASE}/playbook/entries`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to load playbook entries')
  }
  return res.json()
}

export async function createPlaybookEntry(formData) {
  const res = await fetch(`${API_BASE}/playbook/entries`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to create playbook entry')
  }
  return res.json()
}

export async function deletePlaybookEntry(id) {
  const res = await fetch(`${API_BASE}/playbook/entries/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Failed to delete playbook entry')
  }
  return res.json()
}

export function getScreenshotUrl(filename) {
  return `${API_BASE}/playbook/screenshots/${filename}`
}
