function MetricCard({ label, value, subtext, positive }) {
  const colorClass =
    positive === true ? 'text-success' : positive === false ? 'text-danger' : 'text-surface-100'
  return (
    <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 backdrop-blur-sm p-4 hover:border-accent/20 transition-colors">
      <p className="text-xs font-medium text-surface-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold tracking-tight mt-1 ${colorClass}`}>{value}</p>
      {subtext && <p className="text-xs text-surface-500 mt-1">{subtext}</p>}
    </div>
  )
}

export default function PerformanceMetrics({ result }) {
  if (!result) return null

  const isPositive = result.total_return_pct >= 0

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <MetricCard
        label="Total Return"
        value={`${result.total_return_pct >= 0 ? '+' : ''}${result.total_return_pct}%`}
        positive={isPositive}
      />
      <MetricCard
        label="Final Value"
        value={`$${result.final_value.toLocaleString()}`}
        subtext={`From $${result.initial_capital.toLocaleString()}`}
      />
      <MetricCard label="CAGR" value={`${result.cagr}%`} subtext="Compound annual growth" />
      <MetricCard label="Sharpe Ratio" value={result.sharpe_ratio} subtext="Risk-adjusted return" />
      <MetricCard
        label="Max Drawdown"
        value={`${result.max_drawdown_pct}%`}
        positive={false}
        subtext="Largest peak-to-trough"
      />
      <MetricCard
        label="Profit Factor"
        value={result.profit_factor}
        subtext="Gross profit / loss"
      />
    </div>
  )
}
