import { useState, useMemo, useEffect, useCallback } from 'react'
import { fetchNews, getNewsCache, saveNewsCache, deleteNewsCacheEntry, clearNewsCache, getEpScore, fetchCriteriaCheck } from '../api/news'

function formatTimestamp(iso) {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now - d
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  // Show date for older entries
  const isThisYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(isThisYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  })
}

const INPUT_STYLE =
  'w-full rounded-lg bg-surface-800 border border-surface-600/40 px-4 py-2.5 text-sm text-surface-100 placeholder-surface-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 transition-colors'

// Catalyst keywords for episodic pivot detection — full labels, no abbreviations
const CATALYST_RULES = [
  // ─── Core catalysts ───
  { tag: 'Earnings',                color: 'text-purple-400 bg-purple-400/10 border-purple-400/20',     keywords: ['earnings', 'eps', 'revenue beat', 'revenue miss', 'quarterly results', 'q1 ', 'q2 ', 'q3 ', 'q4 ', 'profit', 'guidance raise', 'guidance cut', 'blowout', 'beats estimates', 'misses estimates', 'tops expectations'] },
  { tag: 'Analyst Upgrade',        color: 'text-accent bg-accent/10 border-accent/20',                 keywords: ['upgrade', 'price target raise', 'price target hike', 'overweight', 'outperform', 'buy rating', 'bullish'] },
  { tag: 'Analyst Downgrade',      color: 'text-danger bg-danger/10 border-danger/20',                 keywords: ['downgrade', 'price target cut', 'price target lower', 'underweight', 'underperform', 'sell rating', 'bearish'] },
  { tag: 'Mergers & Acquisitions', color: 'text-cyan bg-cyan/10 border-cyan/20',                       keywords: ['acquisition', 'acquire', 'merger', 'buyout', 'takeover', 'deal'] },
  { tag: 'FDA Approval',           color: 'text-amber-400 bg-amber-400/10 border-amber-400/20',        keywords: ['fda', 'approval', 'approved', 'clearance', 'phase 3', 'phase 2', 'trial results'] },
  { tag: 'Contract / Partnership', color: 'text-blue-400 bg-blue-400/10 border-blue-400/20',           keywords: ['contract', 'awarded', 'partnership', 'collaboration', 'signed', 'strategic partnership', 'joint venture', 'alliance'] },
  { tag: 'Offering / Dilution',    color: 'text-orange-400 bg-orange-400/10 border-orange-400/20',     keywords: ['offering', 'dilution', 'secondary', 'shelf registration', 'ipo'] },

  // ─── Extended EP catalysts ───
  { tag: 'New Product',            color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',  keywords: ['new product', 'product launch', 'launches', 'unveils', 'introduces', 'innovation', 'breakthrough', 'new feature', 'new platform'] },
  { tag: 'Leadership Change',      color: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20',     keywords: ['new ceo', 'new cfo', 'names ceo', 'names cfo', 'appoints', 'appointed', 'management change', 'steps down', 'resigns', 'succession', 'new management', 'executive shakeup'] },
  { tag: 'Government / Policy',    color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',     keywords: ['regulation', 'regulatory', 'government', 'legislation', 'policy change', 'tariff', 'sanction', 'subsidy', 'tax reform', 'antitrust', 'executive order'] },
  { tag: 'Strategic Investment',   color: 'text-teal-400 bg-teal-400/10 border-teal-400/20',           keywords: ['strategic investment', 'takes stake', 'invests in', 'investment from', 'backing', 'funding round', 'series a', 'series b', 'venture capital', 'anchor investor'] },
  { tag: 'Insider Buying',         color: 'text-lime-400 bg-lime-400/10 border-lime-400/20',           keywords: ['insider buying', 'insider purchase', 'ceo buys', 'cfo buys', 'director buys', 'insider buy', 'form 4', 'buys shares', 'open market purchase'] },
  { tag: 'Legal / Litigation',     color: 'text-rose-400 bg-rose-400/10 border-rose-400/20',           keywords: ['lawsuit', 'legal ruling', 'court ruling', 'settlement', 'litigation', 'verdict', 'patent ruling', 'injunction', 'class action'] },
  { tag: 'Revenue / Sales',        color: 'text-sky-400 bg-sky-400/10 border-sky-400/20',              keywords: ['sales growth', 'revenue growth', 'record sales', 'sales surge', 'strong demand', 'backlog', 'record orders', 'sales beat', 'revenue beat'] },
  { tag: 'Theme Play',             color: 'text-violet-400 bg-violet-400/10 border-violet-400/20',     keywords: ['artificial intelligence', 'ai model', 'machine learning', 'electric vehicle', 'ev battery', 'biotech', 'crypto', 'bitcoin', 'blockchain', 'quantum computing', 'autonomous', 'crypto treasury'] },
  { tag: 'High Volume',            color: 'text-pink-400 bg-pink-400/10 border-pink-400/20',           keywords: ['unusual volume', 'high volume', 'volume spike', 'record volume', 'heavy trading', 'volume surge'] },
  { tag: 'Fugazi',                 color: 'text-red-300 bg-red-300/10 border-red-300/20',              keywords: ['pump', 'scam', 'fraud', 'misleading', 'ponzi', 'sec investigation', 'halted', 'delisted', 'suspicious', 'warning letter'] },
  { tag: 'Story / Narrative',      color: 'text-fuchsia-400 bg-fuchsia-400/10 border-fuchsia-400/20',  keywords: ['viral', 'trending', 'social media', 'meme stock', 'short squeeze', 'reddit', 'retail traders', 'momentum play', 'wallstreetbets'] },
]

function detectCatalysts(title, text) {
  const combined = `${title} ${text}`.toLowerCase()
  const found = []
  for (const rule of CATALYST_RULES) {
    if (rule.keywords.some((kw) => combined.includes(kw))) {
      found.push(rule)
    }
  }
  return found
}

function buildSummary(articles) {
  if (!articles || articles.length === 0) return null

  const catalystArticles = []
  const otherArticles = []

  for (const a of articles) {
    const cats = detectCatalysts(a.title, a.text)
    if (cats.length > 0) {
      catalystArticles.push({ ...a, catalysts: cats })
    } else {
      otherArticles.push({ ...a, catalysts: [] })
    }
  }

  const sorted = [...catalystArticles, ...otherArticles]

  let summaryText = ''
  if (catalystArticles.length > 0) {
    const tags = [...new Set(catalystArticles.flatMap((a) => a.catalysts.map((c) => c.tag)))]
    summaryText = `Potential catalysts detected: ${tags.join(', ')}`
  } else {
    summaryText = 'No major catalysts detected in the last 3 days'
  }

  return { sorted, summaryText, hasCatalysts: catalystArticles.length > 0 }
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const now = new Date()
  const then = new Date(dateStr)
  const diff = Math.max(0, now - then)
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function fmtPct(val) {
  if (val == null) return null
  const sign = val >= 0 ? '+' : ''
  return `${sign}${val.toFixed(1)}%`
}

function ChevronIcon({ open }) {
  return (
    <svg
      className={`w-5 h-5 text-surface-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

// ─── Qullamaggie EP Grade ─────────────────────────────────────────────────────

function gradeColor(grade) {
  if (!grade) return { text: 'text-surface-400', bg: 'bg-surface-800', border: 'border-surface-700/40' }
  if (grade === 'A+' || grade === 'A') return { text: 'text-accent', bg: 'bg-accent/10', border: 'border-accent/30' }
  if (grade === 'B') return { text: 'text-cyan', bg: 'bg-cyan/10', border: 'border-cyan/30' }
  if (grade === 'C') return { text: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/30' }
  return { text: 'text-danger', bg: 'bg-danger/10', border: 'border-danger/30' }
}

function GradeBadge({ epScore, loading, error }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-surface-800/60 border border-surface-700/40">
        <svg className="w-4 h-4 text-surface-500 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      </div>
    )
  }
  if (error || !epScore) {
    return (
      <div className="flex flex-col items-center justify-center w-14 h-14 rounded-xl bg-surface-800/60 border border-surface-700/40">
        <span className="text-xs text-surface-500 font-mono">—</span>
      </div>
    )
  }
  const c = gradeColor(epScore.grade)
  return (
    <div className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl border ${c.bg} ${c.border}`}>
      <span className={`text-xl font-bold leading-none font-display ${c.text}`}>{epScore.grade}</span>
      <span className="text-[9px] text-surface-500 font-mono mt-0.5">{epScore.total_score}/100</span>
    </div>
  )
}

function fmtMillions(val) {
  if (val == null) return '—'
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
  return `$${val.toFixed(0)}`
}

function fmtFloat(val) {
  if (val == null) return '—'
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B`
  return `${(val / 1_000_000).toFixed(0)}M`
}

// EP criterion tile — same surface treatment as PerformanceMetrics cards:
// subtle rounded surface, hairline border, calm typography. The accent is
// applied minimally — green when passed, amber when partial, muted when
// failing — via the progress bar and score color, not a heat-map background.
function EpCriterionTile({ crit }) {
  const [open, setOpen] = useState(false)
  const passed = crit.passed
  const pct = crit.max > 0 ? Math.max(0, Math.min(1, crit.points / crit.max)) : 0

  const scoreColor = passed
    ? 'text-success'
    : crit.points > 0
      ? 'text-warning'
      : 'text-surface-500'

  const barColor = passed
    ? 'bg-success'
    : crit.points > 0
      ? 'bg-warning/70'
      : 'bg-surface-700'

  const hoverBorder = passed
    ? 'hover:border-success/30'
    : crit.points > 0
      ? 'hover:border-warning/30'
      : 'hover:border-surface-600/60'

  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      className={`group relative text-left rounded-xl bg-surface-900/60 border border-surface-700/40 backdrop-blur-sm p-4 transition-all duration-200 ${hoverBorder}`}
    >
      {/* Label — matches the uppercase tracking-wider style used on metric cards */}
      <p className="text-[10px] font-medium text-surface-400 uppercase tracking-wider truncate">
        {crit.name}
      </p>

      {/* Score — calm typography, color carries the signal */}
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={`text-2xl font-bold tracking-tight tabular-nums leading-none ${scoreColor}`}>
          {crit.points}
        </span>
        <span className="text-sm text-surface-600 font-semibold tabular-nums">
          / {crit.max}
        </span>
        <span
          className={`ml-auto text-[10px] font-medium ${
            passed ? 'text-success/80' : 'text-surface-500'
          }`}
        >
          {passed ? 'Pass' : crit.points > 0 ? 'Partial' : '—'}
        </span>
      </div>

      {/* Hairline progress bar — the only chromatic accent */}
      <div className="mt-3 h-[2px] rounded-full bg-surface-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${barColor}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>

      {/* Reason — single quiet line, full detail on tap */}
      {!open ? (
        <p className="text-[11px] text-surface-500 mt-3 truncate" title={crit.why}>
          {crit.why}
        </p>
      ) : (
        <div className="mt-3 space-y-1.5">
          <p className="text-[11px] text-surface-200 leading-snug">{crit.why}</p>
          <p className="text-[10px] text-surface-500">
            <span className="text-surface-600">Threshold · </span>
            {crit.threshold}
          </p>
        </div>
      )}
    </button>
  )
}

function EpBreakdownCard({ epScore, epLoading, epError, ticker }) {
  const [claudeResult, setClaudeResult] = useState(null)
  const [claudeLoading, setClaudeLoading] = useState(false)
  const [claudeError, setClaudeError] = useState(null)

  async function askClaude() {
    setClaudeLoading(true)
    setClaudeError(null)
    setClaudeResult(null)
    try {
      const data = await fetchCriteriaCheck(ticker)
      setClaudeResult(data)
    } catch (err) {
      setClaudeError(err.message)
    }
    setClaudeLoading(false)
  }

  if (epLoading) {
    // Skeleton mirrors the real layout so the page doesn't jump when data lands.
    return (
      <div className="mx-5 mb-3 rounded-xl border border-surface-700/40 bg-surface-800/40 p-4">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-3.5 h-3.5 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span className="text-xs font-medium text-surface-200">Scoring {ticker}…</span>
          <span className="text-[10px] text-surface-500">
            fetching OHLCV · ratios · float · news · earnings
          </span>
        </div>
        <div
          className="grid gap-2 animate-pulse"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))' }}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-4">
              <div className="h-2 bg-surface-700/40 rounded w-1/2 mb-2" />
              <div className="h-6 bg-surface-700/50 rounded w-1/3 mb-2" />
              <div className="h-3 bg-surface-700/30 rounded w-2/3 mb-2" />
              <div className="h-[3px] bg-surface-700/40 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (epError || !epScore) {
    return (
      <div className="mx-5 mb-3 rounded-xl border border-surface-700/40 bg-surface-800/40 p-4">
        <p className="text-xs text-surface-500">
          EP grade unavailable{epError ? ` — ${epError}` : ' — Finnhub data fetch failed'}
        </p>
      </div>
    )
  }

  const c = gradeColor(epScore.grade)
  const cat = epScore.catalyst

  return (
    <div className={`mx-5 mb-3 rounded-xl border ${c.border} ${c.bg} p-4`}>
      {/* Verdict header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg className={`w-4 h-4 ${c.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.075 10.1c-.783-.57-.38-1.81.588-1.81h4.915a1 1 0 00.95-.69l1.519-4.674z" />
          </svg>
          <span className="text-xs font-semibold text-surface-100">Qullamaggie EP Score</span>
          {epScore.data_source && (
            <span
              className={`text-[9px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded border ${
                epScore.data_source === 'massive'
                  ? 'border-accent/30 bg-accent/10 text-accent'
                  : 'border-warning/30 bg-warning/10 text-warning'
              }`}
              title={
                epScore.data_source === 'massive'
                  ? 'OHLCV from Massive — full data path'
                  : 'OHLCV from yfinance fallback — Massive key not loaded. Volume/ADR may be missing.'
              }
            >
              {epScore.data_source}
            </span>
          )}
        </div>
        <div className={`px-2.5 py-1 rounded-lg border ${c.border} ${c.bg}`}>
          <span className={`text-sm font-bold ${c.text}`}>{epScore.grade}</span>
          <span className="text-xs text-surface-500 ml-1">· {epScore.verdict}</span>
        </div>
      </div>

      {/* Catalyst chip */}
      {cat && cat.type && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-surface-900/60 border border-surface-700/40">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider font-bold text-surface-500">Catalyst</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border text-violet-400 bg-violet-400/10 border-violet-400/20">
              {cat.type}
            </span>
          </div>
          {cat.url ? (
            <a href={cat.url} target="_blank" rel="noopener noreferrer" className="text-xs text-surface-200 hover:text-accent line-clamp-2 transition-colors">
              {cat.headline}
            </a>
          ) : (
            <p className="text-xs text-surface-200 line-clamp-2">{cat.headline}</p>
          )}
          {cat.source && <p className="text-[10px] text-surface-600 mt-1">{cat.source}</p>}
        </div>
      )}

      {/* Criteria — auto-fit tile grid with same surface treatment as
          PerformanceMetrics cards. Tap a tile to expand for detail. */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-[10px] uppercase tracking-wider font-medium text-surface-500">
            Setup Checklist
            <span className="text-surface-700 mx-1.5">·</span>
            <span className="text-surface-600 normal-case tracking-normal">{epScore.criteria.length} criteria</span>
          </span>
          <span className="text-[10px] text-surface-600">Tap to expand</span>
        </div>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))' }}
        >
          {epScore.criteria.map((crit) => (
            <EpCriterionTile key={crit.name} crit={crit} />
          ))}
        </div>
      </div>

      {/* Raw metrics — secondary detail strip, set apart from the checklist */}
      <div className="mb-3">
        <p className="text-[10px] uppercase tracking-wider font-medium text-surface-500 mb-2">
          Snapshot
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {[
            { label: 'Gap', val: epScore.gap_pct != null ? `${epScore.gap_pct >= 0 ? '+' : ''}${epScore.gap_pct.toFixed(1)}%` : '—' },
            { label: 'Vol Ratio', val: epScore.volume_ratio != null ? `${epScore.volume_ratio.toFixed(1)}×` : '—' },
            { label: '$ Volume', val: fmtMillions(epScore.dollar_volume) },
            { label: 'ADR (20d)', val: epScore.adr_pct != null ? `${epScore.adr_pct.toFixed(1)}%` : '—' },
            { label: 'Float', val: fmtFloat(epScore.float_shares) },
            { label: 'Mkt Cap', val: fmtMillions(epScore.market_cap) },
            { label: 'Prior 20d', val: epScore.prior_move_pct != null ? `${epScore.prior_move_pct >= 0 ? '+' : ''}${epScore.prior_move_pct.toFixed(1)}%` : '—' },
          ].map(({ label, val }) => (
            <div
              key={label}
              className="rounded-lg bg-surface-900/40 border border-surface-700/30 px-3 py-2"
            >
              <p className="text-[9px] text-surface-500 uppercase tracking-wider">{label}</p>
              <p className="text-sm font-mono font-semibold text-surface-100 mt-0.5 tabular-nums">{val}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Ask Claude */}
      <div className="pt-3 border-t border-surface-700/30">
        {!claudeResult && !claudeLoading && (
          <button
            onClick={askClaude}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-400/10 border border-violet-400/25 text-violet-400 hover:bg-violet-400/20 transition-colors"
          >
            Ask Claude (deep-dive)
          </button>
        )}
        {claudeLoading && (
          <div className="flex items-center gap-2 text-xs text-surface-400">
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Analyzing with Claude…
          </div>
        )}
        {claudeError && (
          <p className="text-xs text-danger">{claudeError}</p>
        )}
        {claudeResult && (
          <div className="mt-2">
            <AnalysisResult analysis={claudeResult.analysis} />
          </div>
        )}
      </div>
    </div>
  )
}

function EarningsCard({ data, sourceUrl }) {
  if (!data) return null

  const beat = data.surprise != null && data.surprise > 0
  const miss = data.surprise != null && data.surprise < 0

  return (
    <div className={`mx-5 mb-3 rounded-xl border p-4 ${
      beat ? 'bg-accent/[0.06] border-accent/20' : miss ? 'bg-danger/[0.06] border-danger/20' : 'bg-surface-800/60 border-surface-700/40'
    }`}>
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <span className="text-xs font-semibold text-surface-200">
          Earnings — {data.period ? `Q${data.quarter} ${data.year}` : 'Latest Quarter'}
        </span>
        {beat && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-accent/15 text-accent border border-accent/25">
            Beat
          </span>
        )}
        {miss && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-danger/15 text-danger border border-danger/25">
            Miss
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* EPS Actual */}
        <div>
          <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">EPS Actual</p>
          <p className="text-lg font-bold font-mono text-surface-100 mt-0.5">${data.actual?.toFixed(2)}</p>
        </div>

        {/* EPS Estimate */}
        {data.estimate != null && (
          <div>
            <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">EPS Estimate</p>
            <p className="text-lg font-bold font-mono text-surface-400 mt-0.5">${data.estimate.toFixed(2)}</p>
          </div>
        )}

        {/* Surprise */}
        {data.surprisePercent != null && (
          <div>
            <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">Surprise</p>
            <p className={`text-lg font-bold font-mono mt-0.5 ${data.surprisePercent >= 0 ? 'text-accent' : 'text-danger'}`}>
              {fmtPct(data.surprisePercent)}
            </p>
          </div>
        )}

        {/* YoY Growth */}
        {data.yoy_growth != null && (
          <div>
            <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">Year over Year</p>
            <p className={`text-lg font-bold font-mono mt-0.5 ${data.yoy_growth >= 0 ? 'text-accent' : 'text-danger'}`}>
              {fmtPct(data.yoy_growth)}
            </p>
            <p className="text-[10px] text-surface-600 mt-0.5">
              vs ${data.year_ago_eps?.toFixed(2)} prior year
            </p>
          </div>
        )}

        {/* QoQ Growth */}
        {data.qoq_growth != null && (
          <div>
            <p className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">Quarter over Quarter</p>
            <p className={`text-lg font-bold font-mono mt-0.5 ${data.qoq_growth >= 0 ? 'text-accent' : 'text-danger'}`}>
              {fmtPct(data.qoq_growth)}
            </p>
            <p className="text-[10px] text-surface-600 mt-0.5">
              vs ${data.prev_quarter_eps?.toFixed(2)} prev quarter
            </p>
          </div>
        )}
      </div>

      {/* Source link */}
      {sourceUrl && (
        <div className="mt-3 pt-3 border-t border-surface-700/30">
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-surface-400 hover:text-accent transition-colors"
          >
            View earnings report
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      )}
    </div>
  )
}

function TickerSection({ sym, articles, earningsData, epScore, epLoading, epError }) {
  const [open, setOpen] = useState(true)
  const summary = useMemo(() => buildSummary(articles), [articles])

  if (!summary) return null

  return (
    <div className="rounded-2xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 overflow-hidden transition-all duration-300">
      {/* Ticker header — always visible, clickable */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-800/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <GradeBadge epScore={epScore} loading={epLoading} error={epError} />
          <div className="flex flex-col items-start">
            <span className="font-mono font-bold text-surface-50 text-lg tracking-wide leading-tight">{sym}</span>
            <span className="text-[11px] text-surface-500 font-medium tabular-nums">
              {articles.length} article{articles.length !== 1 ? 's' : ''}
              {epScore && <span className="ml-2 text-surface-400">· {epScore.verdict}</span>}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Catalyst pills in header */}
          {summary.hasCatalysts && (
            <div className="hidden sm:flex items-center gap-1.5 flex-wrap justify-end">
              {[...new Set(summary.sorted.filter(a => a.catalysts.length > 0).flatMap(a => a.catalysts.map(c => c.tag)))].map((tag) => {
                const rule = CATALYST_RULES.find((r) => r.tag === tag)
                return (
                  <span key={tag} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${rule?.color || ''}`}>
                    {tag}
                  </span>
                )
              })}
            </div>
          )}
          <ChevronIcon open={open} />
        </div>
      </button>

      {/* Collapsible body */}
      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${
          open ? 'max-h-[6000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        {/* Qullamaggie EP breakdown — top of body */}
        <EpBreakdownCard
          epScore={epScore}
          epLoading={epLoading}
          epError={epError}
          ticker={sym}
        />

        {/* Earnings card — only shows when earnings data exists */}
        <EarningsCard
          data={earningsData}
          sourceUrl={earningsData ? summary.sorted.find(a => a.catalysts.some(c => c.tag === 'Earnings'))?.url : null}
        />

        {/* Summary bar */}
        <div className={`mx-5 mb-4 px-4 py-2.5 rounded-xl border ${
          summary.hasCatalysts
            ? 'bg-accent/[0.06] border-accent/20'
            : 'bg-surface-800/60 border-surface-700/40'
        }`}>
          <div className="flex items-center gap-2">
            {summary.hasCatalysts ? (
              <svg className="w-4 h-4 text-accent flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-surface-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <p className={`text-xs font-medium ${summary.hasCatalysts ? 'text-accent' : 'text-surface-400'}`}>
              {summary.summaryText}
            </p>
          </div>
        </div>

        {/* Articles */}
        <div className="px-5 pb-4 space-y-2">
          {summary.sorted.map((article, i) => (
            <a
              key={i}
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-4 p-3 rounded-xl hover:bg-surface-800/60 transition-all duration-200 group"
            >
              {/* Thumbnail */}
              {article.image && (
                <div className="flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden bg-surface-800">
                  <img
                    src={article.image}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => { e.target.parentElement.style.display = 'none' }}
                  />
                </div>
              )}

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <h3 className="text-[13px] font-semibold text-surface-100 group-hover:text-accent transition-colors line-clamp-2 flex-1">
                    {article.title}
                  </h3>
                  <svg className="w-3.5 h-3.5 text-surface-600 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {/* Catalyst tags */}
                  {article.catalysts.map((cat) => (
                    <span key={cat.tag} className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${cat.color}`}>
                      {cat.tag}
                    </span>
                  ))}
                  <span className="text-[11px] text-surface-500">{article.site}</span>
                  <span className="text-[11px] text-surface-600">{timeAgo(article.publishedDate)}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Criteria Section ─────────────────────────────────────────────────────────

function CriteriaCheckItem({ label, description, highlight }) {
  return (
    <div className="flex gap-3 py-2.5">
      <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center ${
        highlight ? 'bg-accent/15 border border-accent/30' : 'bg-surface-800 border border-surface-700/50'
      }`}>
        <svg className={`w-3 h-3 ${highlight ? 'text-accent' : 'text-surface-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-surface-100">{label}</p>
        <p className="text-xs text-surface-400 mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

function AnalysisResult({ analysis }) {
  if (!analysis) return null

  // Parse the rating from the response
  const ratingMatch = analysis.match(/OVERALL RATING:\s*(\d+(?:\.\d+)?)\s*\/\s*10/)
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null

  const ratingColor = rating != null
    ? rating >= 7 ? 'text-accent' : rating >= 4 ? 'text-amber-400' : 'text-danger'
    : 'text-surface-400'

  const ratingBg = rating != null
    ? rating >= 7 ? 'bg-accent/10 border-accent/25' : rating >= 4 ? 'bg-amber-400/10 border-amber-400/25' : 'bg-danger/10 border-danger/25'
    : 'bg-surface-800 border-surface-700/50'

  // Simple markdown-to-JSX: bold, headers, check/cross marks
  const renderLine = (line, i) => {
    if (!line.trim()) return <div key={i} className="h-2" />

    // H3 headers
    if (line.startsWith('### ')) {
      return <h3 key={i} className="text-sm font-bold text-surface-100 mt-4 mb-2">{line.slice(4)}</h3>
    }

    // Bold overall rating line (skip — we render it separately)
    if (line.includes('OVERALL RATING')) return null

    // Bullet points with pass/fail/partial markers
    const hasBold = line.includes('**')
    const rendered = line
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/PASS ✓/g, '<span class="text-accent font-semibold">PASS ✓</span>')
      .replace(/FAIL ✗/g, '<span class="text-danger font-semibold">FAIL ✗</span>')
      .replace(/PARTIAL ~/g, '<span class="text-amber-400 font-semibold">PARTIAL ~</span>')

    if (line.startsWith('- ') || line.startsWith('* ')) {
      return (
        <div key={i} className="flex gap-2 py-0.5">
          <span className="text-surface-600 mt-0.5 flex-shrink-0">-</span>
          <span className="text-xs text-surface-300 leading-relaxed" dangerouslySetInnerHTML={{ __html: rendered.slice(2) }} />
        </div>
      )
    }

    return (
      <p key={i} className={`text-xs leading-relaxed ${hasBold ? 'text-surface-200' : 'text-surface-300'}`}
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    )
  }

  const lines = analysis.split('\n')

  return (
    <div className="rounded-2xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 overflow-hidden">
      {/* Rating header */}
      <div className="px-5 py-4 border-b border-surface-800/60 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-400/10 flex items-center justify-center">
            <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-surface-100">Claude Analysis</span>
        </div>
        {rating != null && (
          <div className={`px-3 py-1.5 rounded-lg border ${ratingBg}`}>
            <span className={`text-lg font-bold font-mono ${ratingColor}`}>{rating}</span>
            <span className="text-xs text-surface-500">/10</span>
          </div>
        )}
      </div>

      {/* Analysis body */}
      <div className="px-5 py-4">
        {lines.map(renderLine)}
      </div>
    </div>
  )
}

function CriteriaSection() {
  const [openBonde, setOpenBonde] = useState(true)
  const [openQulla, setOpenQulla] = useState(true)
  const [analysisTicker, setAnalysisTicker] = useState('')
  const [analysisResult, setAnalysisResult] = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState(null)

  async function runAnalysis(e) {
    e?.preventDefault()
    const ticker = analysisTicker.trim().toUpperCase()
    if (!ticker) return

    setAnalysisLoading(true)
    setAnalysisError(null)
    setAnalysisResult(null)

    try {
      const res = await fetch('/api/analysis/criteria-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Analysis failed')
      }

      const data = await res.json()
      setAnalysisResult(data)
    } catch (err) {
      setAnalysisError(err.message)
    }
    setAnalysisLoading(false)
  }

  return (
    <div className="space-y-6">
      {/* AI Analysis — search bar */}
      <div className="rounded-2xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-violet-400/10 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-surface-100">AI Criteria Check</p>
            <p className="text-xs text-surface-400 mt-0.5">
              Enter a ticker to evaluate it against both frameworks using Claude. Pulls live news, price action, volume, and earnings data.
            </p>
          </div>
        </div>

        <form onSubmit={runAnalysis} className="flex gap-3 items-center">
          <div className="relative max-w-xs flex-1">
            <input
              type="text"
              value={analysisTicker}
              onChange={(e) => setAnalysisTicker(e.target.value.toUpperCase())}
              placeholder="e.g. FSLY"
              className={`${INPUT_STYLE} font-mono tracking-wider`}
            />
          </div>
          <button
            type="submit"
            disabled={analysisLoading || !analysisTicker.trim()}
            className="px-5 py-2.5 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 hover:text-surface-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            {analysisLoading ? (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Analyzing
              </span>
            ) : 'Evaluate'}
          </button>
        </form>

        {/* Error */}
        {analysisError && (
          <div className="mt-4 rounded-xl bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            {analysisError}
          </div>
        )}

        {/* Loading skeleton */}
        {analysisLoading && (
          <div className="mt-4 rounded-2xl bg-surface-900/60 border border-surface-700/40 p-5 animate-pulse">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-surface-700/60 rounded-lg" />
              <div className="w-32 h-5 bg-surface-700/60 rounded" />
              <div className="ml-auto w-16 h-8 bg-surface-700/60 rounded-lg" />
            </div>
            <div className="space-y-3">
              <div className="h-4 bg-surface-800/60 rounded w-3/4" />
              <div className="h-3 bg-surface-800/40 rounded w-full" />
              <div className="h-3 bg-surface-800/40 rounded w-5/6" />
              <div className="h-4 bg-surface-800/60 rounded w-1/2 mt-4" />
              <div className="h-3 bg-surface-800/40 rounded w-full" />
              <div className="h-3 bg-surface-800/40 rounded w-2/3" />
            </div>
          </div>
        )}
      </div>

      {/* Analysis result */}
      {analysisResult && <AnalysisResult analysis={analysisResult.analysis} />}

      {/* Intro */}
      <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 w-8 h-8 rounded-lg bg-amber-400/10 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-surface-100">The Bible</p>
            <p className="text-xs text-surface-400 mt-0.5 leading-relaxed">
              Reference criteria from Pradeep Bonde and Qullamaggie. Use these checklists when evaluating any stock setup before entry.
            </p>
          </div>
        </div>
      </div>

      {/* ── Pradeep Bonde — CAP 10×10 MAGNA53 ── */}
      <div className="rounded-2xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 overflow-hidden">
        <button
          onClick={() => setOpenBonde(!openBonde)}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-800/40 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-400/10 flex items-center justify-center">
              <span className="text-sm font-bold text-purple-400">PB</span>
            </div>
            <div className="text-left">
              <span className="font-semibold text-surface-50 text-sm">Pradeep Bonde</span>
              <span className="text-[11px] text-surface-500 ml-2 font-mono">CAP 10×10 MAGNA53</span>
            </div>
          </div>
          <ChevronIcon open={openBonde} />
        </button>

        <div className={`transition-all duration-300 ease-in-out overflow-hidden ${openBonde ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="px-5 pb-5">
            {/* Framework name */}
            <div className="mb-4 px-4 py-3 rounded-xl bg-purple-400/[0.06] border border-purple-400/15">
              <p className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-1">Framework</p>
              <p className="text-sm text-surface-200 font-mono font-semibold">CAP 10×10 MAGNA53</p>
            </div>

            {/* CAP */}
            <div className="mb-5">
              <h4 className="text-xs font-bold text-surface-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-6 h-6 rounded-md bg-surface-800 flex items-center justify-center text-[10px] font-bold text-purple-400 border border-surface-700/50">C</span>
                CAP — Catalyst, Anticipation, Price
              </h4>
              <div className="ml-1 space-y-0.5 divide-y divide-surface-800/50">
                <CriteriaCheckItem
                  label="C — Catalyst"
                  description="The stock must have a clear, identifiable catalyst driving the move. Earnings beat, FDA approval, contract win, new product, M&A — something concrete. No catalyst = no trade."
                  highlight
                />
                <CriteriaCheckItem
                  label="A — Anticipation"
                  description="Was the move anticipated by the market? The best setups are surprises. If analysts already priced it in, the edge is gone. Look for gaps that catch the market off guard."
                  highlight
                />
                <CriteriaCheckItem
                  label="P — Price Action"
                  description="Price must confirm the catalyst. Look for a gap up on massive volume, a clean breakout above resistance, or a powerful trend day. If price doesn't react, the catalyst isn't strong enough."
                  highlight
                />
              </div>
            </div>

            {/* 10×10 */}
            <div className="mb-5">
              <h4 className="text-xs font-bold text-surface-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-6 h-6 rounded-md bg-surface-800 flex items-center justify-center text-[10px] font-bold text-purple-400 border border-surface-700/50">10</span>
                10×10 Rule
              </h4>
              <div className="ml-1 space-y-0.5 divide-y divide-surface-800/50">
                <CriteriaCheckItem
                  label="10% Gap"
                  description="The stock should gap at least 10% at the open. This signals institutional-grade conviction, not retail noise. Bigger gaps = stronger signal."
                  highlight
                />
                <CriteriaCheckItem
                  label="10× Volume"
                  description="Volume on the gap day should be at least 10× the average daily volume. This confirms real money is moving — institutions, not retail. Without volume, a gap is just air."
                  highlight
                />
              </div>
            </div>

            {/* MAGNA53 */}
            <div>
              <h4 className="text-xs font-bold text-surface-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-6 h-6 rounded-md bg-surface-800 flex items-center justify-center text-[10px] font-bold text-purple-400 border border-surface-700/50">M</span>
                MAGNA53 — Selection Filters
              </h4>
              <div className="ml-1 space-y-0.5 divide-y divide-surface-800/50">
                <CriteriaCheckItem
                  label="M — Market Cap"
                  description="Focus on small to mid-cap stocks ($300M–$10B). These have the explosive potential that mega-caps lack. The institutional accumulation in these names creates the biggest moves."
                />
                <CriteriaCheckItem
                  label="A — Acceleration"
                  description="Earnings and revenue growth should be accelerating quarter over quarter. Not just growing — growing faster. Q1: +20%, Q2: +30%, Q3: +50%. That's acceleration."
                />
                <CriteriaCheckItem
                  label="G — Growth"
                  description="Minimum 25%+ earnings growth. Revenue growth should confirm — both must be firing. A stock with earnings growth but flat revenue is borrowing from the future."
                />
                <CriteriaCheckItem
                  label="N — Neglect"
                  description="Low analyst coverage (fewer than 5 analysts). Under-followed stocks have the most room for surprise. By the time Wall Street catches on, the move is already happening."
                />
                <CriteriaCheckItem
                  label="A — Actionable Setup"
                  description="The chart must show a clean, actionable technical pattern. A proper base (3–6+ months of consolidation), a tight range near highs, and volume contraction before the breakout."
                />
                <CriteriaCheckItem
                  label="5 — 5 Day Return"
                  description="After the gap day, watch the first 5 trading days. If the stock holds its gap and doesn't give back more than 50% of the day-1 move, the setup is intact."
                />
                <CriteriaCheckItem
                  label="3 — 3 Day Close"
                  description="The stock should close in the upper third of its range for 3 consecutive days after the gap. Weak closes = distribution. Strong closes = accumulation continuing."
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Qullamaggie — Episodic Pivot Criteria ── */}
      <div className="rounded-2xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 overflow-hidden">
        <button
          onClick={() => setOpenQulla(!openQulla)}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-800/40 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan/10 flex items-center justify-center">
              <span className="text-sm font-bold text-cyan">Q</span>
            </div>
            <div className="text-left">
              <span className="font-semibold text-surface-50 text-sm">Qullamaggie</span>
              <span className="text-[11px] text-surface-500 ml-2">Episodic Pivot Setup</span>
            </div>
          </div>
          <ChevronIcon open={openQulla} />
        </button>

        <div className={`transition-all duration-300 ease-in-out overflow-hidden ${openQulla ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'}`}>
          <div className="px-5 pb-5">
            {/* Core concept */}
            <div className="mb-4 px-4 py-3 rounded-xl bg-cyan/[0.06] border border-cyan/15">
              <p className="text-xs font-bold text-cyan uppercase tracking-wider mb-1">Core Concept</p>
              <p className="text-sm text-surface-200 leading-relaxed">
                A stock that has been consolidating for months suddenly gaps up 10%+ on massive volume due to a fundamental catalyst. The prior base creates a "coiled spring" — the longer the base, the bigger the move.
              </p>
            </div>

            {/* Pre-conditions */}
            <div className="mb-5">
              <h4 className="text-xs font-bold text-surface-300 uppercase tracking-wider mb-3">Pre-Conditions</h4>
              <div className="ml-1 space-y-0.5 divide-y divide-surface-800/50">
                <CriteriaCheckItem
                  label="Prior Basing / Consolidation (3–6+ months)"
                  description="The stock must have a clear base: 3 to 6+ months of sideways-to-down price action. 12+ months is textbook. This creates the coiled spring. Without a base, it's just a random gap."
                  highlight
                />
                <CriteriaCheckItem
                  label="Identifiable Catalyst"
                  description="A concrete, fundamental reason for the gap: earnings surprise, FDA decision, major contract, M&A. The catalyst must be significant enough to permanently re-rate the stock's value."
                  highlight
                />
                <CriteriaCheckItem
                  label="Gap of 10%+"
                  description="The stock must gap at least 10% at the open. Gaps below 10% rarely have enough momentum. 20–60%+ gaps on earnings are the highest-quality setups. The bigger the gap, the stronger the signal."
                  highlight
                />
              </div>
            </div>

            {/* Day 1 confirmation */}
            <div className="mb-5">
              <h4 className="text-xs font-bold text-surface-300 uppercase tracking-wider mb-3">Day 1 Confirmation</h4>
              <div className="ml-1 space-y-0.5 divide-y divide-surface-800/50">
                <CriteriaCheckItem
                  label="Massive Volume"
                  description="Volume should be multiples (5–10×+) of the average daily volume. Look for institutional algo buying in pre-market. High volume = real money, not retail fomo."
                  highlight
                />
                <CriteriaCheckItem
                  label="Strong Close"
                  description="The stock should close in the upper half of the day's range — ideally near the high of day. A weak close (lower third) on day 1 is a red flag for distribution."
                  highlight
                />
                <CriteriaCheckItem
                  label="Range Expansion"
                  description="The day's range should be 3–5× or more the average true range. This signals a regime change, not just normal volatility."
                />
              </div>
            </div>

            {/* Follow-through */}
            <div className="mb-5">
              <h4 className="text-xs font-bold text-surface-300 uppercase tracking-wider mb-3">Follow-Through Criteria</h4>
              <div className="ml-1 space-y-0.5 divide-y divide-surface-800/50">
                <CriteriaCheckItem
                  label="Hold the Gap"
                  description="In the days after the gap, the stock should hold above the gap-up open price. A fill below the gap-open is a failure signal. Best setups never fill."
                />
                <CriteriaCheckItem
                  label="Volume Dry-Up on Pullback"
                  description="If the stock pulls back after day 1, volume should contract significantly. Low-volume pullbacks = healthy consolidation. High-volume pullbacks = selling."
                />
                <CriteriaCheckItem
                  label="Higher Lows"
                  description="Each pullback should make a higher low than the previous one. This creates an ascending pattern that signals continued accumulation by institutions."
                />
              </div>
            </div>

            {/* Risk management */}
            <div>
              <h4 className="text-xs font-bold text-surface-300 uppercase tracking-wider mb-3">Risk Management</h4>
              <div className="ml-1 space-y-0.5 divide-y divide-surface-800/50">
                <CriteriaCheckItem
                  label="Stop Below Day-1 Low"
                  description="Place stop loss below the low of the gap day. If price trades below that level, the setup has failed and institutions are distributing."
                />
                <CriteriaCheckItem
                  label="Position Size: Risk 0.5–1% of Account"
                  description="These are volatile setups. Size accordingly. Risk a maximum of 0.5–1% of total account per trade. Let the R-multiple work in your favor."
                />
                <CriteriaCheckItem
                  label="Target: 2–5× Risk (Minimum)"
                  description="Aim for at least 2R, ideally 3–5R. The best episodic pivots run 50–200%+ over weeks to months. Trail stops to lock in gains as the move extends."
                />
              </div>
            </div>

            {/* Example callout */}
            <div className="mt-5 px-4 py-3 rounded-xl bg-surface-800/60 border border-surface-700/40">
              <p className="text-[10px] text-surface-500 uppercase tracking-wider font-bold mb-2">Example — FSLY Feb 2025</p>
              <div className="space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="text-accent text-xs mt-0.5">+</span>
                  <p className="text-xs text-surface-300"><span className="text-surface-100 font-medium">Prior base:</span> ~12 months of sideways-to-down action through all of 2024. Textbook.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-accent text-xs mt-0.5">+</span>
                  <p className="text-xs text-surface-300"><span className="text-surface-100 font-medium">Massive volume:</span> Traded multiples of avg daily volume (~3.6M/day) on Feb 12, with institutional algo buying in pre-market.</p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-accent text-xs mt-0.5">+</span>
                  <p className="text-xs text-surface-300"><span className="text-surface-100 font-medium">Gap of 60%+:</span> Easily exceeds the 10% threshold. Highest-conviction signal.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'news', label: 'News Analysis' },
  { id: 'criteria', label: 'Criteria' },
]

export default function NewsAnalysis() {
  const [activeTab, setActiveTab] = useState('news')
  const [query, setQuery] = useState('')
  const [articles, setArticles] = useState([])
  const [earnings, setEarnings] = useState({})
  const [epScores, setEpScores] = useState({})
  const [epLoading, setEpLoading] = useState({})
  const [epErrors, setEpErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searched, setSearched] = useState(false)
  const [history, setHistory] = useState([])

  // Load search history from backend on mount
  useEffect(() => {
    getNewsCache().then(setHistory).catch(() => {})
  }, [])

  // Fetch Qullamaggie EP grades for a list of tickers in parallel
  async function fetchEpScores(tickers) {
    const upper = tickers.map((t) => t.toUpperCase())
    setEpLoading(Object.fromEntries(upper.map((t) => [t, true])))
    setEpErrors({})
    const results = await Promise.allSettled(upper.map((t) => getEpScore(t)))
    const scores = {}
    const errors = {}
    upper.forEach((t, i) => {
      if (results[i].status === 'fulfilled') scores[t] = results[i].value
      else errors[t] = results[i].reason?.message || 'Failed'
    })
    setEpScores(scores)
    setEpErrors(errors)
    setEpLoading({})
    return scores
  }

  // Helper: do a fresh Finnhub search and cache the result
  async function doFreshSearch(tickers) {
    setQuery(tickers.join(' '))
    setLoading(true)
    setError(null)
    setSearched(true)
    setEpScores({})
    setEpErrors({})
    try {
      const data = await fetchNews(tickers)
      const arts = data.articles || []
      setArticles(arts)
      setEarnings(data.earnings || {})
      // Fetch EP scores in parallel (don't block news rendering)
      const scores = await fetchEpScores(tickers)
      // Save to backend cache (include EP scores), then reload history
      await saveNewsCache(tickers, arts, data.earnings || {}, scores)
      const updated = await getNewsCache()
      setHistory(updated)
    } catch (err) {
      console.error('News fetch failed:', err)
      setError(err.message)
      setArticles([])
      setEarnings({})
    }
    setLoading(false)
  }

  async function quickSearch(ticker) {
    await doFreshSearch([ticker])
  }

  // Load cached results instantly when clicking a recent search
  const searchTickers = useCallback(async (tickerList, cachedEntry) => {
    if (!tickerList || tickerList.length === 0) return
    if (cachedEntry && cachedEntry.articles) {
      // Use cached data — instant, no API call
      setQuery(tickerList.join(' '))
      setArticles(cachedEntry.articles)
      setEarnings(cachedEntry.earnings || {})
      setSearched(true)
      setError(null)
      // Restore EP scores from cache if present, else refetch
      if (cachedEntry.epScores && Object.keys(cachedEntry.epScores).length) {
        setEpScores(cachedEntry.epScores)
        setEpErrors({})
        setEpLoading({})
      } else {
        await fetchEpScores(tickerList)
      }
      return
    }
    // Fallback to fresh search
    await doFreshSearch(tickerList)
  }, [])

  async function handleSearch(e) {
    e?.preventDefault()
    const tickers = query.trim().split(/[\s,]+/).filter(Boolean)
    if (tickers.length === 0) return
    await doFreshSearch(tickers)
  }

  // Group articles by symbol
  const grouped = useMemo(() => {
    const map = {}
    for (const a of articles) {
      const sym = a.symbol || 'Other'
      if (!map[sym]) map[sym] = []
      map[sym].push(a)
    }
    return map
  }, [articles])

  const tickers = Object.keys(grouped).sort()

  return (
    <div className="space-y-6">
      {/* Header + Tabs */}
      <div>
        <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">
          Stock Analysis
        </h1>
        <p className="text-surface-400 text-[13px] mt-1">
          {activeTab === 'news'
            ? 'Scan for episodic catalysts — earnings, analyst upgrades, mergers & acquisitions, and more. Last 3 days.'
            : 'Reference criteria from top momentum traders. The checklist to validate every setup.'}
        </p>

        {/* Tab bar */}
        <div className="mt-4 flex gap-1 p-1 rounded-xl bg-surface-900/80 border border-surface-700/40 w-fit">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? 'bg-surface-700 text-surface-50 shadow-sm'
                  : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/60'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── News Tab ── */}
      {activeTab === 'news' && (
        <>
          {/* Search bar */}
          <form onSubmit={handleSearch} className="flex gap-3 items-center">
            <div className="relative max-w-lg flex-1">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch(e)}
                placeholder="TSLA BMNR META"
                className={`${INPUT_STYLE} pl-10 font-mono tracking-wider`}
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="px-6 py-2.5 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 hover:text-surface-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Scanning
                </span>
              ) : 'Search'}
            </button>
          </form>

          {/* Error */}
          {error && (
            <div className="rounded-xl bg-danger/10 border border-danger/20 px-4 py-3 text-danger text-sm flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <svg className="w-5 h-5 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  <span className="text-sm text-surface-300">
                    Scanning news for{' '}
                    <span className="font-mono font-semibold text-accent">
                      {query.trim().split(/[\s,]+/).filter(Boolean).map(t => t.toUpperCase()).join(', ')}
                    </span>
                  </span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {query.trim().split(/[\s,]+/).filter(Boolean).map((t, i) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-800/80 border border-surface-700/40"
                      style={{ animationDelay: `${i * 150}ms` }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                      <span className="font-mono text-xs font-medium text-surface-200">{t.toUpperCase()}</span>
                    </span>
                  ))}
                </div>
              </div>
              {[1, 2].map((i) => (
                <div key={i} className="rounded-2xl bg-surface-900/80 border border-surface-700/50 p-5 animate-pulse">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-16 h-6 bg-surface-700/60 rounded-lg" />
                    <div className="w-20 h-4 bg-surface-800/60 rounded" />
                  </div>
                  <div className="space-y-3">
                    <div className="h-4 bg-surface-800/60 rounded w-3/4" />
                    <div className="h-3 bg-surface-800/40 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Results — empty */}
          {!loading && searched && articles.length === 0 && !error && (
            <div className="rounded-2xl bg-surface-900 border border-surface-700/50 border-dashed p-16 text-center animate-fade-in">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-surface-800 flex items-center justify-center">
                <svg className="w-7 h-7 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
              </div>
              <p className="text-surface-200 text-base font-semibold">No news in the last 3 days</p>
              <p className="text-surface-500 text-sm mt-1">
                Try different tickers or check back later.
              </p>
            </div>
          )}

          {!loading && tickers.length > 0 && (
            <div className="space-y-4">
              {tickers.map((sym) => (
                <TickerSection
                  key={sym}
                  sym={sym}
                  articles={grouped[sym]}
                  earningsData={earnings[sym] || null}
                  epScore={epScores[sym] || null}
                  epLoading={!!epLoading[sym]}
                  epError={epErrors[sym] || null}
                />
              ))}
            </div>
          )}

          {/* Recent Searches — vertical list below results */}
          {!loading && searched && history.length > 0 && (
            <div className="rounded-xl bg-surface-900/60 border border-surface-700/30 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-surface-500 uppercase tracking-wider font-medium">
                  Recent {history.length > 20 ? `(showing 20 of ${history.length})` : ''}
                </span>
                <button
                  onClick={async () => { await clearNewsCache(); setHistory([]) }}
                  className="text-[11px] text-surface-600 hover:text-surface-400 transition-colors"
                >
                  Clear
                </button>
              </div>
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {history.slice(0, 20).map((entry, i) => (
                  <button
                    key={`${entry.tickers.join(',')}-${i}`}
                    onClick={() => searchTickers(entry.tickers, entry)}
                    className="group w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-800/80 transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <svg className="w-3.5 h-3.5 text-surface-600 group-hover:text-accent transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <span className="font-mono text-xs font-medium text-surface-200 group-hover:text-accent transition-colors truncate">
                        {entry.tickers.join(', ')}
                      </span>
                      {entry.articleCount > 0 && (
                        <span className="text-[10px] text-surface-600 bg-surface-800/60 px-1.5 py-0.5 rounded-md flex-shrink-0">
                          {entry.articleCount} {entry.articleCount === 1 ? 'article' : 'articles'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                      <span className="text-[10px] text-surface-600">{formatTimestamp(entry.timestamp)}</span>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          await deleteNewsCacheEntry(i)
                          const updated = await getNewsCache()
                          setHistory(updated)
                        }}
                        className="opacity-0 group-hover:opacity-100 text-surface-600 hover:text-surface-300 transition-all p-0.5"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Initial state — actionable with quick-pick tickers */}
          {!loading && !searched && (
            <div className="space-y-4">
              {/* Recent Searches — prominent in initial state */}
              {history.length > 0 && (
                <div className="rounded-2xl bg-surface-900/80 border border-surface-700/40 p-5 animate-fade-in">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-xs text-surface-400 font-medium">Recent Searches</span>
                    </div>
                    <button
                      onClick={async () => { await clearNewsCache(); setHistory([]) }}
                      className="text-[11px] text-surface-600 hover:text-surface-400 transition-colors"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="space-y-1">
                    {history.map((entry, i) => (
                      <button
                        key={`${entry.tickers.join(',')}-${i}`}
                        onClick={() => searchTickers(entry.tickers, entry)}
                        className="group w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-surface-800/80 transition-all"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <svg className="w-3.5 h-3.5 text-surface-600 group-hover:text-accent transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          <span className="font-mono text-sm font-medium text-surface-200 group-hover:text-accent transition-colors truncate">
                            {entry.tickers.join(', ')}
                          </span>
                          {entry.articleCount > 0 && (
                            <span className="text-[10px] text-surface-600 bg-surface-800/60 px-1.5 py-0.5 rounded-md flex-shrink-0">
                              {entry.articleCount} {entry.articleCount === 1 ? 'article' : 'articles'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                          <span className="text-[11px] text-surface-600">{formatTimestamp(entry.timestamp)}</span>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation()
                              await deleteNewsCacheEntry(i)
                              const updated = await getNewsCache()
                              setHistory(updated)
                            }}
                            className="opacity-0 group-hover:opacity-100 text-surface-600 hover:text-surface-300 transition-all p-0.5"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-2xl bg-surface-900 border border-surface-700/50 border-dashed p-16 text-center">
                {/* Warm gradient illustration */}
                <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-accent/20 to-cyan/20 flex items-center justify-center">
                  <svg className="w-8 h-8 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <p className="text-surface-200 text-base font-semibold">Scan for episodic catalysts</p>
                <p className="text-surface-500 text-sm mt-1.5 max-w-sm mx-auto">
                  Find earnings beats, analyst upgrades, M&A, and other market-moving events from the last 3 days.
                </p>

                {/* Quick-pick ticker chips */}
                <div className="mt-6">
                  <p className="text-[11px] text-surface-600 uppercase tracking-wider font-medium mb-3">Quick scan</p>
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    {['AAPL', 'TSLA', 'NVDA', 'META', 'AMZN', 'MSFT'].map((ticker) => (
                      <button
                        key={ticker}
                        onClick={() => quickSearch(ticker)}
                        className="px-3.5 py-2 rounded-xl bg-surface-800 border border-surface-700/50 text-sm font-mono font-medium text-surface-300 hover:text-accent hover:border-accent/30 hover:bg-accent/5 transition-all"
                      >
                        {ticker}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Criteria Tab ── */}
      {activeTab === 'criteria' && <CriteriaSection />}
    </div>
  )
}
