import { useCallback, useEffect, useState } from 'react'
import { getParabolicScan } from '../api/parabolic'
import TickerLink from '../components/TickerLink'
import RefreshControl from '../components/RefreshControl'
import { fmtInt, fmtMoney, fmtCompactDollars, fmtRelativeAge, isScanStale } from '../utils/format'

// ---------------------------------------------------------------------------
// "Parabolic Short" scanner — Qullamaggie's over-extension / snap-back setup.
// Source: https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/
//
//   1. Up 50-100%+ (larger cap) / 300-1000%+ (smaller cap) in days-to-weeks.
//   2. Up 3-5+ days in a row — trends higher then starts speeding up.
//
// "Stocks are rubber bands: stretched short term, they snap back hard." This is
// a SHORT (fade the exhaustion) — the riskiest of the three setups if you don't
// obey stops. The scanner surfaces the over-extended candidates; you still wait
// for the crack (first red day / loss of the day's low) before shorting.
// ---------------------------------------------------------------------------

const RULES = [
  {
    title: 'Run-up 50-100%+ / 300-1000%+',
    body: 'A big move to fade: gain from the run-window low into today. Larger caps run 50-100%+, small caps 300-1000%+ — the scan applies a cap-tiered bar (see below).',
  },
  {
    title: 'Up 3-5+ days in a row',
    body: 'Today caps a streak of consecutive higher closes. A parabola prints new highs day after day; the first down-close is the crack you\'re waiting for.',
  },
  {
    title: 'Cap tier by price (proxy)',
    body: 'The daily cache has no market cap, so price stands in for size: names ≥ $20 use the large-cap gain bar (50%), cheaper names the small-cap bar (100%). Both are the defaults and adjustable server-side.',
  },
  {
    title: 'Liquidity floor',
    body: 'Close ≥ $3 and dollar volume ≥ $3M — the name has to be tradable/shortable, not a no-borrow micro-print.',
  },
  {
    title: 'Extended ≥ 20% above the 10-day (soft)',
    body: 'The classic "rubber band" stretch — close 20%+ above the 10-day MA. Surfaced as a column; toggle the gate above to require it.',
  },
  {
    title: 'Accelerating (soft)',
    body: 'Today\'s 1-day gain is the biggest of the whole run — the "starts speeding up / explodes" tell of a parabola steepening. Toggle the gate to require it.',
  },
]

const ENTRY = [
  { phase: 'Never chase', rule: 'The scan finds candidates, not entries — do NOT short a stock still going up' },
  { phase: 'Wait for the crack', rule: 'First red day, or a break of the prior day\'s low / the low of the day' },
  { phase: 'Size for risk', rule: 'Riskiest of the 3 setups — smaller size, and only if you obey stops' },
]

const EXITS = [
  { phase: 'Hard stop', rule: 'Above the pivot / recent high — a new high says the parabola isn\'t done' },
  { phase: 'Cover into flush', rule: 'Snap-backs are fast — take profits into the first hard down move' },
  { phase: 'Trail the rest', rule: 'Below each lower high / the declining 10-day as it rolls over' },
  { phase: 'It keeps ripping', rule: 'Stopped out → stand aside. Do not re-short a strong stock into strength' },
]

const COLUMN_HELP = {
  Symbol:   'Ticker symbol. Click to open Stock Analysis. ⚡ marks an accelerating parabola (biggest 1-day gain of the run is today).',
  Close:    'Latest closing price.',
  Tier:     'Cap tier by price proxy: "lg" ≥ $20 (50% gain bar), "sm" < $20 (100% gain bar). No market-cap data in the daily cache, so price stands in for size.',
  'Gain%':  'Run-up being faded: from the run-window (~20 session) low into today\'s close. Green = cleared its cap-tier bar comfortably.',
  '5d%':    'Close-to-close move over the last 5 sessions — the "up 50-100% in a few days" leg.',
  'Up d':   'Consecutive higher-closing sessions into today. 3-5+ is the setup; more = more stretched.',
  'Ext%':   '% above the 10-day MA — how far the rubber band is stretched. Bold ≥ 20% (the classic parabolic stretch).',
  'Fade%':  'How far the close sits below today\'s high. A big fade = an intraday reversal already starting (the crack).',
  '$ Vol':  'Dollar volume traded today (Close × Volume). Must be ≥ $3M to be shortable.',
  Stop:     'Reference short stop: today\'s high. A print back above it says the parabola isn\'t done — cover.',
  'Risk%':  'Distance from the close up to the stop (today\'s high): (High − Close) ÷ Close. Your risk if you shorted at the close.',
}

function fmtPct(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${Number(n).toFixed(digits)}%`
}

export default function ParabolicShort() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [requireExtended, setRequireExtended] = useState(false)
  const [requireAccelerating, setRequireAccelerating] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await getParabolicScan({ requireExtended, requireAccelerating, force })
      setData(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [requireExtended, requireAccelerating])

  useEffect(() => { load(false) }, [load])

  const candidates = data?.candidates || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">
            Parabolic Short
          </h1>
          <p className="text-surface-400 text-[13px] mt-1">
            Qullamaggie's over-extension fade — stretched "rubber bands" (up 50-100%+ / 300-1000%+ and 3-5+ days in a row) set up for a powerful snap-back.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-900/80 border border-surface-700/50 text-[12px] text-surface-300 cursor-pointer hover:text-surface-100">
            <input
              type="checkbox"
              checked={requireExtended}
              onChange={(e) => setRequireExtended(e.target.checked)}
              className="accent-rose-400"
            />
            Require extended
          </label>
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-900/80 border border-surface-700/50 text-[12px] text-surface-300 cursor-pointer hover:text-surface-100">
            <input
              type="checkbox"
              checked={requireAccelerating}
              onChange={(e) => setRequireAccelerating(e.target.checked)}
              className="accent-rose-400"
            />
            Require accelerating
          </label>
          <RefreshControl jobId="parabolic-short" onRefresh={() => load(true)} refreshing={loading} busyLabel="Scanning…" />
        </div>
      </div>

      {/* Risk banner — this is the dangerous one */}
      <div className="rounded-xl bg-rose-500/10 border border-rose-400/30 px-4 py-2.5 flex items-start gap-2.5">
        <svg className="w-4 h-4 mt-px shrink-0 text-rose-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <p className="text-[12px] text-rose-100/90 leading-snug">
          <span className="font-semibold text-rose-200">Riskiest setup.</span> This is a list of candidates, not entries —
          never short a stock that's still going up. Wait for the crack (first red day / loss of the low of the day),
          keep the stop above the high, and size small. Shorts have unlimited risk; obey the stop.
        </p>
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
            <svg className="w-4 h-4 text-rose-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[14px] font-semibold text-surface-100">About this setup</span>
            <span className="text-[11px] text-surface-500">— rules, entry timing, exits</span>
          </div>
          <svg className={`w-4 h-4 text-surface-500 transition-transform ${aboutOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="px-5 pb-5 pt-1 space-y-5 border-t border-surface-700/40">
          <p className="text-[13px] text-surface-300 leading-relaxed pt-3">
            The <span className="text-surface-100 font-semibold">Parabolic Short</span> fades over-extension:{' '}
            <em className="text-surface-200">"think of stocks as rubber bands — if they get really stretched short term,
            they can have powerful snapbacks."</em> You short the exhaustion of a vertical move once it cracks, with a hard
            stop above the high, because the snap-back is fast. Qullamaggie calls this{' '}
            <span className="text-surface-100">by far the riskiest setup if done wrong or if you have issues obeying your
            stops</span>. Attributed to <span className="text-surface-100">Kristjan Kullamägi (Qullamaggie)</span>.
          </p>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">
              Scan rules (this scanner)
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

          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">
                Entry
              </div>
              <div className="space-y-2">
                {ENTRY.map(e => (
                  <div key={e.phase} className="rounded-lg bg-surface-950/40 border border-surface-700/40 px-3 py-2 flex items-center justify-between gap-3">
                    <div className="text-[12px] font-semibold text-surface-100 shrink-0">{e.phase}</div>
                    <div className="text-[12px] text-surface-300 text-right">{e.rule}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-surface-500 font-semibold mb-2">
                Exits
              </div>
              <div className="space-y-2">
                {EXITS.map(e => (
                  <div key={e.phase} className="rounded-lg bg-surface-950/40 border border-surface-700/40 px-3 py-2 flex items-center justify-between gap-3">
                    <div className="text-[12px] font-semibold text-surface-100 shrink-0">{e.phase}</div>
                    <div className="text-[12px] text-surface-300 text-right">{e.rule}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-rose-500/5 border border-rose-400/20 p-3">
            <div className="text-[11px] uppercase tracking-wider text-rose-300/80 font-semibold mb-1">
              Why it works
            </div>
            <div className="text-[12px] text-rose-100/80 leading-relaxed">
              A parabola is buying that has outrun any reasonable value — the last buyers are the most emotional, and there's
              no one left to pay up. When it cracks, longs and momentum-chasers exit at once and the "rubber band" snaps back
              to the mean fast. The edge is <span className="font-semibold">the crack + the hard stop</span>: you only risk a
              little above the high, and the snap-back pays multiples of that when the timing is right.
            </div>
          </div>

          <div className="text-[10px] text-surface-600">
            Source: qullamaggie.com — "My 3 timeless setups that have made me tens of millions"
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
            <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-3" title="Tickers that passed the liquidity floor (Close ≥ $3 AND $ Vol ≥ $3M).">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Liquid</div>
              <div className="mt-1 text-[15px] font-mono font-semibold text-surface-100">{fmtInt(data.counts?.passed_liquidity)}</div>
            </div>
            <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-3" title="Tickers that cleared every rule and reached the candidate table.">
              <div className="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Parabolics</div>
              <div className="mt-1 text-[15px] font-mono font-semibold text-rose-300">{fmtInt(data.counts?.passed_all)}</div>
            </div>
          </div>
        )
      })()}

      {/* Loading */}
      {loading && !data && (
        <div className="rounded-2xl bg-surface-900/60 border border-surface-700/40 p-12 text-center">
          <div className="inline-flex items-center gap-2 text-surface-300">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Scanning for parabolics…
          </div>
        </div>
      )}

      {/* Empty state */}
      {data && candidates.length === 0 && !loading && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 border-dashed p-10 text-center">
          <p className="text-surface-100 font-semibold text-base">No parabolic setups today</p>
          <p className="text-surface-500 text-sm mt-2 max-w-md mx-auto">
            {data.error
              ? data.error
              : 'Parabolics cluster around hot tapes and manias — many days produce zero. Try toggling off the strict gates above, or come back at the next refresh.'}
          </p>
        </div>
      )}

      {/* Candidates table */}
      {data && candidates.length > 0 && (
        <div className="rounded-2xl bg-surface-900/80 border border-surface-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-[12px]">
              <thead className="bg-surface-950/50 text-[10px] uppercase tracking-wide text-surface-500">
                <tr>
                  {['Symbol', 'Close', 'Tier', 'Gain%', '5d%', 'Up d', 'Ext%', 'Fade%', '$ Vol', 'Stop', 'Risk%'].map(h => {
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
                {candidates.map(c => (
                  <tr key={c.symbol} className="border-t border-surface-800/60 hover:bg-surface-800/30">
                    <td className="px-3 py-2 font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        {c.accelerating && (
                          <span className="text-amber-300" title="Accelerating — biggest 1-day gain of the run is today">⚡</span>
                        )}
                        <TickerLink symbol={c.symbol} className="text-surface-100" />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-surface-200">{fmtMoney(c.close)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider border ${
                          c.cap_tier === 'large'
                            ? 'bg-cyan-500/10 text-cyan-300 border-cyan-400/30'
                            : 'bg-purple-500/10 text-purple-300 border-purple-400/30'
                        }`}
                        title={`Cleared the ${c.required_gain_pct}% ${c.cap_tier}-cap bar`}
                      >
                        {c.cap_tier === 'large' ? 'lg' : 'sm'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-rose-300 font-semibold">{fmtPct(c.gain_pct)}</td>
                    <td className="px-3 py-2 text-surface-300">{fmtPct(c.gain_5d_pct)}</td>
                    <td className={`px-3 py-2 ${c.up_days >= 5 ? 'text-rose-300 font-semibold' : 'text-surface-300'}`}>
                      {c.up_days ?? 0}
                    </td>
                    <td className={`px-3 py-2 ${c.extended ? 'text-rose-300 font-semibold' : 'text-surface-300'}`}>
                      {fmtPct(c.ext_pct)}
                    </td>
                    <td className={`px-3 py-2 ${c.from_high_pct >= 3 ? 'text-amber-300 font-semibold' : 'text-surface-400'}`}>
                      {fmtPct(c.from_high_pct)}
                    </td>
                    <td className="px-3 py-2 text-surface-400">{fmtCompactDollars(c.dollar_volume)}</td>
                    <td className="px-3 py-2 text-surface-400">{fmtMoney(c.stop)}</td>
                    <td className={`px-3 py-2 ${
                      c.risk_pct == null ? 'text-surface-500'
                      : c.risk_pct <= 5 ? 'text-emerald-300 font-semibold'
                      : c.risk_pct <= 10 ? 'text-surface-200'
                      : 'text-amber-300'
                    }`}>
                      {c.risk_pct == null ? '—' : `${c.risk_pct.toFixed(2)}%`}
                    </td>
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
          <span>Hover any column header for what it means. Sorted most-stretched first. ⚡ = accelerating.</span>
        </div>
      )}
    </div>
  )
}
