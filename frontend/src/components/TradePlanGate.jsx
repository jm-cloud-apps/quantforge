import { useEffect, useMemo, useState } from 'react'
import {
  getConfig, saveConfig, listPlans, createPlan, setPlanStatus, deletePlan, computeRisk,
} from '../api/tradePlans'

// Mirrors the sanctioned Playbook taxonomy (frontend/src/pages/Playbook.jsx).
// There is no "Random" here by design — if it's not on this list, it's not a trade.
const SETUP_GROUPS = [
  { group: 'HTF', items: ['HTF - Long Base Break', 'HTF - Symmetrical Flag', 'HTF - Down Flat Flag', 'HTF - Up Flat Flag', 'HTF - Channel'] },
  { group: 'EP', items: ['EP - Earnings Gap Up', 'EP - Thematic / Macro', 'EP - Financing / Strategic', 'EP - Structural / Milestone', 'EP - Product / Tech', 'EP - Analyst / Narrative'] },
]

// The user's own rules (tradingRules.js) — shown as the gate's conscience.
const RULES = [
  'Know your stop before you enter. No stop, no trade.',
  'Size off the stop, not conviction. Risk drives size.',
  'Risk 0.25–1% of account. Never more, no exceptions.',
]

const money = (n) => n == null || isNaN(n) ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const today = () => new Date().toISOString().slice(0, 10)

const rrTone = (rr) => rr == null ? 'text-surface-400'
  : rr >= 2 ? 'text-emerald-300' : rr >= 1.5 ? 'text-amber-300' : 'text-red-300'

const BLANK = {
  symbol: '', setup: '', direction: 'long', entry: '', stop: '', target: '',
  conviction: '', minHold: '',
}

// Minimum-hold presets. A swing edge is horizon-dependent — a setup that needs
// a week to resolve can't be judged on day one — so the plan commits to a floor
// and the discipline scorecard flags exits taken before it. "Same day" is
// offered but named for what it is.
const MIN_HOLD_OPTIONS = [
  { value: '', label: 'No floor' },
  { value: '0', label: 'Day trade' },
  { value: '2', label: '2 days' },
  { value: '5', label: '5 days' },
  { value: '10', label: '10 days' },
]

// Does the direction being planned contradict today's breadth read?
//
// This is a friction step, not a block. There are legitimate reasons to trade
// against the read (an exceptional setup, managing an existing position), so the
// gate never refuses — it makes the disagreement explicit, requires a deliberate
// acknowledgement, and records the override on the plan so the cost of trading
// against the tape becomes measurable instead of anecdotal.
function conflictFor(verdict, direction) {
  if (!verdict) return null
  const state = direction === 'short' ? verdict.new_short : verdict.new_long
  const side = direction === 'short' ? 'shorts' : 'longs'
  if (state === 'no') {
    return {
      level: 'block',
      title: verdict.avoid
        ? `Today reads as a no-trade day — ${verdict.label}`
        : `Today's read says no new ${side} — ${verdict.label}`,
      body: verdict.why,
    }
  }
  if (state === 'stalk') {
    return {
      level: 'caution',
      title: `${side[0].toUpperCase()}${side.slice(1)} are stalk-only today`,
      body: 'Conditions are building but unconfirmed — wait for the trigger rather than anticipating it.',
    }
  }
  if (state === 'selective') {
    return {
      level: 'caution',
      title: 'A+ setups only today',
      body: 'Mixed tape — demand best-in-class structure, cut size, and take partials quickly.',
    }
  }
  return null
}

export default function TradePlanGate({ regime = null, verdict = null, onPlanLogged = null }) {
  const [config, setConfig] = useState(null)
  const [plans, setPlans] = useState([])
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [override, setOverride] = useState(false)
  const [cfgDraft, setCfgDraft] = useState({ account_size: '', risk_pct: '' })

  const refresh = async () => {
    try {
      const { plans: p } = await listPlans({ date: today() })
      setPlans(p || [])
    } catch (e) { setError(e.message) }
  }

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getConfig()
        setConfig(cfg)
        setCfgDraft({ account_size: cfg.account_size, risk_pct: cfg.risk_pct })
      } catch (e) { setError(e.message) }
      refresh()
    })()
  }, [])

  const risk = useMemo(() => {
    if (!config) return null
    return computeRisk({
      direction: form.direction, entry: form.entry, stop: form.stop, target: form.target,
      accountSize: config.account_size, riskPct: config.risk_pct,
    })
  }, [form.direction, form.entry, form.stop, form.target, config])

  // Client-side gate mirrors the server: real setup + correctly-sided stop/target.
  const sideOk = useMemo(() => {
    const e = Number(form.entry), s = Number(form.stop), t = Number(form.target)
    if (!e || !s || !t) return false
    return form.direction === 'long' ? (s < e && t > e) : (s > e && t < e)
  }, [form])

  // Today's read vs the direction being planned. A 'block' conflict needs an
  // explicit acknowledgement before the plan can be logged.
  const conflict = useMemo(() => conflictFor(verdict, form.direction), [verdict, form.direction])
  const needsOverride = conflict?.level === 'block'

  // Any change of direction retracts a prior acknowledgement — the trader has to
  // agree to the *current* disagreement, not a stale one.
  useEffect(() => { setOverride(false) }, [form.direction, verdict?.code])

  const canSave = form.symbol.trim() && form.setup && sideOk && risk && risk.shares > 0
    && (!needsOverride || override)

  const onSave = async () => {
    setError(''); setSaving(true)
    try {
      await createPlan({
        symbol: form.symbol, setup: form.setup, direction: form.direction,
        entry: Number(form.entry), stop: Number(form.stop), target: Number(form.target),
        conviction: form.conviction ? Number(form.conviction) : null,
        min_hold_days: form.minHold === '' ? null : Number(form.minHold),
        regime: regime || null,
        verdict_code: verdict?.code || null,
        override: Boolean(needsOverride && override),
      })
      setForm(BLANK)
      setOverride(false)
      await refresh()
      // Logging a plan clears the day's circuit breaker — tell the page so the
      // withheld verdict unlocks without a reload.
      await onPlanLogged?.()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const onStatus = async (id, status) => {
    try { await setPlanStatus(id, status); await refresh() } catch (e) { setError(e.message) }
  }
  const onDelete = async (id) => {
    try { await deletePlan(id); await refresh() } catch (e) { setError(e.message) }
  }

  const onSaveConfig = async () => {
    try {
      const cfg = await saveConfig({ account_size: Number(cfgDraft.account_size), risk_pct: Number(cfgDraft.risk_pct) })
      setConfig(cfg); setShowSettings(false)
    } catch (e) { setError(e.message) }
  }

  const inputCls = 'w-full rounded-lg bg-surface-800 border border-surface-700 px-2.5 py-1.5 text-sm text-surface-100 focus:border-accent focus:outline-none placeholder:text-surface-600'
  const labelCls = 'text-[10px] uppercase tracking-wide text-surface-500 font-semibold mb-1 block'

  return (
    <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-surface-50 flex items-center gap-2">
            Pre-trade gate
            <span className="text-[10px] font-medium uppercase tracking-wider text-accent bg-accent/10 border border-accent/25 rounded-full px-2 py-0.5">No stop, no trade</span>
          </h2>
          <p className="text-xs text-surface-500 mt-1 max-w-xl">
            Define the setup, stop, and target before you enter — size is computed off the stop.
            {config && <> Risking <span className="text-surface-300">{config.risk_pct}%</span> of <span className="text-surface-300">{money(config.account_size)}</span> = <span className="text-surface-300">{money(config.account_size * config.risk_pct / 100)}</span> per trade.</>}
          </p>
        </div>
        <button onClick={() => setShowSettings((v) => !v)} className="text-xs text-surface-400 hover:text-surface-200 border border-surface-700 rounded-lg px-3 py-1.5">
          Account &amp; risk
        </button>
      </div>

      {showSettings && (
        <div className="mt-4 flex items-end gap-3 flex-wrap rounded-xl bg-surface-800/60 border border-surface-700/50 p-3">
          <div>
            <label className={labelCls}>Account size</label>
            <input type="number" className={inputCls} style={{ width: 140 }} value={cfgDraft.account_size}
              onChange={(e) => setCfgDraft({ ...cfgDraft, account_size: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Risk % / trade</label>
            <input type="number" step="0.05" className={inputCls} style={{ width: 110 }} value={cfgDraft.risk_pct}
              onChange={(e) => setCfgDraft({ ...cfgDraft, risk_pct: e.target.value })} />
          </div>
          <button onClick={onSaveConfig} className="rounded-lg bg-accent/15 border border-accent/30 text-accent text-sm px-4 py-1.5 hover:bg-accent/25">Save</button>
        </div>
      )}

      {/* Plan form */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div>
          <label className={labelCls}>Symbol</label>
          <input className={inputCls} value={form.symbol} placeholder="AAPL"
            onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} />
        </div>
        <div>
          <label className={labelCls}>Direction</label>
          <div className="flex rounded-lg overflow-hidden border border-surface-700">
            {['long', 'short'].map((d) => (
              <button key={d} onClick={() => setForm({ ...form, direction: d })}
                className={`flex-1 text-xs py-1.5 capitalize ${form.direction === d ? (d === 'long' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300') : 'bg-surface-800 text-surface-500'}`}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1 lg:col-span-2">
          <label className={labelCls}>Setup</label>
          <select className={inputCls} value={form.setup} onChange={(e) => setForm({ ...form, setup: e.target.value })}>
            <option value="">Select a playbook setup…</option>
            {SETUP_GROUPS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.items.map((s) => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Entry</label>
          <input type="number" step="0.01" className={inputCls} value={form.entry}
            onChange={(e) => setForm({ ...form, entry: e.target.value })} />
        </div>
        <div>
          <label className={`${labelCls} text-red-300/70`}>Stop</label>
          <input type="number" step="0.01" className={inputCls} value={form.stop}
            onChange={(e) => setForm({ ...form, stop: e.target.value })} />
        </div>
        <div>
          <label className={`${labelCls} text-emerald-300/70`}>Target</label>
          <input type="number" step="0.01" className={inputCls} value={form.target}
            onChange={(e) => setForm({ ...form, target: e.target.value })} />
        </div>
        <div>
          <label className={labelCls} title="Exits before this floor are flagged as a deviation">
            Min hold
          </label>
          <select className={inputCls} value={form.minHold}
            onChange={(e) => setForm({ ...form, minHold: e.target.value })}>
            {MIN_HOLD_OPTIONS.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Live risk readout */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="Shares to buy" value={risk?.shares > 0 ? risk.shares.toLocaleString() : '—'} big />
        <Metric label="Position size" value={risk?.shares > 0 ? money(risk.positionValue) : '—'}
          hint={risk?.pctOfAccount ? `${risk.pctOfAccount.toFixed(0)}% of account` : ''} />
        <Metric label="$ at risk" value={risk?.shares > 0 ? money(risk.dollarRisk) : '—'}
          hint={risk?.riskPerShare ? `${money(risk.riskPerShare)}/sh` : ''} tone="text-red-300" />
        <Metric label="Reward : risk" value={risk?.rr != null ? `${risk.rr.toFixed(2)}R` : '—'} tone={rrTone(risk?.rr)}
          hint={risk?.rr != null ? (risk.rr >= 2 ? 'good' : risk.rr >= 1.5 ? 'thin' : 'below 1.5 — skip') : ''} />
      </div>

      {/* Today's read vs the direction being planned. Deliberate friction: it
          never blocks outright, but a direct contradiction has to be
          acknowledged, and the acknowledgement is stored on the plan. */}
      {conflict && (
        <div className={`mt-3 rounded-lg px-3 py-2.5 border ${
          conflict.level === 'block'
            ? 'bg-rose-500/10 border-rose-400/30'
            : 'bg-amber-500/10 border-amber-400/30'
        }`}>
          <div className="flex items-start gap-2">
            <svg className={`w-3.5 h-3.5 mt-px shrink-0 ${conflict.level === 'block' ? 'text-rose-300' : 'text-amber-300'}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div className="min-w-0">
              <div className={`text-[12px] font-semibold ${conflict.level === 'block' ? 'text-rose-200' : 'text-amber-200'}`}>
                {conflict.title}
              </div>
              {conflict.body && <p className="text-[11.5px] text-surface-300 mt-0.5 leading-snug">{conflict.body}</p>}

              {needsOverride && (
                <label className="mt-2 flex items-start gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={override}
                    onChange={(e) => setOverride(e.target.checked)}
                    className="mt-0.5 accent-rose-400"
                  />
                  <span className="text-[11.5px] text-surface-300 group-hover:text-surface-200 leading-snug">
                    I'm trading against today's read on purpose — log this as an override.
                    <span className="text-surface-500"> Recorded on the plan so its outcome can be measured later.</span>
                  </span>
                </label>
              )}
            </div>
          </div>
        </div>
      )}

      {error && <div className="mt-3 rounded-lg bg-red-500/10 border border-red-400/30 px-3 py-2 text-xs text-red-200">{error}</div>}

      <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-surface-500">
          {RULES.map((r) => <li key={r} className="flex items-center gap-1"><span className="text-accent/70">›</span>{r}</li>)}
        </ul>
        <button onClick={onSave} disabled={!canSave || saving}
          className="rounded-lg bg-accent/15 border border-accent/40 text-accent text-sm font-medium px-5 py-2 hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed">
          {saving ? 'Saving…' : 'Log plan'}
        </button>
      </div>

      {/* Today's plans */}
      {plans.length > 0 && (
        <div className="mt-5 pt-4 border-t border-surface-700/40">
          <div className="text-[10px] uppercase tracking-wide text-surface-600 font-semibold mb-2">Today's plans · {plans.length}</div>
          <div className="space-y-1.5">
            {plans.map((p) => (
              <div key={p.id} className={`flex items-center gap-3 flex-wrap rounded-xl bg-surface-800/50 border border-surface-700/40 px-3 py-2 text-sm ${p.status === 'skipped' ? 'opacity-50' : ''}`}>
                <span className="font-semibold text-surface-100 w-14">{p.symbol}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${p.direction === 'long' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>{p.direction}</span>
                <span className="text-[11px] text-surface-400 flex-1 min-w-[120px]">{p.setup}</span>
                <span className="text-xs text-surface-500 font-mono">{p.entry} → <span className="text-emerald-300/80">{p.target}</span> / <span className="text-red-300/80">{p.stop}</span></span>
                <span className={`text-xs font-medium ${rrTone(p.rr_ratio)}`}>{p.rr_ratio != null ? `${p.rr_ratio}R` : ''}</span>
                <span className="text-xs text-surface-400">
                  {p.shares}sh · {money(p.dollar_risk)} risk
                  {p.min_hold_days != null && <span className="text-surface-500"> · hold {p.min_hold_days}d+</span>}
                </span>
                {p.status === 'planned' ? (
                  <span className="flex items-center gap-1">
                    <button onClick={() => onStatus(p.id, 'taken')} className="text-[11px] px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10">Taken</button>
                    <button onClick={() => onStatus(p.id, 'skipped')} className="text-[11px] px-2 py-0.5 rounded border border-surface-600 text-surface-400 hover:bg-surface-700/40">Skip</button>
                  </span>
                ) : (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${p.status === 'taken' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-surface-700/60 text-surface-400'}`}>{p.status}</span>
                )}
                <button onClick={() => onDelete(p.id)} className="text-surface-600 hover:text-red-300 text-xs" aria-label="Delete plan">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, hint, tone = 'text-surface-100', big = false }) {
  return (
    <div className="rounded-xl bg-surface-800/50 border border-surface-700/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-surface-500 font-semibold">{label}</div>
      <div className={`${big ? 'text-xl' : 'text-lg'} font-semibold ${tone} tabular-nums`}>{value}</div>
      {hint && <div className="text-[10px] text-surface-500 mt-0.5">{hint}</div>}
    </div>
  )
}
