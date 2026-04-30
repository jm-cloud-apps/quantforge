import { useState, useRef, useEffect, useCallback } from 'react';
import { getFileStatus, loadDefaultTrades, uploadTradeData, analyzeTradeData, getTradeStatistics, getSetupStatistics, getSymbolStatistics, getDrawdownAnalysis, getTimePerformance, getRollingPerformance, getAdvancedMetrics, getEntryTimingAnalysis, getStreakDetection, getMarketCapPerformance, getBenchmarkComparison, getRMultipleAnalysis, getEmotionPerformance } from '../api/tradingAnalysis';
import { useToast } from '../components/Toast';

import TabNavigation from '../components/analysis/TabNavigation';
import OverviewTab from '../components/analysis/OverviewTab';
import PerformanceTab from '../components/analysis/PerformanceTab';
import RiskTab from '../components/analysis/RiskTab';
import TimingTab from '../components/analysis/TimingTab';
import BehaviorTab from '../components/analysis/BehaviorTab';
import RecentTradesTable from '../components/analysis/RecentTradesTable';
import TradeFormatterModal from '../components/analysis/TradeFormatterModal';

const INPUT_STYLE = 'w-full rounded-lg bg-surface-800 border border-surface-600/40 px-4 py-2.5 text-sm text-surface-100 placeholder-surface-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 transition-colors';

// Cache version — bump to force localStorage invalidation after logic changes
const CACHE_VERSION = 4;

// Module-level cache — survives React Router unmount/remount (no loading flash)
let _moduleCache = null;

// Normalize any date value (ISO string, timestamp number, Date-parseable) to "YYYY-MM-DD"
function toDateKey(val) {
  if (!val) return null;
  // If it's already a YYYY-MM-DD string or ISO string, extract date part
  if (typeof val === 'string') {
    // Try ISO format first: "2026-02-14" or "2026-02-14T00:00:00"
    const match = val.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  // Fallback: parse with Date constructor (handles numbers, other string formats)
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

// Compute calendar heatmap data client-side (no API dependency)
function buildCalendarData(trades) {
  if (!trades || trades.length === 0) return { days: [] };

  const byDate = {};
  let skipped = 0;
  for (const t of trades) {
    // Skip partially closed positions (exit_quantity != quantity) — P&L is misleading
    const qty = t.quantity || 0;
    const exitQty = t.exit_quantity;
    if (exitQty != null && exitQty !== 0 && qty !== 0 && exitQty !== qty) {
      skipped++;
      continue;
    }

    const key = toDateKey(t.exit_date) || toDateKey(t.entry_date);
    if (!key) { skipped++; continue; }
    if (!byDate[key]) byDate[key] = { date: key, pnl: 0, trades: 0, wins: 0 };
    byDate[key].pnl += t.pnl || 0;
    byDate[key].trades += 1;
    if ((t.pnl || 0) > 0) byDate[key].wins += 1;
  }

  if (skipped > 0) {
    console.warn(`[Calendar] Skipped ${skipped} trades (partial close or no date)`);
  }

  const days = Object.values(byDate)
    .map(d => ({ ...d, win_rate: d.trades > 0 ? Math.round((d.wins / d.trades) * 100) : 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { days };
}

const TradingAnalysis = () => {
  const { toast } = useToast();
  const [uploadedFile, setUploadedFile] = useState(null);
  const [trades, setTrades] = useState([]);
  const [allTrades, setAllTrades] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [statistics, setStatistics] = useState(null);
  const [setupStats, setSetupStats] = useState(null);
  const [symbolStats, setSymbolStats] = useState(null);
  const [analysisData, setAnalysisData] = useState(null);
  const [drawdownData, setDrawdownData] = useState(null);
  const [timePerformance, setTimePerformance] = useState(null);
  const [rollingPerformance, setRollingPerformance] = useState(null);
  const [advancedMetrics, setAdvancedMetrics] = useState(null);
  const [entryTimingData, setEntryTimingData] = useState(null);
  const [streakData, setStreakData] = useState(null);
  const [marketCapData, setMarketCapData] = useState(null);
  const [benchmarkData, setBenchmarkData] = useState(null);
  const [rMultipleData, setRMultipleData] = useState(null);
  const [emotionData, setEmotionData] = useState(null);
  const [calendarData, setCalendarData] = useState(null);
  const [loading, setLoading] = useState(!_moduleCache);
  const [loadingStep, setLoadingStep] = useState({ current: 0, total: 17, label: 'Loading trades file...' });
  const [error, setError] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const fileInputRef = useRef(null);

  const [activeTab, setActiveTab] = useState('overview');

  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    symbol: '',
    setup: '',
    side: '',
    minPnL: '',
    maxPnL: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [showFormatter, setShowFormatter] = useState(false);

  // Keyboard: Escape closes filters
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && showFilters) {
        setShowFilters(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showFilters]);

  useEffect(() => {
    loadTrades();
  }, []);

  const loadTrades = async (forceRefresh = false) => {
    // Fast path: restore from module-level cache (synchronous, no API call)
    if (!forceRefresh && _moduleCache) {
      setAllTrades(_moduleCache.trades);
      setTrades(_moduleCache.trades);
      setMetrics(_moduleCache.metrics);
      setAnalysisData(_moduleCache.analysisData);
      setStatistics(_moduleCache.statistics);
      setSetupStats(_moduleCache.setupStats);
      setSymbolStats(_moduleCache.symbolStats);
      setDrawdownData(_moduleCache.drawdownData);
      setTimePerformance(_moduleCache.timePerformance);
      setRollingPerformance(_moduleCache.rollingPerformance);
      setAdvancedMetrics(_moduleCache.advancedMetrics);
      setEntryTimingData(_moduleCache.entryTimingData);
      setStreakData(_moduleCache.streakData);
      setMarketCapData(_moduleCache.marketCapData);
      setBenchmarkData(_moduleCache.benchmarkData);
      setRMultipleData(_moduleCache.rMultipleData);
      setEmotionData(_moduleCache.emotionData);
      setCalendarData(_moduleCache.calendarData || buildCalendarData(_moduleCache.trades));
      setFromCache(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setFromCache(false);
    setLoadingStep({ current: 0, total: 17, label: 'Checking for updates...' });
    try {
      if (!forceRefresh) {
        try {
          const status = await getFileStatus();
          const cachedMtime = localStorage.getItem('trading_analysis_mtime');
          const cachedData = localStorage.getItem('trading_analysis_cache');
          const cachedVersion = localStorage.getItem('trading_analysis_version');

          if (cachedMtime && cachedData && String(status.mtime) === cachedMtime && String(cachedVersion) === String(CACHE_VERSION)) {
            const cached = JSON.parse(cachedData);
            setAllTrades(cached.trades);
            setTrades(cached.trades);
            setMetrics(cached.metrics);
            setAnalysisData(cached.analysisData);
            setStatistics(cached.statistics);
            setSetupStats(cached.setupStats);
            setSymbolStats(cached.symbolStats);
            setDrawdownData(cached.drawdownData);
            setTimePerformance(cached.timePerformance);
            setRollingPerformance(cached.rollingPerformance);
            setAdvancedMetrics(cached.advancedMetrics);
            setEntryTimingData(cached.entryTimingData);
            setStreakData(cached.streakData);
            setMarketCapData(cached.marketCapData);
            setBenchmarkData(cached.benchmarkData);
            setRMultipleData(cached.rMultipleData);
            setEmotionData(cached.emotionData);
            const calData = cached.calendarData || buildCalendarData(cached.trades);
            setCalendarData(calData);
            cached.calendarData = calData;
            _moduleCache = cached;
            setFromCache(true);
            setLoading(false);
            return;
          }
        } catch {
          // If file-status fails, proceed with full load
        }
      }

      setLoadingStep({ current: 1, total: 17, label: 'Loading trades file...' });
      const result = await loadDefaultTrades();
      setAllTrades(result.trades);
      setTrades(result.trades);
      await updateAnalytics(result.trades, result.file_mtime);
    } catch (err) {
      setError(err.message);
      console.error('Error loading trades:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateAnalytics = async (tradesToAnalyze, fileMtime) => {
    const total = 17;
    const cache = { trades: tradesToAnalyze };
    try {
      setLoadingStep({ current: 2, total, label: 'Computing metrics...' });
      const metricsData = calculateClientMetrics(tradesToAnalyze);
      setMetrics(metricsData);
      cache.metrics = metricsData;

      setLoadingStep({ current: 3, total, label: 'Analyzing P&L...' });
      const analysis = await analyzeTradeData(tradesToAnalyze);
      setAnalysisData(analysis);
      cache.analysisData = analysis;

      setLoadingStep({ current: 4, total, label: 'Calculating statistics...' });
      const stats = await getTradeStatistics(tradesToAnalyze);
      setStatistics(stats);
      cache.statistics = stats;

      setLoadingStep({ current: 5, total, label: 'Setup breakdown...' });
      const setupData = await getSetupStatistics(tradesToAnalyze);
      setSetupStats(setupData);
      cache.setupStats = setupData;

      setLoadingStep({ current: 6, total, label: 'Symbol analysis...' });
      const symbolData = await getSymbolStatistics(tradesToAnalyze);
      setSymbolStats(symbolData);
      cache.symbolStats = symbolData;

      setLoadingStep({ current: 7, total, label: 'Drawdown analysis...' });
      const drawdown = await getDrawdownAnalysis(tradesToAnalyze);
      setDrawdownData(drawdown);
      cache.drawdownData = drawdown;

      setLoadingStep({ current: 8, total, label: 'Time performance...' });
      const timePerf = await getTimePerformance(tradesToAnalyze);
      setTimePerformance(timePerf);
      cache.timePerformance = timePerf;

      setLoadingStep({ current: 9, total, label: 'Rolling performance...' });
      const rolling = await getRollingPerformance(tradesToAnalyze);
      setRollingPerformance(rolling);
      cache.rollingPerformance = rolling;

      setLoadingStep({ current: 10, total, label: 'Advanced metrics...' });
      const advanced = await getAdvancedMetrics(tradesToAnalyze);
      setAdvancedMetrics(advanced);
      cache.advancedMetrics = advanced;

      setLoadingStep({ current: 11, total, label: 'Entry timing...' });
      const entryTiming = await getEntryTimingAnalysis(tradesToAnalyze);
      setEntryTimingData(entryTiming);
      cache.entryTimingData = entryTiming;

      setLoadingStep({ current: 12, total, label: 'Streak detection...' });
      const streaks = await getStreakDetection(tradesToAnalyze);
      setStreakData(streaks);
      cache.streakData = streaks;

      setLoadingStep({ current: 13, total, label: 'Market cap analysis...' });
      const marketCap = await getMarketCapPerformance(tradesToAnalyze);
      setMarketCapData(marketCap);
      cache.marketCapData = marketCap;

      setLoadingStep({ current: 14, total, label: 'Benchmark comparison...' });
      const benchmark = await getBenchmarkComparison(tradesToAnalyze);
      setBenchmarkData(benchmark);
      cache.benchmarkData = benchmark;

      setLoadingStep({ current: 15, total, label: 'R-multiple analysis...' });
      const rMultiple = await getRMultipleAnalysis(tradesToAnalyze);
      setRMultipleData(rMultiple);
      cache.rMultipleData = rMultiple;

      setLoadingStep({ current: 16, total, label: 'Emotion & process analysis...' });
      const emotionPerf = await getEmotionPerformance(tradesToAnalyze);
      setEmotionData(emotionPerf);
      cache.emotionData = emotionPerf;

    } catch (err) {
      console.error('Error updating analytics:', err);
    }

    // Calendar is computed client-side — always runs even if API calls above failed
    setLoadingStep({ current: 17, total, label: 'Calendar heatmap...' });
    const calendar = buildCalendarData(tradesToAnalyze);
    setCalendarData(calendar);
    cache.calendarData = calendar;

    // Always cache whatever data we managed to load
    _moduleCache = { ...cache };
    if (fileMtime) {
      try {
        localStorage.setItem('trading_analysis_mtime', String(fileMtime));
        localStorage.setItem('trading_analysis_cache', JSON.stringify(cache));
        localStorage.setItem('trading_analysis_version', String(CACHE_VERSION));
      } catch {
        // localStorage might be full
      }
    }
  };

  const calculateClientMetrics = (tradesToAnalyze) => {
    if (!tradesToAnalyze || tradesToAnalyze.length === 0) {
      return { total_pnl: 0, win_rate: 0, avg_win: 0, avg_loss: 0, profit_factor: 0, total_trades: 0, winning_trades: 0, losing_trades: 0 };
    }
    const winning = tradesToAnalyze.filter(t => t.pnl > 0);
    const losing = tradesToAnalyze.filter(t => t.pnl <= 0);
    const totalPnl = tradesToAnalyze.reduce((sum, t) => sum + t.pnl, 0);
    const avgWin = winning.length > 0 ? winning.reduce((sum, t) => sum + t.pnl, 0) / winning.length : 0;
    const avgLoss = losing.length > 0 ? losing.reduce((sum, t) => sum + t.pnl, 0) / losing.length : 0;
    const grossProfit = winning.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losing.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;
    return {
      total_pnl: totalPnl,
      win_rate: (winning.length / tradesToAnalyze.length * 100),
      avg_win: avgWin,
      avg_loss: avgLoss,
      profit_factor: profitFactor,
      total_trades: tradesToAnalyze.length,
      winning_trades: winning.length,
      losing_trades: losing.length,
    };
  };

  const applyFilters = async () => {
    let filtered = [...allTrades];
    if (filters.startDate) filtered = filtered.filter(t => t.entry_date && new Date(t.entry_date) >= new Date(filters.startDate));
    if (filters.endDate) filtered = filtered.filter(t => t.exit_date && new Date(t.exit_date) <= new Date(filters.endDate));
    if (filters.symbol) filtered = filtered.filter(t => t.symbol && t.symbol.toLowerCase().includes(filters.symbol.toLowerCase()));
    if (filters.setup) filtered = filtered.filter(t => t.setup && t.setup.toLowerCase().includes(filters.setup.toLowerCase()));
    if (filters.side) filtered = filtered.filter(t => t.side === filters.side);
    if (filters.minPnL) filtered = filtered.filter(t => t.pnl >= parseFloat(filters.minPnL));
    if (filters.maxPnL) filtered = filtered.filter(t => t.pnl <= parseFloat(filters.maxPnL));
    setTrades(filtered);
    await updateAnalytics(filtered);
  };

  const clearFilters = async () => {
    setFilters({ startDate: '', endDate: '', symbol: '', setup: '', side: '', minPnL: '', maxPnL: '' });
    setTrades(allTrades);
    await updateAnalytics(allTrades);
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setUploadedFile(file);
    setError(null);
    setLoading(true);
    try {
      const result = await uploadTradeData(file);
      setAllTrades(result.trades);
      setTrades(result.trades);
      await updateAnalytics(result.trades);
      toast.success(`Loaded ${result.trades.length} trades from ${file.name}`);
    } catch (err) {
      setError(err.message);
      toast.error('Failed to upload file');
      console.error('Error uploading file:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDragOver = (event) => { event.preventDefault(); };
  const handleDrop = async (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) await handleFileUpload({ target: { files: [file] } });
  };

  // Prepare data for tabs
  const metricsCards = metrics ? [
    { label: 'Total P&L', value: `$${metrics.total_pnl.toFixed(2).toLocaleString()}`, change: metrics.total_pnl > 0 ? 'Profit' : 'Loss', positive: metrics.total_pnl > 0 },
    { label: 'Win Rate', value: `${metrics.win_rate.toFixed(2)}%`, change: `${metrics.winning_trades}W / ${metrics.losing_trades}L`, positive: metrics.win_rate >= 50 },
    { label: 'Avg Win', value: `$${Math.abs(metrics.avg_win).toFixed(2)}`, change: 'Per winning trade', positive: true },
    { label: 'Avg Loss', value: `$${Math.abs(metrics.avg_loss).toFixed(2)}`, change: 'Per losing trade', positive: false },
    { label: 'Profit Factor', value: metrics.profit_factor.toFixed(2), change: metrics.profit_factor > 1 ? 'Good' : 'Poor', positive: metrics.profit_factor > 1 },
    { label: 'Total Trades', value: metrics.total_trades.toString(), change: 'Completed', positive: true },
  ] : [];

  const exportCSV = useCallback(() => {
    if (!trades.length) return;
    const headers = ['Symbol', 'Side', 'Entry Date', 'Exit Date', 'Entry Price', 'Exit Price', 'Quantity', 'P&L', 'Return %', 'Setup', 'Duration Days'];
    const rows = trades.map(t => [
      t.symbol, t.side, t.entry_date, t.exit_date, t.entry_price, t.exit_price,
      t.quantity, t.pnl?.toFixed(2), t.pnl_pct?.toFixed(2), t.setup || '', t.duration_days || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v ?? ''}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trades_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${trades.length} trades to CSV`);
  }, [trades, toast]);

  const cumulativePnLData = analysisData?.cumulative_pnl?.map(item => ({
    date: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    pnl: item.cumulative_pnl
  })) || [];

  const monthlyPnLData = analysisData?.monthly_pnl?.map(item => ({
    month: item.month,
    pnl: item.pnl
  })) || [];

  return (
    <div className="space-y-8">
      {/* Header + Upload */}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-[28px] text-surface-50 tracking-tight mb-1">Trading Analysis</h1>
          <p className="text-surface-400 text-sm">Upload your trade history to analyze performance metrics and visualize results</p>
        </div>
        <div
          className="flex-shrink-0 rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 px-5 py-3 flex items-center gap-3 hover:border-accent/30 transition-colors cursor-pointer min-w-[240px]"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
          <svg className="w-6 h-6 text-surface-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <div className="min-w-0">
            {uploadedFile ? (
              <>
                <p className="text-success font-mono text-sm truncate">{uploadedFile.name}</p>
                <p className="text-surface-500 text-xs">Click to replace</p>
              </>
            ) : (
              <>
                <p className="text-surface-200 text-sm font-medium">Upload Trade Data</p>
                <p className="text-surface-500 text-xs">CSV or Excel</p>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {!loading && trades.length > 0 && fromCache && <span className="text-xs text-surface-500">Cached</span>}
          <button
            onClick={() => setShowFormatter(true)}
            className="px-4 py-2.5 rounded-xl bg-surface-800 border border-surface-700/50 text-surface-300 hover:text-surface-100 hover:bg-surface-700 text-sm font-medium transition-colors flex items-center gap-2"
            title="Import trades from IBKR PDF reports"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            Import
          </button>
          {!loading && trades.length > 0 && (
            <>
              <button
                onClick={exportCSV}
                className="px-4 py-2.5 rounded-xl bg-surface-800 border border-surface-700/50 text-surface-300 hover:text-surface-100 hover:bg-surface-700 text-sm font-medium transition-colors flex items-center gap-2"
                title="Export trades to CSV"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Export
              </button>
              <button
                onClick={() => { _moduleCache = null; localStorage.removeItem('trading_analysis_mtime'); localStorage.removeItem('trading_analysis_cache'); loadTrades(true); }}
                className="px-5 py-2.5 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 hover:text-surface-50 transition-colors"
              >
                Refresh
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-3">
          <p className="text-danger text-sm">{error}</p>
        </div>
      )}

      {/* Filters — inline with active filter chips */}
      {!loading && trades.length > 0 && (() => {
        const activeFilters = Object.entries(filters).filter(([, v]) => v !== '');
        const hasFilters = activeFilters.length > 0;
        const filterLabels = { startDate: 'From', endDate: 'To', symbol: 'Symbol', setup: 'Setup', side: 'Side', minPnL: 'Min P&L', maxPnL: 'Max P&L' };
        return (
          <div className="sticky top-14 z-40 rounded-xl bg-surface-950/90 backdrop-blur-xl border border-surface-700/50 shadow-lg">
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
                {/* Filter toggle */}
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    showFilters ? 'bg-accent/10 text-accent' : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/60'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  Filters
                  {hasFilters && (
                    <span className="w-5 h-5 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center">
                      {activeFilters.length}
                    </span>
                  )}
                </button>

                {/* Active filter chips */}
                {hasFilters && activeFilters.map(([key, val]) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/10 text-accent text-xs font-medium border border-accent/20"
                  >
                    {filterLabels[key]}: <span className="font-mono">{val}</span>
                    <button
                      onClick={() => {
                        const next = { ...filters, [key]: '' };
                        setFilters(next);
                        // Auto-reapply if clearing a filter
                        const anyLeft = Object.values(next).some(v => v !== '');
                        if (!anyLeft) {
                          setTrades(allTrades);
                          updateAnalytics(allTrades);
                        }
                      }}
                      className="ml-0.5 text-accent/60 hover:text-accent"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}

                <span className="text-xs text-surface-500 ml-auto flex-shrink-0">
                  {trades.length === allTrades.length ? `${trades.length} trades` : `${trades.length} of ${allTrades.length}`}
                </span>
              </div>
            </div>

            {/* Expandable filter form */}
            <div className={`overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${showFilters ? 'max-h-[300px] opacity-100' : 'max-h-0 opacity-0'}`}>
              <div className="px-4 pb-4 pt-2 border-t border-surface-700/20">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                  <div>
                    <label className="block text-[11px] text-surface-400 mb-1.5 font-medium uppercase tracking-wider">Start Date</label>
                    <input type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} className={INPUT_STYLE} />
                  </div>
                  <div>
                    <label className="block text-[11px] text-surface-400 mb-1.5 font-medium uppercase tracking-wider">End Date</label>
                    <input type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} className={INPUT_STYLE} />
                  </div>
                  <div>
                    <label className="block text-[11px] text-surface-400 mb-1.5 font-medium uppercase tracking-wider">Symbol</label>
                    <input type="text" placeholder="AAPL" value={filters.symbol} onChange={(e) => setFilters({ ...filters, symbol: e.target.value })} className={INPUT_STYLE} />
                  </div>
                  <div>
                    <label className="block text-[11px] text-surface-400 mb-1.5 font-medium uppercase tracking-wider">Setup</label>
                    <input type="text" placeholder="Breakout" value={filters.setup} onChange={(e) => setFilters({ ...filters, setup: e.target.value })} className={INPUT_STYLE} />
                  </div>
                  <div>
                    <label className="block text-[11px] text-surface-400 mb-1.5 font-medium uppercase tracking-wider">Side</label>
                    <select value={filters.side} onChange={(e) => setFilters({ ...filters, side: e.target.value })} className={INPUT_STYLE}>
                      <option value="">All</option>
                      <option value="LONG">Long</option>
                      <option value="SHORT">Short</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-surface-400 mb-1.5 font-medium uppercase tracking-wider">Min P&L</label>
                    <input type="number" placeholder="$0" value={filters.minPnL} onChange={(e) => setFilters({ ...filters, minPnL: e.target.value })} className={INPUT_STYLE} />
                  </div>
                  <div>
                    <label className="block text-[11px] text-surface-400 mb-1.5 font-medium uppercase tracking-wider">Max P&L</label>
                    <input type="number" placeholder="$1000" value={filters.maxPnL} onChange={(e) => setFilters({ ...filters, maxPnL: e.target.value })} className={INPUT_STYLE} />
                  </div>
                </div>
                <div className="flex gap-3 pt-3">
                  <button onClick={applyFilters} className="px-5 py-2 rounded-lg bg-surface-800 border border-surface-600/50 text-sm font-medium text-surface-200 hover:bg-surface-700 hover:text-surface-50 transition-colors">
                    Apply Filters
                  </button>
                  {hasFilters && (
                    <button onClick={clearFilters} className="px-4 py-2 text-surface-400 hover:text-surface-200 font-medium rounded-lg text-sm transition-colors hover:bg-surface-800/60">
                      Clear All
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Loading State — eased progress + skeleton preview */}
      {loading && (
        <div className="space-y-6 animate-fade-in">
          {/* Progress indicator */}
          <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 backdrop-blur-sm p-8">
            <div className="max-w-md mx-auto">
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-surface-300 font-medium">{loadingStep.label}</span>
                  <span className="text-sm text-surface-400 font-mono">
                    {(() => {
                      // Eased progress: jump to 30%, slow through middle, snap at end
                      const raw = loadingStep.total > 0 ? (loadingStep.current / loadingStep.total) : 0;
                      const eased = raw < 0.1 ? raw * 3 : raw < 0.8 ? 0.3 + (raw - 0.1) * 0.7 : 0.79 + (raw - 0.8) * 1.05;
                      return Math.min(Math.round(eased * 100), 100);
                    })()}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-surface-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-accent to-accent-bright rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: `${(() => {
                        const raw = loadingStep.total > 0 ? (loadingStep.current / loadingStep.total) : 0;
                        const eased = raw < 0.1 ? raw * 3 : raw < 0.8 ? 0.3 + (raw - 0.1) * 0.7 : 0.79 + (raw - 0.8) * 1.05;
                        return Math.max(Math.min(eased * 100, 100), 5);
                      })()}%`,
                    }}
                  />
                </div>
              </div>
              <p className="text-center text-xs text-surface-500">
                Analyzing your trades
              </p>
            </div>
          </div>

          {/* Skeleton preview — shows page shape immediately */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="rounded-xl bg-surface-900/60 border border-surface-700/30 p-4" style={{ animationDelay: `${i * 80}ms` }}>
                <div className="skeleton h-3 w-16 mb-3" />
                <div className="skeleton h-6 w-24 mb-2" />
                <div className="skeleton h-3 w-12" />
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-surface-900/60 border border-surface-700/30 p-6">
            <div className="skeleton h-5 w-40 mb-6" />
            <div className="skeleton h-48 w-full rounded-lg" />
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      {!loading && trades.length > 0 && (
        <div className="flex justify-center">
          <TabNavigation activeTab={activeTab} onChange={setActiveTab} />
        </div>
      )}

      {/* Tab Content */}
      {!loading && trades.length > 0 && (
        <div key={activeTab} className="animate-slide-in">
          {activeTab === 'overview' && (
            <OverviewTab
              metrics={metrics}
              metricsCards={metricsCards}
              statistics={statistics}
              streakData={streakData}
              setupStats={setupStats}
              marketCapData={marketCapData}
              timePerformance={timePerformance}
              rMultipleData={rMultipleData}
              benchmarkData={benchmarkData}
              cumulativePnLData={cumulativePnLData}
              monthlyPnLData={monthlyPnLData}
              trades={trades}
              calendarData={calendarData}
            />
          )}
          {activeTab === 'performance' && (
            <PerformanceTab
              setupStats={setupStats}
              symbolStats={symbolStats}
              metrics={metrics}
              trades={trades}
              marketCapData={marketCapData}
            />
          )}
          {activeTab === 'risk' && (
            <RiskTab
              statistics={statistics}
              advancedMetrics={advancedMetrics}
              drawdownData={drawdownData}
              rMultipleData={rMultipleData}
              benchmarkData={benchmarkData}
            />
          )}
          {activeTab === 'timing' && (
            <TimingTab
              timePerformance={timePerformance}
              entryTimingData={entryTimingData}
              trades={trades}
            />
          )}
          {activeTab === 'behavior' && (
            <BehaviorTab
              streakData={streakData}
              emotionData={emotionData}
              rollingPerformance={rollingPerformance}
              calendarData={calendarData}
              trades={trades}
            />
          )}
        </div>
      )}

      {/* Recent Trades - always visible */}
      {!loading && trades.length > 0 && (
        <RecentTradesTable trades={trades} />
      )}

      {/* Trade Formatter Modal */}
      {showFormatter && (
        <TradeFormatterModal
          onClose={() => setShowFormatter(false)}
          onComplete={() => {
            _moduleCache = null;
            localStorage.removeItem('trading_analysis_mtime');
            localStorage.removeItem('trading_analysis_cache');
            loadTrades(true);
          }}
        />
      )}
    </div>
  );
};

export default TradingAnalysis;
