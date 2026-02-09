export default function TradeList({ trades }) {
  if (!trades?.length) return null

  return (
    <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 backdrop-blur-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-surface-700/50">
        <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
          Trade History ({trades.length} trades)
        </h3>
      </div>
      <div className="overflow-x-auto max-h-64 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-800/60 sticky top-0">
            <tr className="text-left text-surface-400">
              <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Symbol</th>
              <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Entry</th>
              <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Exit</th>
              <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Entry $</th>
              <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Exit $</th>
              <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">Qty</th>
              <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">P&L</th>
              <th className="px-4 py-3 font-medium text-xs uppercase tracking-wider">P&L %</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => (
              <tr
                key={i}
                className="border-t border-surface-700/20 hover:bg-surface-800/50 transition-colors"
              >
                <td className="px-4 py-2 font-medium text-surface-200">{t.symbol || '-'}</td>
                <td className="px-4 py-2 font-mono text-surface-300">{t.entry_date}</td>
                <td className="px-4 py-2 font-mono text-surface-300">{t.exit_date}</td>
                <td className="px-4 py-2 font-mono text-surface-300">${t.entry_price.toFixed(2)}</td>
                <td className="px-4 py-2 font-mono text-surface-300">${t.exit_price.toFixed(2)}</td>
                <td className="px-4 py-2 text-surface-300">{t.quantity}</td>
                <td className={`px-4 py-2 font-mono font-medium ${t.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                  {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                </td>
                <td className={`px-4 py-2 font-mono ${t.pnl_pct >= 0 ? 'text-success' : 'text-danger'}`}>
                  {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
