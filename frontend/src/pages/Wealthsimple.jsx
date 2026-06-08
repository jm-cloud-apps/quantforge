import { useEffect, useMemo, useState, Fragment } from 'react'
import {
  ComposedChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { getWealthsimpleSummary, getWealthsimpleTransactions } from '../api/wealthsimple'

const fmtCAD = (v, { signed = false } = {}) => {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  const s = `$${Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (n < 0) return `-${s}`
  return signed ? `+${s}` : s
}
const fmtK = (v) => {
  if (v == null) return '—'
  const n = Number(v)
  const a = Math.abs(n)
  const s = a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${a.toFixed(0)}`
  return n < 0 ? `-${s}` : s
}
const fmtNum = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('en-CA', { maximumFractionDigits: d }))
const toneCls = (v) => (v == null ? 'text-surface-100' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-surface-100')
const shortMonth = (ym) => {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || '')
  if (!m) return ym
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[parseInt(m[2], 10) - 1]} '${m[1].slice(2)}`
}

function StatCard({ label, value, sub, tone }) {
  return (
    <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-4">
      <p className="text-[10px] font-medium text-surface-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold tracking-tight mt-1 tabular-nums ${tone || 'text-surface-100'}`}>{value}</p>
      {sub && <p className="text-[11px] text-surface-500 mt-1">{sub}</p>}
    </div>
  )
}

const TX_TONE = {
  BUY: 'text-rose-300', SELL: 'text-emerald-300', TRFIN: 'text-cyan-300',
  TRFOUT: 'text-amber-300', INTCHARGED: 'text-rose-400', DIV: 'text-emerald-300', NRT: 'text-surface-400',
}

// Compact transaction list used inside a position's drill-down drawer.
function TxnRows({ items }) {
  if (!items || items.length === 0) {
    return <div className="text-[11px] text-surface-500 py-2 px-3">No buy/sell transactions.</div>
  }
  return (
    <table className="w-full text-[12px]">
      <tbody>
        {items.map((t, i) => (
          <tr key={i} className="border-b border-surface-800/30 last:border-0">
            <td className="py-1 pl-6 pr-2 font-mono text-surface-400 whitespace-nowrap">{t.date}</td>
            <td className={`py-1 px-2 font-medium ${TX_TONE[t.type] || 'text-surface-300'}`}>{t.type}</td>
            <td className="py-1 px-2 text-right font-mono tabular-nums text-surface-400">{t.shares ? fmtNum(t.shares, 0) : '—'}</td>
            <td className="py-1 px-2 text-right font-mono tabular-nums text-surface-400">{t.price ? `@ ${fmtCAD(t.price)}` : '—'}</td>
            <td className={`py-1 px-2 text-right font-mono tabular-nums ${toneCls(t.amount)}`}>{fmtCAD(t.amount, { signed: true })}</td>
            <td className="py-1 pr-3 pl-2 text-right font-mono tabular-nums text-surface-600">{fmtCAD(t.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Chevron({ open }) {
  return (
    <svg className={`inline-block w-3 h-3 mr-1.5 text-surface-500 transition-transform ${open ? 'rotate-90' : ''}`}
         fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

function RealizedChart({ months }) {
  const data = (months || []).map((m) => ({
    month: shortMonth(m.month),
    realized: m.realized || 0,
    cum: m.cum_realized || 0,
  }))
  if (data.length === 0) return null
  return (
    <div className="h-[260px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="rgba(51,65,85,0.25)" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtK} width={48} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 2 }}
            itemStyle={{ color: '#cbd5e1' }}
            cursor={{ fill: 'rgba(148,163,184,0.08)' }}
            formatter={(v, n) => [fmtCAD(v, { signed: true }), n === 'cum' ? 'Cumulative' : 'Monthly realized']}
          />
          <ReferenceLine y={0} stroke="rgba(148,163,184,0.4)" />
          <Bar dataKey="realized" radius={[2, 2, 0, 0]} maxBarSize={28}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.realized >= 0 ? '#34d399' : '#fb7185'} />
            ))}
          </Bar>
          <Line type="monotone" dataKey="cum" stroke="#38bdf8" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function Wealthsimple() {
  const [data, setData] = useState(null)
  const [txns, setTxns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set()) // drill-down keys, e.g. "closed:MU"
  const [txTicker, setTxTicker] = useState('')             // Recent-activity ticker filter
  const [txType, setTxType] = useState('')                 // Recent-activity type filter

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // Pull the full ledger (only ~130 rows) so drill-downs have every txn.
    Promise.all([getWealthsimpleSummary(), getWealthsimpleTransactions(2000)])
      .then(([s, t]) => { if (!cancelled) { setData(s); setTxns(t.transactions || []) } })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Group transactions by ticker (chronological) for position drill-downs.
  const txByTicker = useMemo(() => {
    const map = new Map()
    // txns come newest-first; reverse for chronological reading in the drawer.
    for (const t of [...txns].reverse()) {
      if (!t.ticker) continue
      if (!map.has(t.ticker)) map.set(t.ticker, [])
      map.get(t.ticker).push(t)
    }
    return map
  }, [txns])

  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  if (loading) {
    return <div className="rounded-2xl bg-surface-900/60 border border-surface-700/40 p-12 text-center text-surface-400">Loading Wealthsimple…</div>
  }
  if (error) {
    return (
      <div className="space-y-3">
        <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">Wealthsimple</h1>
        <div className="rounded-xl bg-rose-500/10 border border-rose-400/30 px-4 py-3 text-sm text-rose-200">{error}</div>
      </div>
    )
  }

  const s = data.summary
  const holdings = data.holdings || []
  const closed = data.closed_positions || []
  const byMonth = [...(data.by_month || [])].reverse()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-semibold text-[28px] text-surface-50 tracking-tight">Wealthsimple</h1>
          <p className="text-surface-400 text-[13px] mt-1">
            Non-registered margin account · {s.currency} · {s.trade_count} trades across {s.months_active} active months · realized P&amp;L from average cost.
          </p>
        </div>
        <div className="text-[11px] font-mono text-surface-600 text-right">
          {data.row_count} ledger rows{s.last_date ? ` · through ${s.last_date}` : ''}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Net result"
          value={fmtCAD(s.net_result, { signed: true })}
          tone={toneCls(s.net_result)}
          sub="Realized + div − interest − tax"
        />
        <StatCard
          label="Realized P&L"
          value={fmtCAD(s.realized_pnl, { signed: true })}
          tone={toneCls(s.realized_pnl)}
          sub={`${fmtCAD(s.realized_closed, { signed: true })} closed · ${fmtCAD(s.realized_open, { signed: true })} on open`}
        />
        <StatCard
          label="Win rate (round-trips)"
          value={s.win_rate != null ? `${s.win_rate}%` : '—'}
          tone={s.win_rate == null ? '' : s.win_rate >= 50 ? 'text-emerald-400' : 'text-rose-400'}
          sub={`${s.closed_winners}W · ${s.closed_losers}L of ${s.closed_cycles} round-trips`}
        />
        <StatCard label="Cash balance" value={fmtCAD(s.latest_balance)} tone={toneCls(s.latest_balance)} sub={s.latest_balance < 0 ? 'On margin' : 'Settled cash'} />
        <StatCard label="Net deposits" value={fmtCAD(s.net_deposits)} sub={`${fmtCAD(s.deposits)} in · ${fmtCAD(s.withdrawals)} out`} />
        <StatCard label="Holdings @ cost" value={fmtCAD(s.holdings_book_value)} sub={`${holdings.length} position${holdings.length === 1 ? '' : 's'}`} />
        <StatCard label="Dividends" value={fmtCAD(s.dividends, { signed: true })} tone={toneCls(s.dividends)} sub={`Tax ${fmtCAD(s.tax)}`} />
        <StatCard label="Margin interest" value={fmtCAD(s.interest_paid)} tone={toneCls(s.interest_paid)} sub="Total charged" />
      </div>

      {/* Realized P&L chart */}
      <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-display font-semibold text-base text-surface-50">Realized P&L by month</h2>
          <span className="text-[11px] text-surface-500">bars = monthly · <span className="text-cyan-400">line</span> = cumulative</span>
        </div>
        <RealizedChart months={data.by_month} />
      </div>

      {/* Holdings + Cash flow split */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Holdings (open positions) */}
        <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-5">
          <h2 className="font-display font-semibold text-base text-surface-50 mb-3">Open positions <span className="text-[11px] text-surface-500 font-normal">· held at average cost · click to see trades</span></h2>
          {holdings.length === 0 ? (
            <p className="text-sm text-surface-500 py-6 text-center">No open positions.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-surface-500 border-b border-surface-700/40">
                  <th className="text-left font-medium py-2">Ticker</th>
                  <th className="text-right font-medium py-2">Shares</th>
                  <th className="text-right font-medium py-2">Avg cost</th>
                  <th className="text-right font-medium py-2">Book value</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const key = `open:${h.ticker}`
                  const isOpen = expanded.has(key)
                  const trades = (txByTicker.get(h.ticker) || []).filter((t) => t.type === 'BUY' || t.type === 'SELL')
                  return (
                    <Fragment key={h.ticker}>
                      <tr onClick={() => toggle(key)} className="border-b border-surface-800/40 last:border-0 cursor-pointer hover:bg-surface-800/30">
                        <td className="py-2">
                          <span className="font-mono font-semibold text-surface-100"><Chevron open={isOpen} />{h.ticker}</span>
                          <span className="block text-[10px] text-surface-500 truncate max-w-[280px] pl-[18px]">{h.name}</span>
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums text-surface-200">{fmtNum(h.shares, 2)}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-surface-300">{fmtCAD(h.avg_cost)}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-surface-100">{fmtCAD(h.book_value)}</td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-surface-950/60">
                          <td colSpan={4} className="px-0 py-1.5">
                            <TxnRows items={trades} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Cash flow rollup */}
        <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-5">
          <h2 className="font-display font-semibold text-base text-surface-50 mb-3">Cash flow</h2>
          <ul className="space-y-2.5 text-sm">
            {[
              ['Deposits', s.deposits, 'text-cyan-300'],
              ['Withdrawals', s.withdrawals, 'text-amber-300'],
              ['Buys', -s.total_buy_value, 'text-rose-300'],
              ['Sells', s.total_sell_value, 'text-emerald-300'],
              ['Dividends', s.dividends, 'text-emerald-300'],
              ['Margin interest', s.interest_paid, 'text-rose-400'],
              ['Non-resident tax', s.tax, 'text-surface-400'],
            ].map(([label, val, cls]) => (
              <li key={label} className="flex items-center justify-between">
                <span className="text-surface-400">{label}</span>
                <span className={`font-mono tabular-nums ${cls}`}>{fmtCAD(val, { signed: true })}</span>
              </li>
            ))}
            <li className="flex items-center justify-between pt-2.5 border-t border-surface-700/40">
              <span className="text-surface-200 font-medium">Cash balance</span>
              <span className={`font-mono tabular-nums font-semibold ${toneCls(s.latest_balance)}`}>{fmtCAD(s.latest_balance)}</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Closed positions — realized P&L from COMPLETED round-trips (position
          returned to flat). A ticker can appear here AND in Open positions if
          it was round-tripped before and re-bought later. */}
      <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-display font-semibold text-base text-surface-50">Closed positions</h2>
          <span className="text-[11px] text-surface-500">realized P&amp;L from completed round-trips · “open” = also held now · click to see trades</span>
        </div>
        {closed.length === 0 ? (
          <p className="text-sm text-surface-500 py-6 text-center">No completed round-trips yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-surface-500 border-b border-surface-700/40">
                  <th className="text-left font-medium py-2">Ticker</th>
                  <th className="text-right font-medium py-2">Round-trips</th>
                  <th className="text-right font-medium py-2">Bought</th>
                  <th className="text-right font-medium py-2">Sold</th>
                  <th className="text-right font-medium py-2">Avg buy</th>
                  <th className="text-right font-medium py-2">Avg sell</th>
                  <th className="text-right font-medium py-2">Realized P&L</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((t) => {
                  const key = `closed:${t.ticker}`
                  const isOpen = expanded.has(key)
                  const trades = (txByTicker.get(t.ticker) || []).filter((x) => x.type === 'BUY' || x.type === 'SELL')
                  return (
                    <Fragment key={t.ticker}>
                      <tr onClick={() => toggle(key)} className="border-b border-surface-800/40 last:border-0 cursor-pointer hover:bg-surface-800/30">
                        <td className="py-2">
                          <span className="font-mono font-semibold text-surface-100"><Chevron open={isOpen} />{t.ticker}</span>
                          {t.still_open && (
                            <span className="ml-2 text-[9px] uppercase tracking-wider text-cyan-300/90 border border-cyan-500/30 rounded px-1 py-0.5 align-middle">open</span>
                          )}
                          <span className="block text-[10px] text-surface-500 truncate max-w-[280px] pl-[18px]">{t.name}</span>
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums text-surface-400">{t.cycles}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-surface-300">{fmtNum(t.bought_shares, 0)}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-surface-300">{fmtNum(t.sold_shares, 0)}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-surface-400">{fmtCAD(t.avg_buy)}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-surface-400">{fmtCAD(t.avg_sell)}</td>
                        <td className={`py-2 text-right font-mono tabular-nums font-semibold ${toneCls(t.realized_pnl)}`}>{fmtCAD(t.realized_pnl, { signed: true })}</td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-surface-950/60">
                          <td colSpan={7} className="px-0 py-1.5">
                            <TxnRows items={trades} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Monthly activity */}
      <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-5">
        <h2 className="font-display font-semibold text-base text-surface-50 mb-3">Monthly activity</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-surface-500 border-b border-surface-700/40">
                <th className="text-left font-medium py-2">Month</th>
                <th className="text-right font-medium py-2">Buys</th>
                <th className="text-right font-medium py-2">Sells</th>
                <th className="text-right font-medium py-2">Bought</th>
                <th className="text-right font-medium py-2">Sold</th>
                <th className="text-right font-medium py-2">Realized</th>
                <th className="text-right font-medium py-2">Net cash flow</th>
              </tr>
            </thead>
            <tbody>
              {byMonth.map((m) => {
                const netCash = (m.deposits || 0) + (m.withdrawals || 0) + (m.dividends || 0) + (m.interest || 0) + (m.tax || 0) + (m.sell_value || 0) - (m.buy_value || 0)
                return (
                  <tr key={m.month} className="border-b border-surface-800/40 last:border-0">
                    <td className="py-2 font-mono text-surface-200">{m.month}</td>
                    <td className="py-2 text-right tabular-nums text-surface-400">{m.buy_count || '—'}</td>
                    <td className="py-2 text-right tabular-nums text-surface-400">{m.sell_count || '—'}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-rose-300/80">{m.buy_value ? fmtCAD(m.buy_value) : '—'}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-emerald-300/80">{m.sell_value ? fmtCAD(m.sell_value) : '—'}</td>
                    <td className={`py-2 text-right font-mono tabular-nums ${toneCls(m.realized)}`}>{m.realized ? fmtCAD(m.realized, { signed: true }) : '—'}</td>
                    <td className={`py-2 text-right font-mono tabular-nums ${toneCls(netCash)}`}>{fmtCAD(netCash, { signed: true })}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* All transactions — filterable */}
      <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="font-display font-semibold text-base text-surface-50">Transactions</h2>
          <div className="flex items-center gap-2">
            <select
              value={txTicker} onChange={(e) => setTxTicker(e.target.value)}
              className="bg-surface-900 border border-surface-700/50 rounded-lg px-2.5 py-1.5 text-xs text-surface-200 outline-none focus:border-accent/40"
            >
              <option value="">All tickers</option>
              {[...txByTicker.keys()].sort().map((tk) => <option key={tk} value={tk}>{tk}</option>)}
            </select>
            <select
              value={txType} onChange={(e) => setTxType(e.target.value)}
              className="bg-surface-900 border border-surface-700/50 rounded-lg px-2.5 py-1.5 text-xs text-surface-200 outline-none focus:border-accent/40"
            >
              <option value="">All types</option>
              {['BUY', 'SELL', 'TRFIN', 'TRFOUT', 'DIV', 'INTCHARGED', 'NRT'].map((ty) => <option key={ty} value={ty}>{ty}</option>)}
            </select>
          </div>
        </div>
        {(() => {
          const filtered = txns.filter((t) =>
            (!txTicker || t.ticker === txTicker) && (!txType || t.type === txType))
          return (
            <>
              <p className="text-[11px] text-surface-500 mb-2">{filtered.length} of {txns.length} transactions</p>
              <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-900">
                    <tr className="text-[10px] uppercase tracking-wider text-surface-500 border-b border-surface-700/40">
                      <th className="text-left font-medium py-2">Date</th>
                      <th className="text-left font-medium py-2">Type</th>
                      <th className="text-left font-medium py-2">Ticker</th>
                      <th className="text-right font-medium py-2">Shares</th>
                      <th className="text-right font-medium py-2">Price</th>
                      <th className="text-right font-medium py-2">Amount</th>
                      <th className="text-right font-medium py-2">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t, i) => (
                      <tr key={i} className="border-b border-surface-800/30 last:border-0">
                        <td className="py-1.5 font-mono text-surface-300 whitespace-nowrap">{t.date}</td>
                        <td className={`py-1.5 font-medium ${TX_TONE[t.type] || 'text-surface-300'}`}>{t.type}</td>
                        <td className="py-1.5 font-mono text-surface-200">{t.ticker || '—'}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums text-surface-400">{t.shares ? fmtNum(t.shares, 0) : '—'}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums text-surface-400">{t.price ? fmtCAD(t.price) : '—'}</td>
                        <td className={`py-1.5 text-right font-mono tabular-nums ${toneCls(t.amount)}`}>{fmtCAD(t.amount, { signed: true })}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums text-surface-500">{fmtCAD(t.balance)}</td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr><td colSpan={7} className="py-6 text-center text-surface-500 text-sm">No transactions match.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )
        })()}
      </div>
    </div>
  )
}
