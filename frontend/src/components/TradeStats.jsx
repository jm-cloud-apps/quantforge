export default function TradeStats({ result }) {
  if (!result) return null

  return (
    <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 backdrop-blur-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-surface-700/50">
        <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
          Trade Statistics
        </h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-surface-700/20">
        <div className="p-4">
          <p className="text-xs text-surface-500 mb-1">Total Trades</p>
          <p className="text-xl font-bold text-surface-100">{result.total_trades}</p>
        </div>
        <div className="p-4">
          <p className="text-xs text-surface-500 mb-1">Winning</p>
          <p className="text-xl font-bold text-success">{result.winning_trades}</p>
        </div>
        <div className="p-4">
          <p className="text-xs text-surface-500 mb-1">Losing</p>
          <p className="text-xl font-bold text-danger">{result.losing_trades}</p>
        </div>
        <div className="p-4">
          <p className="text-xs text-surface-500 mb-1">Win Rate</p>
          <p className="text-xl font-bold text-surface-100">{result.win_rate_pct}%</p>
        </div>
        <div className="p-4">
          <p className="text-xs text-surface-500 mb-1">Avg Win</p>
          <p className="text-xl font-bold text-success">+{result.avg_win_pct}%</p>
        </div>
        <div className="p-4">
          <p className="text-xs text-surface-500 mb-1">Avg Loss</p>
          <p className="text-xl font-bold text-danger">{result.avg_loss_pct}%</p>
        </div>
      </div>
    </div>
  )
}
