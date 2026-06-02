import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts'
import IntradayModal from './IntradayModal'
import TradingViewLink from '../TradingViewLink'
import InfoTip from '../InfoTip'

// Plain-English explainer for each stat-grid label. Surfaced as an instant
// tooltip (portal-based InfoTip) when you hover the dotted-underlined label.
// Written for someone who knows what a stock is but not the trading jargon.
const STAT_TIPS = {
  // Unusual Volume tab
  Accum: 'Accumulation Score (0–100). Reads where each day closed in its range, the up/down volume mix, and the share of closes above VWAP. ≥70 = institutional BUYING, 40–70 = mixed, <40 = distribution (sellers won despite the heavy volume).',
  CMF: 'Chaikin Money Flow (−1 to +1). A 21-day, volume-weighted read of where price closes within its daily range. ≥ +0.10 = sustained buying (good); ≤ −0.10 = sustained selling. Accum is today\'s bar; CMF is the trend.',
  RVOL: 'Relative Volume. Today\'s volume ÷ the prior 50-day average. 1× = a normal day, 2× = something is happening (news, breakout), 5×+ = clearly anomalous — institutions or a crowd-driven move.',
  'U/D Vol': 'Up/Down Volume ratio. Volume on up-closing days vs. down-closing days across the streak. Above 1 = more volume on green days (buyers in control); below 1 = sellers are heavier.',
  '>VWAP': 'Share of recent closes that finished above VWAP (the volume-weighted average price — the price the average dollar traded at). Closing above VWAP on heavy volume means real buyers won the session. Algos use it as a fill benchmark.',
  Short: 'Short volume % (FINRA). The share of today\'s volume that was short selling. <35% = real buying (green); 35–50% = mixed / squeeze fuel; >50% = heavy shorting (could be distribution or a trap). It tells you whether a big-volume day is buyers or sellers.',
  DTC: 'Days-to-cover. Short interest ÷ average daily volume — how many days of normal trading shorts would need to buy back their position. ≥5 = a real squeeze setup: a rising price forces shorts to cover, which pushes it higher still.',
  RSI: 'Relative Strength Index (0–100), 14-day momentum. >70 = overbought (extended, may pull back); <30 = oversold; ~50 = neutral. High RSI on a leader isn\'t automatically bad — strong trends can stay overbought for a while.',
  // Breakout / Emerging / Leaders tabs
  ADR: 'Average Daily Range over 20 days — the stock\'s typical high-to-low swing as a %. Qullamaggie\'s hard filter is ≥5%: quieter names simply don\'t move enough to trade.',
  Base: 'Base length — how many days the stock has been consolidating in a tight range since its last big move. Qulla\'s sweet spot is 5–25 days.',
  Range: 'Base range — how wide the consolidation is, high-to-low as a %. Tighter is better (<8%): it means the stock is coiling, not chopping around.',
  Pullback: 'Pullback from the base high — how far below the pivot the stock currently sits. Smaller = closer to a breakout entry.',
  Thrust: 'Parent thrust — the size of the big expansionary move (30%+) that preceded this base. It\'s the "why": the move that first put the stock on the radar.',
  '3M': '3-month trailing return. Part of the relative-strength read — leaders are the names already outperforming the market over the last quarter.',
}

const STATUS_COLORS = {
  READY: 'text-success',
  GOOD: 'text-success',
  DEVELOPING: 'text-warning',
  EMERGING: 'text-accent',
  WATCH: 'text-surface-400',
}

const SENTIMENT_COLORS = {
  positive: 'text-success',
  neutral: 'text-surface-400',
  negative: 'text-danger',
}

function ema(values, span) {
  const k = 2 / (span + 1)
  const out = []
  let prev = null
  for (const v of values) {
    prev = prev == null ? v : v * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}

// Least-squares fit y = a + b·x over values; returns endpoint y-values [y0, y_last].
function linearFitEndpoints(values) {
  const n = values.length
  if (n < 2) return null
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let i = 0; i < n; i++) {
    sx += i; sy += values[i]
    sxx += i * i; sxy += i * values[i]
  }
  const denom = n * sxx - sx * sx
  if (denom === 0) return null
  const b = (n * sxy - sx * sy) / denom
  const a = (sy - b * sx) / n
  return [a, a + b * (n - 1)]
}

const fmtPct = (v, digits = 1) => (v == null ? '–' : `${(v * 100).toFixed(digits)}%`)

// Tags that deserve a colored outline rather than the neutral chip style.
const ACCENT_TAG_PATTERNS = [
  { match: (t) => t === 'Breaking out', cls: 'border-danger/60 text-danger bg-danger/10' },
  { match: (t) => t === 'Extended', cls: 'border-warning/60 text-warning bg-warning/10' },
  { match: (t) => t.startsWith('Earnings '), cls: 'border-danger/60 text-danger bg-danger/10' },
  { match: (t) => t.startsWith('Ex-dividend '), cls: 'border-warning/60 text-warning bg-warning/10' },
]

const tagClassFor = (t) => {
  for (const p of ACCENT_TAG_PATTERNS) if (p.match(t)) return p.cls
  return 'border-surface-700/50 text-surface-300 bg-surface-800'
}

const ChartCard = ({ candidate, rank, isNew = false }) => {
  const containerRef = useRef(null)
  const [showIntraday, setShowIntraday] = useState(false)

  useEffect(() => {
    if (!containerRef.current || !candidate?.ohlcv_tail?.length) return

    const chart = createChart(containerRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8', fontSize: 10 },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(148, 163, 184, 0.08)' },
      },
      timeScale: { borderColor: 'rgba(148, 163, 184, 0.2)', timeVisible: false },
      rightPriceScale: {
        borderColor: 'rgba(148, 163, 184, 0.2)',
        scaleMargins: { top: 0.05, bottom: 0.25 },
      },
      crosshair: { mode: 0 },
      handleScale: false,
      handleScroll: false,
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#ef4444',
      borderVisible: false, wickUpColor: '#10b981', wickDownColor: '#ef4444',
    })
    const bars = candidate.ohlcv_tail.map((b) => ({
      time: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
    }))
    candleSeries.setData(bars)

    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' }, priceScaleId: '', color: '#475569',
    })
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } })
    volSeries.setData(
      candidate.ohlcv_tail.map((b) => ({
        time: b.time, value: b.volume,
        color: b.close >= b.open ? 'rgba(16, 185, 129, 0.45)' : 'rgba(239, 68, 68, 0.45)',
      })),
    )

    const closes = bars.map((b) => b.close)
    const ema10 = ema(closes, 10)
    const ema20 = ema(closes, 20)
    const ema10Series = chart.addSeries(LineSeries, {
      color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
    })
    ema10Series.setData(bars.map((b, i) => ({ time: b.time, value: ema10[i] })))
    const ema20Series = chart.addSeries(LineSeries, {
      color: '#3b82f6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
    })
    ema20Series.setData(bars.map((b, i) => ({ time: b.time, value: ema20[i] })))

    if (candidate.base_top || candidate.pivot) {
      candleSeries.createPriceLine({
        price: candidate.base_top || candidate.pivot,
        color: '#22c55e', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Pivot',
      })
    }
    if (candidate.base_bottom) {
      candleSeries.createPriceLine({
        price: candidate.base_bottom,
        color: '#ef4444', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: 'Base low',
      })
    }

    // Flag lines — fit a line to the highs and lows of the detected base region.
    if (candidate.base_length && bars.length >= candidate.base_length) {
      const baseBars = bars.slice(-candidate.base_length)
      const upper = linearFitEndpoints(baseBars.map((b) => b.high))
      const lower = linearFitEndpoints(baseBars.map((b) => b.low))
      const t0 = baseBars[0].time
      const t1 = baseBars[baseBars.length - 1].time
      if (upper) {
        const s = chart.addSeries(LineSeries, {
          color: '#14b8a6', lineWidth: 2, lineStyle: 0,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        s.setData([{ time: t0, value: upper[0] }, { time: t1, value: upper[1] }])
      }
      if (lower) {
        const s = chart.addSeries(LineSeries, {
          color: '#14b8a6', lineWidth: 2, lineStyle: 0,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        s.setData([{ time: t0, value: lower[0] }, { time: t1, value: lower[1] }])
      }
    }

    chart.timeScale().fitContent()
    const handleResize = () => containerRef.current && chart.applyOptions({ width: containerRef.current.clientWidth })
    window.addEventListener('resize', handleResize)
    handleResize()

    return () => { window.removeEventListener('resize', handleResize); chart.remove() }
  }, [candidate])

  const statusClass = STATUS_COLORS[candidate.status] || 'text-surface-400'
  const distPct = candidate.distance_pct != null ? (candidate.distance_pct * 100).toFixed(1) : null
  const news = candidate.news
  const sentimentClass = news?.sentiment ? SENTIMENT_COLORS[news.sentiment.label] || 'text-surface-400' : ''

  const rsiColor =
    candidate.rsi == null ? 'text-surface-200'
    : candidate.rsi >= 70 ? 'text-warning'
    : candidate.rsi <= 30 ? 'text-accent'
    : 'text-surface-200'

  // Accumulation score colors: ≥70 = clear buying, 40-70 = mixed, <40 = distribution
  const accScore = candidate.accumulation_score
  const accCls =
    accScore == null ? 'text-surface-200'
    : accScore >= 70 ? 'text-success'
    : accScore >= 40 ? 'text-warning'
    : 'text-danger'
  const accLabel =
    accScore == null ? null
    : accScore >= 70 ? 'BUY'
    : accScore >= 40 ? 'MIX'
    : 'SELL'

  // On unusual_volume tiles, swap two of the less-relevant stats (Thrust, 3M)
  // for the accumulation components (CLV, U/D vol). These tell you direction.
  const isVolMode = candidate.accumulation_score != null
  // Short volume ratio interpretation:
  //   ≤ 35%  = normal range, RVOL surge likely real buying      → success
  //   35-50% = elevated short activity (could be squeeze fuel)   → warning
  //   > 50%  = heavy short selling, may be distribution disguised → danger
  const svr = candidate.short_volume_ratio
  const svrCls =
    svr == null ? 'text-surface-200'
    : svr <= 35 ? 'text-success'
    : svr <= 50 ? 'text-warning'
    : 'text-danger'
  // CMF coloring: ≥ +0.10 = sustained accumulation, ≤ -0.10 = distribution.
  const cmfCls =
    candidate.cmf == null ? 'text-surface-200'
    : candidate.cmf >= 0.1 ? 'text-success'
    : candidate.cmf <= -0.1 ? 'text-danger'
    : 'text-surface-200'
  // Days-to-cover: ≥5 = real squeeze setup
  const dtc = candidate.days_to_cover
  const dtcCls =
    dtc == null ? 'text-surface-200'
    : dtc >= 5 ? 'text-warning'
    : 'text-surface-200'
  const stats = isVolMode ? [
    { label: 'Accum', value: accScore != null ? `${accScore.toFixed(0)}` : '–', cls: accCls },
    { label: 'CMF', value: candidate.cmf != null ? candidate.cmf.toFixed(2) : '–', cls: cmfCls },
    { label: 'RVOL', value: candidate.rvol != null ? `${candidate.rvol.toFixed(2)}x` : '–' },
    { label: 'U/D Vol', value: candidate.up_down_vol_ratio != null ? `${candidate.up_down_vol_ratio.toFixed(2)}x` : '–' },
    { label: '>VWAP', value: candidate.above_vwap_pct != null ? `${Math.round(candidate.above_vwap_pct * 100)}%` : '–' },
    { label: 'Short', value: svr != null ? `${svr.toFixed(0)}%` : '–', cls: svrCls },
    { label: 'DTC', value: dtc != null ? `${dtc.toFixed(1)}d` : '–', cls: dtcCls },
    { label: 'RSI', value: candidate.rsi != null ? candidate.rsi.toFixed(0) : '–', cls: rsiColor },
  ] : [
    { label: 'ADR', value: fmtPct(candidate.adr_pct) },
    { label: 'RVOL', value: candidate.rvol != null ? `${candidate.rvol.toFixed(2)}x` : '–' },
    { label: 'RSI', value: candidate.rsi != null ? candidate.rsi.toFixed(0) : '–', cls: rsiColor },
    { label: 'Base', value: candidate.base_length != null ? `${candidate.base_length}d` : '–' },
    { label: 'Range', value: fmtPct(candidate.range_pct) },
    { label: 'Pullback', value: fmtPct(candidate.pullback_pct) },
    { label: 'Thrust', value: fmtPct(candidate.thrust_pct) },
    { label: '3M', value: fmtPct(candidate.ret_3m, 0) },
  ]

  return (
    <>
      <div className={`relative rounded-xl bg-surface-900/60 border p-3 flex flex-col gap-2 transition-colors ${
        isNew ? 'border-accent/50 ring-1 ring-accent/30' : 'border-surface-700/40 hover:border-accent/30'
      }`}>
        {isNew && (
          <span
            className="absolute -top-1.5 -right-1.5 z-10 px-1.5 py-0.5 rounded-full bg-accent text-white text-[9px] font-bold uppercase tracking-wider shadow-lg shadow-accent/30 animate-pulse"
            title="Appeared on the latest auto-refresh"
          >
            New
          </span>
        )}
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-mono text-surface-500">#{rank}</span>
              <TradingViewLink symbol={candidate.symbol} className="text-base font-bold text-surface-100" />
              {candidate.rvol_streak_day != null && (
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border ${
                    candidate.rvol_streak_day === 1
                      ? 'border-success/60 text-success bg-success/10'
                      : candidate.rvol_streak_day === 2
                      ? 'border-accent/60 text-accent bg-accent/10'
                      : 'border-warning/60 text-warning bg-warning/10'
                  }`}
                  title={
                    candidate.rvol_streak_day === 1
                      ? 'First day of ≥2× RVOL — fresh pop'
                      : `Day ${candidate.rvol_streak_day} of sustained ≥2× RVOL`
                  }
                >
                  Day {candidate.rvol_streak_day >= 3 ? '3+' : candidate.rvol_streak_day}
                </span>
              )}
              {accLabel && (
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border ${
                    accScore >= 70 ? 'border-success/60 text-success bg-success/10'
                    : accScore >= 40 ? 'border-warning/60 text-warning bg-warning/10'
                    : 'border-danger/60 text-danger bg-danger/10'
                  }`}
                  title={
                    accScore >= 70 ? `Accumulation Score ${accScore.toFixed(0)}/100 — closing strong, up-volume dominates, holding above VWAP. Likely institutional BUYING.`
                    : accScore >= 40 ? `Accumulation Score ${accScore.toFixed(0)}/100 — mixed signals. The volume spike could be accumulation OR distribution.`
                    : `Accumulation Score ${accScore.toFixed(0)}/100 — closing weak, down-volume dominates, closing below VWAP. Likely DISTRIBUTION (selling).`
                  }
                >
                  {accLabel} {accScore.toFixed(0)}
                </span>
              )}
              {candidate.smart_money_label && (
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border ${
                    candidate.smart_money_class === 'success'
                      ? 'border-success/60 text-success bg-success/10'
                      : 'border-warning/60 text-warning bg-warning/10'
                  }`}
                  title={
                    candidate.smart_money_label === 'STEALTH'
                      ? `${candidate.darkpool_block_count} large hidden fills (≥10K shares OR ≥$1M, off-exchange). The strongest institutional accumulation tell.`
                      : candidate.smart_money_label === 'DARK'
                      ? `${(candidate.darkpool_pct * 100).toFixed(0)}% of sampled volume routed off-exchange (dark pools / ATSes). Funds avoiding market impact.`
                      : candidate.smart_money_label === 'BLOCKS'
                      ? `${candidate.block_count} block trades (≥10K shares OR ≥$1M notional), ${(candidate.block_pct * 100).toFixed(0)}% of sampled volume. Institutional fills visible on the tape.`
                      : `${candidate.block_count} block trades, ${(candidate.block_pct * 100).toFixed(0)}% of sampled volume.`
                  }
                >
                  {candidate.smart_money_label}
                </span>
              )}
              {/* CMF+ badge — sustained 21-day accumulation (>= +0.10). */}
              {candidate.cmf != null && candidate.cmf >= 0.1 && (
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border border-success/60 text-success bg-success/10"
                  title={`Chaikin Money Flow ${candidate.cmf.toFixed(2)} — 21-day volume-weighted close-in-range is in sustained accumulation territory.`}
                >
                  CMF+
                </span>
              )}
              {/* Insider buys (Form 4 'P' codes in last 60 days) */}
              {candidate.insider_buys_60d != null && candidate.insider_buys_60d >= 2 && (
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border border-success/60 text-success bg-success/10"
                  title={`${candidate.insider_buys_60d} insider purchase(s) by ${candidate.distinct_insider_buyers_60d || '?'} distinct insider(s) in the last 60 days (SEC Form 4 'P' codes). Cleanest 'smart money' tell available without options.`}
                >
                  INSIDER BUYS ×{candidate.insider_buys_60d}
                </span>
              )}
              {/* 13-F institutional filers in last 90 days */}
              {candidate.institutional_filers_90d != null && candidate.institutional_filers_90d >= 3 && (
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border border-accent/60 text-accent bg-accent/10"
                  title={`${candidate.institutional_filers_90d} institutional managers (≥$100M AUM) disclosed positions in the last 90 days (SEC 13-F filings).`}
                >
                  {candidate.institutional_filers_90d} FUNDS
                </span>
              )}
              {/* Squeeze setup — high short interest + bullish accumulation */}
              {candidate.days_to_cover != null && candidate.days_to_cover >= 5
                  && candidate.accumulation_score != null && candidate.accumulation_score >= 60 && (
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md border border-warning/60 text-warning bg-warning/10"
                  title={`Squeeze setup: ${candidate.days_to_cover.toFixed(1)}-day cover ratio with accumulation score ${candidate.accumulation_score.toFixed(0)}. Heavy short position being squeezed by buying pressure.`}
                >
                  SQUEEZE
                </span>
              )}
            </div>
            <div className="text-[10px] text-surface-500 mt-0.5 flex items-center gap-2">
              <span>${candidate.last_close?.toFixed(2)}</span>
              {distPct != null && (
                <span className={distPct >= 0 ? 'text-surface-400' : 'text-warning'}>
                  {distPct >= 0 ? `${distPct}% to pivot` : `${Math.abs(distPct)}% past pivot`}
                </span>
              )}
            </div>
          </div>
          <div className="relative group text-right cursor-help">
            <div className="text-lg font-bold text-success leading-none">{candidate.score?.toFixed(1)}</div>
            <div className={`text-[10px] font-mono uppercase tracking-wider mt-0.5 ${statusClass}`}>
              {candidate.status}
            </div>
            {candidate.score_breakdown?.length > 0 && (
              <div className="absolute right-0 top-full mt-1 z-20 hidden group-hover:block w-60 rounded-lg bg-surface-950 border border-surface-700 shadow-xl p-2.5 text-left">
                <div className="text-[10px] uppercase tracking-wider text-surface-500 mb-1.5">Score breakdown</div>
                {candidate.score_breakdown.map((row) => (
                  <div key={row.component} className="flex items-baseline justify-between gap-2 text-[11px] py-0.5">
                    <span className="text-surface-300 truncate">{row.component}</span>
                    <span className="font-mono text-surface-500 shrink-0">
                      <span className="text-surface-400">{(row.value * 100).toFixed(0)}%</span>
                      <span className="mx-1 text-surface-700">×</span>
                      <span className="text-surface-400">{row.weight}</span>
                      <span className="mx-1 text-surface-700">=</span>
                      <span className="text-surface-100">{row.points.toFixed(1)}</span>
                    </span>
                  </div>
                ))}
                <div className="border-t border-surface-700/50 mt-1.5 pt-1.5 flex items-baseline justify-between text-[11px]">
                  <span className="text-surface-400 font-medium">Total</span>
                  <span className="font-mono font-bold text-success">{candidate.score?.toFixed(1)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1">
          {candidate.tags?.map((t) => (
            <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-md border ${tagClassFor(t)}`}>
              {t}
            </span>
          ))}
        </div>

        {/* Chart */}
        <div ref={containerRef} className="w-full h-[220px]" />

        {/* Stats grid — labels with an explainer get a dotted underline and an
            instant hover tooltip (portal-based, never clipped by the card). */}
        <div className="grid grid-cols-4 gap-1.5 text-[10px] font-mono">
          {stats.map((s) => {
            const tip = STAT_TIPS[s.label]
            return (
              <div key={s.label} className="rounded bg-surface-800/60 px-1.5 py-1">
                {tip ? (
                  <InfoTip
                    label={tip}
                    className="block w-fit text-surface-500 uppercase text-[9px] underline decoration-dotted decoration-surface-600 underline-offset-2"
                  >
                    {s.label}
                  </InfoTip>
                ) : (
                  <div className="text-surface-500 uppercase text-[9px]">{s.label}</div>
                )}
                <div className={s.cls || 'text-surface-200'}>{s.value}</div>
              </div>
            )
          })}
        </div>

        {/* Catalyst headline */}
        {news?.title && (
          <a
            href={news.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-lg bg-surface-800/40 border border-surface-700/40 px-2 py-1.5 hover:border-accent/40 transition-colors"
            title={news.sentiment?.reasoning}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] text-surface-200 leading-snug line-clamp-2">{news.title}</p>
              {news.sentiment?.label && (
                <span className={`text-[9px] uppercase font-mono shrink-0 ${sentimentClass}`}>
                  {news.sentiment.label}
                </span>
              )}
            </div>
            <p className="text-[9px] text-surface-500 mt-0.5">
              {news.site} · {news.publishedDate}
            </p>
          </a>
        )}

        {/* Action row: intraday + options-flow deeplink. */}
        <div className="flex items-center gap-4 border-t border-surface-700/30 pt-2">
          {(candidate.status === 'READY' || candidate.status === 'GOOD') && (
            <button
              onClick={() => setShowIntraday(true)}
              className="text-[11px] text-accent hover:text-accent/80 font-medium"
            >
              ↗ View intraday (5m)
            </button>
          )}
          {isVolMode && (
            <a
              href={`/flow/${candidate.symbol}`}
              className="text-[11px] text-accent hover:text-accent/80 font-medium"
              title="Open the Options Flow page for this ticker — see premium-weighted P/C, unusual contracts, and sweep activity."
            >
              ↗ Options flow
            </a>
          )}
        </div>
      </div>

      {showIntraday && (
        <IntradayModal
          symbol={candidate.symbol}
          pivot={candidate.base_top || candidate.pivot}
          onClose={() => setShowIntraday(false)}
        />
      )}
    </>
  )
}

export default ChartCard
