import { useEffect, useRef, useState } from 'react'
import { getBreakouts, getRecentDeveloping } from '../api/breakoutScreener'
import ChartCard from '../components/screener/ChartCard'
import GlossarySidebar from '../components/screener/GlossarySidebar'
import TickerLink from '../components/TickerLink'
import { effectiveCacheTtlMs, isMarketActiveNow, marketStatusLabel } from '../utils/marketClock'

const MODES = [
  { id: 'breakout',        label: 'Breakout',       hint: 'Setting up at the pivot',                                 limit: 24 },
  { id: 'emerging',        label: 'On The Come Up', hint: 'Thrust done, base just starting',                         limit: 24 },
  { id: 'leaders',         label: 'Leaders',        hint: 'Top-percentile trailing returns',                         limit: 24 },
  { id: 'volume',          label: 'Volume Surge',   hint: 'Today’s volume vs each ticker’s 50d avg',                  limit: 15 },
  { id: 'unusual_volume',  label: 'Unusual Volume', hint: 'Day 1/2/3+ of sustained ≥2× volume — Unusual Whales-style', limit: 24 },
]

// Day-N filter options for the unusual_volume tab.
const DAY_FILTERS = [
  { id: 0, label: 'All' },
  { id: 1, label: 'Day 1' },
  { id: 2, label: 'Day 2' },
  { id: 3, label: 'Day 3+' },
]

// unusual_volume uses a stricter RVOL bar than the snapshot Volume Surge tab.
const MIN_RVOL_FOR_MODE = (mode) => (mode === 'unusual_volume' ? 2.0 : 1.5)

// Per-mode explainer copy. Surfaced in the dismissable info panel.
const MODE_ABOUT = {
  breakout: {
    summary: 'Qullamaggie\'s full breakout playbook.',
    bullets: [
      ['ADR ≥ 5%', 'Average daily range over 20d. Hard filter — Qulla won\'t trade quieter names.'],
      ['Parent thrust', 'A 30%+ expansionary move ended within the last 40 days.'],
      ['Orderly base', '5–25 day consolidation, range <8%, holding 10/21 EMA, volume drying up.'],
      ['Near pivot', 'Within 5% of the base high (the green dashed line on the chart).'],
    ],
  },
  emerging: {
    summary: 'Names that just finished a big thrust and are now starting to base.',
    bullets: [
      ['Thrust done', 'Same 30%+ parent move as Breakout mode, but the base is still very young (<10 days).'],
      ['Earlier entry', 'You catch these before they tighten into a textbook pivot — riskier but more upside.'],
    ],
  },
  leaders: {
    summary: 'Pure relative-strength ranking, no setup logic.',
    bullets: [
      ['Trailing returns', 'Ranked by the average percentile of 1M / 3M / 6M returns vs. the universe.'],
      ['Use case', 'Watchlist seed — these are the names institutional money is rotating into.'],
    ],
  },
  volume: {
    summary: 'Single-day RVOL snapshot — what\'s trading heavy TODAY.',
    bullets: [
      ['RVOL ≥ 1.5×', 'Today\'s volume vs. the prior 50-day average (excluding today).'],
      ['No streak logic', 'A one-day pop that fades tomorrow still appears here. Use Unusual Volume for follow-through.'],
    ],
  },
  unusual_volume: {
    summary: 'Day 1 / Day 2 / Day 3+ of sustained ≥2× volume, scored by a directional accumulation read so distribution days rank below buying days.',
    bullets: [
      ['RVOL ≥ 2×', 'Each day\'s volume is compared to ITS OWN trailing 50-day average. Day 2 means today and yesterday both cleared the bar against their own baselines.'],
      ['Day 1 = fresh pop', 'First day of the surge. Often news-driven or a chart breakout.'],
      ['Day 2 = confirmation', 'Institutions are still buying — the most actionable column.'],
      ['Day 3+ = sustained', 'Persistent accumulation. Can be extended; watch for distribution.'],
      ['Accumulation Score (NEW)', 'A 0–100 directional read: 40% Close-Location-Value (where in the day\'s range did it close?), 30% Up/Down volume ratio over the streak, 30% Closes-above-VWAP %. ≥70 = BUY (likely institutional buying). 40–70 = MIX (ambiguous). <40 = SELL (distribution — heavy volume but sellers won the day).'],
      ['Why this matters', 'Raw volume is direction-agnostic — a 5× day at the LOW with red close is distribution, not accumulation. The Accumulation Score filters out those false positives so the top of the list is actually actionable.'],
      ['Short volume % (NEW)', 'From FINRA ATS data. <35% = green (real buying). 35–50% = yellow (squeeze fuel or mixed). >50% = red (heavy short selling — could be a fight or a trap). Pairs with Accumulation Score to confirm the signal.'],
      ['Float %', 'Free-float % of shares outstanding from Massive. Small floats amplify everything — a 2× RVOL day on a 30% float is a much bigger deal than on a 90% float.'],
      ['Smart Money toggle (NEW)', 'Opt-in tick-level analysis of the day\'s trades for the top 8 candidates. Pulls a 100K-trade sample and computes: (a) % of volume from BLOCK trades (≥10K shares OR ≥$1M notional — institutional fills), and (b) % of volume from OFF-EXCHANGE prints (dark pools / ATSes — funds hiding their footprint). Badges: STEALTH ≥5 hidden blocks (strongest tell), DARK ≥50% off-exchange, BLOCKS ≥20% block volume. Cached 6h per (symbol, date) so repeat scans are free.'],
      ['CMF — Chaikin Money Flow', '21-day volume-weighted close-in-range. Computed from existing OHLCV (no extra API). ≥ +0.10 = sustained accumulation (CMF+ badge). ≤ -0.10 = distribution. The Accumulation Score is "today\'s bar", CMF is "the trend" — they\'re complementary.'],
      ['DTC — Days-to-cover', 'Bi-weekly FINRA short interest ÷ avg daily volume. ≥5 days = real squeeze setup. Pairs with Accumulation Score ≥60 to trigger the SQUEEZE badge (heavy short position being overwhelmed by buyers).'],
      ['Institutional toggle (NEW)', 'Opt-in SEC filings enrichment for the top 8 candidates. Pulls Form 4 (insider transactions, last 60d) and 13-F (institutional manager holdings, last 90d). Badges: INSIDER BUYS ×N (≥2 Form 4 purchases — cleanest non-options "smart money" tell available), N FUNDS (≥3 institutional managers disclosed positions).'],
      ['Note on charts', 'The volume histogram below each candle chart is RAW shares, not RVOL. Two consecutive "unusual" days are both ~2× their baselines, so they look similar in height — not 2× of each other.'],
    ],
  },
}

// Plain-English glossary — explains the trading terms surfaced on the Unusual
// Volume tab. Written for someone who knows what a stock is but hasn't traded
// professionally. Rendered as an expandable section at the bottom of the About
// panel when the unusual_volume mode is active.
const GLOSSARY = [
  {
    term: 'Block trade',
    plain: 'A single trade of at least 10,000 shares OR $1 million+ in notional value.',
    why: 'Retail orders are almost never this big — typical retail fills are 100-1,000 shares. When you see a block, it\'s almost certainly a hedge fund, mutual fund, or pension fund executing a position. Counting block trades is the most direct way to "see" institutional activity on the regular tape.',
  },
  {
    term: 'Dark pool / off-exchange',
    plain: 'A private trading venue (like ATS or ECN systems) that\'s NOT one of the lit public exchanges (NYSE, Nasdaq, etc.). Trades there print to the tape but with a special "FINRA" exchange code.',
    why: 'Large funds use dark pools to hide their footprint. If a fund wants to buy 500,000 shares, advertising that on a public exchange would push the price up before they\'re done. Dark pools let them fill the order quietly. High dark-pool % during a green RVOL day = stealth accumulation by funds avoiding market impact.',
  },
  {
    term: 'SEC Form 4',
    plain: 'A legally required filing within 2 business days whenever a corporate insider (officer, director, or 10%+ shareholder) buys or sells stock in their own company.',
    why: 'Insiders have asymmetric information — they know what their company\'s pipeline looks like. Insider SELLING happens for many reasons (taxes, diversification), but insider BUYING almost only happens for one reason: they think the stock is going up. Form 4 purchase code is "P". Multiple "P" filings in 60 days from different insiders = the cleanest "smart money" signal available.',
  },
  {
    term: '13-F filing',
    plain: 'A quarterly SEC report that every institutional manager with $100M+ AUM must file, listing every US equity position they hold at quarter-end.',
    why: 'It\'s how you find out that Stan Druckenmiller bought NVDA, or that ARKK piled into PLTR. 13-Fs are filed 45 days after quarter-end, so they\'re lagging — but they tell you which whales are positioned in this name. When 3+ funds disclose positions in your candidate over the most recent quarter, that\'s institutional conviction.',
  },
  {
    term: 'CMF — Chaikin Money Flow',
    plain: 'A 21-day rolling indicator (range -1 to +1) that combines where each day\'s price closed within its range with that day\'s volume.',
    why: '"Close at the high on big volume" = buying pressure. "Close at the low on big volume" = selling pressure. Doing that math day after day for 21 days and weighting by volume gives you a clean read on whether buyers or sellers have been winning the war. Above +0.10 = sustained accumulation. Below -0.10 = sustained distribution.',
  },
  {
    term: 'DTC — Days-to-cover',
    plain: 'The bi-weekly short interest divided by the stock\'s average daily volume. Answer: "If all shorts had to cover today, how many days of normal trading would it take?"',
    why: '≥5 days = a lot of trapped shorts. Combined with strong accumulation (price rising on heavy volume), shorts get forced to buy back at higher prices, which itself pushes the price higher — a "short squeeze". The SQUEEZE badge fires when DTC ≥5 AND Accumulation Score ≥60.',
  },
  {
    term: 'RVOL',
    plain: 'Today\'s volume divided by the average volume over the prior 50 days.',
    why: '1.0× = normal day. 2.0× = something is happening (news, breakout, earnings). 5.0× = clearly anomalous — institutions, algos, or a crowd-driven move.',
  },
  {
    term: 'VWAP',
    plain: 'Volume-Weighted Average Price for the day. Imagine averaging every trade price, but weighting bigger trades more.',
    why: 'It\'s the price at which the average dollar traded today. Closing above VWAP on heavy volume = real buyers won the session. Below VWAP on heavy volume = sellers won. Institutional algos use VWAP as a fill benchmark, so it\'s a meaningful institutional reference.',
  },
]

// Inline (?) icon — hover for help text.
const InfoTip = ({ text, className = '' }) => (
  <span className={`relative group inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-surface-600 text-surface-500 text-[9px] font-bold cursor-help ${className}`}>
    ?
    <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-30 hidden group-hover:block w-64 rounded-lg bg-surface-950 border border-surface-700 shadow-xl p-2.5 text-left normal-case tracking-normal">
      <span className="block text-[11px] text-surface-200 leading-relaxed">{text}</span>
    </span>
  </span>
)

const CACHE_PREFIX = 'breakouts:'
// Active-session TTL matches the backend response cache (10 min). Outside
// regular hours / on weekends / holidays the TTL extends to 4 hours via
// effectiveCacheTtlMs — the underlying data doesn't change so there's no
// reason to keep re-fetching.
const CACHE_TTL_ACTIVE_MS = 10 * 60 * 1000

const cacheKey = (mode, minAdr, includeMovers, dayFilter) =>
  `${CACHE_PREFIX}${mode}|adr=${minAdr.toFixed(3)}|movers=${includeMovers ? 1 : 0}|day=${dayFilter}`

const readCache = (key) => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const ttl = effectiveCacheTtlMs(CACHE_TTL_ACTIVE_MS)
    if (!parsed?.cachedAt || Date.now() - parsed.cachedAt > ttl) return null
    return parsed
  } catch {
    return null
  }
}

const writeCache = (key, data) => {
  try {
    localStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), data }))
  } catch {
    /* quota — ignore */
  }
}

const Breakouts = () => {
  const [mode, setMode] = useState('breakout')
  const [minAdr, setMinAdr] = useState(0.05)
  const [includeMovers, setIncludeMovers] = useState(false)
  const [dayFilter, setDayFilter] = useState(0)
  const [enrichBlocks, setEnrichBlocks] = useState(false)
  const [enrichInstitutional, setEnrichInstitutional] = useState(false)
  const [wideUniverse, setWideUniverse] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [cacheStamp, setCacheStamp] = useState(null) // ms timestamp of stored payload (null = live)
  const [autoRefreshMin, setAutoRefreshMin] = useState(0) // 0 = off
  const [newSinceLast, setNewSinceLast] = useState(new Set()) // symbols that appeared on the most recent fetch
  const previousSymbolsRef = useRef(new Set())

  const [history, setHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)

  // Loading telemetry: when the request started + a tick that updates every
  // 250ms so the elapsed counter feels alive. Also tracks whether the local
  // cache served the response (vs. a real network roundtrip).
  const [loadStartedAt, setLoadStartedAt] = useState(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  // "About this mode" panel — now a real collapsible (chevron) instead of
  // dismissable. Default expanded; preference persists across sessions.
  const [aboutOpen, setAboutOpen] = useState(() => {
    try { return localStorage.getItem('breakouts:aboutOpen') !== '0' } catch { return true }
  })
  const toggleAbout = () => {
    setAboutOpen((prev) => {
      const next = !prev
      try { localStorage.setItem('breakouts:aboutOpen', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }
  const aboutPanelRef = useRef(null)
  // Force-open the sticky Glossary sidebar (used by the (?) buttons next to
  // the Smart Money / Institutional toggles). We toggle a re-render key so
  // the GlossarySidebar effect resets its state.
  const openGlossary = () => {
    try { localStorage.setItem('breakouts:glossaryOpen', '1') } catch { /* ignore */ }
    // Force a remount of the sidebar so it picks up the new localStorage value.
    setGlossaryKey((k) => k + 1)
  }
  const [glossaryKey, setGlossaryKey] = useState(0)

  useEffect(() => {
    if (!loading || !loadStartedAt) { setElapsedMs(0); return }
    const id = setInterval(() => setElapsedMs(Date.now() - loadStartedAt), 250)
    return () => clearInterval(id)
  }, [loading, loadStartedAt])

  const load = async (modeArg = mode, adrArg = minAdr, moversArg = includeMovers, opts = {}) => {
    const { fresh = false, dayFilter: dayArg = dayFilter } = opts
    const limitForMode = MODES.find((m) => m.id === modeArg)?.limit ?? 24
    // day_filter only meaningful for unusual_volume; force 0 elsewhere so the
    // cache key stays stable when the user switches tabs.
    const effDayFilter = modeArg === 'unusual_volume' ? dayArg : 0
    const effBlocks = modeArg === 'unusual_volume' && enrichBlocks
    const effInst = modeArg === 'unusual_volume' && enrichInstitutional
    const effWide = modeArg === 'unusual_volume' && wideUniverse
    const ck = cacheKey(modeArg, adrArg, moversArg, effDayFilter)
      + (effBlocks ? '|blk' : '')
      + (effInst ? '|inst' : '')
      + (effWide ? '|wide' : '')

    // Client cache — instant response for repeat tab switches / reloads.
    // (Skipped on fresh refresh so the diff against previous results is meaningful.)
    if (!fresh) {
      const cached = readCache(ck)
      if (cached) {
        setData(cached.data)
        setCacheStamp(cached.cachedAt)
        setLoading(false)
        return
      }
    }

    setLoading(true)
    setLoadStartedAt(Date.now())
    setError(null)
    try {
      const res = await getBreakouts({
        mode: modeArg, limit: limitForMode, minAdr: adrArg, includeMovers: moversArg, fresh,
        minRvol: MIN_RVOL_FOR_MODE(modeArg), dayFilter: effDayFilter,
        enrichBlocks: effBlocks,
        enrichInstitutional: effInst,
        wide: effWide,
      })
      // Diff against the previous fetch — symbols that appeared on this run
      // but weren't on the last one get a "NEW" badge on their tile.
      const incoming = new Set((res.results || []).map((r) => r.symbol))
      const prev = previousSymbolsRef.current
      if (prev.size > 0) {
        const fresh = new Set()
        for (const sym of incoming) if (!prev.has(sym)) fresh.add(sym)
        setNewSinceLast(fresh)
        if (fresh.size > 0) {
          // Auto-clear the badge after 60s so it stays meaningful.
          setTimeout(() => setNewSinceLast(new Set()), 60_000)
        }
      }
      previousSymbolsRef.current = incoming

      setData(res)
      writeCache(ck, res)
      setCacheStamp(Date.now())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Auto-refresh — silently re-runs the screener every N minutes when active.
  // Uses fresh=true so it bypasses the cache and we get a real new-since-last diff.
  useEffect(() => {
    if (!autoRefreshMin) return
    const id = setInterval(() => {
      load(mode, minAdr, includeMovers, { fresh: true, dayFilter })
    }, autoRefreshMin * 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefreshMin, mode, minAdr, includeMovers, dayFilter])

  const loadHistory = async () => {
    try {
      const res = await getRecentDeveloping(30)
      setHistory(res.results || [])
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => { load() ; loadHistory() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleModeChange = (m) => {
    setMode(m)
    load(m, minAdr, includeMovers)
  }

  const handleAdrChange = (v) => {
    setMinAdr(v)
  }

  const handleAdrCommit = () => {
    load(mode, minAdr, includeMovers)
  }

  const handleMoversToggle = () => {
    const next = !includeMovers
    setIncludeMovers(next)
    load(mode, minAdr, next, { dayFilter })
  }

  const handleDayFilterChange = (id) => {
    setDayFilter(id)
    load(mode, minAdr, includeMovers, { dayFilter: id })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-[28px] text-surface-50 tracking-tight mb-1">
            Ranked Chart Wall
          </h1>
          <p className="text-surface-400 text-sm">
            {MODES.find((m) => m.id === mode)?.hint} • ADR ≥ {(minAdr * 100).toFixed(1)}%
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Auto-refresh — off / 1m / 5m / 15m. Fires fresh=true so the
              "new since last scan" diff stays meaningful. */}
          <div className="inline-flex items-center gap-1 rounded-lg bg-surface-900/80 border border-surface-700/50 p-1 text-xs">
            <span className="px-2 text-surface-500 uppercase tracking-wider text-[10px]">Auto</span>
            {[0, 1, 5, 15].map((min) => (
              <button
                key={min}
                onClick={() => setAutoRefreshMin(min)}
                className={`px-2 py-1 rounded transition-colors font-medium ${
                  autoRefreshMin === min
                    ? 'bg-accent/15 text-accent'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
                title={min === 0 ? 'Manual refresh only' : `Refresh every ${min} minute${min > 1 ? 's' : ''}`}
              >
                {min === 0 ? 'Off' : `${min}m`}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              showHistory
                ? 'bg-accent/10 border-accent/40 text-accent'
                : 'bg-surface-800 border-surface-600/50 text-surface-200 hover:bg-surface-700'
            }`}
          >
            Last 30 Days ({history.length})
          </button>
          <button
            onClick={() => load(mode, minAdr, includeMovers, { fresh: true, dayFilter })}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 transition-colors disabled:opacity-50"
            title="Bypass the 10-minute cache and re-run the screener"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Mode tabs + ADR filter */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-1 flex">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => handleModeChange(m.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                mode === m.id ? 'bg-accent text-white' : 'text-surface-400 hover:text-surface-200'
              }`}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-xl bg-surface-900/80 border border-surface-700/50 px-4 py-1.5">
          <span className="text-xs text-surface-400 uppercase tracking-wider">Min ADR</span>
          <input
            type="range"
            min="0" max="0.15" step="0.005"
            value={minAdr}
            onChange={(e) => handleAdrChange(parseFloat(e.target.value))}
            onMouseUp={handleAdrCommit}
            onTouchEnd={handleAdrCommit}
            className="w-32 accent-accent"
          />
          <span className="text-xs font-mono text-surface-200 w-12 text-right">
            {(minAdr * 100).toFixed(1)}%
          </span>
        </div>

        <button
          onClick={handleMoversToggle}
          className={`px-4 py-1.5 rounded-xl border text-sm font-medium transition-colors ${
            includeMovers
              ? 'bg-accent/10 border-accent/40 text-accent'
              : 'bg-surface-900/80 border-surface-700/50 text-surface-300 hover:text-surface-100'
          }`}
          title="Merge today's top gainers into the universe"
        >
          {includeMovers ? '✓ Including today\'s movers' : '+ Include today\'s movers'}
        </button>
      </div>

      {/* Day-N sub-filter — only visible in the Unusual Volume mode */}
      {mode === 'unusual_volume' && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs uppercase tracking-wider text-surface-500">Streak day</span>
          <div className="inline-flex items-center gap-1 rounded-xl bg-surface-900/80 border border-surface-700/50 p-1">
            {DAY_FILTERS.map((d) => (
              <button
                key={d.id}
                onClick={() => handleDayFilterChange(d.id)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                  dayFilter === d.id
                    ? 'bg-accent text-white'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
                title={
                  d.id === 0 ? 'All names with an active ≥2× RVOL streak'
                  : d.id === 1 ? 'First day of the surge (fresh pop)'
                  : d.id === 2 ? 'Second consecutive day (confirmation)'
                  : 'Three or more consecutive days (sustained accumulation)'
                }
              >
                {d.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-surface-500">
            Threshold: today &amp; each streak day ≥ 2× the 50d avg
          </span>

          {/* Tier-C toggle: tick-level block & dark-pool enrichment. Expensive
              even with 6h disk cache — surfaced as opt-in. */}
          {/* Wide universe toggle — opens the screener up to every US stock with
              ≥$5M ADV instead of the curated 250. Only honored on Unusual Volume. */}
          <button
            onClick={() => {
              const next = !wideUniverse
              setWideUniverse(next)
              setTimeout(() => load(mode, minAdr, includeMovers, { dayFilter }), 0)
            }}
            className={`ml-2 px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
              wideUniverse
                ? 'bg-accent/10 border-accent/40 text-accent'
                : 'bg-surface-900/80 border-surface-700/50 text-surface-300 hover:text-surface-100'
            }`}
            title="Switch from the curated 250 momentum names to a dynamic universe of every US stock with ≥$5M average daily volume (~1,500-2,500 names). Catches small caps not in the curated list — the most powerful unusual-volume setups often come from there."
          >
            {wideUniverse ? '✓ Wide universe' : '+ Wide universe (1,500+ liquid)'}
          </button>

          {/* Smart Money toggle + inline "what is this?" link */}
          <div className="inline-flex items-center gap-1">
            <button
              onClick={() => {
                const next = !enrichBlocks
                setEnrichBlocks(next)
                setTimeout(() => load(mode, minAdr, includeMovers, { dayFilter }), 0)
              }}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                enrichBlocks
                  ? 'bg-success/10 border-success/40 text-success'
                  : 'bg-surface-900/80 border-surface-700/50 text-surface-300 hover:text-surface-100'
              }`}
              title="Pull tick-level trades for the top 8 candidates to compute block trade % and dark pool %. Cached for 6 hours per symbol."
            >
              {enrichBlocks ? '✓ Smart Money on' : '+ Smart Money (blocks + dark pool)'}
            </button>
            <button
              onClick={openGlossary}
              className="w-5 h-5 rounded-full border border-surface-600 text-surface-400 hover:border-accent hover:text-accent text-[10px] font-bold transition-colors"
              title="What are 'block trades' and 'dark pools'? Click to read the glossary."
              aria-label="Explain Smart Money"
            >
              ?
            </button>
          </div>

          {/* Institutional toggle + inline "what is this?" link */}
          <div className="inline-flex items-center gap-1">
            <button
              onClick={() => {
                const next = !enrichInstitutional
                setEnrichInstitutional(next)
                setTimeout(() => load(mode, minAdr, includeMovers, { dayFilter }), 0)
              }}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                enrichInstitutional
                  ? 'bg-success/10 border-success/40 text-success'
                  : 'bg-surface-900/80 border-surface-700/50 text-surface-300 hover:text-surface-100'
              }`}
              title="Pull SEC Form 4 insider transactions + 13-F institutional holdings for the top 8 candidates. The highest-confidence non-options accumulation signal."
            >
              {enrichInstitutional ? '✓ Institutional on' : '+ Institutional (Form 4 + 13-F)'}
            </button>
            <button
              onClick={openGlossary}
              className="w-5 h-5 rounded-full border border-surface-600 text-surface-400 hover:border-accent hover:text-accent text-[10px] font-bold transition-colors"
              title="What are 'Form 4' and '13-F' filings? Click to read the glossary."
              aria-label="Explain Institutional"
            >
              ?
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-3">
          <p className="text-danger text-sm">{error}</p>
        </div>
      )}

      {/* Wide universe failed — usually entitlement on the grouped endpoint. */}
      {data?.universe_error && (
        <div className="rounded-lg bg-warning/10 border border-warning/40 px-4 py-3 flex items-start gap-3">
          <div className="shrink-0 w-6 h-6 rounded-full border border-warning/40 text-warning flex items-center justify-center font-bold text-xs mt-0.5">$</div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-warning">
              {data.universe_error.code === 'grouped_not_entitled'
                ? `${data.universe_error.endpoint_name || 'Daily Market Summary'} not on your Massive plan`
                : 'Wide universe unavailable'}
            </div>
            <div className="text-[12px] text-warning/80 mt-0.5 leading-snug">
              {data.universe_error.hint || data.universe_error.message} Falling back to the curated universe.
            </div>
          </div>
        </div>
      )}

      {/* Institutional (Form 4 + 13-F) enrichment failed — usually entitlement. */}
      {data?.institutional_error && (
        <div className="rounded-lg bg-warning/10 border border-warning/40 px-4 py-3 flex items-start gap-3">
          <div className="shrink-0 w-6 h-6 rounded-full border border-warning/40 text-warning flex items-center justify-center font-bold text-xs mt-0.5">$</div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-warning">
              {data.institutional_error.code === 'filings_not_entitled'
                ? `${data.institutional_error.endpoint_name || 'SEC Filings'} not on your Massive plan`
                : 'Institutional footprint unavailable'}
            </div>
            <div className="text-[12px] text-warning/80 mt-0.5 leading-snug">
              {data.institutional_error.hint || data.institutional_error.message}
            </div>
          </div>
        </div>
      )}

      {/* Smart Money (Tier C) enrichment failed — usually entitlement. The chain
          summary still rendered, so this is a soft warning, not a hard error. */}
      {data?.blocks_error && (
        <div className="rounded-lg bg-warning/10 border border-warning/40 px-4 py-3 flex items-start gap-3">
          <div className="shrink-0 w-6 h-6 rounded-full border border-warning/40 text-warning flex items-center justify-center font-bold text-xs mt-0.5">$</div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-warning">
              {data.blocks_error.code === 'trades_not_entitled'
                ? `${data.blocks_error.endpoint_name || 'Tick-level Trades'} not on your Massive plan`
                : 'Smart Money enrichment unavailable'}
            </div>
            <div className="text-[12px] text-warning/80 mt-0.5 leading-snug">
              {data.blocks_error.hint || data.blocks_error.message}
            </div>
            {data.blocks_error.code === 'trades_not_entitled' && (
              <a
                href="https://massive.com/pricing"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-warning underline mt-1 inline-block"
              >
                See Massive plans →
              </a>
            )}
          </div>
        </div>
      )}

      {/* About-this-mode explainer — real collapsible (click header to toggle).
          Body includes a plain-English glossary when in unusual_volume mode. */}
      {MODE_ABOUT[mode] && (
        <div ref={aboutPanelRef} className="rounded-xl bg-accent/[0.04] border border-accent/20 overflow-hidden">
          <button
            onClick={toggleAbout}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/5 transition-colors text-left"
            aria-expanded={aboutOpen}
          >
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider text-accent font-bold">
                About: {MODES.find((m) => m.id === mode)?.label}
              </div>
              {!aboutOpen && (
                <p className="text-[12px] text-surface-400 mt-0.5 truncate">{MODE_ABOUT[mode].summary}</p>
              )}
            </div>
            <span
              className={`shrink-0 text-surface-400 text-lg transition-transform duration-150 ${aboutOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            >
              ⌃
            </span>
          </button>

          {aboutOpen && (
            <div className="px-4 pb-4 border-t border-accent/15">
              <p className="text-sm text-surface-200 mt-3">{MODE_ABOUT[mode].summary}</p>
              <ul className="space-y-1.5 mt-3">
                {MODE_ABOUT[mode].bullets.map(([term, def]) => (
                  <li key={term} className="text-[12px] text-surface-400 leading-snug">
                    <span className="text-surface-200 font-medium">{term}:</span> {def}
                  </li>
                ))}
              </ul>

              {/* Pointer to the sticky glossary sidebar (only on volume modes). */}
              {mode === 'unusual_volume' && (
                <div className="text-[11px] text-surface-500 mt-3 pt-2 border-t border-surface-700/40 italic">
                  Need a plain-English breakdown of any term below? Open the <span className="text-accent font-medium not-italic">? Glossary</span> tab on the right edge of the screen (or click the ? next to any toggle).
                </div>
              )}

              <div className="text-[11px] text-surface-500 mt-3 pt-2 border-t border-surface-700/40">
                Data: ~250 curated US momentum names (env-overridable). OHLCV cached locally to
                <span className="font-mono"> backend/data/ohlcv_cache</span>. Provider: <span className="font-mono">QF_DATA_PROVIDER</span> (default <span className="font-mono">massive</span>).
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live loading panel — visible whenever a network fetch is in flight.
          Skeleton tiles below still render; this panel tells you WHAT'S running. */}
      {loading && (
        <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-4 flex items-center gap-4">
          <div className="w-5 h-5 rounded-full border-2 border-accent/30 border-t-accent animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-sm text-surface-100 font-medium">Running screener…</span>
              <span className="font-mono text-xs text-accent">{(elapsedMs / 1000).toFixed(1)}s</span>
              {elapsedMs > 8000 && (
                <span className="text-[10px] text-surface-500 uppercase tracking-wider">cold cache — first run after a quiet period</span>
              )}
            </div>
            <div className="text-[11px] text-surface-400 mt-1 leading-snug">
              {elapsedMs < 3000   && '1. Fetching universe (~250 tickers) & loading cached OHLCV…'}
              {elapsedMs >= 3000 && elapsedMs < 12000 && '2. Pulling fresh bars from data provider for any stale symbols…'}
              {elapsedMs >= 12000 && elapsedMs < 20000 && '3. Scoring candidates — liquidity, ADR, base detection, RVOL…'}
              {elapsedMs >= 20000 && '4. Enriching top candidates with news + RSI + earnings dates…'}
            </div>
          </div>
        </div>
      )}

      {data && (
        <div className="text-xs text-surface-500 flex items-center gap-4 flex-wrap">
          <span className="inline-flex items-center gap-1.5">
            <span>{data.results?.length} of {data.scored} ranked</span>
            <InfoTip text={`Funnel: Universe (${data.universe_size} tickers) → Scored (${data.scored} passed liquidity + ADR + mode-specific gates) → Ranked (${data.results?.length} shown, capped by the per-mode limit). The remaining ${(data.scored || 0) - (data.results?.length || 0)} scored candidates exist but ranked below the cutoff.`} />
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span>Universe: {data.universe_size}</span>
            {data.wide && (
              <span className="px-1.5 py-0.5 rounded border border-accent/40 bg-accent/10 text-accent font-mono text-[10px]">
                wide
              </span>
            )}
            <InfoTip text={data.wide
              ? `Wide universe: every US stock with ≥$5M average daily volume (refreshed daily from Massive's grouped market summary). Catches small caps the curated list misses.`
              : "The total tickers we have OHLCV for. A curated ~250-symbol list of liquid US momentum names — not the whole market. Toggle 'Wide universe' to expand to all US stocks with ≥$5M ADV (~1,500-2,500 names)."
            } />
          </span>
          <span>As of {new Date(data.as_of).toLocaleString()}</span>
          <span>({data.elapsed_seconds}s)</span>
          {cacheStamp && (
            <span
              className="px-1.5 py-0.5 rounded border border-surface-700/40 bg-surface-900/60 text-surface-400 font-mono text-[10px]"
              title="Served from local cache. Click Refresh to bypass."
            >
              cached · {Math.round((Date.now() - cacheStamp) / 60000)}m ago
            </span>
          )}
          {data.cached && !cacheStamp && (
            <span className="px-1.5 py-0.5 rounded border border-surface-700/40 bg-surface-900/60 text-surface-400 font-mono text-[10px]">
              server cache · {Math.round((data.cache_age_seconds || 0) / 60)}m old
            </span>
          )}
          {!isMarketActiveNow() && (
            <span
              className="px-1.5 py-0.5 rounded border border-warning/40 bg-warning/5 text-warning font-mono text-[10px]"
              title="Market is closed (weekend / US holiday / after 2pm PT). Cache TTL is extended to 4 hours — no point re-fetching frozen data."
            >
              {marketStatusLabel()} · cache extended 4h
            </span>
          )}
        </div>
      )}

      {/* History panel (collapsible) */}
      {showHistory && (
        <div className="rounded-xl bg-surface-900/40 border border-surface-700/40 p-4">
          <h3 className="text-sm font-medium text-surface-200 mb-3">
            Recent Developing Setups (last 30 days)
          </h3>
          {history.length === 0 ? (
            <p className="text-xs text-surface-500">No snapshots yet — run the screener a few times to build history.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
              {history.map((h) => (
                <div
                  key={h.symbol}
                  className="rounded-lg bg-surface-800/60 border border-surface-700/40 px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <TickerLink symbol={h.symbol} className="font-bold text-surface-100" />
                    <span className="font-mono text-success">{h.score?.toFixed(0)}</span>
                  </div>
                  <div className="text-[10px] text-surface-500 mt-0.5">
                    {h.status} · {h.last_seen_date}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && !data && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-surface-900/40 border border-surface-700/30 p-3 h-[380px] animate-pulse" />
          ))}
        </div>
      )}

      {data?.results?.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.results.map((c, i) => (
            <ChartCard key={c.symbol} candidate={c} rank={i + 1} isNew={newSinceLast.has(c.symbol)} />
          ))}
        </div>
      )}

      {data && (!data.results || data.results.length === 0) && !loading && (
        <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-12 text-center">
          <p className="text-surface-400 text-sm">
            No candidates passed the filters. Try lowering Min ADR or switching mode.
          </p>
        </div>
      )}

      {/* Sticky right-edge glossary — only on Unusual Volume since that's
          where the jargon density is highest. Key={glossaryKey} so the
          (?) buttons can force-remount it open. */}
      {mode === 'unusual_volume' && (
        <GlossarySidebar key={glossaryKey} terms={GLOSSARY} />
      )}
    </div>
  )
}

export default Breakouts
