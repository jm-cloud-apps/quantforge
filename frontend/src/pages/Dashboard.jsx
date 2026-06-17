import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import TickerLink from '../components/TickerLink'
import TradingViewLink from '../components/TradingViewLink'
import EarningsSessionIcon from '../components/EarningsSessionIcon'
import InfoTip from '../components/InfoTip'
import { getBreadthSnapshot } from '../api/breadth'
import { getSectorPerformance } from '../api/screener'
import { getBreakouts } from '../api/breakoutScreener'
import { get9MScan } from '../api/scanner9m'
import { getEarnings } from '../api/calendar'
import { getMovers, getExtendedMovers, getGapMovers } from '../api/movers'
import { listWatchlists } from '../api/watchlists'
import { fetchNews, refreshNewsCachePrices } from '../api/news'
import { loadRules, getRuleOfDay } from '../utils/tradingRules'
import { marketStatusLabel } from '../utils/marketClock'

// ---------------------------------------------------------------------------
// Market Overview — the app's front door.
//
// One screen that answers "what should I be looking at right now?" by pulling
// the headline read from each of the analysis pages and surfacing the top
// names from each, every card deep-linking back to the full page.
//
// Design: each card fetches independently so the page paints progressively —
// the fast reads (breadth, sectors, index strip) land first; the heavy
// universe scans (breakouts, unusual volume, 9M) fill in as they finish. A
// single "Refresh" bumps a shared key that forces every card to re-fetch
// with `force`.
//
// We deliberately request the SAME params each source page uses for its
// default view (same mode/limit/filters) so the backend response cache is
// shared — visiting the dashboard warms the other pages and vice-versa.
// ---------------------------------------------------------------------------

const fmtPct = (v, digits = 2) =>
  v == null || Number.isNaN(v) ? '–' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(digits)}%`

const fmtPrice = (v) => (v == null || Number.isNaN(v) ? '–' : `$${Number(v).toFixed(2)}`)

const fmtEps = (v) => {
  if (v == null) return '—'
  const n = Number(v)
  if (Number.isNaN(n)) return '—'
  return n >= 0 ? `$${n.toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`
}

const toneFor = (v) =>
  v == null ? 'text-surface-400' : v > 0 ? 'text-success' : v < 0 ? 'text-danger' : 'text-surface-300'

// ─── Unified load progress ──────────────────────────────────────────────────
//
// Every card loads independently (so the page paints progressively), which is
// great for perceived speed but leaves the user staring at a scatter of
// spinners with no sense of "how much is left." This context lets each loader
// register a labelled entry and report its loading state; a single bar near
// the top then shows "8/13 (62%)" plus what's still in flight. It's purely
// observational — it doesn't change how anything fetches.

const LoadProgressContext = createContext(null)

function LoadProgressProvider({ children }) {
  const [items, setItems] = useState({}) // id -> { label, loading }

  const report = useCallback((id, label, loading) => {
    setItems((m) => {
      const prev = m[id]
      if (prev && prev.label === label && prev.loading === loading) return m // no-op
      return { ...m, [id]: { label, loading } }
    })
  }, [])

  const unregister = useCallback((id) => {
    setItems((m) => {
      if (!(id in m)) return m
      const next = { ...m }
      delete next[id]
      return next
    })
  }, [])

  return (
    <LoadProgressContext.Provider value={{ items, report, unregister }}>
      {children}
    </LoadProgressContext.Provider>
  )
}

// Register this loader with the progress bar and keep its state in sync.
// Safe to call when there's no provider (ctx is null) — it just no-ops, so
// cards still work if rendered outside the dashboard.
function useProgressReport(label, loading) {
  const ctx = useContext(LoadProgressContext)
  // Depend on the *stable* report/unregister callbacks, not the whole ctx
  // object. The provider's value is a fresh object literal each render, so
  // depending on `ctx` makes both effects re-run on every provider render —
  // and the unregister-cleanup vs. report-effect then fight over `items`,
  // causing an infinite update loop. report/unregister are useCallback([]),
  // so their identity is stable across renders.
  const report = ctx?.report
  const unregister = ctx?.unregister
  const id = useId()
  useEffect(() => {
    report?.(id, label, loading)
  }, [report, id, label, loading])
  useEffect(() => () => unregister?.(id), [unregister, id])
}

// Generic async loader. Re-runs whenever `refreshKey` changes. `fetcher`
// receives the current refreshKey so it can decide whether to force-bust.
// `label` (optional) names this loader in the unified progress bar.
function useCardData(fetcher, refreshKey, label) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.resolve()
      .then(() => fetcherRef.current(refreshKey > 0))
      .then((data) => { if (alive) setState({ data, loading: false, error: null }) })
      .catch((err) => { if (alive) setState({ data: null, loading: false, error: err.message || 'Failed to load' }) })
    return () => { alive = false }
  }, [refreshKey])

  useProgressReport(label, state.loading)
  return state
}

// ─── Shared card chrome ─────────────────────────────────────────────────────

// Static map so Tailwind's content scanner sees the full class strings — it
// can't resolve interpolated names like `bg-${tone}`.
const DOT = {
  accent: 'bg-accent',
  cyan: 'bg-cyan',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  purple: 'bg-purple',
}

function Card({ title, subtitle, to, toLabel, accent = 'accent', children, loading, error }) {
  return (
    <section className="rounded-xl border border-surface-700/50 bg-surface-900/40 flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-surface-700/40">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${DOT[accent] || DOT.accent}`} aria-hidden="true" />
            <h2 className="font-display font-semibold text-[15px] text-surface-50 truncate">{title}</h2>
            {loading && (
              <span className="inline-block w-3 h-3 rounded-full border-2 border-surface-600 border-t-accent animate-spin" aria-label="Loading" />
            )}
          </div>
          {subtitle && <p className="text-[11px] text-surface-500 mt-0.5">{subtitle}</p>}
        </div>
        {to && (
          <Link to={to} className="shrink-0 text-[11px] font-medium text-accent hover:text-accent/80 whitespace-nowrap">
            {toLabel || 'Open'} →
          </Link>
        )}
      </div>
      <div className="flex-1 px-4 py-3">
        {error ? (
          <div className="text-[12px] text-warning/90 bg-warning/5 border border-warning/20 rounded-lg px-3 py-2">
            {error}
          </div>
        ) : loading && !children ? (
          <SkeletonRows />
        ) : (
          children
        )}
      </div>
    </section>
  )
}

function SkeletonRows({ rows = 4 }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-7 rounded bg-surface-800/60" />
      ))}
    </div>
  )
}

function Empty({ children }) {
  return <div className="text-[12px] text-surface-500 py-2">{children}</div>
}

// ─── Index / market pulse strip ─────────────────────────────────────────────

const INDEX_SYMS = ['SPY', 'QQQ', 'IWM', 'DIA']
const INDEX_NAMES = { SPY: 'S&P 500', QQQ: 'Nasdaq 100', IWM: 'Russell 2000', DIA: 'Dow 30' }

function IndexStrip({ refreshKey }) {
  const { data, loading } = useCardData(() => refreshNewsCachePrices(INDEX_SYMS), refreshKey, 'Index prices')
  const prices = data?.prices || {}
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {INDEX_SYMS.map((sym) => {
        const p = prices[sym]
        const cp = p?.change_pct
        return (
          <div
            key={sym}
            className="rounded-lg border border-surface-700/50 bg-surface-900/40 px-3 py-2 flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 truncate">{INDEX_NAMES[sym]}</div>
              <div className="font-mono text-[13px] font-semibold text-surface-100">
                {p ? fmtPrice(p.price) : loading ? '…' : '–'}
              </div>
            </div>
            <div className={`font-mono text-[13px] font-bold shrink-0 ${toneFor(cp)}`}>{fmtPct(cp)}</div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Rule of the day ────────────────────────────────────────────────────────

const RULE_CAT_STYLE = {
  MINDSET: 'text-purple bg-purple/10 border-purple/30',
  RISK: 'text-danger bg-danger/10 border-danger/30',
  ENTRY: 'text-success bg-success/10 border-success/30',
  EXIT: 'text-cyan bg-cyan/10 border-cyan/30',
}

function RuleOfDay() {
  const rule = useMemo(() => getRuleOfDay(loadRules()), [])
  if (!rule) return null
  const catStyle = RULE_CAT_STYLE[rule.category] || 'text-surface-300 bg-surface-700/40 border-surface-600'
  return (
    <section className="rounded-xl border border-surface-700/50 bg-surface-900/40 px-5 py-3 flex items-center gap-4">
      <span className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold shrink-0 hidden sm:inline">
        Rule of the day
      </span>
      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border shrink-0 ${catStyle}`}>
        {rule.category}
      </span>
      <p className="text-[13px] text-surface-200 leading-snug min-w-0 flex-1">{rule.text}</p>
      <Link to="/rules" className="shrink-0 text-[11px] font-medium text-accent hover:text-accent/80 whitespace-nowrap hidden sm:inline">
        All rules →
      </Link>
    </section>
  )
}

// ─── Regime banner (market breadth) ─────────────────────────────────────────

const REGIME_STYLE = {
  capitulation: { ring: 'border-danger/40', bg: 'bg-danger/10', dot: 'bg-danger', text: 'text-danger' },
  bearish:      { ring: 'border-danger/40', bg: 'bg-danger/10', dot: 'bg-danger', text: 'text-danger' },
  neutral:      { ring: 'border-surface-600', bg: 'bg-surface-800/40', dot: 'bg-surface-400', text: 'text-surface-200' },
  bullish:      { ring: 'border-success/40', bg: 'bg-success/10', dot: 'bg-success', text: 'text-success' },
  overheated:   { ring: 'border-warning/40', bg: 'bg-warning/10', dot: 'bg-warning', text: 'text-warning' },
}

// Plain-English explanations for the breadth metrics in the regime banner.
// These are Stockbee-style momentum-breadth *counts* (number of stocks), not
// moving-average percentages — matching the definitions on the Market Monitor
// page. (T2108 is the one true percentage here.)
const TIP_MO_UP_50 = 'Number of stocks up 50%+ over the last ~21 trading sessions (about a month). A momentum-breadth gauge — readings above ~20 can flag an overheated, blow-off market.'
const TIP_T2108 = 'T2108 — percent of the universe trading above its 40-day moving average. 80%+ = overbought / overheated; 20% or below = oversold, capitulation zone.'
const TIP_MO_UP_25 = 'Number of stocks up 25%+ over the last ~21 trading sessions (about a month). Surges mark strong, broad momentum environments.'
const TIP_MO_DOWN_25 = 'Number of stocks down 25%+ over the last ~21 trading sessions (about a month). Spikes show up during sharp corrections and broad damage.'

function RegimeBanner({ breadth }) {
  const { data, loading, error } = breadth
  const regime = data?.regime
  const level = regime?.level || 'neutral'
  const style = REGIME_STYLE[level] || REGIME_STYLE.neutral
  const m = data?.metrics || {}

  return (
    <section className={`rounded-xl border ${style.ring} ${style.bg} px-5 py-4`}>
      <div className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`shrink-0 w-3 h-3 rounded-full ${style.dot} ${loading ? 'animate-pulse' : ''}`} aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Market Regime · Breadth</div>
            <div className={`font-display font-bold text-lg ${style.text} leading-tight`}>
              {error ? 'Breadth unavailable' : regime?.summary || (loading ? 'Reading the tape…' : 'Neutral / mixed')}
            </div>
            {regime?.posture && !error && (
              <div className="text-[12px] text-surface-400 mt-0.5 leading-snug">{regime.posture}</div>
            )}
          </div>
        </div>

        {!error && (
          <div className="flex items-center gap-5 lg:ml-auto flex-wrap">
            <Metric label="50% month up" tip={TIP_MO_UP_50} value={m.mo_up_50 != null ? `${m.mo_up_50}` : '–'} />
            <Metric label="T2108" tip={TIP_T2108} value={m.t2108 != null ? `${m.t2108}` : '–'} />
            <Metric label="25% month up" tip={TIP_MO_UP_25} value={m.mo_up_25 != null ? `${m.mo_up_25}` : '–'} tone="text-success" />
            <Metric label="25% month down" tip={TIP_MO_DOWN_25} value={m.mo_down_25 != null ? `${m.mo_down_25}` : '–'} tone="text-danger" />
            <Link to="/market-monitor" className="text-[11px] font-medium text-accent hover:text-accent/80 whitespace-nowrap">
              Market Monitor →
            </Link>
          </div>
        )}
      </div>
    </section>
  )
}

function Metric({ label, value, tone = 'text-surface-100', tip }) {
  return (
    <div className="text-center">
      <div className={`font-mono font-bold text-base ${tone}`}>{value}</div>
      {tip ? (
        <InfoTip
          label={tip}
          className="text-[9px] uppercase tracking-wider text-surface-500 underline decoration-dotted decoration-surface-600 underline-offset-2"
        >
          {label}
        </InfoTip>
      ) : (
        <div className="text-[9px] uppercase tracking-wider text-surface-500">{label}</div>
      )}
    </div>
  )
}

// ─── Sector rotation ────────────────────────────────────────────────────────

function rankSectors(sectors) {
  const analyzed = (sectors || [])
    .filter((s) => s.returns && s.returns['5D'] != null)
    .map((s) => ({
      sector: s.sector,
      ticker: s.ticker,
      r5d: s.returns['5D'] ?? 0,
      r1m: s.returns['1M'] ?? 0,
      r3m: s.returns['3M'] ?? 0,
    }))
  const sorted = [...analyzed].sort((a, b) => b.r5d - a.r5d)
  return { in: sorted.slice(0, 10), out: sorted.slice(-10).reverse() }
}

function SectorRotation({ sectors }) {
  const { data, loading, error } = sectors
  const ranked = useMemo(() => rankSectors(data?.sectors), [data])
  const demo = data?.is_demo
  // Don't render more pair rows than we actually have on either side.
  const rowCount = Math.min(10, Math.max(ranked.in.length, ranked.out.length))

  return (
    <Card
      title="Sector Rotation"
      subtitle={demo ? 'Demo data — live feed unavailable' : 'Money flow by sector ETF · 5-day'}
      to="/screener"
      toLabel="Sector Scan"
      accent="cyan"
      loading={loading}
      error={error}
    >
      {data && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div className="text-[10px] uppercase tracking-wider text-success font-semibold pb-1">Rotating In</div>
          <div className="text-[10px] uppercase tracking-wider text-danger font-semibold pb-1">Rotating Out</div>
          {Array.from({ length: rowCount }).map((_, i) => (
            <SectorPair key={i} a={ranked.in[i]} b={ranked.out[i]} />
          ))}
        </div>
      )}
    </Card>
  )
}

function SectorPair({ a, b }) {
  return (
    <>
      <SectorRow s={a} />
      <SectorRow s={b} />
    </>
  )
}

function SectorRow({ s }) {
  if (!s) return <div className="h-6" />
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-[12px] text-surface-200 truncate" title={`${s.sector} (${s.ticker})`}>
        {s.sector}
      </span>
      <span className={`font-mono text-[12px] font-semibold shrink-0 ${toneFor(s.r5d)}`}>{fmtPct(s.r5d, 1)}</span>
    </div>
  )
}

// ─── Market themes (synthesized) ────────────────────────────────────────────

function ThemesCard({ sectors, breadth }) {
  const sectorState = sectors
  const breadthState = breadth

  const themes = useMemo(() => {
    const out = []
    const ranked = rankSectors(sectorState.data?.sectors)
    const top = ranked.in.filter((s) => s.r5d > 0).slice(0, 3)
    const bottom = ranked.out.filter((s) => s.r5d < 0).slice(0, 3)
    if (top.length) {
      out.push({
        tone: 'success',
        text: `Money rotating into ${top.map((s) => s.sector).join(', ')} — leading the tape over the last week.`,
      })
    }
    if (bottom.length) {
      out.push({
        tone: 'danger',
        text: `Weakness in ${bottom.map((s) => s.sector).join(', ')} — capital leaving these groups.`,
      })
    }
    const regime = breadthState.data?.regime
    if (regime?.summary) {
      out.push({ tone: regime.level === 'bullish' ? 'success' : regime.level === 'bearish' || regime.level === 'capitulation' ? 'danger' : 'accent', text: `Breadth regime: ${regime.summary}. ${regime.posture || ''}`.trim() })
    }
    ;(regime?.warnings || []).slice(0, 2).forEach((w) => out.push({ tone: 'warning', text: w }))
    return out
  }, [sectorState.data, breadthState.data])

  const loading = sectorState.loading || breadthState.loading

  return (
    <Card
      title="Current Market Themes"
      subtitle="Synthesized from sector flow + breadth"
      accent="accent"
      loading={loading}
      error={sectorState.error && breadthState.error ? 'Theme inputs unavailable' : null}
    >
      {!loading && themes.length === 0 && <Empty>Not enough data to read a theme yet.</Empty>}
      <ul className="space-y-2">
        {themes.map((t, i) => (
          <li key={i} className="flex gap-2.5 text-[12.5px] leading-snug text-surface-200">
            <span className={`mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full ${DOT[t.tone] || DOT.accent}`} aria-hidden="true" />
            <span>{t.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ─── Earnings this week (calendar) ──────────────────────────────────────────

// Plain-English explanations for the metric abbreviations shown on the
// scan cards, surfaced as instant hover tooltips (see InfoTip).
const TIP_RVOL = "Relative volume — today's volume vs the 50-day average. 3× vol means it's trading 3 times its normal volume."
const TIP_ACC = 'Accumulation score (0–100): is the volume buying or selling? Above 60 = buyers in control, below 40 = sellers in control.'
const TIP_DCR = "Daily closing range — where it closed within the day's high-to-low range. 80% DCR = closed near the high (strong)."
const TIP_EXPANSION = "Range expansion — today's high-to-low range vs the average daily range over the prior 20 sessions. 2× means today's range is double its normal size (a volatility/momentum surge). The scan requires at least 1.5×."
// The last-column score is 0–100 but is computed differently per scan.
const TIP_SCORE_BREAKOUT = 'Setup score (0–100): overall quality of the breakout setup — blends trend leadership, the prior up-thrust, how tight the base is, and how close price is to the pivot.'
const TIP_SCORE_VOLUME = 'Surge score (0–100): scales with relative volume (≈ RVOL × 20, capped at 100). Trading 5× or more above the 50-day average volume scores 100.'
const TIP_SCORE_UNUSUAL = 'Conviction score (0–100): 50% volume magnitude + 20% how fresh the surge is + 30% accumulation (buying vs selling pressure).'

function localDateKey(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function EarningsWeekCard({ refreshKey }) {
  const { data, loading, error } = useCardData(() => getEarnings({ days: 7, force: refreshKey > 0 }), refreshKey, 'Earnings (7d)')

  // Build a forward strip starting at "today" (the backend's window now
  // includes a few past days for beat/miss results, but the dashboard card
  // is forward-looking). Weekends are skipped — US earnings don't print
  // on Sat/Sun. Empty weekdays still render so the grid stays uniform.
  const days = useMemo(() => {
    if (!data?.window) return []
    const byDate = new Map((data.by_date || []).map((d) => [d.date, d]))
    const todayIso = data.window.today || localDateKey(new Date())
    const start = new Date(`${todayIso}T00:00:00`)
    const todayKey = todayIso
    const out = []
    const forwardDays = data.window.days || 7
    let cursor = 0
    while (out.length < 5 && cursor < forwardDays + 3) {
      const dt = new Date(start)
      dt.setDate(start.getDate() + cursor)
      cursor++
      const dow = dt.getDay()
      if (dow === 0 || dow === 6) continue
      const key = localDateKey(dt)
      const entry = byDate.get(key)
      const items = entry ? [...(entry.bmo || []), ...(entry.amc || []), ...(entry.other || [])] : []
      out.push({
        key,
        weekday: dt.toLocaleDateString([], { weekday: 'short' }),
        label: dt.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        isToday: key === todayKey,
        items,
      })
    }
    return out
  }, [data])

  const wlHits = data?.watchlist_hits?.length || 0
  const subtitle = data
    ? `${data.total || 0} reports this week${wlHits ? ` · ${wlHits} on your watchlist` : ''}`
    : 'Reports over the next 7 days'

  return (
    <Card
      title="Earnings This Week"
      subtitle={subtitle}
      to="/earnings"
      toLabel="Calendar"
      accent="purple"
      loading={loading}
      error={error}
    >
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {days.map((day) => (
            <div
              key={day.key}
              className={`rounded-lg border p-2 flex flex-col min-h-[136px] ${
                day.isToday ? 'border-accent/50 bg-accent/5' : 'border-surface-700/50 bg-surface-900/30'
              }`}
            >
              <div className="text-center pb-1.5 mb-1.5 border-b border-surface-700/40">
                <div className={`text-[10px] uppercase tracking-wider font-semibold ${day.isToday ? 'text-accent' : 'text-surface-500'}`}>
                  {day.weekday}
                </div>
                <div className="font-display font-bold text-surface-100 text-[13px] leading-tight">{day.label}</div>
              </div>
              {day.items.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-[16px] text-surface-700">·</div>
              ) : (
                <div className="space-y-0.5">
                  {day.items.slice(0, 7).map((it, itIdx) => {
                    const act = it.eps_actual
                    const est = it.eps_estimate
                    const hasAct = act !== null && act !== undefined && !Number.isNaN(Number(act))
                    const hasEst = est !== null && est !== undefined && !Number.isNaN(Number(est))
                    let state = null
                    if (hasAct && hasEst) {
                      const a = Number(act), e = Number(est)
                      if (a > e) state = 'beat'
                      else if (a < e) state = 'miss'
                      else state = 'inline'
                    }
                    const pct = (hasAct && hasEst && Number(est) !== 0)
                      ? ((Number(act) - Number(est)) / Math.abs(Number(est))) * 100
                      : null
                    const tickerColor = it.in_watchlist
                      ? 'text-accent'
                      : state === 'beat' ? 'text-emerald-300'
                        : state === 'miss' ? 'text-rose-300'
                          : 'text-surface-200'
                    const title = hasAct
                      ? `Actual ${fmtEps(act)} vs est ${fmtEps(est)}`
                      : (hasEst ? `EPS est ${fmtEps(est)}` : undefined)
                    return (
                      <div key={`${it.symbol}-${itIdx}`} className="flex items-center gap-1 justify-between" title={title}>
                        <div className="flex items-center gap-1 min-w-0">
                          <EarningsSessionIcon time={it.time} className="shrink-0 w-3 h-3" />
                          <TradingViewLink
                            symbol={it.symbol}
                            className={`text-[11px] font-semibold truncate ${tickerColor}`}
                          />
                        </div>
                        {state === 'beat' && (
                          <span className="text-[9px] font-mono text-emerald-400 shrink-0 tabular-nums">
                            {pct !== null ? `+${pct.toFixed(0)}%` : '✓'}
                          </span>
                        )}
                        {state === 'miss' && (
                          <span className="text-[9px] font-mono text-rose-400 shrink-0 tabular-nums">
                            {pct !== null ? `-${Math.abs(pct).toFixed(0)}%` : '✗'}
                          </span>
                        )}
                      </div>
                    )
                  })}
                  {day.items.length > 7 && (
                    <div className="text-[10px] text-surface-500 pt-0.5">+{day.items.length - 7} more</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 mt-2.5 text-[10px] text-surface-500">
        <span className="flex items-center gap-1"><EarningsSessionIcon time="bmo" className="w-3 h-3" /> Before open</span>
        <span className="flex items-center gap-1"><EarningsSessionIcon time="amc" className="w-3 h-3" /> After close</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-accent" /> On your watchlist</span>
      </div>
    </Card>
  )
}

// ─── Watchlist pulse ────────────────────────────────────────────────────────

function WatchlistPulseCard({ refreshKey }) {
  const { data, loading, error } = useCardData(async () => {
    const lists = await listWatchlists()
    const symbols = [...new Set((lists || []).flatMap((l) => (l.entries || []).map((e) => e.symbol)))]
    if (!symbols.length) return { lists, symbols: [], prices: {} }
    const { prices } = await refreshNewsCachePrices(symbols.slice(0, 60))
    return { lists, symbols, prices: prices || {} }
  }, refreshKey, 'Watchlist pulse')

  const movers = useMemo(() => {
    if (!data?.symbols?.length) return []
    return data.symbols
      .map((s) => ({ symbol: s, ...(data.prices?.[s] || {}) }))
      .filter((m) => m.change_pct != null)
      .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
      .slice(0, 10)
  }, [data])

  const subtitle = data?.symbols?.length
    ? `${data.symbols.length} names · biggest movers`
    : 'Your watchlists at a glance'

  return (
    <Card
      title="Watchlist Pulse"
      subtitle={subtitle}
      to="/watchlist"
      toLabel="Watchlist"
      accent="cyan"
      loading={loading}
      error={error}
    >
      {data && data.symbols.length === 0 && (
        <Empty>
          No watchlists yet —{' '}
          <Link to="/watchlist" className="text-accent hover:text-accent/80">
            add names on the Watchlist page
          </Link>
          .
        </Empty>
      )}
      {data && data.symbols.length > 0 && movers.length === 0 && (
        <Empty>Couldn't fetch quotes for your watchlist right now.</Empty>
      )}
      <div className="divide-y divide-surface-800/60">
        {movers.map((m) => (
          <div key={m.symbol} className="flex items-center gap-2 py-1.5">
            <TickerLink symbol={m.symbol} className="text-[13px] font-bold text-surface-100 w-14 shrink-0" />
            <span className="text-[11px] text-surface-500 ml-auto">{fmtPrice(m.price)}</span>
            <span className={`font-mono text-[12px] font-bold w-16 text-right ${toneFor(m.change_pct)}`}>
              {fmtPct(m.change_pct)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ─── Today's top movers ─────────────────────────────────────────────────────

function MoverRow({ m }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 border-b border-surface-800/40 last:border-0">
      <TickerLink symbol={m.symbol} className="text-[12px] font-bold text-surface-100 truncate" />
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] text-surface-500">{fmtPrice(m.price)}</span>
        <span className={`font-mono text-[12px] font-bold w-16 text-right ${toneFor(m.change_pct)}`}>
          {fmtPct(m.change_pct, 1)}
        </span>
      </div>
    </div>
  )
}

function MoversCard({ refreshKey }) {
  const { data, loading, error } = useCardData(() => getMovers({ limit: 8 }), refreshKey, 'Top movers')
  const gainers = (data?.gainers || []).slice(0, 8)
  const losers = (data?.losers || []).slice(0, 8)
  const empty = data && gainers.length === 0 && losers.length === 0
  return (
    <Card
      title="Today's Top Movers"
      subtitle="Biggest % moves across US stocks"
      accent="warning"
      loading={loading}
      error={error}
    >
      {empty && <Empty>No movers available right now (market may be closed).</Empty>}
      {!empty && (
        <div className="grid grid-cols-2 gap-x-5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-success font-semibold pb-1">Gainers</div>
            {gainers.map((m) => (
              <MoverRow key={m.symbol} m={m} />
            ))}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-danger font-semibold pb-1">Losers</div>
            {losers.map((m) => (
              <MoverRow key={m.symbol} m={m} />
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Extended-hours movers (pre-market / after-hours / regular) ─────────────

const SESSION_LABEL = {
  premarket: 'Pre-Market Movers',
  afterhours: 'After-Hours Movers',
  regular: 'Live Session Movers',
  closed: 'Latest Session Movers',
  unknown: 'Session Movers',
}

const SESSION_SUBTITLE = {
  premarket: 'Biggest % moves from prior close — pre-market session (4:00 AM ET +)',
  afterhours: 'Biggest % moves since the regular close',
  regular: 'Biggest % moves right now',
  closed: 'Most recent session’s biggest movers',
  unknown: 'Top movers',
}

function ExtendedMoversCard({ refreshKey }) {
  const { data, loading, error } = useCardData(() => getExtendedMovers({ limit: 6 }), refreshKey, 'Extended-hours movers')
  const session = data?.session || 'unknown'
  const gainers = data?.gainers || []
  const losers = data?.losers || []
  const empty = data && gainers.length === 0 && losers.length === 0

  return (
    <Card
      title={SESSION_LABEL[session] || SESSION_LABEL.unknown}
      subtitle={SESSION_SUBTITLE[session] || SESSION_SUBTITLE.unknown}
      accent="warning"
      loading={loading}
      error={error}
    >
      {empty && <Empty>No extended-hours movers right now.</Empty>}
      {!empty && (
        <div className="grid grid-cols-2 gap-x-5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-success font-semibold pb-1">Gainers</div>
            {gainers.map((m) => (
              <MoverRow key={`g-${m.symbol}`} m={m} />
            ))}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-danger font-semibold pb-1">Losers</div>
            {losers.map((m) => (
              <MoverRow key={`l-${m.symbol}`} m={m} />
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Gap-and-go scanner ─────────────────────────────────────────────────────

function fmtVolume(v) {
  if (v == null) return '—'
  const n = Number(v)
  if (Number.isNaN(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function GapRow({ r }) {
  const up = (r.change_pct ?? 0) >= 0
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-surface-800/40 last:border-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <TickerLink symbol={r.symbol} className="text-[12px] font-bold text-surface-100 truncate" />
        {r.earnings_today_bmo && (
          <span
            className="text-[8px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 shrink-0"
            title="Reports earnings before market open today"
          >
            ER
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] text-surface-500 tabular-nums w-10 text-right">{fmtVolume(r.volume)}</span>
        <span className="text-[10px] text-surface-500 tabular-nums w-14 text-right">{fmtPrice(r.price)}</span>
        <span className={`font-mono text-[12px] font-bold w-14 text-right ${up ? 'text-success' : 'text-danger'}`}>
          {fmtPct(r.change_pct, 1)}
        </span>
      </div>
    </div>
  )
}

function GapAndGoCard({ refreshKey }) {
  const { data, loading, error } = useCardData(
    () => getGapMovers({ minPct: 5, minVolume: 500_000, limit: 12 }),
    refreshKey,
    'Gap & go',
  )
  const gainers = data?.gainers || []
  const losers = data?.losers || []
  const bmoCount = data?.bmo_count || 0
  const empty = data && gainers.length === 0 && losers.length === 0

  return (
    <Card
      title="Gap & Go"
      subtitle={`≥5% move on ≥500K vol${bmoCount ? ` · ${bmoCount} BMO earnings today` : ''}`}
      accent="purple"
      loading={loading}
      error={error}
    >
      {empty && <Empty>No qualifying gaps right now.</Empty>}
      {!empty && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-success font-semibold pb-1">Gap up</div>
            {gainers.slice(0, 10).map((r) => (
              <GapRow key={`gu-${r.symbol}`} r={r} />
            ))}
            {gainers.length === 0 && <div className="text-[11px] text-surface-500 italic py-2">No gap-ups</div>}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-danger font-semibold pb-1">Gap down</div>
            {losers.slice(0, 10).map((r) => (
              <GapRow key={`gd-${r.symbol}`} r={r} />
            ))}
            {losers.length === 0 && <div className="text-[11px] text-surface-500 italic py-2">No gap-downs</div>}
          </div>
        </div>
      )}
      <div className="mt-2 text-[10px] text-surface-500">
        <span className="inline-flex items-center gap-1">
          <span className="px-1 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 text-[8px] font-semibold">ER</span>
          = reports earnings before open today
        </span>
      </div>
    </Card>
  )
}

// ─── Breakouts / Unusual Volume (shared layout, lifted state) ───────────────

const STATUS_STYLE = {
  READY: 'text-success bg-success/10 border-success/30',
  BUILDING: 'text-accent bg-accent/10 border-accent/30',
  WATCH: 'text-surface-300 bg-surface-700/40 border-surface-600',
}

function BreakoutsCard({ breakouts }) {
  const { data, loading, error } = breakouts
  const rows = (data?.results || []).slice(0, 10)
  return (
    <Card
      title="Top Breakouts"
      subtitle="Setting up at the pivot · Qullamaggie"
      to="/breakouts"
      toLabel="Breakouts"
      accent="success"
      loading={loading}
      error={error}
    >
      {data && rows.length === 0 && <Empty>No breakout setups passing filters right now.</Empty>}
      <div className="divide-y divide-surface-800/60">
        {rows.map((r) => (
          <div key={r.symbol} className="flex items-center gap-2 py-1.5">
            <TickerLink symbol={r.symbol} className="text-[13px] font-bold text-surface-100 w-14 shrink-0" />
            {r.status && (
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${STATUS_STYLE[r.status] || STATUS_STYLE.WATCH}`}>
                {r.status}
              </span>
            )}
            <span className="text-[11px] text-surface-500 ml-auto">{fmtPrice(r.last_close)}</span>
            <InfoTip label={TIP_RVOL} className="text-[11px] text-surface-400 w-14 text-right">
              {r.rvol != null ? `${r.rvol.toFixed(1)}× vol` : ''}
            </InfoTip>
            <InfoTip label={TIP_SCORE_BREAKOUT} className="font-mono text-[12px] font-bold text-success w-10 text-right">
              {r.score?.toFixed(0)}
            </InfoTip>
          </div>
        ))}
      </div>
    </Card>
  )
}

function VolumeSurgeCard({ refreshKey }) {
  const { data, loading, error } = useCardData(
    () => getBreakouts({ mode: 'volume', limit: 24, minAdr: 0.05, minRvol: 1.5, fresh: refreshKey > 0 }),
    refreshKey,
    'Volume surge',
  )
  const rows = (data?.results || []).slice(0, 10)
  return (
    <Card
      title="Volume Surge"
      subtitle="Today's volume vs 50-day average"
      to="/breakouts"
      toLabel="Breakouts"
      accent="cyan"
      loading={loading}
      error={error}
    >
      {data && rows.length === 0 && <Empty>No volume surges passing filters right now.</Empty>}
      <div className="divide-y divide-surface-800/60">
        {rows.map((r) => (
          <div key={r.symbol} className="flex items-center gap-2 py-1.5">
            <TickerLink symbol={r.symbol} className="text-[13px] font-bold text-surface-100 w-14 shrink-0" />
            {r.accumulation_score != null && (
              <InfoTip
                label={TIP_ACC}
                className={`font-mono text-[10px] ${r.accumulation_score >= 60 ? 'text-success' : r.accumulation_score <= 40 ? 'text-danger' : 'text-surface-400'}`}
              >
                {r.accumulation_score.toFixed(0)} acc
              </InfoTip>
            )}
            <span className="text-[11px] text-surface-500 ml-auto">{fmtPrice(r.last_close)}</span>
            <InfoTip label={TIP_RVOL} className="font-mono text-[12px] font-bold text-cyan w-16 text-right">
              {r.rvol != null ? `${r.rvol.toFixed(1)}× vol` : ''}
            </InfoTip>
            <InfoTip label={TIP_SCORE_VOLUME} className="font-mono text-[12px] font-bold text-success w-10 text-right">
              {r.score?.toFixed(0)}
            </InfoTip>
          </div>
        ))}
      </div>
    </Card>
  )
}

function UnusualVolumeCard({ unusual }) {
  const { data, loading, error } = unusual
  const rows = (data?.results || []).slice(0, 10)
  return (
    <Card
      title="Unusual Volume"
      subtitle="Institutional accumulation · ≥2× RVOL"
      to="/breakouts"
      toLabel="Breakouts"
      accent="warning"
      loading={loading}
      error={error}
    >
      {data && rows.length === 0 && <Empty>No sustained volume surges right now.</Empty>}
      <div className="divide-y divide-surface-800/60">
        {rows.map((r) => (
          <div key={r.symbol} className="flex items-center gap-2 py-1.5">
            <TickerLink symbol={r.symbol} className="text-[13px] font-bold text-surface-100 w-14 shrink-0" />
            {r.rvol_streak_day != null && (
              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border text-warning bg-warning/10 border-warning/30">
                Day {r.rvol_streak_day >= 3 ? '3+' : r.rvol_streak_day}
              </span>
            )}
            <InfoTip label={TIP_RVOL} className="text-[11px] text-surface-500 ml-auto">
              {r.rvol != null ? `${r.rvol.toFixed(1)}× vol` : ''}
            </InfoTip>
            {r.accumulation_score != null && (
              <InfoTip
                label={TIP_ACC}
                className={`font-mono text-[11px] w-12 text-right ${r.accumulation_score >= 60 ? 'text-success' : r.accumulation_score <= 40 ? 'text-danger' : 'text-surface-300'}`}
              >
                {r.accumulation_score.toFixed(0)} acc
              </InfoTip>
            )}
            <InfoTip label={TIP_SCORE_UNUSUAL} className="font-mono text-[12px] font-bold text-success w-10 text-right">
              {r.score?.toFixed(0)}
            </InfoTip>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ─── $9M Scanner ─────────────────────────────────────────────────────────────

const BUCKET_STYLE = {
  liquid_lava: 'text-cyan bg-cyan/10 border-cyan/30',
  review: 'text-amber-300 bg-amber-500/10 border-amber-400/30',
}

function Scanner9MCard({ refreshKey }) {
  const { data, loading, error } = useCardData(
    () => get9MScan({ force: refreshKey > 0 }),
    refreshKey,
    '9M scanner',
  )
  const rows = (data?.candidates || []).slice(0, 10)
  const counts = data?.counts
  return (
    <Card
      title="$9M Scanner"
      subtitle={counts ? `${counts.passed_all} passed · ${counts.universe} universe` : 'Stockbee 9M method'}
      to="/scanner-9m"
      toLabel="Scanner"
      accent="accent"
      loading={loading}
      error={error}
    >
      {data && rows.length === 0 && <Empty>Nothing clearing the 9M gates today.</Empty>}
      <div className="divide-y divide-surface-800/60">
        {rows.map((r) => (
          <div key={r.symbol} className="flex items-center gap-2 py-1.5">
            <TickerLink symbol={r.symbol} className="text-[13px] font-bold text-surface-100 w-14 shrink-0" />
            {r.bucket && (
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${BUCKET_STYLE[r.bucket] || BUCKET_STYLE.review}`}>
                {r.bucket === 'liquid_lava' ? 'Lava' : 'Review'}
              </span>
            )}
            <span className="text-[11px] text-surface-500 ml-auto">{fmtPrice(r.close)}</span>
            <InfoTip label={TIP_DCR} className="text-[11px] text-surface-400 w-14 text-right">
              {r.dcr_pct != null ? `${r.dcr_pct.toFixed(0)}% DCR` : ''}
            </InfoTip>
            <InfoTip label={TIP_EXPANSION} className="font-mono text-[12px] font-bold text-accent w-12 text-right">
              {r.expansion_mult != null ? `${r.expansion_mult.toFixed(1)}×` : ''}
            </InfoTip>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ─── Market-moving news ─────────────────────────────────────────────────────

// Polygon/Benzinga sentiment labels → tone dot.
const SENTIMENT_DOT = { positive: 'bg-success', negative: 'bg-danger', neutral: 'bg-surface-500' }

function fmtNewsTime(s) {
  if (!s) return ''
  try {
    return new Date(s.replace(' ', 'T')).toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

// Driven by the names surfaced in the breakout + unusual-volume scans, so the
// headlines line up with the stocks actually moving today. Fetches on its own
// once those tickers resolve (and again on refresh).
function MarketNews({ tickers, refreshKey }) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const key = tickers.join(',')

  useEffect(() => {
    if (!tickers.length) {
      setState({ data: null, loading: true, error: null })
      return
    }
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    fetchNews(tickers)
      .then((data) => { if (alive) setState({ data, loading: false, error: null }) })
      .catch((err) => { if (alive) setState({ data: null, loading: false, error: err.message || 'Failed to load' }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey])

  // News depends on the breakout/unusual scans finishing first (it derives its
  // tickers from them), so it's the natural last entry in the progress bar.
  useProgressReport('Market news', state.loading)

  // One freshest headline per name, newest names first.
  const headlines = useMemo(() => {
    const articles = state.data?.articles || []
    const bySym = new Map()
    for (const a of articles) {
      const cur = bySym.get(a.symbol)
      if (!cur || (a.publishedDate || '') > (cur.publishedDate || '')) bySym.set(a.symbol, a)
    }
    return [...bySym.values()]
      .sort((x, y) => (y.publishedDate || '').localeCompare(x.publishedDate || ''))
      .slice(0, 8)
  }, [state.data])

  return (
    <Card
      title="Market-Moving News"
      subtitle="Latest headlines on today's most active names"
      to="/news"
      toLabel="News"
      accent="purple"
      loading={state.loading}
      error={state.error}
    >
      {!state.loading && headlines.length === 0 && (
        <Empty>No fresh headlines on today's movers.</Empty>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 divide-y md:divide-y-0 divide-surface-800/60">
        {headlines.map((a, i) => (
          <a
            key={`${a.symbol}-${i}`}
            href={a.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex gap-2.5 py-2 hover:bg-surface-800/30 -mx-1 px-1 rounded transition-colors"
          >
            <span
              className={`mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full ${SENTIMENT_DOT[a.sentiment?.label] || SENTIMENT_DOT.neutral}`}
              aria-hidden="true"
              title={a.sentiment?.label ? `Sentiment: ${a.sentiment.label}` : undefined}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold text-surface-100 shrink-0">{a.symbol}</span>
                <span className="text-[10px] text-surface-500 truncate">
                  {a.site}{a.publishedDate ? ` · ${fmtNewsTime(a.publishedDate)}` : ''}
                </span>
              </div>
              <p className="text-[12.5px] text-surface-300 leading-snug line-clamp-2 group-hover:text-surface-100">
                {a.title}
              </p>
            </div>
          </a>
        ))}
      </div>
    </Card>
  )
}

// Unified loading bar — reads the registry every card reports into and shows
// overall progress plus what's still in flight. Renders nothing once every
// loader has resolved (or before any has registered), so it's invisible on a
// fully-warm/cached load and only appears while there's real work outstanding.
function LoadProgress() {
  const ctx = useContext(LoadProgressContext)
  const items = Object.values(ctx?.items || {})
  const total = items.length
  const done = items.filter((it) => !it.loading).length
  const pending = items.filter((it) => it.loading).map((it) => it.label).filter(Boolean)

  if (total === 0 || done >= total) return null

  const pct = Math.round((done / total) * 100)
  const shown = pending.slice(0, 4)
  const extra = pending.length - shown.length

  return (
    <div
      className="rounded-xl border border-surface-700/50 bg-surface-900/40 px-4 py-3"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3 text-[12px] mb-2">
        <span className="font-medium text-surface-200">
          Loading market data… {done}/{total}{' '}
          <span className="text-surface-500">({pct}%)</span>
        </span>
        {shown.length > 0 && (
          <span className="text-surface-500 truncate text-right min-w-0">
            {shown.join(' · ')}{extra > 0 ? ` +${extra} more` : ''}
          </span>
        )}
      </div>
      <div className="h-1.5 w-full rounded-full bg-surface-800 overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// The provider has to sit ABOVE the component that runs the parent-level
// loaders (sectors/breadth/breakouts/unusual) so those register too, hence the
// thin wrapper around DashboardInner.
export default function Dashboard() {
  return (
    <LoadProgressProvider>
      <DashboardInner />
    </LoadProgressProvider>
  )
}

function DashboardInner() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshedAt, setRefreshedAt] = useState(() => new Date())
  const status = marketStatusLabel()

  // Lift the shared fetches to the parent so we never double-hit the backend:
  // sectors + breadth each feed two cards; the breakout/unusual results also
  // feed the Market-Moving News card (it derives its tickers from them).
  const sectors = useCardData(() => getSectorPerformance({ forceRefresh: refreshKey > 0 }), refreshKey, 'Sectors')
  const breadth = useCardData(() => getBreadthSnapshot(), refreshKey, 'Breadth')
  const breakouts = useCardData(
    () => getBreakouts({ mode: 'breakout', limit: 24, minAdr: 0.05, minRvol: 1.5, fresh: refreshKey > 0 }),
    refreshKey,
    'Breakouts',
  )
  const unusual = useCardData(
    () => getBreakouts({ mode: 'unusual_volume', limit: 24, minAdr: 0.05, minRvol: 2.0, dayFilter: 0, fresh: refreshKey > 0 }),
    refreshKey,
    'Unusual volume',
  )

  // Names for the news card: top movers from both scans, deduped.
  const newsTickers = useMemo(() => {
    const b = (breakouts.data?.results || []).slice(0, 6).map((r) => r.symbol)
    const u = (unusual.data?.results || []).slice(0, 6).map((r) => r.symbol)
    return [...new Set([...b, ...u])].slice(0, 10)
  }, [breakouts.data, unusual.data])

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
    setRefreshedAt(new Date())
  }, [])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl text-surface-50">Market Overview</h1>
          <p className="text-[13px] text-surface-400 mt-1">
            A live read across breadth, sectors, breakouts and volume — your starting point for the session.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${
              status === 'Open'
                ? 'text-success border-success/40 bg-success/10'
                : 'text-surface-400 border-surface-600 bg-surface-800/40'
            }`}
            title={status === 'Open' ? 'US market is in session' : 'Market closed — data is frozen, caches extended'}
          >
            {status === 'Open' ? '● Market open' : `${status} · cached`}
          </span>
          <span className="text-[11px] text-surface-500 hidden sm:inline">
            {refreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button
            onClick={refresh}
            className="text-[12px] font-medium px-3 py-1.5 rounded-lg border border-surface-600 text-surface-200 hover:bg-surface-800/60 hover:text-surface-50 transition-colors"
            title="Re-fetch every card"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Unified load progress — visible only while cards are still fetching */}
      <LoadProgress />

      {/* Index / market pulse strip */}
      <IndexStrip refreshKey={refreshKey} />

      {/* Rule of the day */}
      <RuleOfDay />

      {/* Regime banner */}
      <RegimeBanner breadth={breadth} />

      {/* Sectors + themes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectorRotation sectors={sectors} />
        <ThemesCard sectors={sectors} breadth={breadth} />
      </div>

      {/* Earnings — full-width weekly calendar */}
      <EarningsWeekCard refreshKey={refreshKey} />

      {/* Extended-hours movers + gap scanner */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ExtendedMoversCard refreshKey={refreshKey} />
        <GapAndGoCard refreshKey={refreshKey} />
      </div>

      {/* The scans */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        <BreakoutsCard breakouts={breakouts} />
        <VolumeSurgeCard refreshKey={refreshKey} />
        <UnusualVolumeCard unusual={unusual} />
        <Scanner9MCard refreshKey={refreshKey} />
      </div>

      {/* Market-moving news */}
      <MarketNews tickers={newsTickers} refreshKey={refreshKey} />

      {/* Movers + watchlist (bottom) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <MoversCard refreshKey={refreshKey} />
        <WatchlistPulseCard refreshKey={refreshKey} />
      </div>
    </div>
  )
}
