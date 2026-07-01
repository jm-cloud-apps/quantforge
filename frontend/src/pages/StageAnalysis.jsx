import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { getStageScan } from '../api/stageAnalysis'
import TickerLink from '../components/TickerLink'
import TradingViewChart from '../components/TradingViewChart'

// ---------------------------------------------------------------------------
// Stan Weinstein Stage Analysis — from "Secrets for Profiting in Bull and Bear
// Markets." Every stock cycles Stage 1 (base) → 2 (advance) → 3 (top) → 4
// (decline), read off the 30-week moving average on the weekly chart. We only
// want to *own* Stage 2, ideally caught right as a Stage 1 base breaks out.
//
// Backend approximates the 30-week MA with a 150-day SMA on the daily grouped
// cache (see backend/scanners/stage_analysis.py) and tags each name's stage,
// a signal label, and quant metrics (quality, RS rank, ATR extension, a risk
// model and base-quality stats). Click any row for the weekly TradingView chart.
// ---------------------------------------------------------------------------

const STAGES = [
  {
    n: 1, name: 'Basing', tag: 'Accumulation', color: 'amber',
    what: 'After a decline, selling dries up and price chops sideways in a range. The 30-week MA loses its downslope and goes flat; price crosses back and forth over it. Smart money quietly accumulates.',
    criteria: [
      '30-week MA has flattened (no longer falling)',
      'Price oscillates around a roughly flat MA',
      'Follows a Stage 4 decline — forms near the lows, not the highs',
    ],
    action: 'Watch, don\'t buy yet. Build the list; the buy comes on the Stage 2 breakout.',
  },
  {
    n: 2, name: 'Advancing', tag: 'Markup — BUY', color: 'emerald',
    what: 'Price breaks up out of the base on expanding volume, clears the 30-week MA, and the MA itself turns up. Higher highs and higher lows. This is the only stage Weinstein buys.',
    criteria: [
      'Price trades above a rising 30-week MA',
      'Breakout from the Stage 1 base on a volume surge',
      'Relative strength vs the market positive and rising',
    ],
    action: 'Buy the breakout or the first pullback to the rising MA. Ride it while the MA rises.',
  },
  {
    n: 3, name: 'Topping', tag: 'Distribution', color: 'orange',
    what: 'The advance stalls. Price goes sideways again, but now up near the highs; the 30-week MA rounds over and flattens after having risen. Volatile whipsaws — distribution by the pros.',
    criteria: [
      '30-week MA flattening after a sustained rise',
      'Price churning sideways near the highs, losing momentum',
      'Relative strength rolling over',
    ],
    action: 'Tighten stops / take profits. Do not initiate new longs here.',
  },
  {
    n: 4, name: 'Declining', tag: 'Markdown', color: 'rose',
    what: 'Price breaks down below the trading range and below the 30-week MA, and the MA rolls over to the downside. Lower highs and lower lows — the bear phase.',
    criteria: [
      'Price below a falling 30-week MA',
      'Breakdown from the Stage 3 top',
      'Relative strength weak / negative',
    ],
    action: 'Avoid or short. Wait for a new Stage 1 base to form before caring again.',
  },
]

const CONFIRMATIONS = [
  { title: 'Relative strength (RS rank)', body: 'The stock/SPY ratio vs its own moving average, then ranked 1–99 across the whole liquid universe. A Stage 2 leader should sit high (70+) and be rising — Weinstein\'s demand that you buy genuine leadership, not a name drifting up with the tide.' },
  { title: 'Volume expansion', body: 'The Stage 1→2 breakout must come on a jump in volume (Vol×, today ÷ its 4-week average). A breakout on quiet volume is suspect and often fails back into the base.' },
  { title: 'The 30-week MA is the spine', body: 'One line does the work: is it falling, flat, or rising, and is price above or below it? That single read — slope + side — is what separates the four stages.' },
]

const VIEWS = [
  { key: 'breakouts', label: 'Breakouts (S1→2)', base: true, match: c => c.entering_stage2 || c.breakout_watch },
  { key: 's2', label: 'Stage 2', base: false, match: c => c.stage === 2 },
  { key: 's1', label: 'Stage 1', base: true, match: c => c.stage === 1 },
  { key: 's3', label: 'Stage 3', base: false, match: c => c.stage === 3 },
  { key: 's4', label: 'Stage 4', base: false, match: c => c.stage === 4 },
  { key: 'all', label: 'All', base: false, match: () => true },
]

const STAGE_STYLE = {
  1: { pill: 'bg-amber-500/15 text-amber-300 border-amber-400/30', dot: 'text-amber-400', border: 'border-amber-400/30' },
  2: { pill: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30', dot: 'text-emerald-400', border: 'border-emerald-400/30' },
  3: { pill: 'bg-orange-500/15 text-orange-300 border-orange-400/30', dot: 'text-orange-400', border: 'border-orange-400/30' },
  4: { pill: 'bg-rose-500/15 text-rose-300 border-rose-400/30', dot: 'text-rose-400', border: 'border-rose-400/30' },
}

// -- formatting helpers -----------------------------------------------------
function fmtMoney(n, d = 2) { return n == null || Number.isNaN(n) ? '—' : `$${Number(n).toFixed(d)}` }
function fmtPct(n, d = 1) { return n == null || Number.isNaN(n) ? '—' : `${Number(n) > 0 ? '+' : ''}${Number(n).toFixed(d)}%` }
function fmtNum(n, d = 2) { return n == null || Number.isNaN(n) ? '—' : Number(n).toFixed(d) }
function fmtRelativeAge(iso) {
  if (!iso) return null
  try {
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (sec < 60) return 'just now'
    const min = Math.floor(sec / 60); if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60); if (hr < 24) return `${hr}h ago`
    return null
  } catch { return null }
}

function StageBadge({ stage }) {
  const s = STAGE_STYLE[stage] || STAGE_STYLE[1]
  return <span className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-bold border ${s.pill}`}>S{stage}</span>
}

function qualityColor(q) {
  if (q == null) return 'text-surface-500'
  if (q >= 70) return 'text-emerald-300 font-semibold'
  if (q >= 50) return 'text-emerald-200/80'
  if (q >= 35) return 'text-surface-300'
  return 'text-surface-500'
}

// -- column model: drives header, cells, sorting and CSV --------------------
// value(c) → sortable/exportable scalar; cell(c) → JSX. base:true columns show
// only in the Stage 1 / Breakouts views (where base quality matters).
const COLUMNS = [
  { key: 'quality', label: 'Q', align: 'left', base: false, help: 'Composite quality 0–100: 35% MA-slope trend + 35% RS rank + 15% volume expansion + 15% not-over-extended. One number for "how clean a Stage 2 leader is right now." Click to sort.',
    value: c => c.quality, cell: c => <span className={qualityColor(c.quality)}>{c.quality == null ? '—' : c.quality.toFixed(0)}</span> },
  { key: 'symbol', label: 'Symbol', align: 'left', base: false, help: 'Ticker with its stage badge. ▲ = relative strength rising. ± = borderline stage (MA slope near a threshold). Click the ticker to open Stock Analysis; click the row for the weekly chart.',
    value: c => c.symbol,
    cell: c => (
      <span className="inline-flex items-center gap-1.5">
        <StageBadge stage={c.stage} />
        <span className={c.rs_rising ? 'text-emerald-400' : 'text-surface-600'} title={c.rs_rising ? 'Relative strength rising' : 'RS not rising'}>{c.rs_rising ? '▲' : '·'}</span>
        <TickerLink symbol={c.symbol} className="text-surface-100" onClick={e => e.stopPropagation()} />
        {c.borderline && <span className="text-amber-400/70 text-[10px]" title="Borderline: MA slope sits near a stage threshold — the label is fragile">±</span>}
      </span>
    ) },
  { key: 'signal', label: 'Signal', align: 'left', base: false, help: 'This scanner\'s call: Stage 1→2 breakout (fresh cross above a turning-up MA), Stage 2 advancing, Stage 1 breakout-watch (base coiling under its pivot), or the later stages.',
    value: c => c.signal,
    cell: c => <span className={`whitespace-nowrap ${c.entering_stage2 ? 'text-emerald-300 font-semibold' : c.breakout_watch ? 'text-amber-300' : 'text-surface-400'}`}>{c.signal}</span> },
  { key: 'close', label: 'Close', align: 'right', base: false, help: 'Latest close.', value: c => c.close, cell: c => <span className="text-surface-200">{fmtMoney(c.close)}</span> },
  { key: 'ma', label: '30wk MA', align: 'right', base: false, help: 'The 30-week moving average (150-day SMA proxy) — Weinstein\'s trend spine.', value: c => c.ma, cell: c => <span className="text-surface-400">{fmtMoney(c.ma)}</span> },
  { key: 'pct_vs_ma', label: 'vs MA', align: 'right', base: false, help: 'Percent above (+) or below (−) the 30-week MA.',
    value: c => c.pct_vs_ma, cell: c => <span className={c.pct_vs_ma == null ? 'text-surface-500' : c.pct_vs_ma >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{fmtPct(c.pct_vs_ma)}</span> },
  { key: 'atr_ext', label: 'ATR ext', align: 'right', base: false, help: 'Extension above the MA in ATR (volatility) units — a vol-normalized "how stretched." >6 ATR is over-extended for a fresh entry regardless of the raw %.',
    value: c => c.atr_ext, cell: c => <span className={c.atr_ext == null ? 'text-surface-500' : c.atr_ext > 6 ? 'text-amber-300' : c.atr_ext >= 0 ? 'text-surface-200' : 'text-rose-300/80'}>{c.atr_ext == null ? '—' : `${c.atr_ext.toFixed(1)}×`}</span> },
  { key: 'slope', label: 'Slope', align: 'right', base: false, help: 'Direction of the 30-week MA, as %-per-week. ▲ rising (Stage 2), ▬ flat (Stage 1/3), ▼ falling (Stage 4).',
    value: c => c.ma_slope_per_week, cell: c => (
      c.ma_rising ? <span className="text-emerald-400">▲ {c.ma_slope_per_week?.toFixed(2)}</span>
      : c.ma_falling ? <span className="text-rose-400">▼ {c.ma_slope_per_week?.toFixed(2)}</span>
      : <span className="text-surface-500">▬ {c.ma_slope_per_week?.toFixed(2)}</span>
    ) },
  { key: 'rs_rank', label: 'RS rank', align: 'right', base: false, help: 'Mansfield relative strength vs SPY, ranked 1–99 across the liquid universe. 70+ = market leadership. ▲ next to the ticker = the RS line is rising.',
    value: c => c.rs_rank, cell: c => <span className={c.rs_rank == null ? 'text-surface-500' : c.rs_rank >= 80 ? 'text-emerald-300 font-semibold' : c.rs_rank >= 60 ? 'text-emerald-200/80' : c.rs_rank >= 40 ? 'text-surface-300' : 'text-rose-300/70'}>{c.rs_rank == null ? '—' : c.rs_rank}</span> },
  { key: 'vol_ratio', label: 'Vol×', align: 'right', base: false, help: 'Latest volume ÷ its 4-week average. >1.5× on a breakout = the volume confirmation Weinstein wants.',
    value: c => c.vol_ratio, cell: c => <span className={c.vol_ratio == null ? 'text-surface-500' : c.vol_ratio >= 1.5 ? 'text-emerald-300 font-semibold' : c.vol_ratio >= 1 ? 'text-surface-200' : 'text-surface-500'}>{c.vol_ratio == null ? '—' : `${c.vol_ratio.toFixed(2)}×`}</span> },
  // --- base-quality group (Stage 1 / Breakouts views) ---
  { key: 'base_depth_pct', label: 'Depth', align: 'right', base: true, help: 'Depth of the ~8-week base (high→low, %). Shallower + tighter = a higher-probability base. Huge depths are just wide, sloppy ranges.',
    value: c => c.base_depth_pct, cell: c => <span className={c.base_depth_pct == null ? 'text-surface-500' : c.base_depth_pct <= 15 ? 'text-emerald-300' : c.base_depth_pct <= 30 ? 'text-surface-300' : 'text-surface-500'}>{c.base_depth_pct == null ? '—' : `${c.base_depth_pct.toFixed(0)}%`}</span> },
  { key: 'base_length_weeks', label: 'Base', align: 'right', base: true, help: 'How many weeks price has been contained in its current base. Longer bases build more fuel for the Stage 2 move.',
    value: c => c.base_length_weeks, cell: c => <span className="text-surface-300">{c.base_length_weeks == null ? '—' : `${c.base_length_weeks.toFixed(0)}w`}</span> },
  { key: 'vol_dryup', label: 'Dry', align: 'right', base: true, help: 'Volume dry-up: last-10-day avg volume ÷ the base\'s 40-day avg. <1 (green) means volume is contracting into the base — the classic pre-breakout quiet.',
    value: c => c.vol_dryup, cell: c => <span className={c.vol_dryup == null ? 'text-surface-500' : c.vol_dryup < 0.9 ? 'text-emerald-300' : c.vol_dryup <= 1.2 ? 'text-surface-300' : 'text-surface-500'}>{c.vol_dryup == null ? '—' : `${c.vol_dryup.toFixed(2)}×`}</span> },
  { key: 'pct_to_pivot', label: 'Pivot', align: 'right', base: true, help: 'Distance to the base\'s pivot high — the breakout trigger. −2% means 2% under the level that would launch Stage 2.',
    value: c => c.pct_to_pivot, cell: c => <span className={c.pct_to_pivot != null && c.pct_to_pivot >= -3 && c.pct_to_pivot <= 2 ? 'text-emerald-300 font-semibold' : 'text-surface-400'}>{fmtPct(c.pct_to_pivot)}</span> },
  { key: 'rr', label: 'R:R', align: 'right', base: false, help: 'Reward:risk to a measured-move target (base height projected off the pivot) with a stop under the base low. ≥2 is a healthy asymmetry. Shown as — when the base is too shallow (<4%) or the stop is inside the noise (<0.5 ATR), where the ratio would be meaningless.',
    value: c => c.rr, cell: c => <span className={c.rr == null ? 'text-surface-500' : c.rr >= 2 ? 'text-emerald-300 font-semibold' : c.rr >= 1 ? 'text-surface-300' : 'text-surface-500'}>{c.rr == null ? '—' : `${c.rr.toFixed(1)}`}</span> },
  { key: 'perf_1m', label: '1M', align: 'right', base: false, help: 'Price performance over the last ~1 month.', value: c => c.perf_1m, cell: c => <span className={c.perf_1m >= 0 ? 'text-emerald-200/80' : 'text-rose-200/80'}>{fmtPct(c.perf_1m)}</span> },
  { key: 'perf_3m', label: '3M', align: 'right', base: false, help: 'Price performance over the last ~3 months.', value: c => c.perf_3m, cell: c => <span className={c.perf_3m >= 0 ? 'text-emerald-200/80' : 'text-rose-200/80'}>{fmtPct(c.perf_3m)}</span> },
]

const CSV_FIELDS = ['symbol', 'stage', 'signal', 'quality', 'close', 'ma', 'pct_vs_ma', 'atr', 'atr_ext', 'ma_slope_per_week', 'rs_mansfield', 'rs_rank', 'rs_rising', 'vol_ratio', 'vol_dryup', 'base_depth_pct', 'base_length_weeks', 'pct_to_pivot', 'pivot_high', 'stop', 'risk_pct', 'risk_atr', 'target', 'rr', 'perf_1m', 'perf_3m', 'borderline']

function exportCsv(rows, viewLabel, asOf) {
  const head = CSV_FIELDS.join(',')
  const body = rows.map(r => CSV_FIELDS.map(f => {
    const v = r[f]
    if (v == null) return ''
    return typeof v === 'string' && v.includes(',') ? `"${v}"` : v
  }).join(',')).join('\n')
  const blob = new Blob([`${head}\n${body}\n`], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `stage-analysis_${(viewLabel || 'all').replace(/[^a-z0-9]/gi, '-').toLowerCase()}_${asOf || 'latest'}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function DetailStat({ label, value, hint }) {
  return (
    <div className="rounded-lg bg-surface-950/50 border border-surface-700/40 px-3 py-2" title={hint}>
      <div className="text-[9.5px] uppercase tracking-wider text-surface-500 font-semibold">{label}</div>
      <div className="text-[13px] font-mono text-surface-100 mt-0.5">{value}</div>
    </div>
  )
}

export default function StageAnalysis() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [view, setView] = useState('breakouts')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [sort, setSort] = useState({ key: null, dir: 'desc' })
  const [expanded, setExpanded] = useState(null)

  const load = useCallback(async (force = false) => {
    setLoading(true); setError(null)
    try { setData(await getStageScan({ force })) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load(false) }, [load])

  const candidates = data?.candidates || []
  const counts = data?.counts || {}
  const th = data?.thresholds || {}
  const regime = data?.regime
  const activeView = VIEWS.find(v => v.key === view) || VIEWS[0]

  const viewCounts = useMemo(() => {
    const out = {}
    for (const v of VIEWS) out[v.key] = candidates.filter(v.match).length
    return out
  }, [candidates])

  const visibleColumns = useMemo(
    () => COLUMNS.filter(col => !col.base || activeView.base),
    [activeView],
  )

  const rows = useMemo(() => {
    let out = candidates.filter(activeView.match)
    if (sort.key) {
      const col = COLUMNS.find(c => c.key === sort.key)
      if (col) {
        const mul = sort.dir === 'asc' ? 1 : -1
        out = [...out].sort((a, b) => {
          const av = col.value(a), bv = col.value(b)
          const an = av == null || Number.isNaN(av), bn = bv == null || Number.isNaN(bv)
          if (an && bn) return 0
          if (an) return 1            // nulls always last
          if (bn) return -1
          if (typeof av === 'string') return mul * String(av).localeCompare(String(bv))
          return mul * (av - bv)
        })
      }
    }
    return out
  }, [candidates, activeView, sort])

  const toggleSort = (key) => {
    setSort(s => s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' })
  }
  const changeView = (k) => { setView(k); setExpanded(null) }

  const scanRel = fmtRelativeAge(data?.generated_at)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">Stage Analysis</h1>
          <p className="text-surface-400 text-[13px] mt-1">
            Stan Weinstein's four-stage cycle off the 30-week MA — surfacing Stage 1 bases about to break into Stage 2,
            and the Stage 2 advancers already running. Click a row for the weekly chart.
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-[12px] font-medium hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {loading ? 'Scanning…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-3 text-sm text-red-200">{error}</div>}

      {/* About / criteria panel */}
      <details className="rounded-2xl bg-surface-900/80 border border-surface-700/50" open={aboutOpen} onToggle={e => setAboutOpen(e.currentTarget.open)}>
        <summary className="cursor-pointer list-none px-5 py-3.5 flex items-center justify-between hover:bg-surface-800/40 rounded-2xl transition-colors">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="text-[14px] font-semibold text-surface-100">The four stages — what exactly the criteria is</span>
            <span className="text-[11px] text-surface-500">— Weinstein's cycle, RS &amp; volume</span>
          </div>
          <svg className={`w-4 h-4 text-surface-500 transition-transform ${aboutOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </summary>
        <div className="px-5 pb-5 pt-1 space-y-5 border-t border-surface-700/40">
          <p className="text-[13px] text-surface-300 leading-relaxed pt-3">
            In <span className="text-surface-100 font-semibold">Secrets for Profiting in Bull and Bear Markets</span>, Stan Weinstein
            shows that every stock rotates through the same four stages, read off the <span className="text-surface-100">30-week moving average</span>{' '}
            on the weekly chart. The whole method is one question asked of that line: <em className="text-surface-200">is it falling, flat, or rising —
            and is price above or below it?</em> You want to <span className="text-surface-100">buy Stage 2 and only Stage 2</span>, ideally the moment a Stage 1 base breaks out.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            {STAGES.map(s => (
              <div key={s.n} className={`rounded-xl border p-3.5 bg-surface-950/40 ${STAGE_STYLE[s.n].border}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <StageBadge stage={s.n} />
                  <span className="text-[13px] font-semibold text-surface-100">Stage {s.n} — {s.name}</span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wide ${STAGE_STYLE[s.n].dot}`}>{s.tag}</span>
                </div>
                <div className="text-[11.5px] text-surface-400 leading-relaxed">{s.what}</div>
                <ul className="mt-2 space-y-0.5">
                  {s.criteria.map((c, i) => <li key={i} className="text-[11px] text-surface-300 flex gap-1.5"><span className={STAGE_STYLE[s.n].dot}>•</span><span>{c}</span></li>)}
                </ul>
                <div className="mt-2 text-[11px] text-surface-200"><span className="text-surface-500 font-semibold">What to do: </span>{s.action}</div>
              </div>
            ))}
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">The two confirmations</div>
            <div className="grid sm:grid-cols-3 gap-2">
              {CONFIRMATIONS.map(c => (
                <div key={c.title} className="rounded-lg bg-surface-950/40 border border-surface-700/40 p-3">
                  <div className="text-[12px] font-semibold text-surface-100">{c.title}</div>
                  <div className="text-[11px] text-surface-400 mt-1 leading-relaxed">{c.body}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg bg-emerald-500/5 border border-emerald-400/20 p-3">
            <div className="text-[11px] uppercase tracking-wider text-emerald-300/80 font-semibold mb-1">How this scanner maps to the book</div>
            <div className="text-[12px] text-emerald-100/80 leading-relaxed">
              Weekly charts and their 30-week MA ≈ a <span className="font-semibold">150-day SMA</span> on daily bars, so the scanner runs off the daily
              market cache (no extra data pulls). It reads the MA's slope (rising / flat / falling) and price's side of it to assign the stage, then adds
              a cross-sectional RS rank, an ATR-normalized extension, a stop-under-the-base risk model and base-quality stats. A fresh cross above a
              turning-up MA is tagged <span className="font-semibold">Stage 1→2 breakout</span>; a base coiling under its pivot is <span className="font-semibold">Stage 1 breakout-watch</span>.
            </div>
          </div>
          <div className="text-[10px] text-surface-600">Reference: Stan Weinstein, "Secrets for Profiting in Bull and Bear Markets" (1988). A systematic approximation of a discretionary chart method — always confirm on the weekly chart.</div>
        </div>
      </details>

      {/* Regime read */}
      {regime && !data?.error && (
        <div className={`rounded-xl border px-4 py-2.5 flex items-center gap-3 ${
          regime.tone === 'bull' ? 'bg-emerald-500/5 border-emerald-400/25'
          : regime.tone === 'bear' ? 'bg-rose-500/5 border-rose-400/25'
          : 'bg-surface-900/80 border-surface-700/50'
        }`}>
          <span className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
            regime.tone === 'bull' ? 'bg-emerald-500/15 text-emerald-300'
            : regime.tone === 'bear' ? 'bg-rose-500/15 text-rose-300'
            : 'bg-surface-700/40 text-surface-300'
          }`}>{regime.label}</span>
          <span className="text-[12px] text-surface-300">{regime.note}</span>
        </div>
      )}

      {/* Market-wide stage distribution */}
      {data && !data.error && (
        <div>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold">Market stage distribution</div>
            <div className="text-[10.5px] text-surface-500 flex items-center gap-2">
              {th.ma_approx && (
                <span className="text-[9px] font-bold tracking-wider text-amber-300 bg-amber-500/15 border border-amber-400/30 rounded px-1.5 py-px uppercase cursor-help"
                  title={`Cache holds ${th.days_available} trading days — using a ${th.ma_weeks}-week MA instead of the full 30-week. Backfill a bigger lookback in Market Monitor → Refresh (e.g. 260 days) for the full 30-week MA.`}>
                  {th.ma_weeks}-wk MA (approx)
                </span>
              )}
              <span title={`Scan ran ${data.generated_at || ''}${data.from_cache ? ' (served from cache)' : ''}`}>
                {counts.classified?.toLocaleString?.()} names · {data.as_of}{scanRel ? ` · ${scanRel}` : ''}{data.from_cache ? ' · cached' : ''}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {STAGES.map(s => {
              const total = counts[`stage${s.n}`] || 0
              const extra = s.n === 2 ? counts.entering_stage2 : s.n === 1 ? counts.breakout_watch : null
              const extraLabel = s.n === 2 ? 'entering' : s.n === 1 ? 'breakout-watch' : null
              return (
                <div key={s.n} className="rounded-xl border border-surface-700/50 p-3 bg-surface-900/80">
                  <div className="flex items-center gap-1.5"><StageBadge stage={s.n} /><div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">{s.name}</div></div>
                  <div className={`mt-1 text-[18px] font-mono font-semibold tabular-nums ${STAGE_STYLE[s.n].dot}`}>{total.toLocaleString()}</div>
                  {extra != null && <div className="text-[10px] text-surface-500 mt-0.5"><span className="text-surface-300 font-semibold">{extra}</span> {extraLabel}</div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* View chips + export */}
      {data && !data.error && (
        <div className="flex items-center gap-2 flex-wrap">
          {VIEWS.map(v => (
            <button key={v.key} onClick={() => changeView(v.key)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition ${view === v.key ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-surface-900/80 border-surface-700/50 text-surface-300 hover:text-surface-100'}`}>
              {v.label}<span className="ml-1.5 text-[10px] opacity-70 font-mono">{viewCounts[v.key] ?? 0}</span>
            </button>
          ))}
          <div className="flex-1" />
          <button onClick={() => exportCsv(rows, activeView.label, data.as_of)} disabled={!rows.length}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium border bg-surface-900/80 border-surface-700/50 text-surface-300 hover:text-surface-100 disabled:opacity-40 inline-flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" /></svg>
            CSV
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="rounded-2xl bg-surface-900/60 border border-surface-700/40 p-12 text-center">
          <div className="inline-flex items-center gap-2 text-surface-300">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
            Classifying stages…
          </div>
        </div>
      )}

      {/* Error / empty */}
      {data?.error && !loading && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 border-dashed p-10 text-center">
          <p className="text-surface-100 font-semibold text-base">Can't run the stage scan yet</p>
          <p className="text-surface-500 text-sm mt-2 max-w-md mx-auto">{data.error}</p>
        </div>
      )}
      {data && !data.error && rows.length === 0 && !loading && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 border-dashed p-10 text-center">
          <p className="text-surface-100 font-semibold text-base">Nothing in this view</p>
          <p className="text-surface-500 text-sm mt-2 max-w-md mx-auto">No names match “{activeView.label}” right now. Try another stage above.</p>
        </div>
      )}

      {/* Table */}
      {data && !data.error && rows.length > 0 && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-[12px]">
              <thead className="bg-surface-950/50 text-[10px] uppercase tracking-wide text-surface-500">
                <tr>
                  <th className="w-6 px-2 py-2" />
                  {visibleColumns.map(col => (
                    <th key={col.key} title={col.help} aria-label={`${col.label}: ${col.help}`}
                      onClick={() => toggleSort(col.key)}
                      className={`px-3 py-2 font-semibold whitespace-nowrap cursor-pointer select-none hover:text-surface-300 ${col.align === 'right' ? 'text-right' : 'text-left'} ${sort.key === col.key ? 'text-accent' : ''}`}>
                      {col.label}{sort.key === col.key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono">
                {rows.map(c => {
                  const isOpen = expanded === c.symbol
                  return (
                    <Fragment key={c.symbol}>
                      <tr onClick={() => setExpanded(isOpen ? null : c.symbol)}
                        className={`border-t border-surface-800/60 cursor-pointer ${isOpen ? 'bg-surface-800/40' : 'hover:bg-surface-800/30'}`}>
                        <td className="px-2 py-2 text-surface-500">
                          <svg className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-90 text-accent' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        </td>
                        {visibleColumns.map(col => (
                          <td key={col.key} className={`px-3 py-2 ${col.align === 'right' ? 'text-right' : 'text-left'} ${col.key === 'symbol' ? 'font-semibold' : ''}`}>
                            {col.cell(c)}
                          </td>
                        ))}
                      </tr>
                      {isOpen && (
                        <tr className="bg-surface-950/40 border-t border-surface-800/60">
                          <td colSpan={visibleColumns.length + 1} className="px-4 py-4">
                            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-3">
                              <DetailStat label="Signal" value={c.signal} />
                              <DetailStat label="Quality" value={c.quality == null ? '—' : c.quality.toFixed(0)} hint="Composite 0–100" />
                              <DetailStat label="Stop (base low)" value={fmtMoney(c.stop)} hint="Weinstein stop just under the base" />
                              <DetailStat label="Risk" value={c.risk_pct == null ? '—' : `${c.risk_pct.toFixed(1)}% · ${c.risk_atr == null ? '—' : c.risk_atr.toFixed(1) + ' ATR'}`} hint="Close→stop distance, % and in ATR units" />
                              <DetailStat label="Target (meas. move)" value={fmtMoney(c.target)} hint="Pivot + base height" />
                              <DetailStat label="R:R" value={c.rr == null ? '—' : c.rr.toFixed(1)} hint="Reward:risk to the measured-move target" />
                            </div>
                            <TradingViewChart symbol={c.symbol} height={460} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && !data.error && rows.length > 0 && (
        <div className="text-[10.5px] text-surface-500 flex items-center gap-2 px-1">
          <svg className="w-3 h-3 text-surface-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span>Click a header to sort, a row to open its weekly chart. Hover a header for what it means. Table shows the strongest ~200 names per stage of {counts.classified?.toLocaleString?.()} classified.</span>
        </div>
      )}
    </div>
  )
}
