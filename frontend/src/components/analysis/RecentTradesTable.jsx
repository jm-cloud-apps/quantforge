import { useState, useMemo, Fragment } from 'react';

// Columns the user can sort by. `value` extractors return something
// sortable (number, ISO string, or '') so a single comparator handles all.
const SORT_COLUMNS = [
  { key: 'entry_date',  label: 'Entry Date', align: 'left',  value: (t) => t.entry_date || '' },
  { key: 'exit_date',   label: 'Exit Date',  align: 'left',  value: (t) => t.exit_date  || '' },
  { key: 'symbol',      label: 'Symbol',     align: 'left',  value: (t) => t.symbol     || '' },
  { key: 'side',        label: 'Side',       align: 'left',  value: (t) => t.side       || '' },
  { key: 'entry_price', label: 'Entry',      align: 'right', value: (t) => t.entry_price ?? -Infinity },
  { key: 'exit_price',  label: 'Exit',       align: 'right', value: (t) => t.exit_price  ?? -Infinity },
  { key: 'quantity',    label: 'Qty',        align: 'right', value: (t) => t.quantity    ?? -Infinity },
  { key: 'pnl',         label: 'P&L',        align: 'right', value: (t) => t.pnl         ?? -Infinity },
  { key: 'pnl_pct',     label: 'Return %',   align: 'right', value: (t) => t.pnl_pct     ?? -Infinity },
];

function TradeDetailRow({ trade }) {
  return (
    <tr className="border-b border-surface-800">
      <td colSpan={9} className="px-4 py-3 bg-surface-900/60">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          {trade.setup && (
            <div>
              <span className="text-surface-500 block mb-0.5">Setup</span>
              <span className="text-surface-200 font-medium">{trade.setup}</span>
            </div>
          )}
          {trade.emotion && (
            <div>
              <span className="text-surface-500 block mb-0.5">Emotion</span>
              <span className="text-surface-200 font-medium">{trade.emotion}</span>
            </div>
          )}
          {trade.duration_days != null && (
            <div>
              <span className="text-surface-500 block mb-0.5">Duration</span>
              <span className="text-surface-200 font-mono">{trade.duration_days > 0 ? `${trade.duration_days} day${trade.duration_days !== 1 ? 's' : ''}` : 'Intraday'}</span>
            </div>
          )}
          {trade.market_cap && (
            <div>
              <span className="text-surface-500 block mb-0.5">Market Cap</span>
              <span className="text-surface-200 font-medium">{trade.market_cap}</span>
            </div>
          )}
          {trade.stop_price != null && (
            <div>
              <span className="text-surface-500 block mb-0.5">Stop</span>
              <span className="text-danger font-mono">${trade.stop_price.toFixed(2)}</span>
            </div>
          )}
          {trade.target_price != null && (
            <div>
              <span className="text-surface-500 block mb-0.5">Target</span>
              <span className="text-success font-mono">${trade.target_price.toFixed(2)}</span>
            </div>
          )}
          {trade.conviction != null && (
            <div>
              <span className="text-surface-500 block mb-0.5">Conviction</span>
              <div className="flex gap-0.5 mt-0.5">
                {[1, 2, 3, 4, 5].map(s => (
                  <div key={s} className={`w-2 h-2 rounded-full ${s <= trade.conviction ? 'bg-warning' : 'bg-surface-700'}`} />
                ))}
              </div>
            </div>
          )}
          {trade.grade && (
            <div>
              <span className="text-surface-500 block mb-0.5">Grade</span>
              <span className={`font-mono font-bold ${
                trade.grade === 'A' ? 'text-success' : trade.grade === 'B' ? 'text-cyan' : trade.grade === 'C' ? 'text-warning' : 'text-danger'
              }`}>{trade.grade}</span>
            </div>
          )}
        </div>
        {trade.notes && (
          <div className="mt-3 pt-3 border-t border-surface-700/30">
            <span className="text-surface-500 text-xs block mb-0.5">Notes</span>
            <p className="text-surface-300 text-xs leading-relaxed">{trade.notes}</p>
          </div>
        )}
      </td>
    </tr>
  );
}

export default function RecentTradesTable({ trades }) {
  const [tradesPage, setTradesPage] = useState(1);
  const [expandedRows, setExpandedRows] = useState(new Set());
  // Default sort: most recent exit at the top (matches the old reverse()
  // behaviour, but now via the sort path so column clicks override it).
  const [sort, setSort] = useState({ key: 'exit_date', dir: 'desc' });
  const tradesPerPage = 20;

  const sortedTrades = useMemo(() => {
    const col = SORT_COLUMNS.find((c) => c.key === sort.key);
    if (!col) return trades;
    const rows = trades.slice();
    rows.sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      if (av === bv) return 0;
      // Empty / missing values always sink to the bottom regardless of dir
      // so an unsorted column doesn't shove a wall of "N/A" to the top.
      const aMissing = av === '' || av === -Infinity || av == null;
      const bMissing = bv === '' || bv === -Infinity || bv == null;
      if (aMissing && !bMissing) return 1;
      if (bMissing && !aMissing) return -1;
      const cmp = av < bv ? -1 : 1;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [trades, sort]);

  const totalPages = Math.ceil(sortedTrades.length / tradesPerPage);
  const startIndex = (tradesPage - 1) * tradesPerPage;
  const endIndex = startIndex + tradesPerPage;
  const paginatedTrades = sortedTrades.slice(startIndex, endIndex);

  const toggleSort = (key) => {
    setExpandedRows(new Set());
    setTradesPage(1);
    setSort((s) => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
  };

  const SortIcon = ({ active, dir }) => (
    <svg
      className={`w-3 h-3 inline-block ml-1 ${active ? 'text-accent' : 'text-surface-600 group-hover:text-surface-400'}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
    >
      {active ? (
        dir === 'asc'
          ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          : <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4M8 15l4 4 4-4" />
      )}
    </svg>
  );

  const toggleRow = (index) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const hasExpandableData = trades.some(t => t.setup || t.emotion || t.notes || t.stop_price || t.conviction || t.grade);

  return (
    <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-semibold text-lg text-surface-50">
          Recent Trades ({trades.length} total)
        </h2>
        {hasExpandableData && (
          <span className="text-[11px] text-surface-500">Click a row for details</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-surface-700">
              {SORT_COLUMNS.map((col) => {
                const active = sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={`group py-3 px-4 text-sm font-medium cursor-pointer select-none transition-colors ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    } ${active ? 'text-surface-100' : 'text-surface-400 hover:text-surface-200'}`}
                    title={`Sort by ${col.label}`}
                  >
                    {col.label}
                    <SortIcon active={active} dir={sort.dir} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paginatedTrades.map((trade, index) => {
              const globalIndex = startIndex + index;
              const isExpanded = expandedRows.has(globalIndex);
              const hasDetails = trade.setup || trade.emotion || trade.notes || trade.stop_price || trade.conviction || trade.grade;
              return (
                <Fragment key={globalIndex}>
                  <tr
                    onClick={() => hasDetails && toggleRow(globalIndex)}
                    className={`border-b border-surface-800 transition-colors ${
                      hasDetails ? 'cursor-pointer hover:bg-surface-800/40' : ''
                    } ${isExpanded ? 'bg-surface-800/30' : 'hover:bg-surface-900/30'}`}
                  >
                    <td className="py-3 px-4 text-surface-100 font-mono text-sm">{trade.entry_date ? new Date(trade.entry_date).toLocaleDateString() : 'N/A'}</td>
                    <td className="py-3 px-4 text-surface-100 font-mono text-sm">{trade.exit_date ? new Date(trade.exit_date).toLocaleDateString() : 'N/A'}</td>
                    <td className="py-3 px-4 font-mono text-sm font-semibold">
                      <span className="text-surface-100">{trade.symbol}</span>
                      {trade.setup && (
                        <span className="ml-2 text-[10px] text-surface-500 font-normal hidden lg:inline">{trade.setup.split(' - ')[0]}</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-1 rounded ${trade.side === 'LONG' ? 'bg-accent/15 text-accent' : 'bg-danger/10 text-danger'}`}>{trade.side || 'N/A'}</span>
                    </td>
                    <td className="py-3 px-4 text-surface-100 font-mono text-sm text-right">${trade.entry_price?.toFixed(2)}</td>
                    <td className="py-3 px-4 text-surface-100 font-mono text-sm text-right">${trade.exit_price?.toFixed(2)}</td>
                    <td className="py-3 px-4 text-surface-100 font-mono text-sm text-right">{trade.quantity}</td>
                    <td className={`py-3 px-4 font-mono text-sm font-semibold text-right ${trade.pnl >= 0 ? 'text-success' : 'text-danger'}`}>{trade.pnl >= 0 ? '+' : ''}${trade.pnl?.toFixed(2)}</td>
                    <td className={`py-3 px-4 font-mono text-sm font-semibold text-right ${trade.pnl_pct >= 0 ? 'text-success' : 'text-danger'}`}>
                      {trade.pnl_pct >= 0 ? '+' : ''}{trade.pnl_pct?.toFixed(2)}%
                      {hasDetails && (
                        <svg className={`w-3 h-3 inline-block ml-1.5 text-surface-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </td>
                  </tr>
                  {isExpanded && <TradeDetailRow trade={trade} />}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-surface-700">
          <div className="text-surface-400 text-sm">
            Showing {startIndex + 1}-{Math.min(endIndex, sortedTrades.length)} of {sortedTrades.length} trades
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setTradesPage(prev => Math.max(1, prev - 1)); setExpandedRows(new Set()); }}
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
                      onClick={() => { setTradesPage(pageNum); setExpandedRows(new Set()); }}
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
              onClick={() => { setTradesPage(prev => Math.min(totalPages, prev + 1)); setExpandedRows(new Set()); }}
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
