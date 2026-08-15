import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getMissedEntries, getMissedSummary, getMissedSuggestions, createMissedEntry,
  updateMissedEntry, deleteMissedEntry, missedScreenshotUrl, priceCheck,
  VERDICTS, REASON_GROUPS, ALL_REASONS, SETUP_GROUPS, GROUP_TONE, GROUP_FIX, HORIZONS,
} from '../api/missed'

// ── Missed Book ─────────────────────────────────────────────────────────────
// The mirror of the Playbook. That page collects the trades you executed well;
// this one collects the ones you never took — with the chart, the reason, and
// what the stock went on to do.
//
// The page is built around one refusal: it will not become a regret machine. A
// setup your rules correctly declined is logged as a *correct pass* and counted
// as evidence the filters worked, never as a cost. And the cost that is real is
// reported twice — to the high you'd never have caught, and to the exit you'd
// actually have taken — because summing maxima produces a large fictional
// number, the same trap the discipline scorecard avoids.

const VERDICT_TONE = {
  missed:  { text: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/30', label: 'MISSED' },
  passed:  { text: 'text-accent', bg: 'bg-accent/10', border: 'border-accent/30', label: 'CORRECT PASS' },
  unclear: { text: 'text-surface-300', bg: 'bg-surface-800/70', border: 'border-surface-700', label: 'UNCLEAR' },
}

const REASON_GROUP_OF = Object.fromEntries(
  REASON_GROUPS.flatMap(g => g.items.map(r => [r, g.group]))
)

const today = () => new Date().toISOString().slice(0, 10)
const fmtR = (r) => (r == null ? '—' : `${r > 0 ? '+' : ''}${r.toFixed(1)}R`)

const MAX_SHOTS = 4  // mirrors missed_router.MAX_SCREENSHOTS

// Esc-to-dismiss for the overlays. `guard` returns false to veto the close —
// the form uses it so a half-written entry isn't thrown away by a stray key.
function useEscape(onClose, guard) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (guard && !guard()) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, guard])
}

const BLANK = {
  symbol: '', date: today(), setup: '', direction: 'long', verdict: 'missed', reason: '',
  entry: '', stop: '', peak: '', exit_price: '', why_good: '', lesson: '', tags: '',
}

// ── Small pieces ────────────────────────────────────────────────────────────

function Stat({ label, value, hint, tone = 'text-surface-100', border = 'border-surface-700/50' }) {
  return (
    <div className={`rounded-2xl border ${border} bg-surface-900/50 px-4 py-3.5`}>
      <div className="text-[10px] font-bold tracking-widest text-surface-500 uppercase">{label}</div>
      <div className={`mt-1 text-[26px] font-display font-bold leading-none tabular-nums ${tone}`}>{value}</div>
      {hint && <div className="mt-1.5 text-[10.5px] text-surface-500 leading-snug">{hint}</div>}
    </div>
  )
}

function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[10px] font-bold tracking-widest text-surface-500 uppercase mb-1">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-[10px] text-surface-500 leading-snug">{hint}</span>}
    </label>
  )
}

const inputCls = 'w-full bg-surface-800/60 border border-surface-700 rounded-lg px-3 py-2 text-[13px] text-surface-100 placeholder-surface-500 focus:outline-none focus:border-accent'

// ── The form ────────────────────────────────────────────────────────────────

function EntryForm({ initial, editingId, onCancel, onSaved }) {
  const [form, setForm] = useState(initial || BLANK)
  const [files, setFiles] = useState([])
  const [removed, setRemoved] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const existing = (initial?.screenshots || []).filter(n => !removed.includes(n))
  const room = MAX_SHOTS - existing.length - files.length

  // Trading screenshots come from the clipboard (⌘⇧4 then paste), not from
  // disk. Without this the flow is: screenshot → find it in Downloads → open
  // the picker. The page only earns its keep if logging a miss takes seconds,
  // so paste is the primary path and the file input is the fallback.
  useEffect(() => {
    const onPaste = (ev) => {
      const imgs = [...(ev.clipboardData?.items || [])]
        .filter(i => i.type.startsWith('image/'))
        .map(i => i.getAsFile())
        .filter(Boolean)
      if (imgs.length === 0) return
      ev.preventDefault()
      setFiles(f => [...f, ...imgs].slice(0, MAX_SHOTS))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // Thumbnails for files not yet uploaded. Revoked on every change so a long
  // editing session doesn't leak object URLs.
  const pendingUrls = useMemo(() => files.map(f => URL.createObjectURL(f)), [files])
  useEffect(() => () => pendingUrls.forEach(URL.revokeObjectURL), [pendingUrls])

  // Pull the two price fields off the local cache. Self-reported highs drift
  // toward whatever story is being told that day, and the R totals inherit the
  // drift — so the measured number is offered the moment symbol + date exist.
  const [pricing, setPricing] = useState(null)
  const [horizon, setHorizon] = useState(HORIZONS[0].value)
  const canPrice = form.symbol.trim().length > 0 && !!form.date
  const pullPrices = async (sessions = horizon) => {
    setPricing({ state: 'loading' })
    try {
      const p = await priceCheck({ symbol: form.symbol, date: form.date, direction: form.direction, sessions })
      if (!p.available) { setPricing({ state: 'unavailable', reason: p.reason }); return }
      setForm(f => ({ ...f, peak: String(p.peak), exit_price: String(p.trail_exit) }))
      setPricing({ state: 'done', ...p })
    } catch (e) {
      setPricing({ state: 'unavailable', reason: e.message })
    }
  }

  // Esc closes — but only when there's nothing to lose. A dirty form asks.
  const dirty = JSON.stringify(form) !== JSON.stringify(initial || BLANK) || files.length > 0
  useEscape(onCancel, useCallback(
    () => !dirty || window.confirm('Discard this entry?'),
    [dirty],
  ))

  // The R preview — the same arithmetic the backend stores, shown live so the
  // numbers are checkable before the entry is saved rather than after.
  const preview = useMemo(() => {
    const e = parseFloat(form.entry), s = parseFloat(form.stop)
    const p = parseFloat(form.peak), x = parseFloat(form.exit_price)
    const risk = form.direction === 'short' ? s - e : e - s
    if (!(risk > 0)) return null
    const r = (price) => (isNaN(price) ? null : (form.direction === 'short' ? e - price : price - e) / risk)
    return { best: r(p), real: r(x) }
  }, [form.entry, form.stop, form.peak, form.exit_price, form.direction])

  const submit = async (ev) => {
    ev.preventDefault()
    if (!form.symbol.trim()) { setError('Symbol is required'); return }
    // Mirrors the backend guard: an unreasoned miss lands in "unspecified" and
    // silently degrades the one table that makes this page a diagnosis.
    if (form.verdict === 'missed' && !form.reason) {
      setError('Pick a reason — it’s what the summary ranks. Not sure yet? Log it as Unclear.')
      return
    }
    setSaving(true); setError(null)
    try {
      const fd = new FormData()
      for (const [k, v] of Object.entries(form)) {
        if (k === 'screenshots') continue
        fd.append(k, v ?? '')
      }
      files.forEach(f => fd.append('screenshots', f))
      if (removed.length) fd.append('remove_screenshots', removed.join(','))
      if (editingId) await updateMissedEntry(editingId, fd)
      else await createMissedEntry(fd)
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const isPass = form.verdict === 'passed'

  return (
    <div className="fixed inset-0 z-50 bg-surface-950/80 backdrop-blur-sm overflow-y-auto p-4 sm:p-8">
      <form
        onSubmit={submit}
        className="mx-auto max-w-3xl rounded-2xl border border-surface-700/60 bg-surface-900 shadow-card"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-surface-700/50">
          <div>
            <h2 className="text-[16px] font-display font-bold text-surface-50">
              {editingId ? 'Edit entry' : 'Log a missed opportunity'}
            </h2>
            <p className="text-[11px] text-surface-500 mt-0.5">
              The chart, why it was good, and the honest reason it didn’t get taken.
            </p>
          </div>
          <button type="button" onClick={onCancel} className="text-surface-400 hover:text-surface-100 text-[20px] leading-none px-2">×</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {error && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Symbol">
              <input className={inputCls} value={form.symbol} onChange={e => set('symbol', e.target.value.toUpperCase())} placeholder="NVDA" />
            </Field>
            <Field label="Date">
              <input type="date" className={inputCls} value={form.date} onChange={e => set('date', e.target.value)} />
            </Field>
            <Field label="Direction">
              <select className={inputCls} value={form.direction} onChange={e => set('direction', e.target.value)}>
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
            </Field>
            <Field label="Setup">
              <select className={inputCls} value={form.setup} onChange={e => set('setup', e.target.value)}>
                <option value="">—</option>
                {SETUP_GROUPS.map(g => (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map(i => <option key={i} value={i}>{i}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
          </div>

          {/* Verdict first — it changes what the rest of the form means */}
          <Field label="Verdict" hint="A setup your rules correctly declined is a process win, not a cost. Tag it honestly — the summary counts the two separately.">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {VERDICTS.map(v => {
                const tone = VERDICT_TONE[v.value]
                const active = form.verdict === v.value
                return (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => set('verdict', v.value)}
                    className={`text-left rounded-xl border px-3 py-2 transition-colors ${active ? `${tone.border} ${tone.bg}` : 'border-surface-700 bg-surface-800/40 hover:border-surface-600'}`}
                  >
                    <div className={`text-[12.5px] font-semibold ${active ? tone.text : 'text-surface-200'}`}>{v.label}</div>
                    <div className="text-[10.5px] text-surface-500 leading-snug mt-0.5">{v.hint}</div>
                  </button>
                )
              })}
            </div>
          </Field>

          <Field
            label={isPass ? 'Reason' : 'Reason · required'}
            hint="Controlled list so it aggregates — the summary ranks which failure mode costs the most."
          >
            <select
              className={`${inputCls} ${form.verdict === 'missed' && !form.reason ? 'border-danger/50' : ''}`}
              value={form.reason}
              onChange={e => set('reason', e.target.value)}
            >
              <option value="">—</option>
              {REASON_GROUPS.map(g => (
                <optgroup key={g.group} label={g.label}>
                  {g.items.map(i => <option key={i} value={i}>{i}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>

          {/* Prices — the whole quantified half */}
          <div>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
              <span className="text-[10px] font-bold tracking-widest text-surface-500 uppercase">What it did</span>
              <select
                value={horizon}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setHorizon(v)
                  if (pricing?.state === 'done') pullPrices(v)   // re-measure in place
                }}
                title={HORIZONS.find(h => h.value === horizon)?.hint}
                className="ml-auto bg-surface-800 border border-surface-700 text-surface-300 text-[11px] rounded px-1.5 py-1 focus:outline-none focus:border-cyan"
              >
                {HORIZONS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select>
              <button
                type="button"
                onClick={() => pullPrices()}
                disabled={!canPrice || pricing?.state === 'loading'}
                className="text-[11px] font-semibold text-cyan hover:text-cyan/80 bg-cyan/10 border border-cyan/30 rounded-lg px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
                title={canPrice ? 'Read the high and the rail exit off the local price cache'
                                : 'Enter a symbol and date first'}
              >
                {pricing?.state === 'loading' ? 'Reading…' : 'Fill from chart data'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Entry" hint="The trigger you'd have used">
                <input className={inputCls} inputMode="decimal" value={form.entry} onChange={e => set('entry', e.target.value)} placeholder="42.10" />
              </Field>
              <Field label="Stop" hint="Where you'd have been wrong">
                <input className={inputCls} inputMode="decimal" value={form.stop} onChange={e => set('stop', e.target.value)} placeholder="41.40" />
              </Field>
              <Field label="Best price" hint={form.direction === 'short' ? 'The low it reached' : 'The high it reached'}>
                <input className={inputCls} inputMode="decimal" value={form.peak} onChange={e => set('peak', e.target.value)} placeholder="52.00" />
              </Field>
              <Field label="Realistic exit" hint="Where your rail/target would have taken you out">
                <input className={inputCls} inputMode="decimal" value={form.exit_price} onChange={e => set('exit_price', e.target.value)} placeholder="48.50" />
              </Field>
            </div>
            {pricing?.state === 'done' && (
              <div className="mt-2 text-[11px] text-cyan/90 leading-snug rounded-lg border border-cyan/25 bg-cyan/[0.06] px-3 py-2">
                Measured over {pricing.sessions_used} session{pricing.sessions_used === 1 ? '' : 's'}: high{' '}
                <span className="font-mono font-bold">{pricing.peak}</span> on {pricing.peak_date}
                {pricing.trail_hit
                  ? <> · first close through the {pricing.trail_ma}-day rail at{' '}
                      <span className="font-mono font-bold">{pricing.trail_exit}</span> on {pricing.trail_exit_date}</>
                  : <> · the {pricing.trail_ma}-day rail never broke, so the realistic exit falls back to the last close
                      (<span className="font-mono font-bold">{pricing.trail_exit}</span>) — it was still running</>}
                . Edit either field if your plan would have exited elsewhere.
              </div>
            )}
            {pricing?.state === 'unavailable' && (
              <div className="mt-2 text-[11px] text-surface-500 leading-snug rounded-lg border border-surface-700/50 bg-surface-800/40 px-3 py-2">
                {pricing.reason} Fill the prices by hand — the entry is just as valid, it's the number that's estimated.
              </div>
            )}
            {preview && (
              <div className="mt-2 flex items-center gap-4 flex-wrap text-[11.5px] rounded-lg border border-surface-700/50 bg-surface-800/40 px-3 py-2">
                <span className="text-surface-500">This would have been</span>
                <span className="font-mono text-surface-300">best case <span className="font-bold text-surface-100">{preview.best != null ? fmtR(preview.best) : '—'}</span></span>
                <span className="font-mono text-surface-300">realistic <span className="font-bold text-accent">{preview.real != null ? fmtR(preview.real) : '—'}</span></span>
                {isPass && <span className="text-accent">— logged as a correct pass, so it won’t be counted as a cost</span>}
              </div>
            )}
          </div>

          <Field label="Why it was a good opportunity">
            <textarea rows={3} className={`${inputCls} resize-none`} value={form.why_good} onChange={e => set('why_good', e.target.value)}
              placeholder="What made it an A setup — the base, the catalyst, the RS, the group…" />
          </Field>

          <Field label="Why it was missed / what changes" hint="The line you'll actually reread. Be specific about the decision, not the outcome.">
            <textarea rows={3} className={`${inputCls} resize-none`} value={form.lesson} onChange={e => set('lesson', e.target.value)}
              placeholder="I saw it at 9:35, wanted the 1-min ORB, then wouldn't pay 20c above it…" />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Tags" hint="Comma separated">
              <input className={inputCls} value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="ai, gap-up, small-float" />
            </Field>
            <Field
              label="Screenshots"
              hint={room > 0
                ? `Press ⌘V to paste one straight from the clipboard — ${room} slot${room === 1 ? '' : 's'} left.`
                : `${MAX_SHOTS} attached — remove one to add another.`}
            >
              <input type="file" accept="image/*" multiple disabled={room <= 0}
                onChange={e => setFiles(f => [...f, ...e.target.files].slice(0, MAX_SHOTS))}
                className="w-full text-[12px] text-surface-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-surface-600 file:bg-surface-800 file:text-surface-200 file:text-[11px] hover:file:border-accent disabled:opacity-40" />
            </Field>
          </div>

          {(existing.length > 0 || files.length > 0) && (
            <div className="flex gap-2 flex-wrap">
              {existing.map(n => (
                <div key={n} className="relative">
                  <img src={missedScreenshotUrl(n)} alt="" className="h-16 rounded-lg border border-surface-700" />
                  <button type="button" onClick={() => setRemoved(r => [...r, n])}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-danger/90 text-white text-[11px] leading-none">×</button>
                </div>
              ))}
              {pendingUrls.map((url, i) => (
                <div key={url} className="relative">
                  <img src={url} alt="" className="h-16 rounded-lg border border-accent/50" />
                  <span className="absolute bottom-0 inset-x-0 text-[8px] text-center font-bold tracking-wider text-accent bg-surface-950/80 rounded-b-lg">NEW</span>
                  <button type="button" onClick={() => setFiles(f => f.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-danger/90 text-white text-[11px] leading-none">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-surface-700/50">
          <button type="button" onClick={onCancel} className="text-[12px] text-surface-400 hover:text-surface-100 px-3 py-2">Cancel</button>
          <button type="submit" disabled={saving}
            className="text-[12px] font-semibold text-accent hover:text-accent-bright bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-lg px-4 py-2 disabled:opacity-50">
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Log it'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Entry card ──────────────────────────────────────────────────────────────

function EntryCard({ e, onEdit, onDelete, onOpen }) {
  const tone = VERDICT_TONE[e.verdict] || VERDICT_TONE.unclear
  const group = REASON_GROUP_OF[e.reason] || 'other'
  const gt = GROUP_TONE[group]
  return (
    <div className="group relative rounded-2xl border border-surface-700/50 bg-surface-900/60 hover:border-surface-600 transition-colors overflow-hidden flex flex-col">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${gt.bar} opacity-70`} />
      {e.screenshots?.length > 0 && (
        <button type="button" onClick={() => onOpen(e)} className="block w-full">
          <img src={missedScreenshotUrl(e.screenshots[0])} alt={`${e.symbol} setup`}
            className="w-full h-36 object-cover border-b border-surface-700/50" />
        </button>
      )}
      <div className="p-4 pl-5 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[15px] font-display font-bold text-surface-50">{e.symbol}</span>
              {e.direction === 'short' && (
                <span className="text-[9px] font-bold tracking-wider text-danger border border-danger/30 bg-danger/10 rounded px-1.5 py-0.5">SHORT</span>
              )}
              <span className={`text-[9px] font-bold tracking-wider rounded px-1.5 py-0.5 border ${tone.bg} ${tone.text} ${tone.border}`}>
                {tone.label}
              </span>
            </div>
            <div className="text-[11px] text-surface-500 mt-0.5">{e.date}{e.setup ? ` · ${e.setup}` : ''}</div>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-[18px] font-display font-bold tabular-nums ${e.verdict === 'missed' ? 'text-danger' : 'text-surface-300'}`}>
              {fmtR(e.r_real ?? e.r_best)}
            </div>
            <div className="text-[9px] text-surface-500 uppercase tracking-wider">
              {e.r_real != null ? 'realistic' : e.r_best != null ? 'best case' : 'unpriced'}
            </div>
          </div>
        </div>

        {e.reason && (
          <div className={`mt-2 inline-flex self-start items-center gap-1.5 text-[10.5px] rounded px-2 py-1 border ${gt.bg} ${gt.text} ${gt.border}`}>
            {e.reason}
          </div>
        )}

        {e.why_good && <p className="mt-2 text-[12px] text-surface-300 leading-snug line-clamp-3">{e.why_good}</p>}
        {e.lesson && <p className="mt-1.5 text-[11.5px] text-surface-500 leading-snug line-clamp-2 italic">{e.lesson}</p>}

        <div className="flex-1" />
        <div className="mt-3 flex items-center gap-2">
          {e.tags?.slice(0, 3).map(t => (
            <span key={t} className="text-[9.5px] text-surface-400 bg-surface-800/70 border border-surface-700 rounded px-1.5 py-0.5">{t}</span>
          ))}
          <div className="flex-1" />
          <button onClick={() => onOpen(e)} className="text-[11px] text-surface-500 hover:text-surface-200">Open</button>
          <button onClick={() => onEdit(e)} className="text-[11px] text-surface-500 hover:text-accent">Edit</button>
          <button onClick={() => onDelete(e)} className="text-[11px] text-surface-500 hover:text-danger">Delete</button>
        </div>
      </div>
    </div>
  )
}

function DetailModal({ e, onClose }) {
  const tone = VERDICT_TONE[e.verdict] || VERDICT_TONE.unclear
  useEscape(onClose)
  return (
    <div className="fixed inset-0 z-50 bg-surface-950/85 backdrop-blur-sm overflow-y-auto p-4 sm:p-8" onClick={onClose}>
      <div className="mx-auto max-w-4xl rounded-2xl border border-surface-700/60 bg-surface-900" onClick={ev => ev.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-surface-700/50">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[18px] font-display font-bold text-surface-50">{e.symbol}</span>
            <span className={`text-[9px] font-bold tracking-wider rounded px-1.5 py-0.5 border ${tone.bg} ${tone.text} ${tone.border}`}>{tone.label}</span>
            <span className="text-[11px] text-surface-500">{e.date}{e.setup ? ` · ${e.setup}` : ''}</span>
          </div>
          <button onClick={onClose} className="text-surface-400 hover:text-surface-100 text-[20px] leading-none px-2">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[['Entry', e.entry], ['Stop', e.stop], [e.direction === 'short' ? 'Low' : 'High', e.peak], ['Exit', e.exit_price]].map(([l, v]) => (
              <div key={l} className="rounded-lg border border-surface-700/50 bg-surface-800/40 px-3 py-2">
                <div className="text-[9px] font-bold tracking-widest text-surface-500 uppercase">{l}</div>
                <div className="text-[13px] font-mono text-surface-100 tabular-nums">{v ?? '—'}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 flex-wrap text-[12px]">
            <span className="text-surface-400">Best case <span className="font-mono font-bold text-surface-100">{fmtR(e.r_best)}</span></span>
            <span className="text-surface-400">Realistic <span className="font-mono font-bold text-accent">{fmtR(e.r_real)}</span></span>
            {e.pct_best != null && <span className="text-surface-400">Move <span className="font-mono text-surface-100">{e.pct_best}%</span></span>}
          </div>
          {e.why_good && (
            <div>
              <div className="text-[10px] font-bold tracking-widest text-surface-500 uppercase mb-1">Why it was good</div>
              <p className="text-[13px] text-surface-200 leading-relaxed whitespace-pre-wrap">{e.why_good}</p>
            </div>
          )}
          {e.lesson && (
            <div>
              <div className="text-[10px] font-bold tracking-widest text-surface-500 uppercase mb-1">Why it was missed</div>
              <p className="text-[13px] text-surface-300 leading-relaxed whitespace-pre-wrap">{e.lesson}</p>
            </div>
          )}
          {e.screenshots?.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {e.screenshots.map(n => (
                <img key={n} src={missedScreenshotUrl(n)} alt="" className="w-full rounded-lg border border-surface-700" />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Names shortlisted on Prep, never traded, that then went somewhere. The book
// otherwise records only what you remember to record — the worst possible
// sample of the events you're least motivated to write down. Accepting a
// suggestion prefills the form; logging it as a *correct pass* is how you tell
// the list to stop offering it, so there's no separate dismissal state.
function Suggestions({ onAccept }) {
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let alive = true
    getMissedSuggestions({ days: 90 })
      .then(d => { if (alive) setRows(d) })
      .catch(() => { if (alive) setRows({ suggestions: [] }) })
    return () => { alive = false }
  }, [])

  if (!rows || !rows.suggestions?.length) return null

  return (
    <div className="rounded-2xl border border-cyan/25 bg-cyan/[0.04] overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-cyan/[0.06] transition-colors">
        <span className="text-[11px] font-bold tracking-widest uppercase text-cyan">From your prep</span>
        <span className="text-[12px] text-surface-400">
          <span className="font-semibold text-surface-200">{rows.suggestions.length}</span> shortlisted
          {rows.suggestions.length === 1 ? ' name you' : ' names you'} didn’t trade, and {rows.suggestions.length === 1 ? 'it' : 'they'} moved
        </span>
        <svg className={`w-4 h-4 ml-auto text-surface-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4">
          <p className="text-[11px] text-surface-500 leading-snug mb-2.5">
            A review queue, not a cost: ranked by how far the name travelled from its first trigger, with what the
            10-day rail would actually have banked beside it. Those disagree most often when a setup triggered, stopped
            you out, and then ran — the commonest shape a real miss takes. Cost only gets computed from the entry and
            stop you supply. Logging one as a correct pass removes it from here; the filters working is a result worth
            keeping, not a row to hide.
          </p>
          <div className="space-y-1.5">
            {rows.suggestions.map(s => (
              <div key={`${s.symbol}-${s.prep_date}`}
                className="flex items-center gap-3 flex-wrap rounded-xl border border-surface-700/50 bg-surface-900/50 px-3 py-2">
                <span className="text-[13.5px] font-display font-bold text-surface-50 w-14 shrink-0">{s.symbol}</span>
                <span className="text-[11px] text-surface-500 w-24 shrink-0" title={`Shortlisted ${s.prep_date}`}>
                  {s.anchor_date || s.prep_date}
                </span>
                {s.setup_state && (
                  <span className="text-[10px] text-surface-400 bg-surface-800 border border-surface-700 rounded px-1.5 py-0.5">
                    {s.setup_state}
                  </span>
                )}
                <span className="text-[12px] font-mono tabular-nums text-accent font-semibold"
                  title={`High of ${s.peak} on ${s.peak_date}`}>
                  +{s.pct_to_peak}%
                </span>
                <span className={`text-[11px] font-mono tabular-nums ${s.pct_to_rail < 0 ? 'text-danger/80' : 'text-surface-500'}`}
                  title={`10-day rail exit at ${s.trail_exit} on ${s.trail_exit_date}`}>
                  {s.pct_to_rail >= 0 ? '+' : ''}{s.pct_to_rail}% on the rail
                  {s.trail_hit ? '' : ' (still running)'}
                </span>
                <button onClick={() => onAccept(s)}
                  className="ml-auto text-[11px] font-semibold text-accent hover:text-accent-bright bg-accent/10 border border-accent/30 rounded-lg px-2.5 py-1">
                  Log it
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function MissedBook() {
  const [entries, setEntries] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [detail, setDetail] = useState(null)
  const [filterVerdict, setFilterVerdict] = useState('ALL')
  const [filterReasonGroup, setFilterReasonGroup] = useState('ALL')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [e, s] = await Promise.all([getMissedEntries(), getMissedSummary()])
      setEntries(e.entries || [])
      setSummary(s)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (e) => {
    if (!window.confirm(`Delete the ${e.symbol} entry? This removes its screenshots too.`)) return
    try { await deleteMissedEntry(e.id); load() } catch (err) { setError(err.message) }
  }

  const filtered = useMemo(() => entries.filter(e => {
    if (filterVerdict !== 'ALL' && e.verdict !== filterVerdict) return false
    if (filterReasonGroup !== 'ALL' && (REASON_GROUP_OF[e.reason] || 'other') !== filterReasonGroup) return false
    if (search) {
      const hay = `${e.symbol} ${e.setup} ${e.reason} ${e.why_good} ${e.lesson} ${(e.tags || []).join(' ')}`.toLowerCase()
      if (!hay.includes(search.toLowerCase())) return false
    }
    return true
  }), [entries, filterVerdict, filterReasonGroup, search])

  const missed = summary?.missed
  const topReason = summary?.by_reason?.[0]

  // Unclear entries that have sat undecided for a month. The verdict decides
  // whether a row is a cost or a process win, so leaving them is the one way to
  // make every number on the page wrong at once.
  const staleUnclear = useMemo(() => {
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    return entries.filter(e => e.verdict === 'unclear' && (e.date || '') < cutoff).length
  }, [entries])

  return (
    <div className="space-y-6">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-2xl border border-surface-700/50 bg-gradient-to-br from-surface-900 via-surface-900/80 to-surface-950">
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-danger/10 blur-3xl pointer-events-none" />
        <div className="relative px-5 sm:px-6 py-4 sm:py-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold tracking-widest text-danger bg-danger/10 border border-danger/30 uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse-soft" />
                  Omission
                </span>
                <h1 className="text-[20px] sm:text-[22px] font-display font-bold text-surface-50 tracking-tight leading-tight">
                  Missed Book
                </h1>
              </div>
              <p className="mt-0.5 text-[12px] text-surface-400 max-w-2xl">
                The Playbook keeps the trades you took well. This keeps the ones you didn’t take at all — with the chart,
                the honest reason, and what it went on to do. Discipline measures the trades you shouldn’t have taken;
                this is the other half of the same question.
              </p>
            </div>
            <button
              onClick={() => { setEditing(null); setShowForm(true) }}
              className="shrink-0 text-[12px] font-semibold text-accent hover:text-accent-bright bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-lg px-3.5 py-2"
            >
              + Log a miss
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-[12.5px] text-danger">
          {error} — is the backend running?
        </div>
      )}

      <Suggestions onAccept={(s) => {
        // Prefill everything the shortlist and the cache already know; the
        // reason is the one field only you can supply, so it's left blank.
        setEditing({
          // Dated at the trigger, not the shortlist night — that's the day the
          // decision was actually available to make.
          symbol: s.symbol, date: s.anchor_date || s.prep_date, setup: '', direction: 'long',
          verdict: 'missed', reason: '',
          entry: String(s.ref_close ?? ''), stop: '',
          peak: String(s.peak ?? ''), exit_price: String(s.trail_exit ?? ''),
          why_good: s.note || '', lesson: '', tags: '', screenshots: [],
        })
        setShowForm(true)
      }} />

      {staleUnclear > 0 && (
        <div className="rounded-xl border border-surface-700/60 bg-surface-900/50 px-4 py-2.5 text-[12px] text-surface-400 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold tracking-widest uppercase text-surface-500">Revisit</span>
          <span>
            <span className="font-semibold text-surface-200">{staleUnclear}</span> entr{staleUnclear === 1 ? 'y is' : 'ies are'} still
            marked unclear after 30 days. The verdict is the field the whole summary hangs on — decide them.
          </span>
          <button onClick={() => setFilterVerdict('unclear')}
            className="ml-auto text-[11px] text-accent hover:text-accent-bright">Show them →</button>
        </div>
      )}

      {/* SUMMARY */}
      {summary && summary.total > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Real misses" value={missed.count} tone="text-danger" border="border-danger/25"
              hint="Setups you should have taken" />
            <Stat label="Cost — realistic" value={missed.r_real_sum != null ? fmtR(missed.r_real_sum) : '—'}
              tone="text-surface-100"
              hint={`Priced to the exit you'd actually have taken · ${missed.r_real_n} of ${missed.count} priced`} />
            <Stat label="Cost — best case" value={missed.r_best_sum != null ? fmtR(missed.r_best_sum) : '—'}
              tone="text-surface-400"
              hint={`To the high you would not have caught · ${missed.r_best_n} of ${missed.count} priced`} />
            <Stat label="Correct passes" value={summary.passed.count} tone="text-accent" border="border-accent/25"
              hint="The filters working — not a cost" />
          </div>

          {/* Where the misses come from */}
          {summary.by_group.length > 0 && (
            <div className="rounded-2xl border border-surface-700/50 bg-surface-900/40 p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
                <h2 className="text-[13px] font-bold tracking-wider uppercase text-surface-300">Where the misses come from</h2>
                {topReason && (
                  <span className="text-[11px] text-surface-500">
                    Most expensive single reason: <span className="text-surface-200 font-semibold">{topReason.reason}</span>
                    {topReason.r_real_sum != null && <> · {fmtR(topReason.r_real_sum)} over {topReason.count}</>}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {summary.by_group.map(g => {
                  const gt = GROUP_TONE[g.group] || GROUP_TONE.other
                  return (
                    <button key={g.group} onClick={() => setFilterReasonGroup(filterReasonGroup === g.group ? 'ALL' : g.group)}
                      className={`text-left rounded-xl border px-3.5 py-3 transition-colors ${filterReasonGroup === g.group ? `${gt.border} ${gt.bg}` : 'border-surface-700/50 bg-surface-900/50 hover:border-surface-600'}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`text-[11px] font-bold tracking-widest uppercase ${gt.text}`}>{g.group}</span>
                        <span className="text-[18px] font-display font-bold tabular-nums text-surface-100">{g.count}</span>
                      </div>
                      <div className="mt-1 text-[10.5px] text-surface-500 leading-snug">{GROUP_FIX[g.group]}</div>
                      {g.r_real_sum != null && (
                        <div className="mt-1.5 text-[11px] font-mono text-surface-300">{fmtR(g.r_real_sum)} over {g.r_real_n} priced</div>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Ranked reasons */}
              <div className="mt-3 space-y-1">
                {summary.by_reason.map(r => {
                  const gt = GROUP_TONE[r.group] || GROUP_TONE.other
                  const max = Math.max(...summary.by_reason.map(x => x.count))
                  return (
                    <div key={r.reason} className="flex items-center gap-3">
                      <span className="text-[11.5px] text-surface-300 w-[220px] shrink-0 truncate">{r.reason}</span>
                      <div className="flex-1 h-2 rounded-full bg-surface-800 overflow-hidden">
                        <div className={`h-full ${gt.bar} opacity-80`} style={{ width: `${(r.count / max) * 100}%` }} />
                      </div>
                      <span className="text-[11px] font-mono tabular-nums text-surface-400 w-10 text-right">{r.count}</span>
                      <span className="text-[11px] font-mono tabular-nums text-surface-300 w-16 text-right">
                        {r.r_real_sum != null ? fmtR(r.r_real_sum) : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
              <p className="mt-3 text-[11px] text-surface-500 leading-snug">
                Cost is summed only over entries you priced to a realistic exit — the “best case” column exists to be
                distrusted. Nobody sells the high, and a book of maxima adds up to a number that argues for trading more,
                which is exactly the wrong lesson to take from a page like this.
              </p>

              {/* Which setups go missing. Reasons say *how* you miss; this says
                  *what* — and the two answer different questions. EPs force a
                  decision in the first five minutes; a flag gives you all day,
                  so a book weighted to one family points somewhere specific. */}
              {summary.by_setup.filter(s => s.setup !== 'unspecified').length >= 2 && (
                <div className="mt-4 pt-4 border-t border-surface-700/40">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                    <h3 className="text-[11px] font-bold tracking-widest uppercase text-surface-400">Which setups go missing</h3>
                    <span className="text-[11px] text-surface-500">a book that leans one way is a different problem from one that doesn’t</span>
                  </div>
                  <div className="space-y-1">
                    {summary.by_setup.map(s => {
                      const max = Math.max(...summary.by_setup.map(x => x.count)) || 1
                      const isEP = s.setup.startsWith('EP')
                      return (
                        <div key={s.setup} className="flex items-center gap-3">
                          <span className="text-[11.5px] text-surface-300 w-[220px] shrink-0 truncate">{s.setup}</span>
                          <div className="flex-1 h-2 rounded-full bg-surface-800 overflow-hidden">
                            <div className={`h-full opacity-80 ${isEP ? 'bg-warning' : 'bg-purple'}`}
                              style={{ width: `${(s.count / max) * 100}%` }} />
                          </div>
                          <span className="text-[11px] font-mono tabular-nums text-surface-400 w-10 text-right">{s.count}</span>
                          <span className="text-[11px] font-mono tabular-nums text-surface-300 w-16 text-right">
                            {s.r_real_sum != null ? fmtR(s.r_real_sum) : '—'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* The trend. Ranked reasons say where the leak is; only this says
                  whether last month's fix did anything. Hidden under two months
                  because a single bar is not a trend. */}
              {summary.by_month.length >= 2 && (
                <div className="mt-4 pt-4 border-t border-surface-700/40">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2.5">
                    <h3 className="text-[11px] font-bold tracking-widest uppercase text-surface-400">Is it getting better?</h3>
                    <span className="text-[11px] text-surface-500">misses per month — the number that says whether the fix took</span>
                  </div>
                  <div className="flex items-end gap-2 h-24">
                    {(() => {
                      const max = Math.max(...summary.by_month.map(m => m.count)) || 1
                      return summary.by_month.map(m => (
                        <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0"
                          title={`${m.count} miss${m.count === 1 ? '' : 'es'}${m.r_real_sum != null ? ` · ${fmtR(m.r_real_sum)} over ${m.r_real_n} priced` : ''}`}>
                          <span className="text-[10px] font-mono tabular-nums text-surface-400">{m.count}</span>
                          <div className="w-full rounded-t bg-danger/60 hover:bg-danger/80 transition-colors"
                            style={{ height: `${Math.max(4, (m.count / max) * 100)}%` }} />
                          <span className="text-[9.5px] font-mono text-surface-500 truncate w-full text-center">
                            {m.month.slice(5)}/{m.month.slice(2, 4)}
                          </span>
                        </div>
                      ))
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* FILTERS */}
      {entries.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {['ALL', ...VERDICTS.map(v => v.value)].map(v => (
            <button key={v} onClick={() => setFilterVerdict(v)}
              className={`text-[11.5px] font-semibold rounded-lg border px-3 py-1.5 transition-colors ${
                filterVerdict === v
                  ? (v === 'ALL' ? 'border-surface-500 bg-surface-700/40 text-surface-100' : `${VERDICT_TONE[v].border} ${VERDICT_TONE[v].bg} ${VERDICT_TONE[v].text}`)
                  : 'border-surface-700/60 text-surface-400 hover:text-surface-200 hover:border-surface-600'
              }`}>
              {v === 'ALL' ? 'All' : VERDICT_TONE[v].label}
            </button>
          ))}
          {filterReasonGroup !== 'ALL' && (
            <button onClick={() => setFilterReasonGroup('ALL')}
              className="text-[11.5px] rounded-lg border border-surface-600 bg-surface-800/60 text-surface-200 px-3 py-1.5">
              {filterReasonGroup} ×
            </button>
          )}
          <div className="flex-1 min-w-[140px]">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search symbol, setup, notes…"
              className="w-full bg-surface-900/60 border border-surface-700/60 rounded-lg px-3 py-1.5 text-[12px] text-surface-100 placeholder-surface-500 focus:outline-none focus:border-accent" />
          </div>
        </div>
      )}

      {/* LIST */}
      {loading ? (
        <div className="rounded-2xl border border-surface-700/40 bg-surface-900/40 p-12 text-center text-[13px] text-surface-400">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-surface-700 bg-surface-900/30 p-10 text-center">
          <h3 className="text-[15px] font-display font-bold text-surface-100">Nothing logged yet</h3>
          <p className="mt-1.5 text-[12.5px] text-surface-400 max-w-lg mx-auto leading-relaxed">
            Log the setups that got away — the chart as you saw it, what it did after, and the honest reason it didn’t
            get taken. After a dozen entries the ranked reasons below the header stop being a diary and start being a
            diagnosis: whether your misses are a scan problem, a hesitation problem, or the price of running concentrated.
          </p>
          <button onClick={() => { setEditing(null); setShowForm(true) }}
            className="mt-4 text-[12px] font-semibold text-accent hover:text-accent-bright bg-accent/10 border border-accent/30 rounded-lg px-4 py-2">
            Log the first one
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-surface-700/40 bg-surface-900/40 p-10 text-center text-[13px] text-surface-400">
          No entries match this filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(e => (
            <EntryCard key={e.id} e={e} onOpen={setDetail} onDelete={handleDelete}
              onEdit={(row) => { setEditing(row); setShowForm(true) }} />
          ))}
        </div>
      )}

      {showForm && (
        <EntryForm
          editingId={editing?.id}
          initial={editing ? {
            symbol: editing.symbol || '', date: editing.date || today(), setup: editing.setup || '',
            direction: editing.direction || 'long', verdict: editing.verdict || 'missed', reason: editing.reason || '',
            entry: editing.entry ?? '', stop: editing.stop ?? '', peak: editing.peak ?? '',
            exit_price: editing.exit_price ?? '', why_good: editing.why_good || '', lesson: editing.lesson || '',
            tags: (editing.tags || []).join(', '), screenshots: editing.screenshots || [],
          } : null}
          onCancel={() => { setShowForm(false); setEditing(null) }}
          onSaved={() => { setShowForm(false); setEditing(null); load() }}
        />
      )}

      {detail && <DetailModal e={detail} onClose={() => setDetail(null)} />}

      <div className="pt-1 text-[10.5px] text-surface-500 font-mono text-center">
        Missed Book · the omission half of the discipline loop · {ALL_REASONS.length} tagged reasons
      </div>
    </div>
  )
}
