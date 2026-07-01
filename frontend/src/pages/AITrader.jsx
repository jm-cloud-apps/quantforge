import { useState, useEffect, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import { getAITraderIdeas, getAITraderHistory, getAITraderBacktest, getAITraderBacktestHistory, getAITraderWalkforward } from '../api/aiTrader'

const fmtUSD = (v, d = 2) =>
  v == null || Number.isNaN(Number(v))
    ? '—'
    : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
const fmtPct = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v) >= 0 ? '' : ''}${Number(v).toFixed(d)}%`)
const signPct = (v, d = 1) => (v == null ? '—' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(d)}%`)
const fmtR = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}R`)
const tone = (v) => (v == null ? 'text-surface-500' : v > 0 ? 'text-success' : v < 0 ? 'text-danger' : 'text-surface-400')
const fmtAge = (s) => {
  s = Number(s) || 0
  if (s < 90) return 'just now'
  const m = Math.round(s / 60)
  if (m < 90) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const SETUP_STYLE = {
  Breakout: 'bg-accent/15 text-accent border-accent/30',
  'Episodic Pivot': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
}
const CONV_STYLE = {
  high: 'bg-success/15 text-success',
  medium: 'bg-amber-500/15 text-amber-300',
  low: 'bg-surface-700 text-surface-300',
}
const REGIME_STYLE = {
  bullish: { dot: 'bg-success', text: 'text-success', ring: 'border-success/30 bg-success/[0.06]' },
  overheated: { dot: 'bg-amber-400', text: 'text-amber-300', ring: 'border-amber-500/30 bg-amber-500/[0.06]' },
  neutral: { dot: 'bg-surface-400', text: 'text-surface-300', ring: 'border-surface-700/50 bg-surface-800/40' },
  bearish: { dot: 'bg-danger', text: 'text-danger', ring: 'border-danger/30 bg-danger/[0.06]' },
  capitulation: { dot: 'bg-danger', text: 'text-danger', ring: 'border-danger/40 bg-danger/[0.1]' },
  unknown: { dot: 'bg-surface-500', text: 'text-surface-400', ring: 'border-surface-700/50 bg-surface-800/40' },
}
const OUTCOME_STYLE = {
  trail: { label: 'Trailed', cls: 'bg-success/15 text-success' },
  target: { label: 'Target ✓', cls: 'bg-success/15 text-success' },
  stop: { label: 'Stopped', cls: 'bg-danger/15 text-danger' },
  open: { label: 'Open', cls: 'bg-accent/15 text-accent' },
  no_entry: { label: 'No entry', cls: 'bg-surface-700 text-surface-400' },
  untracked: { label: '—', cls: 'bg-surface-700 text-surface-500' },
}

function Chip({ label, value, tone = 'text-surface-200' }) {
  return (
    <div className="rounded-md bg-surface-800/60 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-surface-500">{label}</div>
      <div className={`text-xs font-mono font-semibold ${tone}`}>{value}</div>
    </div>
  )
}

function PlanCell({ label, value, tone }) {
  return (
    <div className="flex-1 rounded-lg bg-surface-800/50 px-3 py-2 text-center">
      <div className="text-[10px] uppercase tracking-wider text-surface-500 mb-0.5">{label}</div>
      <div className={`font-mono text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  )
}

function RegimeBanner({ regime }) {
  if (!regime) return null
  const st = REGIME_STYLE[regime.level] || REGIME_STYLE.unknown
  return (
    <div className={`rounded-xl border ${st.ring} px-4 py-3`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${st.dot}`} />
          <span className={`text-sm font-display font-semibold ${st.text} capitalize`}>{regime.level} regime</span>
        </span>
        {regime.summary && <span className="text-sm text-surface-300">{regime.summary}</span>}
        {regime.selectivity && (
          <span className="text-[10px] uppercase tracking-wider text-surface-500">
            · {regime.selectivity === 'strict' ? 'be highly selective' : regime.selectivity === 'raised' ? 'raised bar' : 'tailwind'}
          </span>
        )}
        {!regime.available && <span className="text-[10px] text-surface-500">(breadth cache cold)</span>}
      </div>
      {regime.posture && <p className="text-xs text-surface-400 mt-1">{regime.posture}</p>}
      {Array.isArray(regime.warnings) && regime.warnings.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {regime.warnings.slice(0, 2).map((w, i) => (
            <li key={i} className="text-[11px] text-amber-300/80">⚠ {w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PortfolioPanel({ portfolio, regime }) {
  if (!portfolio) return null
  const heat = portfolio.heat_pct
  const suggested = portfolio.regime_suggested_heat_pct
  const hot = suggested != null && heat != null && heat > suggested
  return (
    <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-display font-semibold text-surface-50">Portfolio risk</h2>
        <span className="text-[11px] text-surface-500">if all {portfolio.ideas} ideas are taken & every stop hits</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Chip label="Capital deployed" value={`${fmtUSD(portfolio.total_cost, 0)}`} tone="text-surface-100" />
        <Chip label="% of account" value={portfolio.deployed_pct != null ? `${portfolio.deployed_pct}%` : '—'} />
        <Chip label="Total $ at risk" value={fmtUSD(portfolio.total_risk_dollars, 0)} tone="text-danger" />
        <Chip
          label="Portfolio heat"
          value={heat != null ? `${heat}%` : '—'}
          tone={hot ? 'text-danger' : 'text-success'}
        />
      </div>
      {suggested != null && (
        <p className={`text-[11px] mt-2 ${hot ? 'text-amber-300' : 'text-surface-500'}`}>
          {hot ? '⚠ ' : ''}Regime-suggested max heat ≈ {suggested}% {hot ? '— current heat exceeds it, consider trimming size or count.' : '— within budget.'}
        </p>
      )}
      {Array.isArray(portfolio.correlated_pairs) && portfolio.correlated_pairs.length > 0 && (
        <div className="mt-3 border-t border-surface-800 pt-2.5">
          <div className="text-[10px] uppercase tracking-wider text-surface-500 mb-1.5">Correlated bets — not independent positions</div>
          <div className="flex flex-wrap gap-1.5">
            {portfolio.correlated_pairs.map((p, i) => (
              <span key={i} className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300/90 border border-amber-500/20">
                {p.a} ↔ {p.b} · ρ {p.corr}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-surface-500 mt-1.5">These move together — treat them as one position when sizing total risk.</p>
        </div>
      )}
    </div>
  )
}

function IdeaCard({ idea, rank, budget, account }) {
  const s = idea.stats || {}
  const tvUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(idea.ticker)}`
  const setupCls = SETUP_STYLE[idea.setup] || 'bg-surface-700 text-surface-200 border-surface-600'
  const convCls = CONV_STYLE[idea.conviction] || CONV_STYLE.low
  const change = s.today_change_pct
  const budgetCapped = idea.sizing_basis === 'budget'
  return (
    <div className="rounded-xl bg-surface-900/70 border border-surface-700/50 p-5 space-y-4">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent/15 text-accent font-display font-bold text-sm flex items-center justify-center">
            {rank}
          </span>
          <div className="min-w-0">
            <a href={tvUrl} target="_blank" rel="noreferrer"
               className="font-display font-bold text-lg text-surface-50 hover:text-accent transition-colors">
              {idea.ticker}
            </a>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${setupCls}`}>{idea.setup}</span>
              {idea.conviction && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${convCls}`}>{idea.conviction} conviction</span>
              )}
              {idea.source === 'scan' && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-700 text-surface-400">rule-based</span>
              )}
            </div>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="font-mono text-sm text-surface-200">{fmtUSD(s.price)}</div>
          {change != null && (
            <div className={`font-mono text-xs ${change >= 0 ? 'text-success' : 'text-danger'}`}>{signPct(change)} today</div>
          )}
          {idea.composite_score != null && (
            <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent"
                 title={(idea.score_breakdown || []).map((b) => `${b.factor}: ${b.points}`).join('  ·  ')}>
              Q {idea.composite_score}
            </div>
          )}
        </div>
      </div>

      {/* backtest outcome strip (only present on backtested ideas) */}
      {idea.outcome && (
        <div className="flex items-center justify-between rounded-lg bg-surface-800/50 border border-surface-700/40 px-3 py-2">
          <span className="flex items-center gap-2">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${(OUTCOME_STYLE[idea.outcome] || OUTCOME_STYLE.untracked).cls}`}>
              {(OUTCOME_STYLE[idea.outcome] || OUTCOME_STYLE.untracked).label}
            </span>
            <span className="text-[11px] text-surface-500">
              {idea.exit_price != null
                ? `exit ${fmtUSD(idea.exit_price)}${idea.holding_bars ? ` · ${idea.holding_bars}d` : ''}`
                : 'open · mark-to-market'}
            </span>
          </span>
          <span className="flex items-center gap-3 font-mono text-sm">
            {idea.mfe_r != null && <span className="text-[11px] text-surface-500" title="max favorable excursion">peak ↑{idea.mfe_r}R</span>}
            <span className={tone(idea.exit_price != null ? idea.realized_return_pct : idea.change_pct)}>
              {signPct(idea.exit_price != null ? idea.realized_return_pct : idea.change_pct)}
            </span>
            <span className={idea.r_multiple == null ? 'text-surface-500' : `font-semibold ${tone(idea.r_multiple)}`}>{fmtR(idea.r_multiple)}</span>
          </span>
        </div>
      )}

      {/* trade plan */}
      <div className="flex gap-2">
        <PlanCell label="Entry" value={fmtUSD(idea.entry)} tone="text-accent" />
        <PlanCell label="Stop" value={fmtUSD(idea.stop)} tone="text-danger" />
        <PlanCell label="Target" value={fmtUSD(idea.target)} tone="text-success" />
        <PlanCell label="R:R" value={idea.rr_to_target ? `${idea.rr_to_target}×` : '—'} tone="text-surface-200" />
      </div>

      {/* sizing — risk-based */}
      <div className="rounded-lg bg-surface-800/40 border border-surface-700/40 px-3 py-2 flex flex-wrap items-center justify-between gap-y-1 text-xs">
        <span className="text-surface-400">
          <span className="text-surface-100 font-semibold">{idea.shares} sh</span>
          <span className="text-surface-500"> ≈ {fmtUSD(idea.position_cost)}</span>
          {budgetCapped && <span className="ml-1 text-[10px] text-amber-300/80">(budget-capped)</span>}
        </span>
        <span className="text-surface-400">
          risk{' '}
          <span className="text-danger font-semibold">{fmtUSD(idea.risk_dollars)}</span>
          {idea.account_risk_pct != null && <span className="text-surface-500"> · {idea.account_risk_pct}% of acct</span>}
        </span>
      </div>

      {/* why invest */}
      {idea.rationale && <p className="text-sm font-medium text-surface-100 leading-relaxed">{idea.rationale}</p>}
      {idea.thesis && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-surface-500 mb-1">Why this trade</div>
          <p className="text-[13px] text-surface-300 leading-relaxed">{idea.thesis}</p>
        </div>
      )}
      {Array.isArray(idea.key_points) && idea.key_points.length > 0 && (
        <ul className="space-y-1">
          {idea.key_points.map((p, i) => (
            <li key={i} className="flex gap-2 text-[13px] text-surface-300">
              <span className="text-success mt-0.5 flex-shrink-0">✓</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
      {idea.risk_note && (
        <p className="text-[11px] text-amber-300/80 leading-relaxed bg-amber-500/[0.05] rounded px-2.5 py-1.5">
          ⚠ {idea.risk_note}
        </p>
      )}

      {/* stats */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        <Chip label="ADR" value={s.adr_pct != null ? fmtPct(s.adr_pct) : '—'} tone={s.adr_pct >= 3 ? 'text-success' : 'text-surface-300'} />
        <Chip label="RVOL" value={s.rvol != null ? `${s.rvol}×` : '—'} />
        <Chip label="$Vol" value={s.dollar_vol_m != null ? `${s.dollar_vol_m}M` : '—'} />
        <Chip label="1M" value={signPct(s.ret_1m_pct)} tone={s.ret_1m_pct >= 0 ? 'text-success' : 'text-danger'} />
        <Chip label="3M" value={signPct(s.ret_3m_pct)} tone={s.ret_3m_pct >= 0 ? 'text-success' : 'text-danger'} />
        <Chip label="6M" value={signPct(s.ret_6m_pct)} tone={s.ret_6m_pct >= 0 ? 'text-success' : 'text-danger'} />
      </div>

      {/* catalyst */}
      {(s.news?.title || s.earnings_date) && (
        <div className="border-t border-surface-800 pt-3 space-y-1">
          {s.news?.title && (
            <p className="text-xs text-surface-400 leading-relaxed">
              📰 {s.news.title}
              {s.news.sentiment && <span className="text-surface-500"> · {s.news.sentiment}</span>}
            </p>
          )}
          {s.earnings_date && <p className="text-[11px] text-amber-300/90">📅 Earnings: {s.earnings_date}</p>}
        </div>
      )}
    </div>
  )
}

function SetupCriteria({ criteria }) {
  if (!criteria) return null
  return (
    <details open className="rounded-xl bg-surface-900/60 border border-surface-700/40 px-4 py-3">
      <summary className="cursor-pointer font-display font-semibold text-surface-100 select-none">
        Setup criteria <span className="text-[11px] font-normal text-surface-500">— exactly what produces these ideas</span>
      </summary>
      <div className="mt-3 space-y-3">
        {Array.isArray(criteria.gates) && (
          <div className="flex flex-wrap gap-1.5">
            {criteria.gates.map((g) => (
              <span key={g.label} className="text-[11px] rounded-md bg-surface-800/60 px-2 py-1">
                <span className="text-surface-500">{g.label}: </span>
                <span className="text-surface-100 font-semibold">{g.value}</span>
              </span>
            ))}
          </div>
        )}
        {Array.isArray(criteria.setups) && (
          <div className="grid sm:grid-cols-2 gap-2">
            {criteria.setups.map((s) => (
              <div key={s.name} className="rounded-lg bg-surface-800/40 border border-surface-700/40 px-3 py-2">
                <div className="text-[13px] font-semibold text-surface-100">{s.name}</div>
                <p className="text-[12px] text-surface-400 leading-snug mt-0.5">{s.desc}</p>
                <div className="mt-1.5 text-[11px] space-y-0.5">
                  <div><span className="text-accent font-semibold">Entry</span> <span className="text-surface-300">{s.entry}</span></div>
                  <div><span className="text-danger font-semibold">Stop</span> <span className="text-surface-300">{s.stop}</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
        {Array.isArray(criteria.levels) && (
          <div className="border-t border-surface-800 pt-2.5">
            <div className="text-[10px] uppercase tracking-wider text-surface-500 mb-1.5">How entry / stop / target are set</div>
            <div className="space-y-1">
              {criteria.levels.map((l) => (
                <p key={l.label} className="text-[12px] text-surface-400 leading-snug">
                  <span className={`font-semibold ${l.label === 'Entry' ? 'text-accent' : l.label === 'Stop' ? 'text-danger' : 'text-success'}`}>{l.label}:</span> {l.value}
                </p>
              ))}
            </div>
          </div>
        )}
        {(criteria.sizing || criteria.management) && (
          <div className="text-[12px] text-surface-400 space-y-1 border-t border-surface-800 pt-2">
            {criteria.sizing && <p><span className="text-surface-300 font-semibold">Sizing:</span> {criteria.sizing}</p>}
            {criteria.management && <p><span className="text-surface-300 font-semibold">Management:</span> {criteria.management}</p>}
          </div>
        )}
      </div>
    </details>
  )
}

function StatTile({ label, value, tone = 'text-surface-100', sub }) {
  return (
    <div className="rounded-lg bg-surface-800/40 border border-surface-700/30 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-surface-500">{label}</div>
      <div className={`font-mono text-lg font-semibold ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-surface-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function TrackRecord({ stats }) {
  if (!stats || !stats.resolved) {
    return (
      <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-4 text-sm text-surface-500">
        <span className="font-display font-semibold text-surface-300">Track record</span> — no trades have resolved
        (hit target or stop) yet. Stats populate as suggested setups play out.
      </div>
    )
  }
  const exp = stats.expectancy_r
  const pf = stats.profit_factor
  return (
    <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-display font-semibold text-lg text-surface-50">Track record</h2>
        <span className="text-[11px] text-surface-500">realized R-multiples · entry-triggered setups only</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <StatTile label="Expectancy" value={fmtR(exp)} tone={exp >= 0 ? 'text-success' : 'text-danger'} sub="per trade" />
        <StatTile label="Hit rate" value={stats.hit_rate_pct != null ? `${stats.hit_rate_pct}%` : '—'}
          sub={`${stats.wins}W / ${stats.losses}L`} />
        <StatTile label="Profit factor" value={stats.all_wins ? '∞' : pf == null ? '—' : pf}
          tone={stats.all_wins || (pf && pf >= 1) ? 'text-success' : 'text-danger'} />
        <StatTile label="Avg win" value={fmtR(stats.avg_win_r)} tone="text-success" />
        <StatTile label="Avg loss" value={fmtR(stats.avg_loss_r)} tone="text-danger" />
        <StatTile label="Total" value={fmtR(stats.total_r)} tone={stats.total_r >= 0 ? 'text-success' : 'text-danger'}
          sub={`${stats.resolved} resolved`} />
      </div>
      <p className="text-[11px] text-surface-500 mt-2">
        {stats.open} open · {stats.no_entry} never triggered the entry. Target = +planned R, stop = −1R; ties within a bar
        resolve to the stop (conservative).
      </p>
    </div>
  )
}

function HistoryLedger({
  records,
  title = 'Suggestion history',
  subtitle = 'suggested → exit/now · realized % · peak MFE · R · 1/day',
  empty = "No history yet — today's picks will appear here, then track against the price going forward.",
}) {
  if (!records || records.length === 0) {
    return (
      <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-6 text-center text-sm text-surface-500">
        {empty}
      </div>
    )
  }
  return (
    <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-display font-semibold text-lg text-surface-50">{title}</h2>
        <span className="text-[11px] text-surface-500">{subtitle}</span>
      </div>
      <div className="space-y-3">
        {records.map((r) => (
          <div key={r.date} className="rounded-lg bg-surface-800/30 border border-surface-700/30 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 bg-surface-800/50">
              <span className="text-xs font-semibold text-surface-200">
                {r.date}
                {!r.ai_available && <span className="ml-2 text-[10px] text-surface-500 font-normal">rule-based</span>}
                {r.regime && <span className="ml-2 text-[10px] text-surface-500 font-normal capitalize">· {r.regime}</span>}
              </span>
              <span className="flex items-center gap-2">
                {r.alpha_pct != null && (
                  <span className={`text-[11px] font-mono ${tone(r.alpha_pct)}`} title={`vs SPY ${signPct(r.benchmark_change_pct)}`}>
                    α {signPct(r.alpha_pct)}
                  </span>
                )}
                {r.avg_change_pct != null && (
                  <span className={`text-xs font-mono font-semibold ${tone(r.avg_change_pct)}`}>avg {signPct(r.avg_change_pct)}</span>
                )}
              </span>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {r.ideas.map((i, idx) => {
                  const oc = OUTCOME_STYLE[i.outcome] || OUTCOME_STYLE.untracked
                  const closed = i.exit_price != null
                  const px = closed ? i.exit_price : i.current_price
                  const ret = closed ? i.realized_return_pct : i.change_pct
                  return (
                    <tr key={idx} className="border-t border-surface-800/40">
                      <td className="py-1.5 px-3 font-semibold text-surface-100">{i.ticker}</td>
                      <td className="py-1.5 px-2">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${oc.cls}`}>{oc.label}</span>
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono text-surface-400 hidden sm:table-cell">{fmtUSD(i.suggested_price)}</td>
                      <td className="py-1.5 px-1 text-surface-600 text-center hidden sm:table-cell">→</td>
                      <td className="py-1.5 px-2 text-right font-mono text-surface-200" title={closed ? `exit ${i.exit_date || ''}` : 'latest close'}>{fmtUSD(px)}</td>
                      <td className={`py-1.5 px-2 text-right font-mono ${tone(ret)}`}>{signPct(ret)}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-surface-600 hidden md:table-cell" title="peak unrealized (max favorable excursion)">
                        {i.mfe_r != null ? `↑${i.mfe_r}R` : ''}
                      </td>
                      <td className={`py-1.5 px-3 text-right font-mono font-semibold ${i.r_multiple == null ? 'text-surface-500' : tone(i.r_multiple)}`}>
                        {fmtR(i.r_multiple)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}

function EquityCurve({ points }) {
  if (!points || points.length < 2) return null
  const hasSpy = points.some((p) => p.spy_pct != null)
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: -4 }}>
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(d) => d.slice(5)} minTickGap={24} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={44} unit="%" />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#cbd5e1' }}
            formatter={(v, name) => [`${Number(v) >= 0 ? '+' : ''}${v}%`, name]}
          />
          {hasSpy && <Line type="monotone" dataKey="spy_pct" name="SPY" stroke="#64748b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />}
          <Line type="monotone" dataKey="strategy_pct" name="Strategy" stroke="#6366f1" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function BacktestInspector({ budget, account, riskPct, onRan }) {
  const [asOf, setAsOf] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const win = data?.data_window

  const run = useCallback(async () => {
    if (!asOf) {
      setError('Pick a date first.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      setData(await getAITraderBacktest({ asOf, budget, account, riskPct }))
      onRan?.() // refresh the saved backtest ledger below
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [asOf, budget, account, riskPct, onRan])

  const ideas = data?.ideas || []
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-surface-400">
            As-of date
            <input
              type="date" value={asOf}
              min={win?.earliest || undefined} max={win?.latest || undefined}
              onChange={(e) => setAsOf(e.target.value)}
              className="mt-1 block rounded-lg bg-surface-800 border border-surface-700 px-2.5 py-2 text-sm text-surface-100 font-mono focus:outline-none focus:border-accent"
            />
          </label>
          <button
            onClick={run} disabled={loading}
            className="rounded-lg bg-accent text-white text-sm font-semibold px-4 py-2 hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Replaying…' : 'Replay this date'}
          </button>
          <p className="text-[11px] text-surface-500">
            Rule-based engine, data ≤ chosen date only · then scored forward to today.
            {win?.earliest && <> Window {win.earliest} → {win.latest}.</>}
          </p>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-10 text-center">
          <div className="inline-block w-7 h-7 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-2" />
          <p className="text-surface-400 text-sm">Loading point-in-time data &amp; replaying… (~30s on first run)</p>
        </div>
      )}
      {error && !loading && (
        <div className="rounded-xl border border-danger/30 bg-danger/[0.06] p-4 text-center text-danger text-sm">{error}</div>
      )}

      {!loading && data && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-surface-500">as of <span className="text-surface-200 font-mono">{data.as_of}</span></span>
            <span className="text-surface-600">·</span>
            <span className="text-surface-500 capitalize">regime: {data.regime?.level}</span>
            <span className="text-surface-600">·</span>
            <span className="text-surface-500">{data.candidates_considered} candidates</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatTile label="Avg since" value={signPct(data.avg_change_pct)} tone={tone(data.avg_change_pct)} sub="raw % to today" />
            <StatTile label="Alpha vs SPY" value={signPct(data.alpha_pct)} tone={tone(data.alpha_pct)} sub={`SPY ${signPct(data.benchmark_change_pct)}`} />
            <StatTile label="Expectancy" value={fmtR(data.stats?.expectancy_r)} tone={data.stats?.expectancy_r >= 0 ? 'text-success' : 'text-danger'} sub="per trade" />
            <StatTile label="Hit rate" value={data.stats?.hit_rate_pct != null ? `${data.stats.hit_rate_pct}%` : '—'} sub={`${data.stats?.wins || 0}W / ${data.stats?.losses || 0}L`} />
          </div>
          <p className="text-[11px] text-surface-500">
            ⚠ Raw % is survivorship-biased (today's universe) and ignores the stop — the R-multiple is the honest read.
          </p>
          {ideas.length > 0 ? (
            <div className="space-y-4">
              {ideas.map((idea, i) => (
                <IdeaCard key={`${idea.ticker}-${i}`} idea={idea} rank={i + 1} budget={budget} account={account} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-8 text-center text-surface-400 text-sm">
              No rule-based setups qualified on {data.as_of}.
            </div>
          )}
        </>
      )}
    </div>
  )
}

const STEP_OPTIONS = [
  { label: 'Weekly', days: 7 },
  { label: 'Biweekly', days: 14 },
  { label: 'Monthly', days: 30 },
]

function WalkForwardPanel({ budget, account, riskPct }) {
  const [stepDays, setStepDays] = useState(7)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const run = useCallback(async (fresh = false) => {
    setLoading(true)
    setError(null)
    try {
      setData(await getAITraderWalkforward({ stepDays, budget, account, riskPct, fresh }))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [stepDays, budget, account, riskPct])

  const agg = data?.aggregate
  return (
    <div className="space-y-4">
      {/* plain-English explainer */}
      <div className="rounded-xl border border-accent/20 bg-accent/[0.04] p-4 space-y-3">
        <div className="flex items-start gap-2.5">
          <span className="text-accent text-base leading-none mt-0.5">ℹ</span>
          <div className="space-y-2 text-[13px] text-surface-300 leading-relaxed">
            <p>
              The <span className="text-surface-100 font-semibold">single-day replay</span> above answers
              “how did <em>one</em> day’s picks do?” A <span className="text-surface-100 font-semibold">walk-forward backtest</span> answers
              the bigger question: <span className="text-surface-100">does this strategy work over time, or was that day just luck?</span>
            </p>
            <p>
              It steps through history — e.g. every week across the last ~8 months — and on each date re-runs the engine
              seeing <span className="text-surface-100 font-semibold">only the data available that day</span> (no peeking ahead).
              Every simulated pick is then tracked to its real outcome. Stacking all those days together is the strategy’s track record.
            </p>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-2 pt-1">
          <div className="rounded-lg bg-surface-800/40 px-3 py-2">
            <div className="text-[11px] font-semibold text-surface-200">Expectancy</div>
            <div className="text-[11px] text-surface-400 leading-snug">Avg profit per trade in <span className="text-surface-300">R</span> (1R = what you risk per trade). Above 0 = an edge.</div>
          </div>
          <div className="rounded-lg bg-surface-800/40 px-3 py-2">
            <div className="text-[11px] font-semibold text-surface-200">Equity curve</div>
            <div className="text-[11px] text-surface-400 leading-snug">Running total of R if you took every pick. Up-and-to-the-right is good.</div>
          </div>
          <div className="rounded-lg bg-surface-800/40 px-3 py-2">
            <div className="text-[11px] font-semibold text-surface-200">By regime</div>
            <div className="text-[11px] text-surface-400 leading-snug">Whether the edge holds in healthy vs. weak market breadth.</div>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-surface-400">
            Cadence
            <select
              value={stepDays} onChange={(e) => setStepDays(Number(e.target.value))}
              className="mt-1 block rounded-lg bg-surface-800 border border-surface-700 px-2.5 py-2 text-sm text-surface-100 focus:outline-none focus:border-accent"
            >
              {STEP_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
            </select>
          </label>
          <button
            onClick={() => run(false)} disabled={loading}
            className="rounded-lg bg-accent text-white text-sm font-semibold px-4 py-2 hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Running…' : 'Run backtest'}
          </button>
          {data && !loading && (
            <button onClick={() => run(true)} disabled={loading} className="text-[11px] text-surface-500 hover:text-surface-300 underline">
              re-run fresh
            </button>
          )}
          <p className="text-[11px] text-surface-500">Replays the rule-based engine across the window. First run ~30–60s; cached after.</p>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-10 text-center">
          <div className="inline-block w-7 h-7 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-2" />
          <p className="text-surface-400 text-sm">Walking the engine forward through history…</p>
        </div>
      )}
      {error && !loading && (
        <div className="rounded-xl border border-danger/30 bg-danger/[0.06] p-4 text-center text-danger text-sm">{error}</div>
      )}

      {!loading && agg && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <StatTile label="Expectancy" value={fmtR(agg.expectancy_r)} tone={agg.expectancy_r >= 0 ? 'text-success' : 'text-danger'} sub="per trade" />
            <StatTile label="Total" value={fmtR(agg.total_r)} tone={agg.total_r >= 0 ? 'text-success' : 'text-danger'} sub={`${agg.resolved} resolved`} />
            <StatTile label="Hit rate" value={agg.hit_rate_pct != null ? `${agg.hit_rate_pct}%` : '—'} sub={`${agg.wins}W / ${agg.losses}L`} />
            <StatTile label="Profit factor" value={agg.all_wins ? '∞' : agg.profit_factor == null ? '—' : agg.profit_factor} tone={agg.all_wins || (agg.profit_factor && agg.profit_factor >= 1) ? 'text-success' : 'text-danger'} />
            <StatTile label="Ideas" value={agg.total_ideas} sub={`${agg.dates_run} dates`} />
            <StatTile label="Avg win / loss" value={`${fmtR(agg.avg_win_r)} / ${fmtR(agg.avg_loss_r)}`} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <StatTile label="Max drawdown" value={fmtR(agg.max_drawdown_r)} tone="text-danger" sub="peak-to-trough" />
            <StatTile label="System quality" value={agg.system_quality != null ? agg.system_quality : '—'} tone={agg.system_quality >= 0 ? 'text-success' : 'text-danger'} sub="expectancy / R std" />
            <StatTile label="Avg hold" value={agg.avg_holding_bars != null ? `${agg.avg_holding_bars}d` : '—'} sub="bars in trade" />
            <StatTile label="Avg peak (MFE)" value={fmtR(agg.avg_mfe_r)} tone="text-surface-200" sub="ran in favor" />
            <StatTile label="Strategy" value={signPct(agg.strategy_return_pct)} tone={tone(agg.strategy_return_pct)} sub={`at ${data.params?.risk_pct}%/idea`} />
            <StatTile label="SPY (buy & hold)" value={signPct(agg.spy_return_pct)} tone={tone(agg.spy_return_pct)} sub="same window" />
          </div>

          <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-4">
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="font-display font-semibold text-surface-100">Equity curve</h3>
              <span className="text-[11px] text-surface-500 flex items-center gap-2">
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-accent" />strategy</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed border-surface-500" />SPY</span>
                <span className="text-surface-600">· % return</span>
              </span>
            </div>
            <EquityCurve points={data.equity_curve} />
          </div>

          {data.by_regime && Object.keys(data.by_regime).length > 0 && (
            <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-4">
              <h3 className="font-display font-semibold text-surface-100 mb-2">By regime</h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-surface-500 text-left">
                    <th className="py-1 font-medium">Regime</th>
                    <th className="py-1 font-medium text-right">Ideas</th>
                    <th className="py-1 font-medium text-right">Hit rate</th>
                    <th className="py-1 font-medium text-right">Expectancy</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.by_regime).map(([lvl, s]) => (
                    <tr key={lvl} className="border-t border-surface-800/40">
                      <td className="py-1.5 capitalize text-surface-200">{lvl}</td>
                      <td className="py-1.5 text-right font-mono text-surface-300">{s.ideas}</td>
                      <td className="py-1.5 text-right font-mono text-surface-300">{s.hit_rate_pct != null ? `${s.hit_rate_pct}%` : '—'}</td>
                      <td className={`py-1.5 text-right font-mono font-semibold ${s.expectancy_r >= 0 ? 'text-success' : 'text-danger'}`}>{fmtR(s.expectancy_r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {Array.isArray(data.dates) && data.dates.length > 0 && (
            <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-4">
              <h3 className="font-display font-semibold text-surface-100 mb-2">By date</h3>
              <div className="space-y-1.5">
                {data.dates.map((d) => (
                  <details key={d.as_of} className="rounded-lg bg-surface-800/30 border border-surface-700/30">
                    <summary className="flex items-center justify-between px-3 py-1.5 cursor-pointer text-xs">
                      <span className="text-surface-200 font-mono">{d.as_of}</span>
                      <span className="flex items-center gap-3">
                        <span className="text-surface-500 capitalize">{d.regime}</span>
                        {d.alpha_pct != null && <span className={`font-mono ${tone(d.alpha_pct)}`}>α {signPct(d.alpha_pct)}</span>}
                        <span className="text-surface-500">{d.ideas.length} ideas</span>
                      </span>
                    </summary>
                    <table className="w-full text-xs border-t border-surface-800/40">
                      <tbody>
                        {d.ideas.map((i, idx) => {
                          const oc = OUTCOME_STYLE[i.outcome] || OUTCOME_STYLE.untracked
                          return (
                            <tr key={idx} className="border-t border-surface-800/30">
                              <td className="py-1 px-3 font-semibold text-surface-100">{i.ticker}</td>
                              <td className="py-1 px-2"><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${oc.cls}`}>{oc.label}</span></td>
                              <td className="py-1 px-2 text-right font-mono text-surface-600 hidden sm:table-cell" title="peak (MFE)">{i.mfe_r != null ? `↑${i.mfe_r}R` : ''}</td>
                              <td className={`py-1 px-2 text-right font-mono ${tone(i.exit_price != null ? i.realized_return_pct : i.change_pct)}`}>{signPct(i.exit_price != null ? i.realized_return_pct : i.change_pct)}</td>
                              <td className={`py-1 px-3 text-right font-mono font-semibold ${i.r_multiple == null ? 'text-surface-500' : tone(i.r_multiple)}`}>{fmtR(i.r_multiple)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </details>
                ))}
              </div>
            </div>
          )}
          <p className="text-[11px] text-surface-600">
            Backtests the deterministic rule-based engine (not the live LLM picks). See limitations in the strategy doc: survivorship in the universe, daily-bar resolution, no fees/slippage.
          </p>
        </>
      )}
    </div>
  )
}

export default function AITrader() {
  const [tab, setTab] = useState('live')
  const [budget, setBudget] = useState(500)
  const [account, setAccount] = useState(25000)
  const [riskPct, setRiskPct] = useState(1.0)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState(null)
  const [stats, setStats] = useState(null)
  const [btHistory, setBtHistory] = useState(null)

  const loadHistory = useCallback(async () => {
    try {
      const h = await getAITraderHistory()
      setHistory(h.records || [])
      setStats(h.stats || null)
    } catch {
      /* non-fatal */
    }
  }, [])

  const loadBtHistory = useCallback(async () => {
    try {
      const h = await getAITraderBacktestHistory()
      setBtHistory(h.records || [])
    } catch {
      /* non-fatal */
    }
  }, [])

  const load = useCallback(async (fresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const d = await getAITraderIdeas({ budget, minAdr: 0.03, account, riskPct, fresh })
      setData(d)
      loadHistory() // refresh ledger (today's run may have just been recorded)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [budget, account, riskPct, loadHistory])

  useEffect(() => {
    load(false)
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (tab === 'backtest' && btHistory === null) loadBtHistory()
  }, [tab, btHistory, loadBtHistory])

  const ideas = data?.ideas || []

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6 animate-fade-in">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-surface-50">AI Trader</h1>
          <p className="text-sm text-surface-400 mt-1">
            Today's top <span className="text-surface-200">Qullamaggie</span> setups · ADR ≥ 3% · regime-aware · risk-sized
          </p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-xs text-surface-400">
            Account
            <div className="mt-1 flex items-center rounded-lg bg-surface-800 border border-surface-700 px-2.5">
              <span className="text-surface-500 text-sm">$</span>
              <input
                type="number" min="500" step="1000" value={account}
                onChange={(e) => setAccount(Math.max(500, Number(e.target.value) || 0))}
                className="w-24 bg-transparent py-2 px-1 text-sm text-surface-100 font-mono focus:outline-none"
              />
            </div>
          </label>
          <label className="text-xs text-surface-400">
            Risk / idea
            <div className="mt-1 flex items-center rounded-lg bg-surface-800 border border-surface-700 px-2.5">
              <input
                type="number" min="0.05" max="10" step="0.25" value={riskPct}
                onChange={(e) => setRiskPct(Math.min(10, Math.max(0.05, Number(e.target.value) || 0)))}
                className="w-12 bg-transparent py-2 px-1 text-sm text-surface-100 font-mono focus:outline-none"
              />
              <span className="text-surface-500 text-sm">%</span>
            </div>
          </label>
          <label className="text-xs text-surface-400">
            Per-idea cap
            <div className="mt-1 flex items-center rounded-lg bg-surface-800 border border-surface-700 px-2.5">
              <span className="text-surface-500 text-sm">$</span>
              <input
                type="number" min="50" step="50" value={budget}
                onChange={(e) => setBudget(Math.max(50, Number(e.target.value) || 0))}
                className="w-20 bg-transparent py-2 px-1 text-sm text-surface-100 font-mono focus:outline-none"
              />
            </div>
          </label>
          {tab === 'live' && (
            <button
              onClick={() => load(true)} disabled={loading}
              className="rounded-lg bg-accent text-white text-sm font-semibold px-4 py-2 hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Scanning…' : 'Generate ideas'}
            </button>
          )}
        </div>
      </div>

      {/* tabs */}
      <div className="flex items-center gap-1 border-b border-surface-800">
        {[['live', 'Live ideas'], ['backtest', 'Backtest']].map(([id, label]) => (
          <button
            key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === id ? 'border-accent text-surface-50' : 'border-transparent text-surface-400 hover:text-surface-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'backtest' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-surface-700/40 bg-surface-800/30 px-4 py-3">
            <p className="text-sm text-surface-300">
              Point-in-time backtest of the <span className="text-surface-100 font-semibold">rule-based</span> engine — only data on/before
              the chosen date drives the picks, then they're scored forward to today. Uses your Account / Risk / Cap settings above.
            </p>
          </div>
          <div>
            <h2 className="font-display font-semibold text-lg text-surface-50 mb-2">Inspect a single day</h2>
            <BacktestInspector budget={budget} account={account} riskPct={riskPct} onRan={loadBtHistory} />
          </div>
          <div>
            <h2 className="font-display font-semibold text-lg text-surface-50 mb-2">Walk-forward backtest</h2>
            <WalkForwardPanel budget={budget} account={account} riskPct={riskPct} />
          </div>
          <HistoryLedger
            records={btHistory}
            title="Backtest history"
            subtitle="entry → exit · realized % · peak MFE · R · scale-out + MA trail"
            empty="No saved backtests yet — replay a date above and it'll be saved here, re-priced to today."
          />
        </div>
      )}

      {tab === 'live' && (
      <>
      {/* regime banner */}
      {data?.regime && !loading && <RegimeBanner regime={data.regime} />}

      {/* status line */}
      {data && !loading && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className={`px-2 py-0.5 rounded-full font-semibold ${data.market_active ? 'bg-success/15 text-success' : 'bg-surface-700 text-surface-400'}`}>
            Market {data.market_active ? 'open' : 'closed'}
          </span>
          <span className="text-surface-500">as of {new Date(data.as_of).toLocaleString()}</span>
          <span className="text-surface-600">·</span>
          <span className="text-surface-500">{data.candidates_considered} candidates scanned</span>
          {data.cached && (
            <span className="text-surface-600">
              · {data.market_active ? 'cached' : 'last session'} {fmtAge(data.cache_age_seconds)}
            </span>
          )}
          {data.ai_available
            ? <span className="px-2 py-0.5 rounded-full bg-accent/15 text-accent font-semibold">AI ranked · T={data.temperature ?? 0}</span>
            : <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-semibold">rule-based</span>}
        </div>
      )}

      {/* setup criteria */}
      {data?.criteria && !loading && <SetupCriteria criteria={data.criteria} />}

      {/* AI-unavailable banner */}
      {data && !data.ai_available && data.error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200/90">
          <span className="font-semibold">AI ranking unavailable.</span> {data.error} — showing the scan's top rule-based setups in the meantime.
        </div>
      )}

      {/* loading */}
      {loading && (
        <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-12 text-center">
          <div className="inline-block w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-3" />
          <p className="text-surface-300 text-sm">Scanning today's market &amp; ranking setups…</p>
          <p className="text-surface-500 text-xs mt-1">This runs a full universe scan — give it ~30 seconds.</p>
        </div>
      )}

      {/* error */}
      {error && !loading && (
        <div className="rounded-xl border border-danger/30 bg-danger/[0.06] p-6 text-center text-danger text-sm">
          {error}
        </div>
      )}

      {/* portfolio risk */}
      {!loading && !error && ideas.length > 0 && data?.portfolio && (
        <PortfolioPanel portfolio={data.portfolio} regime={data.regime} />
      )}

      {/* ideas */}
      {!loading && !error && ideas.length > 0 && (
        <div className="space-y-4">
          {ideas.map((idea, i) => (
            <IdeaCard key={`${idea.ticker}-${i}`} idea={idea} rank={i + 1} budget={data.budget} account={data.account} />
          ))}
        </div>
      )}

      {/* no setups */}
      {!loading && !error && data && ideas.length === 0 && (
        <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-12 text-center">
          <p className="text-surface-200 font-display font-semibold text-lg mb-1">No clean setups today</p>
          <p className="text-surface-400 text-sm max-w-md mx-auto">
            {data.no_setups_reason || data.market_note || 'Nothing in today’s scan met the Qullamaggie criteria. Discipline over activity — wait for the A+ setup.'}
          </p>
        </div>
      )}

      {/* track record + history ledger */}
      <TrackRecord stats={stats} />
      <HistoryLedger records={history} />
      </>
      )}

      {/* disclaimer */}
      <p className="text-[11px] text-surface-600 text-center pt-2">
        Research tool, not financial advice. Always confirm the chart and manage your own risk before trading.
      </p>
    </div>
  )
}
