import { useState, useEffect, useRef } from 'react';
import { getFormatterMonths, runFormatter, resetFormatter, runDaily } from '../../api/tradingAnalysis';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// "06.2026" → "June 2026" (falls back to the raw value if it doesn't parse).
function monthLabel(mmYYYY) {
  const m = /^(\d{2})\.(\d{4})$/.exec(mmYYYY || '');
  if (!m) return mmYYYY;
  return `${MONTH_NAMES[parseInt(m[1], 10) - 1] || m[1]} ${m[2]}`;
}

// Bucket the (already newest-first) MM.YYYY list into year groups, preserving
// order so the latest year + month sits at the top.
function groupByYear(months) {
  const order = [];
  const byYear = new Map();
  for (const m of months) {
    const yr = (m.split('.')[1]) || '—';
    if (!byYear.has(yr)) { byYear.set(yr, []); order.push(yr); }
    byYear.get(yr).push(m);
  }
  return order.map((yr) => ({ year: yr, months: byYear.get(yr) }));
}

const TradeFormatterModal = ({ onClose, onComplete }) => {
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [mode, setMode] = useState(null); // null | 'preview' | 'applied' — set by __MODE__ event
  const [logs, setLogs] = useState([]);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const logEndRef = useRef(null);
  const controllerRef = useRef(null);

  // Detect whether the preview contained any actual changes. If the script
  // reported no rows in any of the three sections, applying is a no-op and
  // we should hide the Apply button.
  const previewHasChanges = logs.some((l) =>
    /NEW POSITIONS TO OPEN\s*\((\d+)\s+row/.test(l.text) ||
    /EXISTING POSITIONS TO CLOSE\s*\((\d+)\s+row/.test(l.text) ||
    /DAY-TRADES.*\((\d+)\s+row/.test(l.text)
  );

  // Load available months on mount. Default to the current month (the backend
  // ensures its folder exists) so the daily pipeline runs against today's
  // month, not last month's — which is what caused the 05/06 mismatch.
  useEffect(() => {
    getFormatterMonths()
      .then(({ months: m, current }) => {
        setMonths(m);
        const def = current && m.includes(current) ? current : (m[0] || '');
        setSelectedMonth(def);
      })
      .catch(() => {
        setLogs((prev) => [...prev, { type: 'error', text: 'Failed to load available months' }]);
      });
  }, []);

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const handleRun = (confirm = 'no') => {
    if (!selectedMonth) return;
    lastRunRef.current = 'formatter';
    setStatus('running');
    setMode(null);
    setLogs([]);

    controllerRef.current = runFormatter(selectedMonth, {
      confirm,
      onMessage: (msg) => {
        setLogs((prev) => [...prev, { type: 'info', text: msg }]);
      },
      onMode: (m) => setMode(m),
      onDone: () => {
        setStatus('done');
        setLogs((prev) => [...prev, {
          type: 'success',
          text: confirm === 'yes'
            ? '\n✅ Changes applied to Trades.xlsx.'
            : '\n✅ Preview complete — no changes written yet.',
        }]);
      },
      onError: (err) => {
        setStatus('error');
        setLogs((prev) => [...prev, { type: 'error', text: `\n❌ Error: ${err}` }]);
      },
    });
  };

  // Track which pipeline produced the most recent preview so the Apply
  // button re-runs the right one (formatter vs full Gmail→format→summarize).
  const lastRunRef = useRef('formatter'); // 'formatter' | 'daily'
  const handleApply = () => {
    if (lastRunRef.current === 'daily') handleRunDaily('yes');
    else handleRun('yes');
  };
  const handleDiscard = () => {
    setLogs([]);
    setStatus('idle');
    setMode(null);
  };

  const handleRunDaily = (confirm = 'no') => {
    if (!selectedMonth) return;
    lastRunRef.current = 'daily';
    setStatus('running');
    setMode(null);
    setLogs([{
      type: 'info',
      text: confirm === 'yes'
        ? `▶ Starting daily pipeline for ${selectedMonth}: Gmail fetch → format → apply`
        : `▶ Previewing daily pipeline for ${selectedMonth}: Gmail fetch → format → dry-run`,
    }]);

    controllerRef.current = runDaily(selectedMonth, {
      confirm,
      onMessage: (msg) => {
        setLogs((prev) => [...prev, { type: 'info', text: msg }]);
      },
      onMode: (m) => setMode(m),
      onDone: () => {
        setStatus('done');
        setLogs((prev) => [...prev, {
          type: 'success',
          text: confirm === 'yes'
            ? '\n✅ Daily pipeline completed — changes applied.'
            : '\n✅ Preview complete — no changes written yet.',
        }]);
      },
      onError: (err) => {
        setStatus('error');
        setLogs((prev) => [...prev, { type: 'error', text: `\n❌ Error: ${err}` }]);
      },
    });
  };

  const handleReset = () => {
    setShowResetConfirm(false);
    setStatus('running');
    setLogs([]);

    controllerRef.current = resetFormatter({
      onMessage: (msg) => {
        setLogs((prev) => [...prev, { type: 'info', text: msg }]);
      },
      onDone: () => {
        setStatus('done');
        setLogs((prev) => [...prev, { type: 'success', text: '\n✅ Reset completed successfully.' }]);
      },
      onError: (err) => {
        setStatus('error');
        setLogs((prev) => [...prev, { type: 'error', text: `\n❌ Error: ${err}` }]);
      },
    });
  };

  const handleCancel = () => {
    controllerRef.current?.abort();
    setStatus('idle');
    setLogs((prev) => [...prev, { type: 'warning', text: '\n⚠️ Cancelled by user.' }]);
  };

  const handleReloadAndClose = () => {
    onComplete?.();
    onClose();
  };

  const isRunning = status === 'running';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl mx-4 rounded-2xl bg-surface-900 border border-surface-700/50 p-6 space-y-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-surface-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            Trade Log Formatter
          </h3>
          <button
            onClick={isRunning ? handleCancel : onClose}
            className="text-surface-400 hover:text-surface-200 transition-colors"
          >
            {isRunning ? (
              <span className="text-xs font-medium text-warning">Cancel</span>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            disabled={isRunning}
            className="flex-1 rounded-lg bg-surface-800 border border-surface-600/40 px-4 py-2.5 text-sm text-surface-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 transition-colors disabled:opacity-50"
          >
            {months.length === 0 && <option value="">No folders found</option>}
            {groupByYear(months).map((g) => (
              <optgroup key={g.year} label={g.year}>
                {g.months.map((m) => (
                  <option key={m} value={m}>{monthLabel(m)}</option>
                ))}
              </optgroup>
            ))}
          </select>

          <button
            onClick={() => handleRun('no')}
            disabled={isRunning || !selectedMonth}
            className="px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isRunning ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Running...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z" />
                </svg>
                Preview
              </>
            )}
          </button>

          <button
            onClick={() => setShowResetConfirm(true)}
            disabled={isRunning}
            className="px-4 py-2.5 rounded-lg bg-surface-800 border border-danger/30 text-danger text-sm font-medium hover:bg-danger/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Reset all trade data"
          >
            Reset
          </button>
        </div>

        {/* Run Daily — full pipeline (Gmail fetch → format → summarize) */}
        <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-800/40 border border-surface-700/40 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-surface-100">Run Daily Pipeline</p>
            <p className="text-xs text-surface-400">Fetch new IB reports from Gmail, format, and append daily summary.</p>
          </div>
          <button
            onClick={() => handleRunDaily('no')}
            disabled={isRunning || !selectedMonth}
            className="px-4 py-2 rounded-lg bg-accent/10 border border-accent/40 text-accent text-sm font-medium hover:bg-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 flex-shrink-0"
            title="Run run_daily.py: fetch Gmail → format → summarize"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1018 0 9 9 0 00-18 0zm0 0l3-3m-3 3l3 3" />
            </svg>
            Run Daily
          </button>
        </div>

        {/* Reset confirmation */}
        {showResetConfirm && (
          <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-3 flex items-center justify-between">
            <p className="text-danger text-sm">This will DELETE ALL trade data. Are you sure?</p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-3 py-1.5 rounded-lg text-sm text-surface-300 hover:text-surface-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                className="px-3 py-1.5 rounded-lg bg-danger text-white text-sm font-medium hover:bg-danger/90 transition-colors"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        )}

        {/* Log viewer */}
        <div className="flex-1 min-h-0 rounded-xl bg-surface-950 border border-surface-700/30 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-surface-700/30 flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              status === 'running' ? 'bg-accent animate-pulse' :
              status === 'done' ? 'bg-success' :
              status === 'error' ? 'bg-danger' :
              'bg-surface-600'
            }`} />
            <span className="text-xs text-surface-400 font-mono">
              {status === 'running' ? 'Processing...' :
               status === 'done' ? 'Complete' :
               status === 'error' ? 'Error' :
               'Ready'}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed min-h-[200px] max-h-[400px]">
            {logs.length === 0 ? (
              <p className="text-surface-500">Select a month and click Run to process trade reports...</p>
            ) : (
              logs.map((entry, i) => (
                <div
                  key={i}
                  className={`whitespace-pre-wrap ${
                    entry.type === 'error' ? 'text-danger' :
                    entry.type === 'success' ? 'text-success' :
                    entry.type === 'warning' ? 'text-warning' :
                    'text-surface-300'
                  }`}
                >
                  {entry.text}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* Footer — preview gets Apply/Discard; applied/no-changes gets Reload */}
        {status === 'done' && mode === 'preview' && previewHasChanges && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-accent/[0.06] border border-accent/30 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-surface-100">Preview ready</p>
              <p className="text-xs text-surface-400">
                Review the journal update above. Click Apply to write the changes to Trades.xlsx.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleDiscard}
                className="px-4 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 transition-colors"
              >
                Discard
              </button>
              <button
                onClick={handleApply}
                className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Apply changes
              </button>
            </div>
          </div>
        )}

        {status === 'done' && mode === 'preview' && !previewHasChanges && (
          <div className="rounded-lg bg-surface-800/40 border border-surface-700/40 px-4 py-3">
            <p className="text-sm text-surface-300">
              No changes detected for this month — nothing to apply.
            </p>
          </div>
        )}

        {status === 'done' && mode === 'applied' && (
          <div className="flex justify-end">
            <button
              onClick={handleReloadAndClose}
              className="px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reload Analysis
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TradeFormatterModal;
