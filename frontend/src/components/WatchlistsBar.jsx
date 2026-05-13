import { useEffect, useState } from 'react'
import { listWatchlists, createWatchlist, deleteWatchlist, removeSymbol } from '../api/watchlists'

/**
 * Watchlists bar — chips at the top of Stock Analysis.
 * Click a watchlist chip to run a search across all of its symbols.
 * Create / rename / delete are inline.
 *
 * Props:
 *   currentTickers: string[]     — the tickers currently shown on the page
 *   onActivate(symbols)          — called when the user clicks a chip
 */
export default function WatchlistsBar({ currentTickers = [], onActivate }) {
  const [lists, setLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [error, setError] = useState(null)

  const reload = async () => {
    try {
      const data = await listWatchlists()
      setLists(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setError(null)
    try {
      await createWatchlist({ name, symbols: currentTickers })
      setNewName('')
      setCreating(false)
      reload()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this watchlist?')) return
    try {
      await deleteWatchlist(id)
      if (activeId === id) setActiveId(null)
      reload()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleActivate = (wl) => {
    setActiveId(wl.id)
    onActivate?.(wl.symbols || [])
  }

  const handleRemoveSymbol = async (wlId, symbol, e) => {
    e.stopPropagation()
    try {
      await removeSymbol(wlId, symbol)
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider font-medium text-surface-500 mr-1">
        Watchlists
      </span>

      {lists.map((wl) => {
        const isActive = activeId === wl.id
        return (
          <div
            key={wl.id}
            className={`group relative inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors cursor-pointer ${
              isActive
                ? 'bg-accent/10 border-accent/40 text-accent'
                : 'bg-surface-900/60 border-surface-700/40 text-surface-300 hover:border-surface-600/60'
            }`}
            onClick={() => handleActivate(wl)}
            title={`${wl.symbols?.length || 0} symbols${wl.symbols?.length ? ` — ${wl.symbols.join(', ')}` : ''}`}
          >
            <span className="font-medium">{wl.name}</span>
            <span className="text-[10px] text-surface-500 tabular-nums">
              {wl.symbols?.length || 0}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(wl.id) }}
              className="opacity-0 group-hover:opacity-100 text-surface-500 hover:text-danger transition-opacity"
              title="Delete watchlist"
              aria-label="Delete watchlist"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )
      })}

      {creating ? (
        <div className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-surface-900/80 px-2 py-1">
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
              if (e.key === 'Escape') { setCreating(false); setNewName('') }
            }}
            placeholder="Name…"
            className="bg-transparent text-xs text-surface-100 placeholder-surface-600 outline-none w-28"
          />
          <button
            onClick={handleCreate}
            className="text-xs text-accent hover:text-accent/80"
            disabled={!newName.trim()}
          >
            Save
          </button>
          <button
            onClick={() => { setCreating(false); setNewName('') }}
            className="text-xs text-surface-500 hover:text-surface-300"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-surface-700/60 bg-surface-900/40 px-2.5 py-1 text-xs text-surface-500 hover:text-surface-300 hover:border-surface-600 transition-colors"
          title={currentTickers.length ? `Save current tickers (${currentTickers.join(', ')}) as a new watchlist` : 'Create an empty watchlist'}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {currentTickers.length > 0 ? `Save ${currentTickers.length} as list` : 'New watchlist'}
        </button>
      )}

      {error && <span className="text-xs text-danger ml-2">{error}</span>}
    </div>
  )
}
