export const INPUT_STYLE = 'w-full rounded-lg bg-surface-800 border border-surface-600/40 px-4 py-2.5 text-sm text-surface-100 placeholder-surface-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 transition-colors';

export const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'rgba(15, 22, 35, 0.95)',
    border: '0.5px solid rgba(30, 41, 59, 0.5)',
    borderRadius: '8px',
    backdropFilter: 'blur(20px)',
  },
  labelStyle: { color: '#E2E8F0', fontFamily: 'monospace', fontSize: '12px' },
  itemStyle: { color: '#E2E8F0', fontFamily: 'monospace', fontSize: '12px' },
};

export function InfoTooltip({ text }) {
  return (
    <div className="group relative inline-block ml-1">
      <span className="text-surface-500 text-xs cursor-help">ⓘ</span>
      <div className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-surface-900/95 backdrop-blur-xl border border-surface-600/40 rounded-xl shadow-card text-[12px] text-surface-200 z-50 leading-relaxed">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-surface-900/95"></div>
      </div>
    </div>
  );
}

export function SortIcon({ column, currentSort }) {
  if (currentSort.column !== column) {
    return <span className="text-surface-600 ml-1">&darr;&uarr;</span>;
  }
  return currentSort.direction === 'desc'
    ? <span className="text-success ml-1">&darr;</span>
    : <span className="text-success ml-1">&uarr;</span>;
}

export function CustomTooltip({ active, payload }) {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-xl bg-surface-900/95 backdrop-blur-xl border border-surface-700/50 p-3 shadow-card">
        <p className="text-surface-100 font-mono text-sm">
          {payload[0].payload.date || payload[0].payload.month}
        </p>
        <p className={`font-mono text-sm font-semibold ${
          payload[0].value >= 0 ? 'text-success' : 'text-danger'
        }`}>
          ${Math.abs(payload[0].value).toLocaleString()}
        </p>
      </div>
    );
  }
  return null;
}
