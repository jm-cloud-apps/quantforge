import { useState } from 'react';

export default function RecentTradesTable({ trades }) {
  const [tradesPage, setTradesPage] = useState(1);
  const tradesPerPage = 20;

  const totalPages = Math.ceil(trades.length / tradesPerPage);
  const startIndex = (tradesPage - 1) * tradesPerPage;
  const endIndex = startIndex + tradesPerPage;
  const paginatedTrades = trades.slice().reverse().slice(startIndex, endIndex);

  return (
    <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
      <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">
        Recent Trades ({trades.length} total)
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-surface-700">
              <th className="text-left py-3 px-4 text-surface-400 text-sm font-medium">Entry Date</th>
              <th className="text-left py-3 px-4 text-surface-400 text-sm font-medium">Exit Date</th>
              <th className="text-left py-3 px-4 text-surface-400 text-sm font-medium">Symbol</th>
              <th className="text-left py-3 px-4 text-surface-400 text-sm font-medium">Side</th>
              <th className="text-right py-3 px-4 text-surface-400 text-sm font-medium">Entry</th>
              <th className="text-right py-3 px-4 text-surface-400 text-sm font-medium">Exit</th>
              <th className="text-right py-3 px-4 text-surface-400 text-sm font-medium">Qty</th>
              <th className="text-right py-3 px-4 text-surface-400 text-sm font-medium">P&L</th>
              <th className="text-right py-3 px-4 text-surface-400 text-sm font-medium">Return %</th>
            </tr>
          </thead>
          <tbody>
            {paginatedTrades.map((trade, index) => (
              <tr key={index} className="border-b border-surface-800 hover:bg-surface-900/30 transition-colors">
                <td className="py-3 px-4 text-surface-100 font-mono text-sm">{trade.entry_date ? new Date(trade.entry_date).toLocaleDateString() : 'N/A'}</td>
                <td className="py-3 px-4 text-surface-100 font-mono text-sm">{trade.exit_date ? new Date(trade.exit_date).toLocaleDateString() : 'N/A'}</td>
                <td className="py-3 px-4 text-surface-100 font-mono text-sm font-semibold">{trade.symbol}</td>
                <td className="py-3 px-4">
                  <span className={`text-xs px-2 py-1 rounded ${trade.side === 'LONG' ? 'bg-accent/15 text-accent' : 'bg-danger/10 text-danger'}`}>{trade.side || 'N/A'}</span>
                </td>
                <td className="py-3 px-4 text-surface-100 font-mono text-sm text-right">${trade.entry_price?.toFixed(2)}</td>
                <td className="py-3 px-4 text-surface-100 font-mono text-sm text-right">${trade.exit_price?.toFixed(2)}</td>
                <td className="py-3 px-4 text-surface-100 font-mono text-sm text-right">{trade.quantity}</td>
                <td className={`py-3 px-4 font-mono text-sm font-semibold text-right ${trade.pnl >= 0 ? 'text-success' : 'text-danger'}`}>{trade.pnl >= 0 ? '+' : ''}${trade.pnl?.toFixed(2)}</td>
                <td className={`py-3 px-4 font-mono text-sm font-semibold text-right ${trade.pnl_pct >= 0 ? 'text-success' : 'text-danger'}`}>{trade.pnl_pct >= 0 ? '+' : ''}{trade.pnl_pct?.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-surface-700">
          <div className="text-surface-400 text-sm">
            Showing {startIndex + 1}-{Math.min(endIndex, trades.length)} of {trades.length} trades
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTradesPage(prev => Math.max(1, prev - 1))}
              disabled={tradesPage === 1}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${tradesPage === 1 ? 'bg-surface-700 text-surface-500 cursor-not-allowed' : 'bg-surface-700 text-surface-100 hover:bg-surface-600'}`}
            >
              Previous
            </button>
            <div className="flex items-center gap-1">
              {[...Array(totalPages)].map((_, i) => {
                const pageNum = i + 1;
                if (pageNum === 1 || pageNum === totalPages || (pageNum >= tradesPage - 1 && pageNum <= tradesPage + 1)) {
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setTradesPage(pageNum)}
                      className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${tradesPage === pageNum ? 'bg-surface-700 text-surface-50 font-semibold shadow-sm' : 'bg-surface-700 text-surface-100 hover:bg-surface-600'}`}
                    >
                      {pageNum}
                    </button>
                  );
                } else if (pageNum === tradesPage - 2 || pageNum === tradesPage + 2) {
                  return <span key={pageNum} className="text-surface-500 px-1">...</span>;
                }
                return null;
              })}
            </div>
            <button
              onClick={() => setTradesPage(prev => Math.min(totalPages, prev + 1))}
              disabled={tradesPage === totalPages}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${tradesPage === totalPages ? 'bg-surface-700 text-surface-500 cursor-not-allowed' : 'bg-surface-700 text-surface-100 hover:bg-surface-600'}`}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
