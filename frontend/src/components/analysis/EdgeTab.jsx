const fmtMoney = (v) => {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  const a = Math.abs(n)
  const body = a >= 1000 ? a.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${n < 0 ? '-' : ''}$${body}`
}
const tone = (v) => (v > 0 ? 'text-success' : v < 0 ? 'text-danger' : 'text-surface-400')

const SEV = {
  good: { ring: 'border-success/30 bg-success/[0.06]', dot: 'bg-success', label: 'text-success' },
  bad: { ring: 'border-danger/30 bg-danger/[0.06]', dot: 'bg-danger', label: 'text-danger' },
  info: { ring: 'border-cyan/30 bg-cyan/[0.06]', dot: 'bg-cyan', label: 'text-cyan' },
}

/* A breakdown table with an inline avg-P&L bar (centered at 0). */
function BreakdownTable({ title, subtitle, rows, labelKey, extra }) {
  if (!rows || rows.length === 0) return null
  const maxAvg = Math.max(1, ...rows.map((r) => Math.abs(r.avg_pnl || 0)))
  return (
    <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-display font-semibold text-base text-surface-50">{title}</h3>
        {subtitle && <span className="text-[11px] text-surface-500">{subtitle}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-surface-500 border-b border-surface-700/40">
              <th className="text-left font-medium py-2">{labelKey === 'day' ? 'Day' : 'Bucket'}</th>
              {extra && <th className="text-right font-medium py-2">{extra.label}</th>}
              <th className="text-right font-medium py-2">Trades</th>
              <th className="text-right font-medium py-2">Win%</th>
              <th className="text-right font-medium py-2">Avg/trade</th>
              <th className="text-left font-medium py-2 pl-3 w-[120px]">Edge</th>
              <th className="text-right font-medium py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const avg = r.avg_pnl || 0
              const pct = Math.min(100, (Math.abs(avg) / maxAvg) * 100)
              return (
                <tr key={i} className="border-b border-surface-800/40 last:border-0">
                  <td className="py-2 text-surface-100 font-medium">{r[labelKey]}</td>
                  {extra && <td className="py-2 text-right font-mono tabular-nums text-surface-400">{extra.fmt(r)}</td>}
                  <td className="py-2 text-right font-mono tabular-nums text-surface-400">{r.count}</td>
                  <td className={`py-2 text-right font-mono tabular-nums ${r.win_rate >= 50 ? 'text-success' : 'text-surface-300'}`}>{r.win_rate}%</td>
                  <td className={`py-2 text-right font-mono tabular-nums font-semibold ${tone(avg)}`}>{fmtMoney(avg)}</td>
                  <td className="py-2 pl-3">
                    <div className="relative h-2 w-full bg-surface-800 rounded-full overflow-hidden flex">
                      <div className="w-1/2 flex justify-end">
                        {avg < 0 && <div className="h-full bg-danger/70 rounded-l-full" style={{ width: `${pct}%` }} />}
                      </div>
                      <div className="w-1/2">
                        {avg > 0 && <div className="h-full bg-success/70 rounded-r-full" style={{ width: `${pct}%` }} />}
                      </div>
                    </div>
                  </td>
                  <td className={`py-2 text-right font-mono tabular-nums ${tone(r.total_pnl)}`}>{fmtMoney(r.total_pnl)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function EdgeTab({ edgeInsights }) {
  if (!edgeInsights) {
    return <div className="rounded-xl bg-surface-900/60 border border-surface-700/40 p-12 text-center text-surface-400">Computing edge insights…</div>
  }
  const d = edgeInsights
  const findings = d.findings || []

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Key insights feed */}
      <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 p-6">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-display font-semibold text-lg text-surface-50">Key insights</h2>
          <span className="text-[11px] text-surface-500">auto-derived from {d.total_trades} trades · ranked by $ impact</span>
        </div>
        {findings.length === 0 ? (
          <p className="text-sm text-surface-500 py-6 text-center">Not enough data yet to surface reliable patterns.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {findings.map((f, i) => {
              const sev = SEV[f.severity] || SEV.info
              return (
                <div key={i} className={`rounded-lg border ${sev.ring} p-3.5 flex gap-3`}>
                  <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${sev.dot}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-surface-100">{f.title}</p>
                    <p className="text-[12px] text-surface-400 mt-0.5 leading-relaxed">{f.detail}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Hold duration + Position size */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <BreakdownTable
          title="By hold duration"
          subtitle="how long you held the trade"
          rows={d.hold_duration}
          labelKey="bucket"
        />
        <BreakdownTable
          title="By position size"
          subtitle="$ exposure quartiles — are bigger bets better?"
          rows={d.position_size}
          labelKey="bucket"
          extra={{ label: 'Avg size', fmt: (r) => (r.avg_size != null ? fmtMoney(r.avg_size) : '—') }}
        />
      </div>

      {/* Entry time of day + Day of week */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <BreakdownTable
          title="By entry time of day"
          subtitle="when you opened the position (ET)"
          rows={d.by_entry_time}
          labelKey="bucket"
        />
        <BreakdownTable
          title="By day of week"
          subtitle="realized on exit day"
          rows={d.by_dow}
          labelKey="day"
        />
      </div>

      {/* Setups */}
      {d.setups && d.setups.length > 0 && (
        <BreakdownTable
          title="By setup"
          subtitle="≥ 4 trades · sorted by total P&L"
          rows={d.setups}
          labelKey="setup"
        />
      )}
    </div>
  )
}
