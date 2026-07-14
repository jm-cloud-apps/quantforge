import { useAutoRefresh } from '../autorefresh/AutoRefreshProvider'

// Compact "Auto" pill — opts a page into the daily background-warm queue. Lives
// inside RefreshControl (but usable standalone). The status dot shows where the
// job is: armed / already-fresh-today / queued / warming / failed.
export default function AutoRefreshToggle({ jobId, className = '' }) {
  const { getStatus, toggle } = useAutoRefresh()
  const s = getStatus(jobId)
  if (!s) return null

  const { state, label, error } = s
  const on = s.enabled

  const title = {
    off: `Auto-refresh off — click to warm ${label} in the background once a day.`,
    armed: `Auto-refresh on — ${label} will warm in the background on the next app open.`,
    fresh: `Auto-refresh on — ${label} already refreshed today.`,
    queued: `${label}: queued to warm in the background…`,
    running: `${label}: warming in the background…`,
    error: `Last background warm of ${label} failed${error ? `: ${error}` : ''}. Click to turn off, or it retries on next app open.`,
  }[state]

  return (
    <button
      type="button"
      onClick={() => toggle(jobId)}
      title={title}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition-colors ${
        on
          ? 'bg-accent/10 border-accent/30 text-accent hover:bg-accent/20'
          : 'bg-surface-800 border-surface-600/50 text-surface-400 hover:text-surface-200'
      } ${className}`}
    >
      <StatusDot state={state} />
      <span>Auto</span>
    </button>
  )
}

function StatusDot({ state }) {
  if (state === 'running') {
    return (
      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    )
  }
  const cls = {
    off: 'bg-surface-600',
    armed: 'bg-accent',
    fresh: 'bg-success',
    queued: 'bg-warning animate-pulse',
    error: 'bg-danger',
  }[state] || 'bg-surface-600'
  return <span className={`w-2 h-2 rounded-full ${cls}`} aria-hidden="true" />
}
