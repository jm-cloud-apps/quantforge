import { useMemo, useState } from 'react';
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
    .map(([setup, tds]) => ({ setup, trades: tds, ...computeStats(tds) }))
    .sort((a, b) => b.totalPnl - a.totalPnl);
}

// Workbook dates arrive as "2025-05-21T00:00:00" (no zone, so no off-by-one
// from a UTC parse) and times as a bare "09:32:31" string. A missing time is
// zeroed to 0 by the backend's NaN cleanup, hence the shape check rather than
// a truthiness one.
function fmtDay(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function fmtClock(t) {
  if (!t || !/^\d{1,2}:/.test(String(t))) return null;
  return String(t).slice(0, 5);
}

function fmtHold(days) {
  if (days == null) return null;
  return days > 0 ? `${days}d` : 'intraday';
}

function TradeLine({ trade }) {
  const clock = fmtClock(trade.entry_time);
  const hold = fmtHold(trade.duration_days);
  const px = trade.entry_price != null && trade.exit_price != null
    ? `$${trade.entry_price.toFixed(2)} → $${trade.exit_price.toFixed(2)}`
    : null;
  const qty = trade.quantity ? `${trade.quantity} @ ` : '';
  const win = (trade.pnl || 0) >= 0;

  return (
    <div className="py-2 px-3 rounded-lg bg-surface-900/50 border border-surface-700/20">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-sm font-mono font-semibold text-surface-100 truncate">{trade.symbol || '—'}</span>
          {trade.side && (
            <span className={`text-[9px] px-1 py-px rounded uppercase tracking-wide ${trade.side === 'LONG' ? 'bg-accent/15 text-accent' : 'bg-danger/10 text-danger'}`}>
              {trade.side}
            </span>
          )}
        </span>
        <span className={`text-sm font-mono font-semibold flex-shrink-0 ${win ? 'text-success' : 'text-danger'}`}>
          {win ? '+' : ''}{fmt(trade.pnl)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3 mt-0.5">
        <span className="text-[11px] font-mono text-surface-400 truncate">
          {fmtDay(trade.entry_date)}{clock ? ` · ${clock}` : ''}
        </span>
        <span className={`text-[11px] font-mono flex-shrink-0 ${win ? 'text-success/70' : 'text-danger/70'}`}>
          {trade.pnl_pct >= 0 ? '+' : ''}{trade.pnl_pct?.toFixed(2)}%
        </span>
      </div>
      {(px || hold) && (
        <p className="text-[10px] font-mono text-surface-500 mt-0.5 truncate">
          {px ? `${qty}${px}` : ''}{px && hold ? ' · ' : ''}{hold || ''}
        </p>
      )}
    </div>
  );
}

const TRADES_PER_PAGE = 10;

// Sort keys for an expanded trade list. `date` reads the ENTRY timestamp
// because that is the field each line prints — sorting on the hidden exit date
// (the Recent Trades default) makes the list look unsorted. Both date parts
// are ISO-ish, so a plain string compare is chronological.
const TRADE_SORTS = {
  date: (t) => `${t.entry_date || t.exit_date || ''} ${t.entry_time || ''}`,
  pnl: (t) => t.pnl ?? 0,
  pnl_pct: (t) => t.pnl_pct ?? 0,
};

const SORT_NAMES = { date: 'entry date', pnl: 'P&L in dollars', pnl_pct: 'return %' };

function SortButton({ label, sortKey, sort, onSort }) {
  const active = sort.key === sortKey;
  const name = SORT_NAMES[sortKey];
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
        active ? 'bg-surface-700/70 text-surface-100' : 'text-surface-500 hover:text-surface-300'
      }`}
      title={active
        ? `Sorted by ${name}, ${sort.dir === 'asc' ? 'ascending' : 'descending'} — click to reverse`
        : `Sort by ${name}`}
    >
      {label}
      <span className={`ml-0.5 ${active ? 'text-accent' : 'text-surface-600'}`}>
        {active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </button>
  );
}

// One sub-setup row. Click the header to expand the trades that make up its
// numbers, paginated 10 at a time — a category like "Continuation (Post-Gap)"
// can hold 50 fills, and the point of drilling in is to read them, not to
// scroll past them. Page state lives here so collapsing and reopening a row
// starts back at the top, and so two open rows don't share a page number.
function BreakdownRow({ sub, stripPrefix }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  // Newest first by default — the question a drill-down usually opens with is
  // "how has this setup been doing lately".
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });

  const sorted = useMemo(() => {
    const value = TRADE_SORTS[sort.key];
    const rows = sub.trades.slice();
    rows.sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av === bv) return 0;
      return (av < bv ? -1 : 1) * (sort.dir === 'asc' ? 1 : -1);
    });
    return rows;
  }, [sub.trades, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / TRADES_PER_PAGE));
  // Guard against a stale page if the trade list shrinks under an open row.
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * TRADES_PER_PAGE;
  const pageTrades = sorted.slice(startIndex, startIndex + TRADES_PER_PAGE);

  const label = stripPrefix && sub.setup.startsWith(stripPrefix)
    ? sub.setup.slice(stripPrefix.length)
    : sub.setup;

  const toggle = () => {
    if (open) setPage(1);
    setOpen(!open);
  };

  // Re-picking the active key reverses it; switching keys starts descending
  // (newest / biggest first), which is the useful end of both columns.
  const applySort = (key) => {
    setPage(1);
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  return (
    <div className={`rounded-lg border transition-colors ${open ? 'bg-surface-800/50 border-surface-700/40' : 'bg-surface-800/30 border-surface-700/20'}`}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between py-2 px-3 text-left rounded-lg hover:bg-surface-700/20 transition-colors"
        title={`${open ? 'Hide' : 'Show'} the ${sub.totalTrades} ${sub.setup} trade${sub.totalTrades === 1 ? '' : 's'}`}
      >
        <div className="min-w-0 flex items-center gap-1.5">
          <svg
            className={`w-3 h-3 flex-shrink-0 text-surface-500 transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <div className="min-w-0">
            <p className="text-sm text-surface-200 font-medium truncate">{label}</p>
            <p className="text-[11px] text-surface-500">{sub.totalTrades} trades · {sub.winRate.toFixed(0)}% win</p>
          </div>
        </div>
        <div className="text-right flex-shrink-0 ml-4">
          <p className={`text-sm font-mono font-semibold ${sub.totalPnl >= 0 ? 'text-success' : 'text-danger'}`}>
            {sub.totalPnl >= 0 ? '+' : ''}{fmt(sub.totalPnl)}
          </p>
          <p className={`text-[11px] font-mono ${sub.avgPnl >= 0 ? 'text-success/70' : 'text-danger/70'}`}>
            avg {fmt(sub.avgPnl)}
          </p>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-surface-700/30">
          <div className="flex items-center gap-1 mt-2 mb-1.5">
            <span className="text-[10px] text-surface-600 uppercase tracking-wider mr-0.5">Sort</span>
            <SortButton label="Date" sortKey="date" sort={sort} onSort={applySort} />
            <SortButton label="P&L" sortKey="pnl" sort={sort} onSort={applySort} />
            <SortButton label="%" sortKey="pnl_pct" sort={sort} onSort={applySort} />
          </div>
          <div className="space-y-1.5">
            {pageTrades.map((t, i) => (
              <TradeLine key={`${t.symbol}-${t.entry_date}-${t.entry_time}-${startIndex + i}`} trade={t} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 mt-2.5 pt-2.5 border-t border-surface-700/30">
              <span className="text-[10px] text-surface-500 font-mono">
                {startIndex + 1}–{Math.min(startIndex + TRADES_PER_PAGE, sorted.length)} of {sorted.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${safePage === 1 ? 'text-surface-600 cursor-not-allowed' : 'text-surface-200 bg-surface-700/60 hover:bg-surface-600'}`}
                >
                  Prev
                </button>
                <span className="text-[10px] text-surface-500 font-mono px-1">{safePage}/{totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${safePage === totalPages ? 'text-surface-600 cursor-not-allowed' : 'text-surface-200 bg-surface-700/60 hover:bg-surface-600'}`}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BreakdownColumn({ title, titleClass, subSetups, stripPrefix }) {
  if (subSetups.length === 0) return null;
  return (
    <div>
      <p className={`text-sm font-semibold ${titleClass} mb-3`}>{title}</p>
      <div className="space-y-2">
        {subSetups.map((s) => (
          <BreakdownRow key={s.setup} sub={s} stripPrefix={stripPrefix} />
        ))}
      </div>
    </div>
  );
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

      {/* Sub-setup breakdown — each row expands into its own trades */}
      <div className={`grid grid-cols-1 ${categories.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-6`}>
        <BreakdownColumn title="EP Breakdown" titleClass="text-accent" subSetups={epSubSetups} stripPrefix="EP - " />
        <BreakdownColumn title="HTF Breakdown" titleClass="text-cyan" subSetups={htfSubSetups} stripPrefix="HTF - " />
        <BreakdownColumn title="N/A Breakdown" titleClass="text-amber-400" subSetups={naSubSetups} />
      </div>
    </div>
  );
}
