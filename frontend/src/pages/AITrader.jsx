import { useState, useEffect, useCallback } from 'react'
import { getAITraderIdeas, getAITraderHistory } from '../api/aiTrader'

const fmtUSD = (v, d = 2) =>
  v == null || Number.isNaN(Number(v))
    ? '—'
    : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
const fmtPct = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v) >= 0 ? '' : ''}${Number(v).toFixed(d)}%`)
const signPct = (v, d = 1) => (v == null ? '—' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(d)}%`)
const tone = (v) => (v == null ? 'text-surface-500' : v > 0 ? 'text-success' : v < 0 ? 'text-danger' : 'text-surface-400')

const SETUP_STYLE = {
  Breakout: 'bg-accent/15 text-accent border-accent/30',
  'Episodic Pivot': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
}
const CONV_STYLE = {
  high: 'bg-success/15 text-success',
  medium: 'bg-amber-500/15 text-amber-300',
  low: 'bg-surface-700 text-surface-300',
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

function IdeaCard({ idea, rank, budget }) {
  const s = idea.stats || {}
  const tvUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(idea.ticker)}`
  const setupCls = SETUP_STYLE[idea.setup] || 'bg-surface-700 text-surface-200 border-surface-600'
  const convCls = CONV_STYLE[idea.conviction] || CONV_STYLE.low
  const change = s.today_change_pct
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
            <div className="flex items-center gap-1.5 mt-0.5">
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
        </div>
      </div>

      {/* trade plan */}
      <div className="flex gap-2">
        <PlanCell label="Entry" value={fmtUSD(idea.entry)} tone="text-accent" />
        <PlanCell label="Stop" value={fmtUSD(idea.stop)} tone="text-danger" />
        <PlanCell label="Target" value={fmtUSD(idea.target)} tone="text-success" />
        <PlanCell label="R:R" value={idea.rr_to_target ? `${idea.rr_to_target}×` : '—'} tone="text-surface-200" />
      </div>

      {/* sizing */}
      <div className="rounded-lg bg-surface-800/40 border border-surface-700/40 px-3 py-2 flex items-center justify-between text-xs">
        <span className="text-surface-400">
          {fmtUSD(budget, 0)} →{' '}
          <span className="text-surface-100 font-semibold">{idea.shares} sh</span>
          <span className="text-surface-500"> ≈ {fmtUSD(idea.position_cost)}</span>
        </span>
        <span className="text-surface-400">
          risk{' '}
          <span className="text-danger font-semibold">{fmtUSD(idea.risk_dollars)}</span>
          {idea.risk_pct != null && <span className="text-surface-500"> ({idea.risk_pct}%)</span>}
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

function HistoryLedger({ records }) {
  if (!records || records.length === 0) {
    return (
      <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-6 text-center text-sm text-surface-500">
        No history yet — today's picks will appear here, then track against the price going forward.
      </div>
    )
  }
  return (
    <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-display font-semibold text-lg text-surface-50">Suggestion history</h2>
        <span className="text-[11px] text-surface-500">suggested price → latest close · 1/day · last 365 days</span>
      </div>
      <div className="space-y-3">
        {records.map((r) => (
          <div key={r.date} className="rounded-lg bg-surface-800/30 border border-surface-700/30 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 bg-surface-800/50">
              <span className="text-xs font-semibold text-surface-200">
                {r.date}
                {!r.ai_available && <span className="ml-2 text-[10px] text-surface-500 font-normal">rule-based</span>}
              </span>
              {r.avg_change_pct != null && (
                <span className={`text-xs font-mono font-semibold ${tone(r.avg_change_pct)}`}>avg {signPct(r.avg_change_pct)}</span>
              )}
            </div>
            <table className="w-full text-xs">
              <tbody>
                {r.ideas.map((i, idx) => (
                  <tr key={idx} className="border-t border-surface-800/40">
                    <td className="py-1.5 px-3 font-semibold text-surface-100">{i.ticker}</td>
                    <td className="py-1.5 px-2 text-surface-500 hidden sm:table-cell">{i.setup}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-surface-400">{fmtUSD(i.suggested_price)}</td>
                    <td className="py-1.5 px-1 text-surface-600 text-center">→</td>
                    <td className="py-1.5 px-2 text-right font-mono text-surface-200">{fmtUSD(i.current_price)}</td>
                    <td className={`py-1.5 px-3 text-right font-mono font-semibold ${tone(i.change_pct)}`}>{signPct(i.change_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AITrader() {
  const [budget, setBudget] = useState(500)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState(null)

  const loadHistory = useCallback(async () => {
    try {
      const h = await getAITraderHistory()
      setHistory(h.records || [])
    } catch {
      /* non-fatal */
    }
  }, [])

  const load = useCallback(async (fresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const d = await getAITraderIdeas({ budget, minAdr: 0.03, fresh })
      setData(d)
      loadHistory() // refresh ledger (today's run may have just been recorded)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [budget, loadHistory])

  useEffect(() => {
    load(false)
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ideas = data?.ideas || []

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6 animate-fade-in">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-surface-50">AI Trader</h1>
          <p className="text-sm text-surface-400 mt-1">
            Today's top <span className="text-surface-200">Qullamaggie</span> setups · ADR ≥ 3% · sized for your daily budget
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs text-surface-400">
            Daily budget
            <div className="mt-1 flex items-center rounded-lg bg-surface-800 border border-surface-700 px-2.5">
              <span className="text-surface-500 text-sm">$</span>
              <input
                type="number" min="50" step="50" value={budget}
                onChange={(e) => setBudget(Math.max(50, Number(e.target.value) || 0))}
                className="w-20 bg-transparent py-2 px-1 text-sm text-surface-100 font-mono focus:outline-none"
              />
            </div>
          </label>
          <button
            onClick={() => load(true)} disabled={loading}
            className="rounded-lg bg-accent text-white text-sm font-semibold px-4 py-2 hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Scanning…' : 'Generate ideas'}
          </button>
        </div>
      </div>

      {/* status line */}
      {data && !loading && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className={`px-2 py-0.5 rounded-full font-semibold ${data.market_active ? 'bg-success/15 text-success' : 'bg-surface-700 text-surface-400'}`}>
            Market {data.market_active ? 'open' : 'closed'}
          </span>
          <span className="text-surface-500">as of {new Date(data.as_of).toLocaleString()}</span>
          <span className="text-surface-600">·</span>
          <span className="text-surface-500">{data.candidates_considered} candidates scanned</span>
          {data.cached && <span className="text-surface-600">· cached {Math.round((data.cache_age_seconds || 0) / 60)}m ago</span>}
          {data.ai_available
            ? <span className="px-2 py-0.5 rounded-full bg-accent/15 text-accent font-semibold">AI ranked</span>
            : <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-semibold">rule-based</span>}
        </div>
      )}

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

      {/* ideas */}
      {!loading && !error && ideas.length > 0 && (
        <div className="space-y-4">
          {ideas.map((idea, i) => (
            <IdeaCard key={`${idea.ticker}-${i}`} idea={idea} rank={i + 1} budget={data.budget} />
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

      {/* history ledger */}
      <HistoryLedger records={history} />

      {/* disclaimer */}
      <p className="text-[11px] text-surface-600 text-center pt-2">
        Research tool, not financial advice. Always confirm the chart and manage your own risk before trading.
      </p>
    </div>
  )
}
