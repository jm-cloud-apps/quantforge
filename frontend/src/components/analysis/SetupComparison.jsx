import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { TOOLTIP_STYLE } from './shared';

function fmt(val) {
  if (val == null || val === 0) return '$0';
  const abs = Math.abs(val);
  const str = abs >= 1000
    ? `$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${abs.toFixed(2)}`;
  return `${val < 0 ? '-' : ''}${str}`;
}

function computeStats(trades) {
  if (!trades || trades.length === 0) return null;
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const totalPnl = trades.reduce((s, t) => s + (t.pnl || 0), 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  // Hold duration (days)
  let avgHoldDays = null;
  const durations = trades
    .filter(t => t.entry_date && t.exit_date)
    .map(t => {
      const entry = new Date(t.entry_date);
      const exit = new Date(t.exit_date);
      return Math.max(0, (exit - entry) / (1000 * 60 * 60 * 24));
    });
  if (durations.length > 0) {
    avgHoldDays = durations.reduce((s, d) => s + d, 0) / durations.length;
  }

  return {
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    totalPnl,
    avgPnl: trades.length > 0 ? totalPnl / trades.length : 0,
    bestTrade: trades.length > 0 ? Math.max(...trades.map(t => t.pnl || 0)) : 0,
    worstTrade: trades.length > 0 ? Math.min(...trades.map(t => t.pnl || 0)) : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgHoldDays,
  };
}

function computeSubSetups(trades) {
  const map = {};
  for (const t of trades) {
    const setup = t.setup || 'Unknown';
    if (!map[setup]) map[setup] = [];
    map[setup].push(t);
  }
  return Object.entries(map)
    .map(([setup, tds]) => ({ setup, ...computeStats(tds) }))
    .sort((a, b) => b.totalPnl - a.totalPnl);
}

function StatRow({ label, vals, format = 'number', highlight = false }) {
  const formatVal = (v) => {
    if (v == null) return '—';
    if (format === 'dollar') return fmt(v);
    if (format === 'pct') return `${v.toFixed(1)}%`;
    if (format === 'ratio') return v === Infinity ? '∞' : v.toFixed(2);
    if (format === 'days') return `${v.toFixed(1)}d`;
    return v.toString();
  };

  const colorClass = (v) => {
    if (format === 'dollar' || format === 'ratio') return v > 0 ? 'text-success' : v < 0 ? 'text-danger' : 'text-surface-300';
    if (format === 'pct') return v >= 50 ? 'text-success' : 'text-danger';
    return 'text-surface-100';
  };

  // Find the best value among non-null entries
  const nonNull = vals.filter(v => v != null);
  const bestVal = highlight && nonNull.length > 1 ? Math.max(...nonNull) : null;

  return (
    <div className={`grid gap-4 py-2.5 border-b border-surface-700/20 last:border-0`} style={{ gridTemplateColumns: `1fr repeat(${vals.length}, 1fr)` }}>
      <span className="text-sm text-surface-400">{label}</span>
      {vals.map((v, i) => {
        const isWinner = highlight && bestVal != null && v === bestVal && nonNull.filter(n => n === bestVal).length === 1;
        return (
          <span key={i} className={`text-sm font-mono font-semibold text-right ${colorClass(v)} ${isWinner ? 'relative' : ''}`}>
            {formatVal(v)}
            {isWinner && <span className="absolute -left-4 text-[10px] text-accent">●</span>}
          </span>
        );
      })}
    </div>
  );
}

export default function SetupComparison({ trades }) {
  const { epStats, htfStats, naStats, epSubSetups, htfSubSetups, naSubSetups, chartData, categories } = useMemo(() => {
    const epTrades = trades.filter(t => t.setup && t.setup.startsWith('EP'));
    const htfTrades = trades.filter(t => t.setup && t.setup.startsWith('HTF'));
    const naTrades = trades.filter(t => !t.setup || (!t.setup.startsWith('EP') && !t.setup.startsWith('HTF')));

    const ep = computeStats(epTrades);
    const htf = computeStats(htfTrades);
    const na = computeStats(naTrades);
    const epSub = computeSubSetups(epTrades);
    const htfSub = computeSubSetups(htfTrades);
    const naSub = computeSubSetups(naTrades);

    // Build active categories list
    const cats = [];
    if (ep) cats.push({ key: 'EP', label: 'EP', color: '#10B981', colorClass: 'bg-accent', textClass: 'text-accent', stats: ep });
    if (htf) cats.push({ key: 'HTF', label: 'HTF', color: '#06B6D4', colorClass: 'bg-cyan', textClass: 'text-cyan', stats: htf });
    if (na) cats.push({ key: 'NA', label: 'N/A', color: '#F59E0B', colorClass: 'bg-amber-500', textClass: 'text-amber-400', stats: na });

    // Chart data for visual comparison
    const chart = [];
    if (cats.length >= 2) {
      const row = (metric, getter, unit) => {
        const entry = { metric, unit };
        for (const c of cats) entry[c.key] = getter(c.stats);
        return entry;
      };
      chart.push(row('Win Rate', s => s.winRate, '%'));
      chart.push(row('Avg P&L', s => s.avgPnl, '$'));
      chart.push(row('Profit Factor', s => Math.min(s.profitFactor, 10), 'x'));
    }

    return { epStats: ep, htfStats: htf, naStats: na, epSubSetups: epSub, htfSubSetups: htfSub, naSubSetups: naSub, chartData: chart, categories: cats };
  }, [trades]);

  // Render if at least 2 categories have trades
  if (categories.length < 2) return null;

  const statVals = (getter) => categories.map(c => getter(c.stats));

  return (
    <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display font-semibold text-lg text-surface-50">Setup Comparison</h2>
        <div className="flex items-center gap-4 text-[11px] text-surface-500">
          {categories.map(c => (
            <span key={c.key} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-sm ${c.colorClass}`} />
              {c.label} ({c.stats.totalTrades})
            </span>
          ))}
        </div>
      </div>

      {/* Side-by-side stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Comparison table */}
        <div className="rounded-xl bg-surface-800/40 border border-surface-700/30 p-4">
          <div className="gap-4 pb-2.5 border-b border-surface-700/40 mb-1" style={{ display: 'grid', gridTemplateColumns: `1fr repeat(${categories.length}, 1fr)` }}>
            <span className="text-[11px] text-surface-500 font-medium uppercase tracking-wider">Metric</span>
            {categories.map(c => (
              <span key={c.key} className={`text-[11px] ${c.textClass} font-medium uppercase tracking-wider text-right`}>{c.label}</span>
            ))}
          </div>
          <StatRow label="Total Trades" vals={statVals(s => s.totalTrades)} />
          <StatRow label="Win Rate" vals={statVals(s => s.winRate)} format="pct" highlight />
          <StatRow label="Total P&L" vals={statVals(s => s.totalPnl)} format="dollar" highlight />
          <StatRow label="Avg P&L" vals={statVals(s => s.avgPnl)} format="dollar" highlight />
          <StatRow label="Profit Factor" vals={statVals(s => s.profitFactor)} format="ratio" highlight />
          <StatRow label="Best Trade" vals={statVals(s => s.bestTrade)} format="dollar" />
          <StatRow label="Worst Trade" vals={statVals(s => s.worstTrade)} format="dollar" />
          {categories.every(c => c.stats.avgHoldDays != null) && (
            <StatRow label="Avg Hold" vals={statVals(s => s.avgHoldDays)} format="days" />
          )}
        </div>

        {/* Visual comparison chart */}
        {chartData.length > 0 && (
          <div className="rounded-xl bg-surface-800/40 border border-surface-700/30 p-4">
            <p className="text-[11px] text-surface-500 font-medium uppercase tracking-wider mb-4">Visual Comparison</p>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(30, 41, 59, 0.5)" horizontal={false} />
                  <XAxis type="number" stroke="#64748B" style={{ fontSize: '11px', fontFamily: 'monospace' }} />
                  <YAxis type="category" dataKey="metric" stroke="#64748B" style={{ fontSize: '12px' }} width={90} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(value, name) => {
                      const item = chartData.find(d => d[name] === value);
                      const unit = item?.unit || '';
                      return [`${unit === '$' ? '$' : ''}${value.toFixed(1)}${unit === '%' ? '%' : unit === 'x' ? 'x' : ''}`, name === 'NA' ? 'N/A' : name];
                    }}
                  />
                  {categories.map(c => (
                    <Bar key={c.key} dataKey={c.key} fill={c.color} radius={[0, 4, 4, 0]} barSize={14} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Sub-setup breakdown */}
      <div className={`grid grid-cols-1 ${categories.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-6`}>
        {/* EP sub-setups */}
        {epSubSetups.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-accent mb-3">EP Breakdown</p>
            <div className="space-y-2">
              {epSubSetups.map((s) => (
                <div key={s.setup} className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-800/30 border border-surface-700/20">
                  <div className="min-w-0">
                    <p className="text-sm text-surface-200 font-medium truncate">{s.setup.replace('EP - ', '')}</p>
                    <p className="text-[11px] text-surface-500">{s.totalTrades} trades · {s.winRate.toFixed(0)}% win</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <p className={`text-sm font-mono font-semibold ${s.totalPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                      {s.totalPnl >= 0 ? '+' : ''}{fmt(s.totalPnl)}
                    </p>
                    <p className={`text-[11px] font-mono ${s.avgPnl >= 0 ? 'text-success/70' : 'text-danger/70'}`}>
                      avg {fmt(s.avgPnl)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* HTF sub-setups */}
        {htfSubSetups.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-cyan mb-3">HTF Breakdown</p>
            <div className="space-y-2">
              {htfSubSetups.map((s) => (
                <div key={s.setup} className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-800/30 border border-surface-700/20">
                  <div className="min-w-0">
                    <p className="text-sm text-surface-200 font-medium truncate">{s.setup.replace('HTF - ', '')}</p>
                    <p className="text-[11px] text-surface-500">{s.totalTrades} trades · {s.winRate.toFixed(0)}% win</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <p className={`text-sm font-mono font-semibold ${s.totalPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                      {s.totalPnl >= 0 ? '+' : ''}{fmt(s.totalPnl)}
                    </p>
                    <p className={`text-[11px] font-mono ${s.avgPnl >= 0 ? 'text-success/70' : 'text-danger/70'}`}>
                      avg {fmt(s.avgPnl)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* N/A sub-setups */}
        {naSubSetups.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-amber-400 mb-3">N/A Breakdown</p>
            <div className="space-y-2">
              {naSubSetups.map((s) => (
                <div key={s.setup} className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-800/30 border border-surface-700/20">
                  <div className="min-w-0">
                    <p className="text-sm text-surface-200 font-medium truncate">{s.setup}</p>
                    <p className="text-[11px] text-surface-500">{s.totalTrades} trades · {s.winRate.toFixed(0)}% win</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <p className={`text-sm font-mono font-semibold ${s.totalPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                      {s.totalPnl >= 0 ? '+' : ''}{fmt(s.totalPnl)}
                    </p>
                    <p className={`text-[11px] font-mono ${s.avgPnl >= 0 ? 'text-success/70' : 'text-danger/70'}`}>
                      avg {fmt(s.avgPnl)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
