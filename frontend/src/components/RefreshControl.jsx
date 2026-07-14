import { useState } from 'react'
import { useAutoRefresh } from '../autorefresh/AutoRefreshProvider'
import AutoRefreshToggle from './AutoRefreshToggle'

// One standardized refresh cluster for every page that has a Refresh button:
//
//     Updated 3m ago   [● Auto]   [ Refresh ]
//
// Drop it top-right in a page header. Pass the page's own refresh function as
// `onRefresh` (usually `() => load(true)`) — the control runs it, shows the
// busy state, and stamps the "last refreshed" time that feeds both the label
// here and the daily-warm queue's "done today" check. `jobId` links it to a
// registered background job so the Auto toggle + timestamp appear; omit `jobId`
// for a plain standardized Refresh button with no auto-warm.
export default function RefreshControl({
  jobId,
  onRefresh,
  refreshing: externalBusy,
  label = 'Refresh',
  busyLabel = 'Refreshing…',
  disabled = false,
  className = '',
}) {
  const { getStatus, markRefreshed } = useAutoRefresh()
  const [internalBusy, setInternalBusy] = useState(false)
  const status = jobId ? getStatus(jobId) : null
  const busy = externalBusy != null ? externalBusy : internalBusy
  const updated = status?.lastRunAt ? relTime(status.lastRunAt) : null

  const handle = async () => {
    if (busy || disabled) return
    setInternalBusy(true)
    try {
      await onRefresh?.()
      if (jobId) markRefreshed(jobId)
    } catch {
      /* the page surfaces its own error state */
    } finally {
      setInternalBusy(false)
    }
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {updated && (
        <span
          className="text-xs text-surface-500 whitespace-nowrap"
          title={`Last refreshed ${new Date(status.lastRunAt).toLocaleString()}`}
        >
          Updated {updated}
        </span>
      )}
      {jobId && <AutoRefreshToggle jobId={jobId} />}
      <button
        type="button"
        onClick={handle}
        disabled={busy || disabled}
        className="px-4 py-2 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm font-medium hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition inline-flex items-center gap-2"
      >
        {busy && (
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        )}
        {busy ? busyLabel : label}
      </button>
    </div>
  )
}

// Coarse relative time — "just now" / "5m ago" / "3h ago" / "Jun 23, 2:23 PM".
function relTime(ms) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const sameDay = new Date(ms).toDateString() === new Date().toDateString()
  const h = Math.floor(m / 60)
  if (h < 24 && sameDay) return `${h}h ago`
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
