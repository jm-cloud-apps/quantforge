import { useCallback, useEffect, useMemo, useState } from 'react'
import { get9MScan } from '../api/scanner9m'

// ---------------------------------------------------------------------------
// "$9 Million Method" scanner — Stockbee framework summary.
// Source: https://breakoutshappen.com/stock-news/ep9-million-method-how-the-stockbee-framework-works
// ---------------------------------------------------------------------------

const RULES = [
  {
    title: 'Volume ≥ 9M shares',
    body: 'The "9M" of the method. Filters ~12,000 US tickers down to the top ~2% by daily volume — these are the names with institutional participation, not retail noise.',
  },
  {
    title: 'Price ≥ $3.00',
    body: 'Penny-stock patterns collapse below this. Cleanly removes low-quality names where the breakout signal is unreliable.',
  },
  {
    title: 'Daily Closing Range ≥ 70%',
    body: 'DCR = (close − low) ÷ (high − low). Close in the upper 30% of the day\'s range means buyers controlled the session into the close.',
  },
  {
    title: 'Green bar (close > open)',
    body: 'Entry is same-day on a green candle — no chasing lows or waiting for pullbacks. The candle is the trigger.',
  },
  {
    title: 'Range expansion ≥ 1.5× prior 20d',
    body: 'Today\'s range visibly wider than the recent average. Range expansion is the institutional signature — it\'s when the size shows up.',
  },
  {
    title: 'Emerging from compression (soft)',
    body: 'Prior 5-day range ≤ 70% of prior 20-day range. The setup wants "silence then expansion," not late continuation. Surfaced as a column; toggle the gate to require it.',
  },
  {
    title: 'Not late in move (soft)',
    body: 'Close 3 days ago below today\'s low — i.e., the expansion really started today, not 3 days ago. Stockbee: "if the stock is already 3+ days into a move, do not enter."',
  },
]

const CATEGORIES = [
  {
    name: 'CATS',
    color: 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10',
    summary: 'Real catalyst + fundamentals',
    expected: '20–50%',
    stop: '2.5%',
    size: '25–50% account',
    risk: '1–2.5% equity',
    detail: 'Earnings beat, FDA approval, contract win, product launch. Tight stop because the fundamental floor is real.',
  },
  {
    name: 'Liquid Lava',
    color: 'text-cyan-300 border-cyan-400/40 bg-cyan-500/10',
    summary: 'Mega-cap institutional move',
    expected: '5–15%',
    stop: '2.5%',
    size: '25–100% account',
    risk: '1–2.5% equity',
    detail: '9M+ vol, 2500+ fund holders. Cleanest setups — limited downside, biggest size, smallest expected move.',
  },
  {
    name: 'DOGS',
    color: 'text-amber-300 border-amber-400/40 bg-amber-500/10',
    summary: 'Narrative-only (hype, squeeze)',
    expected: '40–100%+',
    stop: '8–10%',
    size: '5–10% account',
    risk: '1–2.5% equity',
    detail: 'AI hype, biotech moonshots, viral retail names. Wide stop because the floor is psychological, not fundamental.',
  },
]

const EXITS = [
  { phase: 'Day 1',  rule: 'Hold to close unless intraday target hit (then partial)' },
  { phase: 'Day 2–3', rule: 'No follow-through → exit complete' },
  { phase: 'Day 4+', rule: 'Trail 0.5–1% below prior day\'s low' },
  { phase: 'Calendar', rule: 'Close at 3–5 days OR +40% cumulative gain, whichever first' },
]

// Column glossary — hover-text shown on each table header. Same explanation
// the user gets in the "About this method" panel, surfaced where they're
// actually looking when scanning the table. Lifted nearly verbatim from the
// RULES array so the two stay in sync without a refactor of the data model.
const COLUMN_HELP = {
  Symbol:    'Ticker symbol. Click to open the chart.',
  Bucket:    'Auto-classification. Liquid Lava = vol ≥ 20M AND $-vol ≥ $300M (mega-cap institutional). Review = needs you to read the news/chart and decide CATS vs DOGS.',
  Close:     'Today\'s closing price.',
  Vol:       'Today\'s share volume. Must be ≥ 9,000,000 to be in the scan at all — that\'s the "9M" floor.',
  '$ Vol':   'Dollar volume traded today (Close × Volume). The institutional-participation gate; helps separate Liquid Lava from speculative low-priced volume.',
  DCR:       'Daily Closing Range = (Close − Low) ÷ (High − Low). 70%+ means the bar closed in the upper 30% of the day\'s range — buyers controlled into the close. 90%+ is a true demand bar.',
  'Exp×':    'Range expansion multiple. Today\'s High − Low vs. the average range of the prior 20 days. ≥ 1.5× passes the trigger; ≥ 3× is the institutional signature.',
  Compr:    'Compression ratio. Prior 5-day range ÷ prior 20-day range. ≤ 0.70 means the stock was "quiet" before today — silence then expansion is the textbook EP shape. Toggle the gate above to require it.',
  'Not late': 'Did the move actually start TODAY? Close 3 days ago should be below today\'s low. ✓ = clean, ⚠ = stock is already 3+ days into the move (Stockbee: do not enter).',
  Range:    'Today\'s dollar range (High − Low). Combine with Close to size your stop — a $2 range on a $40 stock needs a wider stop than a $2 range on a $200 stock.',
}

// Compact relative-time string for the freshness indicator: "2m ago",
// "1h ago", "yesterday". Older than a day → return null so the caller can
// decide to show the full date instead (different formatting).
function fmtRelativeAge(iso) {
  if (!iso) return null
  try {
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return null
    const diffMs = Date.now() - then
    if (diffMs < 0) return 'just now'
    const sec = Math.floor(diffMs / 1000)
    if (sec < 60) return 'just now'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    return null
  } catch {
    return null
  }
}

// Stockbee scans on EOD bars, but stale scan data is still misleading if it's
// hours old — the trader needs to know whether they're looking at "today's
// candle" or last week's. 90 min after generation we flag it.
const STALE_AFTER_MIN = 90

function isScanStale(iso) {
  if (!iso) return false
  try {
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return false
    return (Date.now() - then) / 60000 > STALE_AFTER_MIN
  } catch {
    return false
  }
}

function fmtInt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return Number(n).toLocaleString('en-US')
}
function fmtMoney(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `$${Number(n).toFixed(digits)}`
}
function fmtCompactDollars(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const v = Math.abs(Number(n))
  if (v >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${Number(n).toFixed(0)}`
}

const BUCKET_TONE = {
  liquid_lava: 'bg-cyan-500/10 text-cyan-200 border-cyan-400/30',
  review:      'bg-amber-500/10 text-amber-200 border-amber-400/30',
}
const BUCKET_LABEL = {
  liquid_lava: 'Liquid Lava',
  review:      'Review · classify',
}

export default function Scanner9M() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [requireCompression, setRequireCompression] = useState(false)
  const [requireNotLate, setRequireNotLate] = useState(false)
  const [bucketFilter, setBucketFilter] = useState('all')
  const [aboutOpen, setAboutOpen] = useState(false)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await get9MScan({ requireCompression, requireNotLate, force })
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [requireCompression, requireNotLate])

  useEffect(() => { load(false) }, [load])

  const filtered = useMemo(() => {
    if (!data?.candidates) return []
    if (bucketFilter === 'all') return data.candidates
    return data.candidates.filter(c => c.bucket === bucketFilter)
  }, [data, bucketFilter])

  const bucketCounts = useMemo(() => {
    const counts = { all: 0, liquid_lava: 0, review: 0 }
    for (const c of data?.candidates || []) {
      counts.all += 1
      counts[c.bucket] = (counts[c.bucket] || 0) + 1
    }
    return counts
  }, [data])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">
            $9 Million Method
          </h1>
          <p className="text-surface-400 text-[13px] mt-1">
            Stockbee's volume-filtered breakout scanner. Trades the candle, sizes by catalyst.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-900/80 border border-surface-700/50 text-[12px] text-surface-300 cursor-pointer hover:text-surface-100">
            <input
              type="checkbox"
              checked={requireCompression}
              onChange={(e) => setRequireCompression(e.target.checked)}
              className="accent-accent"
            />
            Require compression
          </label>
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-900/80 border border-surface-700/50 text-[12px] text-surface-300 cursor-pointer hover:text-surface-100">
            <input
              type="checkbox"
              checked={requireNotLate}
              onChange={(e) => setRequireNotLate(e.target.checked)}
              className="accent-accent"
            />
            Require not-late
          </label>
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent text-[12px] font-medium hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loading ? 'Scanning…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-400/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* About / explanation panel */}
      <details
        className="rounded-2xl bg-surface-900/80 border border-surface-700/50"
        open={aboutOpen}
        onToggle={(e) => setAboutOpen(e.currentTarget.open)}
      >
        <summary className="cursor-pointer list-none px-5 py-3.5 flex items-center justify-between hover:bg-surface-800/40 rounded-2xl transition-colors">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[14px] font-semibold text-surface-100">About this method</span>
            <span className="text-[11px] text-surface-500">— rules, classification, exits</span>
          </div>
          <svg className={`w-4 h-4 text-surface-500 transition-transform ${aboutOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="px-5 pb-5 pt-1 space-y-5 border-t border-surface-700/40">
          <p className="text-[13px] text-surface-300 leading-relaxed pt-3">
            The <span className="text-surface-100 font-semibold">$9 Million Method</span> is a swing-trading framework
            for 2–5 week holds, attributed to <span className="text-surface-100">Stockbee (Pradeep Bonde)</span>. It strips
            ~12,000 US tickers down to <span className="text-surface-100">3–10 daily candidates</span> using three
            filters: a hard volume floor (≥9M shares), a range-expansion trigger candle, and a position-sizing rule
            keyed to the underlying catalyst quality. Stockbee's claim:{' '}
            <em className="text-surface-200">"The edge is not prediction — it is filtration."</em>
          </p>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">
              Entry rules (this scanner)
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {RULES.map(r => (
                <div key={r.title} className="rounded-lg bg-surface-950/40 border border-surface-700/40 p-3">
                  <div className="text-[12px] font-semibold text-surface-100">{r.title}</div>
                  <div className="text-[11px] text-surface-400 mt-1 leading-relaxed">{r.body}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">
              Position sizing by catalyst category
            </div>
            <div className="grid md:grid-cols-3 gap-2">
              {CATEGORIES.map(c => (
                <div key={c.name} className={`rounded-lg border p-3 ${c.color}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-[13px] font-semibold">{c.name}</div>
                    <div className="text-[10px] uppercase tracking-wider opacity-70">{c.summary}</div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <div className="opacity-70">Expected</div><div className="font-mono">{c.expected}</div>
                    <div className="opacity-70">Stop</div><div className="font-mono">{c.stop}</div>
                    <div className="opacity-70">Size</div><div className="font-mono">{c.size}</div>
                    <div className="opacity-70">Risk</div><div className="font-mono">{c.risk}</div>
                  </div>
                  <div className="text-[11px] mt-2 leading-relaxed opacity-80">{c.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">
              Exits
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {EXITS.map(e => (
                <div key={e.phase} className="rounded-lg bg-surface-950/40 border border-surface-700/40 px-3 py-2 flex items-center justify-between gap-3">
                  <div className="text-[12px] font-semibold text-surface-100 shrink-0">{e.phase}</div>
                  <div className="text-[12px] text-surface-300 text-right">{e.rule}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg bg-amber-500/5 border border-amber-400/20 p-3">
            <div className="text-[11px] uppercase tracking-wider text-amber-300/80 font-semibold mb-1">
              Note on classification
            </div>
            <div className="text-[12px] text-amber-100/80 leading-relaxed">
              Without fund-holders data we cannot cleanly split <span className="font-semibold">CATS</span> vs{' '}
              <span className="font-semibold">DOGS</span> in code — only{' '}
              <span className="font-semibold">Liquid Lava</span> (mega-cap institutional, vol ≥ 20M AND dollar-vol ≥ $300M)
              is auto-tagged. The rest are marked <span className="font-semibold">Review · classify</span> for the trader
              to read the news + chart and decide. This matches Stockbee&apos;s own workflow:{' '}
              <em>"The volume tells you if to enter, the story tells you how much to risk."</em>
            </div>
          </div>

          <div className="text-[10px] text-surface-600">
            Source: breakoutshappen.com / Stockbee framework
          </div>
        </div>
      </details>

      {/* Scan meta + counts */}
      {data && (() => {
        const stale = isScanStale(data.generated_at)
        const scanTime = data.generated_at
          ? new Date(data.generated_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
          : null
        const scanRel = fmtRelativeAge(data.generated_at)
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div
              className={`rounded-xl border p-3 ${
                stale ? 'bg-amber-500/5 border-amber-400/30' : 'bg-surface-900/80 border-surface-700/50'
              }`}
              title={data.generated_at ? `Scan ran ${data.generated_at.replace('T', ' ')}${data.from_cache ? ' (served from cache)' : ''}` : ''}
            >
              <div className="flex items-center gap-1.5">
                <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Scanned</div>
                {stale && (
                  <span className="text-[9px] font-bold tracking-wider text-amber-300 bg-amber-500/15 border border-amber-400/30 rounded px-1 py-px uppercase">
                    Stale
                  </span>
                )}
                {data.from_cache && !stale && (
                  <span className="text-[9px] font-mono text-surface-600 lowercase">cached</span>
                )}
              </div>
              <div className={`mt-1 text-[15px] font-mono font-semibold tabular-nums ${stale ? 'text-amber-200' : 'text-surface-100'}`}>
                {scanTime || data.as_of || '—'}
              </div>
              <div className={`text-[10px] mt-0.5 ${stale ? 'text-amber-300/80' : 'text-surface-500'}`}>
                {scanRel ? `${scanRel} · ${data.as_of || ''}` : (data.as_of || '')}
              </div>
            </div>
            <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-3" title="Total US tickers considered before any filter.">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Universe</div>
              <div className="mt-1 text-[15px] font-mono font-semibold text-surface-100">{fmtInt(data.counts?.universe)}</div>
            </div>
            <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-3" title="Tickers that passed the hard volume + price floor (Vol ≥ 9M AND Close ≥ $3).">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">≥ 9M vol + $3</div>
              <div className="mt-1 text-[15px] font-mono font-semibold text-surface-100">{fmtInt(data.counts?.passed_volume)}</div>
            </div>
            <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-3" title="Tickers that cleared every rule and reached the candidate table.">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Setups</div>
              <div className="mt-1 text-[15px] font-mono font-semibold text-accent">{fmtInt(data.counts?.passed_all)}</div>
            </div>
          </div>
        )
      })()}

      {/* Bucket filter */}
      {data?.candidates && data.candidates.length > 0 && (
        <div className="inline-flex rounded-lg bg-surface-900/80 border border-surface-700/50 p-0.5">
          {[
            { id: 'all',         label: 'All' },
            { id: 'liquid_lava', label: 'Liquid Lava' },
            { id: 'review',      label: 'Review' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setBucketFilter(t.id)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                bucketFilter === t.id ? 'bg-accent/15 text-accent' : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              {t.label} <span className="opacity-60">· {bucketCounts[t.id] || 0}</span>
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="rounded-2xl bg-surface-900/60 border border-surface-700/40 p-12 text-center">
          <div className="inline-flex items-center gap-2 text-surface-300">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Scanning the universe…
          </div>
        </div>
      )}

      {/* Empty state */}
      {data && filtered.length === 0 && !loading && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 border-dashed p-10 text-center">
          <p className="text-surface-100 font-semibold text-base">No setups match these filters</p>
          <p className="text-surface-500 text-sm mt-2 max-w-md mx-auto">
            {data.error
              ? data.error
              : 'Some days legitimately produce zero — that\'s the method working. Try toggling off the strict gates above, or come back at the next refresh.'}
          </p>
        </div>
      )}

      {/* Candidates table */}
      {data && filtered.length > 0 && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-[12px]">
              <thead className="bg-surface-950/50 text-[10px] uppercase tracking-wide text-surface-500">
                <tr>
                  {['Symbol', 'Bucket', 'Close', 'Vol', '$ Vol', 'DCR', 'Exp×', 'Compr', 'Not late', 'Range'].map(h => {
                    const help = COLUMN_HELP[h]
                    return (
                      <th
                        key={h}
                        title={help}
                        aria-label={help ? `${h}: ${help}` : h}
                        className={`px-3 py-2 text-left font-semibold whitespace-nowrap ${
                          help ? 'cursor-help underline decoration-dotted decoration-surface-600 underline-offset-[3px] hover:text-surface-300' : ''
                        }`}
                      >
                        {h}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="font-mono">
                {filtered.map(c => (
                  <tr key={c.symbol} className="border-t border-surface-800/60 hover:bg-surface-800/30">
                    <td className="px-3 py-2 font-semibold text-surface-100">{c.symbol}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider border ${BUCKET_TONE[c.bucket] || ''}`}>
                        {BUCKET_LABEL[c.bucket] || c.bucket}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-surface-200">{fmtMoney(c.close)}</td>
                    <td className="px-3 py-2 text-surface-300">{fmtInt(c.volume)}</td>
                    <td className="px-3 py-2 text-surface-400">{fmtCompactDollars(c.dollar_volume)}</td>
                    <td className={`px-3 py-2 ${c.dcr_pct >= 90 ? 'text-emerald-300 font-semibold' : c.dcr_pct >= 80 ? 'text-emerald-200' : 'text-surface-200'}`}>
                      {c.dcr_pct?.toFixed(1)}%
                    </td>
                    <td className={`px-3 py-2 ${c.expansion_mult >= 3 ? 'text-amber-300 font-semibold' : 'text-surface-200'}`}>
                      {c.expansion_mult?.toFixed(2)}×
                    </td>
                    <td className={`px-3 py-2 ${c.is_compressed ? 'text-emerald-300' : 'text-surface-500'}`}>
                      {c.compression_ratio?.toFixed(2) ?? '—'}
                    </td>
                    <td className={`px-3 py-2 ${c.not_late ? 'text-emerald-300' : 'text-red-300'}`}>
                      {c.not_late ? '✓' : '⚠'}
                    </td>
                    <td className="px-3 py-2 text-surface-400">{fmtMoney(c.range_today)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data?.candidates?.length > 0 && (
        <div className="text-[10.5px] text-surface-500 flex items-center gap-2 px-1">
          <svg className="w-3 h-3 text-surface-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Hover any column header for what it means.</span>
        </div>
      )}
    </div>
  )
}
