import { useState, useMemo } from 'react';
import {
  PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { TOOLTIP_STYLE, SortIcon } from './shared';

export default function PerformanceTab({
  setupStats, symbolStats, metrics, trades, marketCapData,
}) {
  const [setupSort, setSetupSort] = useState({ column: 'total_pnl', direction: 'desc' });
  const [symbolSort, setSymbolSort] = useState({ column: 'total_pnl', direction: 'desc' });

  const handleSetupSort = (column) => {
    setSetupSort(prev => ({
      column,
      direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const handleSymbolSort = (column) => {
    setSymbolSort(prev => ({
      column,
      direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const sortedSetupStats = useMemo(() => {
    if (!setupStats?.setups) return [];
    return [...setupStats.setups].sort((a, b) => {
      const multiplier = setupSort.direction === 'desc' ? -1 : 1;
      return (a[setupSort.column] > b[setupSort.column] ? 1 : -1) * multiplier;
    });
  }, [setupStats, setupSort]);

  const sortedSymbolStats = useMemo(() => {
    if (!symbolStats?.symbols) return [];
    return [...symbolStats.symbols].sort((a, b) => {
      const multiplier = symbolSort.direction === 'desc' ? -1 : 1;
      return (a[symbolSort.column] > b[symbolSort.column] ? 1 : -1) * multiplier;
    });
  }, [symbolStats, symbolSort]);

  const winLossData = metrics ? [
    { name: 'Wins', value: metrics.winning_trades, color: '#10B981' },
    { name: 'Losses', value: metrics.losing_trades, color: '#EF4444' },
  ] : [];

  // P&L distribution histogram
  const pnlBins = useMemo(() => {
    const pnlValues = trades.map(t => t.pnl).filter(v => v !== undefined && v !== null);
    if (pnlValues.length === 0) return [];
    const minPnl = Math.min(...pnlValues);
    const maxPnl = Math.max(...pnlValues);
    const range = maxPnl - minPnl;
    const binCount = Math.min(20, Math.max(8, Math.ceil(Math.sqrt(pnlValues.length))));
    const binSize = range / binCount;
    const bins = [];
    for (let i = 0; i < binCount; i++) {
      const low = minPnl + i * binSize;
      const high = low + binSize;
      const count = pnlValues.filter(v => v >= low && (i === binCount - 1 ? v <= high : v < high)).length;
      bins.push({ range: `$${low.toFixed(0)}`, low, high, count, isPositive: (low + high) / 2 >= 0 });
    }
    return bins;
  }, [trades]);

  return (
    <div className="space-y-8">
      {/* Win/Loss + P&L Distribution side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Win/Loss Distribution */}
        {winLossData.length > 0 && (
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-lg text-surface-50 mb-4">Win/Loss Distribution</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={winLossData} cx="50%" cy="50%" labelLine={false} label={({ name, value }) => `${name}: ${value}`} outerRadius={100} fill="#8884d8" dataKey="value">
                    {winLossData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip {...TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* P&L Distribution Histogram */}
        {pnlBins.length > 0 && (
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-lg text-surface-50 mb-2">P&L Distribution</h2>
            <p className="text-surface-400 text-sm mb-4">How your trade outcomes are distributed</p>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pnlBins}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="range" stroke="#64748B" style={{ fontSize: '10px', fontFamily: 'monospace' }} interval={Math.max(0, Math.floor(pnlBins.length / 8))} />
                  <YAxis stroke="#64748B" style={{ fontSize: '11px', fontFamily: 'monospace' }} allowDecimals={false} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(value, name, props) => [`${value} trades`, `$${props.payload.low.toFixed(0)} to $${props.payload.high.toFixed(0)}`]} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {pnlBins.map((entry, index) => (
                      <Cell key={index} fill={entry.isPositive ? '#10B981' : '#EF4444'} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Setup and Symbol Performance */}
      {setupStats?.setups?.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Setup Statistics */}
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-lg text-surface-50 mb-4">Performance by Setup</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-700">
                    <th className="text-left py-3 px-4 text-surface-400 text-sm font-medium">Setup</th>
                    <th className="text-center py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSetupSort('total_trades')}>
                      Trades <SortIcon column="total_trades" currentSort={setupSort} />
                    </th>
                    <th className="text-center py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSetupSort('win_rate')}>
                      Win Rate <SortIcon column="win_rate" currentSort={setupSort} />
                    </th>
                    <th className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSetupSort('total_pnl')}>
                      Total P&L <SortIcon column="total_pnl" currentSort={setupSort} />
                    </th>
                    <th className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSetupSort('avg_pnl')}>
                      Avg P&L <SortIcon column="avg_pnl" currentSort={setupSort} />
                    </th>
                    <th className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSetupSort('best_trade')}>
                      Best Trade <SortIcon column="best_trade" currentSort={setupSort} />
                    </th>
                    <th className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSetupSort('worst_trade')}>
                      Worst Loss <SortIcon column="worst_trade" currentSort={setupSort} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSetupStats.map((setup, index) => (
                    <tr key={index} className="border-b border-surface-800 hover:bg-surface-900/30 transition-colors">
                      <td className="py-3 px-4 text-surface-100 font-mono text-sm font-semibold">{setup.setup || 'N/A'}</td>
                      <td className="py-3 px-4 text-surface-100 font-mono text-sm text-center">{setup.total_trades} <span className="text-surface-500">({setup.winning_trades}W / {setup.losing_trades}L)</span></td>
                      <td className="py-3 px-4 text-center"><span className={`font-mono text-sm font-semibold ${setup.win_rate >= 50 ? 'text-success' : 'text-danger'}`}>{setup.win_rate}%</span></td>
                      <td className={`py-3 px-4 font-mono text-sm font-semibold text-right ${setup.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>${setup.total_pnl.toFixed(2)}</td>
                      <td className={`py-3 px-4 font-mono text-sm text-right ${setup.avg_pnl >= 0 ? 'text-success' : 'text-danger'}`}>${setup.avg_pnl.toFixed(2)}</td>
                      <td className="py-3 px-4 text-success font-mono text-sm text-right">${setup.best_trade.toFixed(2)}</td>
                      <td className="py-3 px-4 font-mono text-sm text-right">
                        {setup.worst_trade < -100 ? <span className="text-danger">${setup.worst_trade.toFixed(2)}</span> : <span className="text-surface-500">&mdash;</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Symbol Performance */}
          {symbolStats?.symbols?.length > 0 && (
            <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
              <h2 className="font-display font-semibold text-lg text-surface-50 mb-4">Performance by Symbol (Top 20)</h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-700">
                      <th className="text-left py-3 px-4 text-surface-400 text-sm font-medium">Symbol</th>
                      <th className="text-center py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSymbolSort('total_trades')}>
                        Trades <SortIcon column="total_trades" currentSort={symbolSort} />
                      </th>
                      <th className="text-center py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSymbolSort('win_rate')}>
                        Win Rate <SortIcon column="win_rate" currentSort={symbolSort} />
                      </th>
                      <th className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSymbolSort('total_pnl')}>
                        Total P&L <SortIcon column="total_pnl" currentSort={symbolSort} />
                      </th>
                      <th className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSymbolSort('avg_pnl')}>
                        Avg P&L <SortIcon column="avg_pnl" currentSort={symbolSort} />
                      </th>
                      <th className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSymbolSort('best_trade')}>
                        Best Trade <SortIcon column="best_trade" currentSort={symbolSort} />
                      </th>
                      <th className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200" onClick={() => handleSymbolSort('worst_trade')}>
                        Worst Loss <SortIcon column="worst_trade" currentSort={symbolSort} />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSymbolStats.slice(0, 20).map((symbol, index) => (
                      <tr key={index} className="border-b border-surface-800 hover:bg-surface-900/30 transition-colors">
                        <td className="py-3 px-4 text-surface-100 font-mono text-sm font-semibold">{symbol.symbol}</td>
                        <td className="py-3 px-4 text-surface-100 font-mono text-sm text-center">{symbol.total_trades} <span className="text-surface-500">({symbol.winning_trades}W / {symbol.losing_trades}L)</span></td>
                        <td className="py-3 px-4 text-center"><span className={`font-mono text-sm font-semibold ${symbol.win_rate >= 50 ? 'text-success' : 'text-danger'}`}>{symbol.win_rate}%</span></td>
                        <td className={`py-3 px-4 font-mono text-sm font-semibold text-right ${symbol.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>${symbol.total_pnl.toFixed(2)}</td>
                        <td className={`py-3 px-4 font-mono text-sm text-right ${symbol.avg_pnl >= 0 ? 'text-success' : 'text-danger'}`}>${symbol.avg_pnl.toFixed(2)}</td>
                        <td className="py-3 px-4 text-success font-mono text-sm text-right">${symbol.best_trade.toFixed(2)}</td>
                        <td className="py-3 px-4 font-mono text-sm text-right">
                          {symbol.worst_trade < -100 ? <span className="text-danger">${symbol.worst_trade.toFixed(2)}</span> : <span className="text-surface-500">&mdash;</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Market Cap Performance */}
      {marketCapData?.categories?.length > 0 && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-lg text-surface-50 mb-2">Performance by Market Cap</h2>
          <p className="text-surface-400 text-sm mb-4">How you perform across different market cap segments</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={marketCapData.categories} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis type="number" stroke="#64748B" style={{ fontSize: '11px', fontFamily: 'monospace' }} tickFormatter={(v) => `$${v}`} />
                  <YAxis type="category" dataKey="market_cap" stroke="#64748B" style={{ fontSize: '11px', fontFamily: 'monospace' }} width={90} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(value) => [`$${value.toFixed(2)}`, 'Total P&L']} />
                  <Bar dataKey="total_pnl" radius={[0, 4, 4, 0]}>
                    {marketCapData.categories.map((entry, index) => (
                      <Cell key={index} fill={entry.total_pnl >= 0 ? '#10B981' : '#EF4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-700">
                    <th className="text-left py-2 px-3 text-surface-400 text-xs font-medium">Cap</th>
                    <th className="text-center py-2 px-3 text-surface-400 text-xs font-medium">Trades</th>
                    <th className="text-center py-2 px-3 text-surface-400 text-xs font-medium">Win Rate</th>
                    <th className="text-right py-2 px-3 text-surface-400 text-xs font-medium">Total P&L</th>
                    <th className="text-right py-2 px-3 text-surface-400 text-xs font-medium">Avg P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {marketCapData.categories.map((cat, i) => (
                    <tr key={i} className="border-b border-surface-800">
                      <td className="py-2 px-3 text-surface-100 font-mono text-xs font-semibold">{cat.market_cap}</td>
                      <td className="py-2 px-3 text-surface-100 font-mono text-xs text-center">{cat.total_trades}</td>
                      <td className="py-2 px-3 text-center"><span className={`font-mono text-xs font-semibold ${cat.win_rate >= 50 ? 'text-success' : 'text-danger'}`}>{cat.win_rate}%</span></td>
                      <td className={`py-2 px-3 font-mono text-xs font-semibold text-right ${cat.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>${cat.total_pnl.toFixed(2)}</td>
                      <td className={`py-2 px-3 font-mono text-xs text-right ${cat.avg_pnl >= 0 ? 'text-success' : 'text-danger'}`}>${cat.avg_pnl.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
