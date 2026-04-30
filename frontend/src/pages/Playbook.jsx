import { useState, useEffect, useRef } from 'react'
import { getPlaybookEntries, createPlaybookEntry, deletePlaybookEntry, getScreenshotUrl } from '../api/playbook'
import { useToast } from '../components/Toast'

const INPUT_STYLE = 'w-full rounded-lg bg-surface-800 border border-surface-600/40 px-4 py-2.5 text-sm text-surface-100 placeholder-surface-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 transition-colors'

const SETUP_TYPES = [
  { group: 'HTF', items: ['HTF - Long Base Break', 'HTF - Symmetrical Flag', 'HTF - Down Flat Flag', 'HTF - Up Flat Flag', 'HTF - Channel'] },
  { group: 'EP', items: ['EP - Earnings Gap Up', 'EP - Thematic / Macro', 'EP - Financing / Strategic', 'EP - Structural / Milestone', 'EP - Product / Tech', 'EP - Analyst / Narrative'] },
]

const ALL_SETUP_VALUES = SETUP_TYPES.flatMap(g => g.items)

const INITIAL_FORM = {
  symbol: '',
  date: '',
  setup: '',
  pnl: '',
  pnl_pct: '',
  notes: '',
  tags: '',
}

/* ── Custom Dropdown ── */
function Dropdown({ value, onChange, options, placeholder, grouped, searchable, className = '' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)
  const searchRef = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (open && searchable) {
      setTimeout(() => searchRef.current?.focus(), 0)
    }
    if (!open) setQuery('')
  }, [open, searchable])

  const displayLabel = value || placeholder

  const filteredOptions = query
    ? (options || []).filter(opt => opt.toLowerCase().includes(query.toLowerCase()))
    : (options || [])

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between rounded-lg bg-surface-800 border px-3.5 py-2 text-sm transition-colors ${
          open ? 'border-accent ring-1 ring-accent/30' : 'border-surface-600/40 hover:border-surface-500'
        } ${value ? 'text-surface-100' : 'text-surface-500'}`}
      >
        <span className="truncate">{displayLabel}</span>
        <svg
          className={`w-3.5 h-3.5 ml-2 flex-shrink-0 text-surface-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] max-h-60 rounded-lg bg-surface-800 border border-surface-600/40 shadow-xl shadow-black/30 flex flex-col">
          {/* Search input */}
          {searchable && (
            <div className="p-2 border-b border-surface-700/50">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type to search..."
                className="w-full rounded bg-surface-900 border border-surface-600/30 px-2.5 py-1.5 text-xs text-surface-100 placeholder-surface-500 focus:border-accent focus:outline-none"
              />
            </div>
          )}

          <div className="overflow-y-auto py-1">
            {/* Clear / All option */}
            {!query && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false) }}
                className={`w-full text-left px-3.5 py-2 text-sm transition-colors ${
                  !value ? 'text-accent bg-accent/10' : 'text-surface-400 hover:bg-surface-700/60 hover:text-surface-200'
                }`}
              >
                {placeholder}
              </button>
            )}

            {grouped && !query ? (
              grouped.map((group) => (
                <div key={group.group}>
                  <div className="px-3.5 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-surface-500">
                    {group.group}
                  </div>
                  {group.items.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => { onChange(item); setOpen(false) }}
                      className={`w-full text-left px-3.5 py-2 text-sm transition-colors ${
                        value === item ? 'text-accent bg-accent/10' : 'text-surface-300 hover:bg-surface-700/60 hover:text-surface-100'
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ))
            ) : (
              filteredOptions.length > 0 ? (
                filteredOptions.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => { onChange(opt); setOpen(false) }}
                    className={`w-full text-left px-3.5 py-2 text-sm transition-colors ${
                      value === opt ? 'text-accent bg-accent/10' : 'text-surface-300 hover:bg-surface-700/60 hover:text-surface-100'
                    }`}
                  >
                    {opt}
                  </button>
                ))
              ) : (
                <div className="px-3.5 py-2 text-sm text-surface-500">No matches</div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Playbook() {
  const { toast } = useToast()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [detailEntry, setDetailEntry] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  // Filters
  const [filterSetup, setFilterSetup] = useState('')
  const [filterSymbol, setFilterSymbol] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [search, setSearch] = useState('')

  // Add form
  const [form, setForm] = useState(INITIAL_FORM)
  const [screenshotFile, setScreenshotFile] = useState(null)
  const [screenshotPreview, setScreenshotPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    loadEntries()
  }, [])

  async function loadEntries() {
    setLoading(true)
    try {
      const res = await getPlaybookEntries()
      setEntries(res.entries || [])
    } catch (err) {
      console.error('Failed to load database:', err)
    }
    setLoading(false)
  }

  async function handleSubmit() {
    if (!form.symbol.trim() || !form.date) return
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('symbol', form.symbol)
      fd.append('date', form.date)
      fd.append('setup', form.setup)
      fd.append('pnl', form.pnl || '0')
      fd.append('pnl_pct', form.pnl_pct || '0')
      fd.append('notes', form.notes)
      fd.append('tags', form.tags)
      if (screenshotFile) {
        fd.append('screenshot', screenshotFile)
      }
      await createPlaybookEntry(fd)
      setShowAddModal(false)
      setForm(INITIAL_FORM)
      setScreenshotFile(null)
      setScreenshotPreview(null)
      loadEntries()
      toast.success(`${form.symbol} added to playbook`)
    } catch (err) {
      console.error('Failed to create entry:', err)
      toast.error('Failed to save entry')
    }
    setSaving(false)
  }

  async function handleDelete(id) {
    try {
      await deletePlaybookEntry(id)
      setConfirmDelete(null)
      setDetailEntry(null)
      loadEntries()
      toast.success('Entry deleted')
    } catch (err) {
      console.error('Failed to delete:', err)
      toast.error('Failed to delete entry')
    }
  }

  function handleFileSelect(file) {
    if (!file) return
    setScreenshotFile(file)
    const reader = new FileReader()
    reader.onload = (e) => setScreenshotPreview(e.target.result)
    reader.readAsDataURL(file)
  }

  function handleDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      handleFileSelect(file)
    }
  }

  // Derive filter options from existing entries
  const allSetups = [...new Set(entries.map(e => e.setup).filter(Boolean))].sort()
  const allSymbols = [...new Set(entries.map(e => e.symbol).filter(Boolean))].sort()
  const allTags = [...new Set(entries.flatMap(e => e.tags || []))].sort()

  const filtered = entries.filter(e => {
    if (filterSetup && e.setup !== filterSetup) return false
    if (filterSymbol && e.symbol !== filterSymbol) return false
    if (filterTag && !(e.tags || []).includes(filterTag)) return false
    if (search && !`${e.symbol} ${e.setup} ${e.notes} ${(e.tags || []).join(' ')}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const hasActiveFilters = filterSetup || filterSymbol || filterTag || search

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">
            Database
          </h1>
          <p className="text-surface-400 text-[13px] mt-1">
            Your collection of standout trades — setups worth repeating.
          </p>
        </div>
        <button
          onClick={() => { setForm(INITIAL_FORM); setScreenshotFile(null); setScreenshotPreview(null); setShowAddModal(true); }}
          className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 hover:text-surface-50 transition-colors"
        >
          + Add Trade
        </button>
      </div>

      {/* Filter Bar */}
      {entries.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="w-[220px]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className={INPUT_STYLE}
            />
          </div>
          <Dropdown
            value={filterSetup}
            onChange={setFilterSetup}
            options={allSetups}
            placeholder="All Setups"
            className="w-[180px]"
          />
          {allSymbols.length > 0 && (
            <Dropdown
              value={filterSymbol}
              onChange={setFilterSymbol}
              options={allSymbols}
              placeholder="All Symbols"
              searchable
              className="w-[160px]"
            />
          )}
          {allTags.length > 0 && (
            <Dropdown
              value={filterTag}
              onChange={setFilterTag}
              options={allTags}
              placeholder="All Tags"
              className="w-[160px]"
            />
          )}
          {hasActiveFilters && (
            <button
              onClick={() => { setFilterSetup(''); setFilterSymbol(''); setFilterTag(''); setSearch('') }}
              className="text-xs text-surface-500 hover:text-surface-300 transition-colors whitespace-nowrap"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Gallery Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-xl bg-surface-900/80 border border-surface-700/50 overflow-hidden" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="skeleton h-48 rounded-none" />
              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="skeleton h-4 w-16" />
                  <div className="skeleton h-4 w-20" />
                </div>
                <div className="skeleton h-3 w-32" />
                <div className="skeleton h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[16px] bg-surface-900 border border-surface-700/50 border-dashed p-16 text-center">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-accent/20 to-purple/10 border border-accent/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-accent/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
          </div>
          {entries.length === 0 ? (
            <>
              <p className="text-surface-200 text-[15px] font-semibold">Build Your Playbook</p>
              <p className="text-surface-500 text-[13px] mt-1.5 max-w-sm mx-auto leading-relaxed">
                Save your best trade setups with screenshots, notes, and tags. Build a visual reference library of patterns that work for you.
              </p>
              <button
                onClick={() => { setForm(INITIAL_FORM); setScreenshotFile(null); setScreenshotPreview(null); setShowAddModal(true); }}
                className="mt-5 px-5 py-2.5 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 hover:text-surface-50 transition-colors inline-flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                Add Your First Trade
              </button>
            </>
          ) : (
            <>
              <p className="text-surface-200 text-[15px] font-semibold">No Matching Entries</p>
              <p className="text-surface-500 text-[13px] mt-1.5">Try adjusting your filters or search terms.</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((entry) => (
            <div
              key={entry.id}
              onClick={() => setDetailEntry(entry)}
              className="rounded-xl bg-surface-900/80 border border-surface-700/50 overflow-hidden cursor-pointer hover:border-accent/30 transition-all group"
            >
              {/* Screenshot Hero */}
              {entry.screenshot ? (
                <div className="h-48 bg-surface-800 overflow-hidden">
                  <img
                    src={getScreenshotUrl(entry.screenshot)}
                    alt={`${entry.symbol} setup`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
              ) : (
                <div className="h-48 bg-surface-800/50 flex items-center justify-center">
                  <span className="text-surface-600 text-sm">No screenshot</span>
                </div>
              )}

              {/* Card Body */}
              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-surface-100">{entry.symbol}</span>
                  <span className={`text-sm font-mono font-semibold ${entry.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                    {entry.pnl >= 0 ? '+' : ''}${Math.abs(entry.pnl).toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {entry.setup && (
                    <span className="px-2 py-0.5 rounded-full bg-accent/15 text-accent text-[10px] font-medium">{entry.setup}</span>
                  )}
                  <span className="text-surface-500 text-xs">{entry.date}</span>
                  {entry.pnl_pct !== 0 && (
                    <span className={`text-[10px] font-mono ${entry.pnl_pct >= 0 ? 'text-success' : 'text-danger'}`}>
                      {entry.pnl_pct >= 0 ? '+' : ''}{entry.pnl_pct.toFixed(1)}%
                    </span>
                  )}
                </div>
                {entry.notes && (
                  <p className="text-surface-400 text-xs line-clamp-2">{entry.notes}</p>
                )}
                {entry.tags?.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {entry.tags.map(tag => (
                      <span key={tag} className="px-2 py-0.5 rounded-full bg-surface-800 text-surface-400 text-[10px]">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Entry Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl mx-4 rounded-2xl bg-surface-900 border border-surface-700/50 p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-surface-100">Add to Database</h2>
              <button onClick={() => setShowAddModal(false)} className="text-surface-400 hover:text-surface-200 text-xl">&times;</button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">Symbol *</label>
                <input type="text" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="e.g. AAPL" className={INPUT_STYLE} />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">Date *</label>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={INPUT_STYLE} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">Setup</label>
                <Dropdown
                  value={form.setup}
                  onChange={(v) => setForm({ ...form, setup: v })}
                  options={ALL_SETUP_VALUES}
                  grouped={SETUP_TYPES}
                  placeholder="Select setup..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">P&L ($)</label>
                <input type="number" step="0.01" value={form.pnl} onChange={(e) => setForm({ ...form, pnl: e.target.value })} placeholder="0.00" className={INPUT_STYLE} />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1.5">Return %</label>
                <input type="number" step="0.01" value={form.pnl_pct} onChange={(e) => setForm({ ...form, pnl_pct: e.target.value })} placeholder="0.00" className={INPUT_STYLE} />
              </div>
            </div>

            {/* Screenshot Upload */}
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Screenshot</label>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl border-2 border-dashed border-surface-600/40 bg-surface-800/30 p-6 text-center cursor-pointer hover:border-accent/40 transition-colors"
              >
                {screenshotPreview ? (
                  <div className="space-y-2">
                    <img src={screenshotPreview} alt="Preview" className="max-h-48 mx-auto rounded-lg" />
                    <p className="text-surface-400 text-xs">{screenshotFile?.name}</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <svg className="w-8 h-8 mx-auto text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    <p className="text-surface-400 text-sm">Drop an image here or click to browse</p>
                    <p className="text-surface-600 text-xs">PNG, JPG, WEBP</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFileSelect(e.target.files[0])}
                className="hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="What made this trade great? Key observations..." rows={3} className={INPUT_STYLE} />
            </div>

            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Tags (comma-separated)</label>
              <input type="text" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="e.g. momentum, earnings, gap-up" className={INPUT_STYLE} />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleSubmit}
                disabled={!form.symbol.trim() || !form.date || saving}
                className="px-5 py-2.5 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 hover:text-surface-50 transition-colors disabled:opacity-40"
              >
                {saving ? 'Saving...' : 'Save to Database'}
              </button>
              <button onClick={() => setShowAddModal(false)} className="px-5 py-2.5 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-400 hover:bg-surface-700 hover:text-surface-200 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail View Modal */}
      {detailEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDetailEntry(null)}>
          <div className="w-full max-w-3xl mx-4 rounded-2xl bg-surface-900 border border-surface-700/50 overflow-hidden max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Screenshot */}
            {detailEntry.screenshot && (
              <div className="bg-surface-800">
                <img
                  src={getScreenshotUrl(detailEntry.screenshot)}
                  alt={`${detailEntry.symbol} setup`}
                  className="w-full max-h-[50vh] object-contain"
                />
              </div>
            )}

            {/* Details */}
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-xl text-surface-50">{detailEntry.symbol}</span>
                  {detailEntry.setup && (
                    <span className="px-3 py-1 rounded-full bg-accent/15 text-accent text-xs font-medium">{detailEntry.setup}</span>
                  )}
                </div>
                <div className="text-right">
                  <div className={`text-lg font-mono font-bold ${detailEntry.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                    {detailEntry.pnl >= 0 ? '+' : ''}${Math.abs(detailEntry.pnl).toFixed(2)}
                  </div>
                  {detailEntry.pnl_pct !== 0 && (
                    <div className={`text-sm font-mono ${detailEntry.pnl_pct >= 0 ? 'text-success' : 'text-danger'}`}>
                      {detailEntry.pnl_pct >= 0 ? '+' : ''}{detailEntry.pnl_pct.toFixed(2)}%
                    </div>
                  )}
                </div>
              </div>

              <div className="text-surface-400 text-sm">
                {new Date(detailEntry.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </div>

              {detailEntry.notes && (
                <div>
                  <label className="block text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Notes</label>
                  <p className="text-surface-200 text-sm whitespace-pre-wrap">{detailEntry.notes}</p>
                </div>
              )}

              {detailEntry.tags?.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {detailEntry.tags.map(tag => (
                    <span key={tag} className="px-2.5 py-1 rounded-full bg-accent/10 text-accent text-xs font-medium">{tag}</span>
                  ))}
                </div>
              )}

              <div className="flex gap-3 pt-2 border-t border-surface-700">
                {confirmDelete === detailEntry.id ? (
                  <>
                    <span className="text-danger text-sm py-2.5">Delete this entry?</span>
                    <button onClick={() => handleDelete(detailEntry.id)} className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-danger hover:bg-surface-700 transition-colors">
                      Confirm
                    </button>
                    <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-400 hover:bg-surface-700 hover:text-surface-200 transition-colors">
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setConfirmDelete(detailEntry.id)} className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-danger hover:bg-surface-700 transition-colors">
                      Delete
                    </button>
                    <button onClick={() => setDetailEntry(null)} className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 hover:text-surface-50 transition-colors">
                      Close
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
