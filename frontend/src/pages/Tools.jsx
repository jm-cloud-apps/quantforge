import { useState, useEffect } from 'react'
import { calculatePositionSize, getChecklistTemplate, saveChecklistTemplate } from '../api/tools'

const INPUT_STYLE = 'w-full rounded-lg bg-surface-800 border border-surface-600/40 px-4 py-2.5 text-sm text-surface-100 placeholder-surface-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 transition-colors'

export default function Tools() {
  const [tab, setTab] = useState('sizer')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">
          Trading Tools
        </h1>
        <p className="text-surface-400 text-[13px] mt-1">
          Risk management and trading discipline tools.
        </p>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 rounded-lg bg-surface-900/80 border border-surface-700/50 p-1 w-fit">
        <button
          onClick={() => setTab('sizer')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            tab === 'sizer' ? 'bg-accent/15 text-accent' : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          Position Sizer
        </button>
        <button
          onClick={() => setTab('checklist')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
            tab === 'checklist' ? 'bg-accent/15 text-accent' : 'text-surface-400 hover:text-surface-200'
          }`}
        >
          Pre-Trade Checklist
        </button>
      </div>

      {tab === 'sizer' ? <PositionSizer /> : <PreTradeChecklist />}
    </div>
  )
}


function PositionSizer() {
  const [method, setMethod] = useState('fixed_pct')
  const [form, setForm] = useState({
    account_size: 100000,
    risk_per_trade_pct: 1,
    entry_price: '',
    stop_loss_price: '',
    win_rate: 55,
    avg_win: 500,
    avg_loss: 250,
    atr_value: '',
    atr_multiplier: 2,
  })
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function handleCalculate() {
    setError(null)
    try {
      const res = await calculatePositionSize({
        ...form,
        method,
        entry_price: parseFloat(form.entry_price),
        stop_loss_price: parseFloat(form.stop_loss_price),
        atr_value: parseFloat(form.atr_value) || 0,
      })
      setResult(res)
    } catch (err) {
      setError(err.message)
    }
  }

  const methods = [
    { id: 'fixed_pct', label: 'Fixed % Risk', desc: 'Risk a fixed percentage of your account per trade' },
    { id: 'kelly', label: 'Kelly Criterion', desc: 'Optimal sizing based on your win rate and R:R' },
    { id: 'atr_based', label: 'ATR-Based', desc: 'Size based on average true range volatility' },
  ]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Input Form */}
      <div className="rounded-[16px] bg-surface-900 border border-surface-700/50 p-6 space-y-5">
        <h2 className="text-base font-semibold text-surface-100">Calculate Position Size</h2>

        {/* Method selector */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-surface-400">Method</label>
          <div className="space-y-2">
            {methods.map((m) => (
              <label
                key={m.id}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  method === m.id ? 'border-accent/40 bg-accent/5' : 'border-surface-700/50 hover:border-surface-600'
                }`}
              >
                <input
                  type="radio"
                  name="method"
                  value={m.id}
                  checked={method === m.id}
                  onChange={() => setMethod(m.id)}
                  className="mt-0.5 accent-accent"
                />
                <div>
                  <p className="text-sm font-medium text-surface-100">{m.label}</p>
                  <p className="text-xs text-surface-500">{m.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Core inputs */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Account Size ($)</label>
            <input type="number" value={form.account_size} onChange={(e) => setForm({ ...form, account_size: parseFloat(e.target.value) || 0 })} className={INPUT_STYLE} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Risk Per Trade (%)</label>
            <input type="number" value={form.risk_per_trade_pct} onChange={(e) => setForm({ ...form, risk_per_trade_pct: parseFloat(e.target.value) || 0 })} step="0.25" className={INPUT_STYLE} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Entry Price ($)</label>
            <input type="number" value={form.entry_price} onChange={(e) => setForm({ ...form, entry_price: e.target.value })} placeholder="0.00" step="0.01" className={INPUT_STYLE} />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Stop Loss ($)</label>
            <input type="number" value={form.stop_loss_price} onChange={(e) => setForm({ ...form, stop_loss_price: e.target.value })} placeholder="0.00" step="0.01" className={INPUT_STYLE} />
          </div>
        </div>

        {/* Kelly inputs */}
        {method === 'kelly' && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Win Rate (%)</label>
              <input type="number" value={form.win_rate} onChange={(e) => setForm({ ...form, win_rate: parseFloat(e.target.value) || 0 })} className={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Avg Win ($)</label>
              <input type="number" value={form.avg_win} onChange={(e) => setForm({ ...form, avg_win: parseFloat(e.target.value) || 0 })} className={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Avg Loss ($)</label>
              <input type="number" value={form.avg_loss} onChange={(e) => setForm({ ...form, avg_loss: parseFloat(e.target.value) || 0 })} className={INPUT_STYLE} />
            </div>
          </div>
        )}

        {/* ATR inputs */}
        {method === 'atr_based' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">ATR Value</label>
              <input type="number" value={form.atr_value} onChange={(e) => setForm({ ...form, atr_value: e.target.value })} placeholder="0.00" step="0.01" className={INPUT_STYLE} />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">ATR Multiplier</label>
              <input type="number" value={form.atr_multiplier} onChange={(e) => setForm({ ...form, atr_multiplier: parseFloat(e.target.value) || 2 })} step="0.5" className={INPUT_STYLE} />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm">{error}</div>
        )}

        <button
          onClick={handleCalculate}
          disabled={!form.entry_price || !form.stop_loss_price}
          className="px-5 py-2.5 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 hover:text-surface-50 transition-colors disabled:opacity-40"
        >
          Calculate
        </button>
      </div>

      {/* Results */}
      <div className="rounded-[16px] bg-surface-900 border border-surface-700/50 p-6">
        <h2 className="text-base font-semibold text-surface-100 mb-4">Results</h2>

        {!result ? (
          <div className="text-center py-12 text-surface-500 text-sm">
            Enter your trade parameters and click Calculate.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Main result */}
            <div className="rounded-xl bg-accent/10 border border-accent/20 p-5 text-center">
              <p className="text-xs text-accent/70 uppercase tracking-wider mb-1">Shares to Buy</p>
              <p className="text-4xl font-bold text-accent">{result.shares?.toLocaleString() || 0}</p>
            </div>

            {/* Detail grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-surface-800/60 p-3">
                <p className="text-[11px] text-surface-500 uppercase">Dollar Risk</p>
                <p className="text-lg font-semibold text-danger">${result.risk_amount?.toLocaleString()}</p>
              </div>
              <div className="rounded-lg bg-surface-800/60 p-3">
                <p className="text-[11px] text-surface-500 uppercase">Risk/Share</p>
                <p className="text-lg font-semibold text-surface-100">${result.risk_per_share}</p>
              </div>
              <div className="rounded-lg bg-surface-800/60 p-3">
                <p className="text-[11px] text-surface-500 uppercase">Position Value</p>
                <p className="text-lg font-semibold text-surface-100">${result.position_value?.toLocaleString()}</p>
              </div>
              <div className="rounded-lg bg-surface-800/60 p-3">
                <p className="text-[11px] text-surface-500 uppercase">% of Account</p>
                <p className="text-lg font-semibold text-surface-100">{result.position_pct_of_account}%</p>
              </div>
              <div className="rounded-lg bg-surface-800/60 p-3">
                <p className="text-[11px] text-surface-500 uppercase">Stop Distance</p>
                <p className="text-lg font-semibold text-surface-100">{result.stop_loss_distance_pct}%</p>
              </div>
              {result.kelly_pct !== undefined && (
                <div className="rounded-lg bg-surface-800/60 p-3">
                  <p className="text-[11px] text-surface-500 uppercase">Kelly / Half-Kelly</p>
                  <p className="text-lg font-semibold text-purple">{result.kelly_pct}% / {result.half_kelly_pct}%</p>
                </div>
              )}
              {result.atr_stop_distance !== undefined && (
                <div className="rounded-lg bg-surface-800/60 p-3">
                  <p className="text-[11px] text-surface-500 uppercase">ATR Stop</p>
                  <p className="text-lg font-semibold text-surface-100">${result.atr_stop_distance}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


function PreTradeChecklist() {
  const [items, setItems] = useState([])
  const [checked, setChecked] = useState({})
  const [newItem, setNewItem] = useState('')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    loadChecklist()
  }, [])

  async function loadChecklist() {
    try {
      const res = await getChecklistTemplate()
      setItems(res.items || [])
      setChecked({})
    } catch (err) {
      console.error('Failed to load checklist:', err)
    }
  }

  async function handleSave() {
    try {
      await saveChecklistTemplate(items)
      setEditing(false)
    } catch (err) {
      console.error('Failed to save checklist:', err)
    }
  }

  function addItem() {
    if (newItem.trim()) {
      setItems([...items, newItem.trim()])
      setNewItem('')
    }
  }

  function removeItem(index) {
    setItems(items.filter((_, i) => i !== index))
  }

  function toggleCheck(index) {
    setChecked({ ...checked, [index]: !checked[index] })
  }

  function resetChecklist() {
    setChecked({})
  }

  const totalChecked = Object.values(checked).filter(Boolean).length
  const allChecked = totalChecked === items.length && items.length > 0
  const progress = items.length > 0 ? (totalChecked / items.length) * 100 : 0

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-[16px] bg-surface-900 border border-surface-700/50 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-surface-100">Pre-Trade Checklist</h2>
          <div className="flex gap-2">
            <button
              onClick={resetChecklist}
              className="px-3 py-1.5 rounded-lg bg-surface-800 border border-surface-600/40 text-xs text-surface-400 hover:text-surface-200 transition-colors"
            >
              Reset
            </button>
            <button
              onClick={() => setEditing(!editing)}
              className="px-3 py-1.5 rounded-lg bg-surface-800 border border-surface-600/40 text-xs text-surface-400 hover:text-surface-200 transition-colors"
            >
              {editing ? 'Done Editing' : 'Customize'}
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-surface-500">{totalChecked} of {items.length} completed</span>
            <span className={`text-xs font-medium ${allChecked ? 'text-accent' : 'text-surface-400'}`}>
              {allChecked ? 'Ready to Trade' : `${Math.round(progress)}%`}
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${allChecked ? 'bg-accent' : 'bg-accent/50'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Checklist items */}
        <div className="space-y-2">
          {items.map((item, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                checked[i]
                  ? 'bg-accent/5 border-accent/20'
                  : 'bg-surface-800/40 border-surface-700/30 hover:border-surface-600/50'
              }`}
            >
              <button
                onClick={() => toggleCheck(i)}
                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                  checked[i] ? 'bg-accent border-accent text-white' : 'border-surface-600 hover:border-accent/50'
                }`}
              >
                {checked[i] && (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <span className={`text-sm flex-1 ${checked[i] ? 'text-surface-400 line-through' : 'text-surface-200'}`}>
                {item}
              </span>
              {editing && (
                <button onClick={() => removeItem(i)} className="text-danger/60 hover:text-danger text-sm flex-shrink-0">
                  &times;
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Add new item (edit mode) */}
        {editing && (
          <div className="flex gap-2">
            <input
              type="text"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
              placeholder="Add checklist item..."
              className={`${INPUT_STYLE} flex-1`}
            />
            <button onClick={addItem} className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 hover:text-surface-50 transition-colors">
              Add
            </button>
          </div>
        )}

        {editing && (
          <button onClick={handleSave} className="px-5 py-2.5 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 hover:text-surface-50 transition-colors">
            Save Template
          </button>
        )}

        {/* Ready to trade indicator */}
        {allChecked && (
          <div className="rounded-xl bg-accent/10 border border-accent/20 p-4 text-center">
            <p className="text-accent font-semibold">All checks passed — you are ready to trade.</p>
          </div>
        )}
      </div>
    </div>
  )
}
