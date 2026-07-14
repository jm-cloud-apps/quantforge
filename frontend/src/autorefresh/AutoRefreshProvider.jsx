import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AUTO_REFRESH_JOBS, JOB_BY_ID } from './registry'

// ---------------------------------------------------------------------------
// Background daily-warm queue.
//
// On app boot (and when you flip a page's Auto toggle back on), any enabled job
// that hasn't already run today gets enqueued and drained SERIALLY — one warm
// at a time, with a small gap — so we never fan out a burst of expensive scans.
// Each job writes an on-disk server cache, so by the time you navigate to the
// page it's already fresh; the page's normal on-mount load just reads it.
//
// Auto is ON by default for every registered job (an absent entry counts as
// enabled); toggling a page off stores an explicit `false`.
//
// Freshness is a per-job wall-clock timestamp (epoch ms) in localStorage. "Done
// today" = that timestamp falls on the current local calendar day; the same
// stamp drives the "Updated …" label on the shared RefreshControl. A client
// stamp is the right granularity here: the backend isn't a 24/7 daemon (it
// comes up with the frontend via start.sh), so a client stamp and the server
// cache share one lifecycle — nothing could have warmed while both were down.
// ---------------------------------------------------------------------------

const AutoRefreshContext = createContext(null)

const ENABLED_KEY = 'qf.autorefresh.enabled.v1'
const LASTRUN_KEY = 'qf.autorefresh.lastRunAt.v1'

// Gap between serial warms — keeps us gentle on the backend / data provider.
const GAP_MS = 700
// Delay before the boot sweep so we don't compete with the landing page's own
// initial data load.
const BOOT_DELAY_MS = 2500

function localDayKey(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function isToday(ms) {
  return ms != null && localDayKey(ms) === localDayKey(Date.now())
}

function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v ? JSON.parse(v) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val))
  } catch {
    /* private mode / quota — degrade to in-memory only */
  }
}

export function AutoRefreshProvider({ children }) {
  const [enabled, setEnabledState] = useState(() => readJSON(ENABLED_KEY, {}))
  const [lastRunAt, setLastRunAtState] = useState(() => readJSON(LASTRUN_KEY, {}))
  const [runState, setRunState] = useState({}) // { [id]: 'queued' | 'running' }
  const [errors, setErrors] = useState({})     // { [id]: message | null }

  // Refs mirror the latest state for the async drain loop / boot sweep, which
  // must not close over stale snapshots.
  const enabledRef = useRef(enabled)
  const lastRunRef = useRef(lastRunAt)
  const runStateRef = useRef(runState)
  useEffect(() => { enabledRef.current = enabled }, [enabled])
  useEffect(() => { lastRunRef.current = lastRunAt }, [lastRunAt])
  useEffect(() => { runStateRef.current = runState }, [runState])

  const queueRef = useRef([])
  const drainingRef = useRef(false)

  // Absent entry = enabled (Auto defaults ON); only an explicit false opts out.
  const isEnabled = useCallback((id) => enabledRef.current[id] !== false, [])
  const isFresh = useCallback((id) => isToday(lastRunRef.current[id]), [])

  const setRun = useCallback((id, val) => {
    setRunState((prev) => ({ ...prev, [id]: val }))
  }, [])

  const stamp = useCallback((id) => {
    setLastRunAtState((prev) => {
      const next = { ...prev, [id]: Date.now() }
      writeJSON(LASTRUN_KEY, next)
      return next
    })
  }, [])

  const drain = useCallback(async () => {
    if (drainingRef.current) return
    drainingRef.current = true
    try {
      while (queueRef.current.length > 0) {
        const id = queueRef.current.shift()
        const job = JOB_BY_ID[id]
        if (!job) continue
        setRun(id, 'running')
        try {
          await job.run()
          stamp(id)
          setErrors((p) => (p[id] ? { ...p, [id]: null } : p))
        } catch (e) {
          // Leave the timestamp untouched so a failed warm retries next boot.
          setErrors((p) => ({ ...p, [id]: e?.message || 'Background refresh failed' }))
        } finally {
          setRun(id, null)
        }
        await new Promise((r) => setTimeout(r, GAP_MS))
      }
    } finally {
      drainingRef.current = false
    }
  }, [setRun, stamp])

  const enqueue = useCallback((id) => {
    if (!JOB_BY_ID[id]) return
    if (queueRef.current.includes(id)) return
    if (runStateRef.current[id] === 'running') return
    queueRef.current.push(id)
    setRun(id, 'queued')
    drain()
  }, [drain, setRun])

  const dequeue = useCallback((id) => {
    queueRef.current = queueRef.current.filter((x) => x !== id)
    // Clear a not-yet-started 'queued' marker; a job mid-flight is left to finish.
    setRunState((prev) => (prev[id] === 'queued' ? { ...prev, [id]: null } : prev))
  }, [])

  const setEnabled = useCallback((id, val) => {
    setEnabledState((prev) => {
      const next = { ...prev, [id]: val }
      writeJSON(ENABLED_KEY, next)
      return next
    })
  }, [])

  const toggle = useCallback((id) => {
    const next = !isEnabled(id)
    setEnabled(id, next)
    if (next) {
      // Flipping it on gives immediate feedback: warm now unless already fresh.
      if (!isFresh(id)) enqueue(id)
    } else {
      dequeue(id)
    }
  }, [isEnabled, isFresh, setEnabled, enqueue, dequeue])

  // Called by a page's manual Refresh so a hand-triggered refresh counts as
  // "done today" (and updates the "Updated …" stamp) — the queue then won't
  // redundantly re-warm it.
  const markRefreshed = useCallback((id) => {
    stamp(id)
    setErrors((p) => (p[id] ? { ...p, [id]: null } : p))
  }, [stamp])

  // Boot sweep — runs once, shortly after mount.
  const sweptRef = useRef(false)
  useEffect(() => {
    if (sweptRef.current) return
    sweptRef.current = true
    const t = setTimeout(() => {
      AUTO_REFRESH_JOBS.forEach((j) => {
        if (isEnabled(j.id) && !isFresh(j.id)) enqueue(j.id)
      })
    }, BOOT_DELAY_MS)
    return () => clearTimeout(t)
  }, [isEnabled, isFresh, enqueue])

  const getStatus = useCallback((id) => {
    const job = JOB_BY_ID[id]
    if (!job) return null
    const en = enabled[id] !== false
    const rs = runState[id]
    const err = errors[id]
    const at = lastRunAt[id] || null
    const fresh = isToday(at)
    let state
    if (rs === 'running') state = 'running'
    else if (rs === 'queued') state = 'queued'
    else if (err) state = 'error'
    else if (en && fresh) state = 'fresh'
    else if (en) state = 'armed'
    else state = 'off'
    return { id, label: job.label, hint: job.hint, enabled: en, state, lastRunAt: at, fresh, error: err || null }
  }, [enabled, runState, errors, lastRunAt])

  const value = useMemo(
    () => ({ getStatus, toggle, setEnabled, markRefreshed }),
    [getStatus, toggle, setEnabled, markRefreshed],
  )

  return <AutoRefreshContext.Provider value={value}>{children}</AutoRefreshContext.Provider>
}

export function useAutoRefresh() {
  const ctx = useContext(AutoRefreshContext)
  if (!ctx) throw new Error('useAutoRefresh must be used inside <AutoRefreshProvider>')
  return ctx
}
