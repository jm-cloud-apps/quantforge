import { useState, useEffect, useRef } from 'react';
import { getFormatterMonths, runFormatter, resetFormatter } from '../../api/tradingAnalysis';

const TradeFormatterModal = ({ onClose, onComplete }) => {
  const [months, setMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [logs, setLogs] = useState([]);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const logEndRef = useRef(null);
  const controllerRef = useRef(null);

  // Load available months on mount
  useEffect(() => {
    getFormatterMonths()
      .then(({ months: m }) => {
        setMonths(m);
        if (m.length > 0) setSelectedMonth(m[0]);
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

  const handleRun = () => {
    if (!selectedMonth) return;
    setStatus('running');
    setLogs([]);

    controllerRef.current = runFormatter(selectedMonth, {
      onMessage: (msg) => {
        setLogs((prev) => [...prev, { type: 'info', text: msg }]);
      },
      onDone: () => {
        setStatus('done');
        setLogs((prev) => [...prev, { type: 'success', text: '\n✅ Formatter completed successfully.' }]);
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
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <button
            onClick={handleRun}
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
                Run
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

        {/* Footer */}
        {status === 'done' && (
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
