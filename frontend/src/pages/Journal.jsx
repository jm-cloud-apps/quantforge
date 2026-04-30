import { useState, useEffect } from 'react'
import {
  getJournalEntries,
  getJournalStats,
  searchJournal,
} from '../api/journal'

const EMOTIONS = ['Calm', 'Confident', 'FOMO', 'Nervous', 'Revenge', 'Bored', 'Frustrated', 'Euphoric']

const EMOTION_COLORS = {
  Calm: 'bg-cyan/20 text-cyan border-cyan/30',
  Confident: 'bg-accent/20 text-accent border-accent/30',
  FOMO: 'bg-warning/20 text-warning border-warning/30',
  Nervous: 'bg-purple/20 text-purple border-purple/30',
  Revenge: 'bg-danger/20 text-danger border-danger/30',
  Bored: 'bg-surface-600/20 text-surface-400 border-surface-600/30',
  Frustrated: 'bg-danger/20 text-danger border-danger/30',
  Euphoric: 'bg-warning/20 text-warning border-warning/30',
}

const INPUT_STYLE = 'w-full rounded-lg bg-surface-800 border border-surface-600/40 px-4 py-2.5 text-sm text-surface-100 placeholder-surface-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 transition-colors'

function StarRating({ value }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          className={`text-lg ${star <= value ? 'text-warning' : 'text-surface-600'}`}
        >
          {star <= value ? '\u2605' : '\u2606'}
        </span>
      ))}
    </div>
  )
}

export default function Journal() {
  const [entries, setEntries] = useState([])
  const [stats, setStats] = useState(null)
  const [search, setSearch] = useState('')
  const [filterEmotion, setFilterEmotion] = useState('')
  const [filterRating, setFilterRating] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [entriesRes, statsRes] = await Promise.all([
        getJournalEntries(),
        getJournalStats(),
      ])
      setEntries(entriesRes.entries || [])
      setStats(statsRes)
    } catch (err) {
      console.error('Failed to load journal:', err)
    }
    setLoading(false)
  }

  async function handleSearch() {
    if (!search.trim()) {
      loadData()
      return
    }
    try {
      const res = await searchJournal(search)
      setEntries(res.entries || [])
    } catch (err) {
      console.error('Search failed:', err)
    }
  }

  const filtered = entries.filter((e) => {
    if (filterEmotion && e.emotion_entry !== filterEmotion) return false
    if (filterRating && e.rating < filterRating) return false
    return true
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">
          Trade Journal
        </h1>
        <p className="text-surface-400 text-[13px] mt-1">
          Review emotions, plans, and lessons from your trades.
        </p>
      </div>

      {/* Stats Cards */}
      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-4">
            <p className="text-[11px] text-surface-500 uppercase tracking-wider">Total Entries</p>
            <p className="text-2xl font-bold text-surface-100 mt-1">{stats.total}</p>
          </div>
          <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-4">
            <p className="text-[11px] text-surface-500 uppercase tracking-wider">Avg Rating</p>
            <p className="text-2xl font-bold text-warning mt-1">{stats.avg_rating}/5</p>
          </div>
          <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-4">
            <p className="text-[11px] text-surface-500 uppercase tracking-wider">Top Emotion (Entry)</p>
            <p className="text-lg font-bold text-surface-100 mt-1">
              {stats.emotions_entry && Object.keys(stats.emotions_entry).length > 0
                ? Object.entries(stats.emotions_entry).sort((a, b) => b[1] - a[1])[0][0]
                : 'N/A'}
            </p>
          </div>
          <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-4">
            <p className="text-[11px] text-surface-500 uppercase tracking-wider">Top Tag</p>
            <p className="text-lg font-bold text-surface-100 mt-1">
              {stats.top_tags?.length > 0 ? stats.top_tags[0].tag : 'N/A'}
            </p>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search entries..."
            className={INPUT_STYLE}
          />
        </div>
        <button onClick={handleSearch} className="px-4 py-2.5 rounded-lg bg-surface-800 border border-surface-600/40 text-sm text-surface-300 hover:bg-surface-700 transition-colors">
          Search
        </button>
        <select
          value={filterEmotion}
          onChange={(e) => setFilterEmotion(e.target.value)}
          className={`${INPUT_STYLE} w-auto`}
        >
          <option value="">All Emotions</option>
          {EMOTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <select
          value={filterRating}
          onChange={(e) => setFilterRating(Number(e.target.value))}
          className={`${INPUT_STYLE} w-auto`}
        >
          <option value={0}>All Ratings</option>
          {[1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>{r}+ stars</option>)}
        </select>
      </div>

      {/* Entries List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-4" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="flex items-center gap-3 mb-2">
                <div className="skeleton h-4 w-24" />
                <div className="skeleton h-5 w-16 rounded-full" />
                <div className="flex gap-1">{[...Array(5)].map((_, j) => <div key={j} className="skeleton w-4 h-4 rounded-full" />)}</div>
              </div>
              <div className="skeleton h-3 w-3/4" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[16px] bg-surface-900 border border-surface-700/50 border-dashed p-16 text-center">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-accent/20 to-cyan/10 border border-accent/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-accent/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          {entries.length === 0 ? (
            <>
              <p className="text-surface-200 text-[15px] font-semibold">Start Your Trading Journal</p>
              <p className="text-surface-500 text-[13px] mt-1.5 max-w-xs mx-auto leading-relaxed">
                Track emotions, plans, and lessons learned. Journal entries are created from the Trading Analysis page when you review individual trades.
              </p>
            </>
          ) : (
            <>
              <p className="text-surface-200 text-[15px] font-semibold">No Matching Entries</p>
              <p className="text-surface-500 text-[13px] mt-1.5">Try adjusting your search or filters.</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => (
            <div
              key={entry.trade_id}
              className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-4 transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-surface-100 font-medium">{entry.trade_id}</span>
                    {entry.emotion_entry && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${EMOTION_COLORS[entry.emotion_entry] || 'bg-surface-700 text-surface-400 border-surface-600'}`}>
                        {entry.emotion_entry}
                      </span>
                    )}
                    <StarRating value={entry.rating} />
                  </div>
                  {entry.pre_trade_plan && (
                    <p className="text-surface-400 text-xs mt-2 line-clamp-1">{entry.pre_trade_plan}</p>
                  )}
                  {entry.lessons_learned && (
                    <p className="text-surface-500 text-xs mt-1 line-clamp-1">Lesson: {entry.lessons_learned}</p>
                  )}
                </div>
                {entry.tags?.length > 0 && (
                  <div className="flex gap-1 ml-3 flex-shrink-0">
                    {entry.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium">
                        {tag}
                      </span>
                    ))}
                    {entry.tags.length > 3 && (
                      <span className="text-surface-500 text-[10px]">+{entry.tags.length - 3}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
