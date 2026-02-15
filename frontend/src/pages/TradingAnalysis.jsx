import { useState, useRef, useEffect } from 'react';
import { getFileStatus, loadDefaultTrades, uploadTradeData, analyzeTradeData, getTradeStatistics, getSetupStatistics, getSymbolStatistics, getDrawdownAnalysis, getTimePerformance, getRollingPerformance, getAdvancedMetrics, getEntryTimingAnalysis, getStreakDetection, getMarketCapPerformance, getBenchmarkComparison, getRMultipleAnalysis, getEmotionPerformance } from '../api/tradingAnalysis';

import TabNavigation from '../components/analysis/TabNavigation';
import OverviewTab from '../components/analysis/OverviewTab';
import PerformanceTab from '../components/analysis/PerformanceTab';
import RiskTab from '../components/analysis/RiskTab';
import TimingTab from '../components/analysis/TimingTab';
import BehaviorTab from '../components/analysis/BehaviorTab';
import RecentTradesTable from '../components/analysis/RecentTradesTable';

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
    } catch (err) {
      setError(err.message);
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
          <h1 className="font-display font-bold text-3xl text-surface-50 mb-1">Trading Analysis</h1>
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
        {!loading && trades.length > 0 && (
          <div className="flex items-center gap-3 flex-shrink-0">
            {fromCache && <span className="text-xs text-surface-500">Cached</span>}
            <button
              onClick={() => { _moduleCache = null; localStorage.removeItem('trading_analysis_mtime'); localStorage.removeItem('trading_analysis_cache'); loadTrades(true); }}
              className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-muted text-white text-sm font-medium transition-colors"
            >
              Refresh
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-3">
          <p className="text-danger text-sm">{error}</p>
        </div>
      )}

      {/* Filters */}
      {!loading && trades.length > 0 && (
        <div className="sticky top-14 z-40 rounded-xl bg-surface-950/90 backdrop-blur-xl border border-surface-700/50 shadow-lg">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-4">
              <h2 className="font-display font-semibold text-sm text-surface-50">Filters</h2>
              <span className="text-xs text-surface-400">{trades.length} of {allTrades.length} trades</span>
            </div>
            <button onClick={() => setShowFilters(!showFilters)} className="text-xs text-success hover:text-success-bright transition-colors px-3 py-1 rounded bg-surface-900/50">
              {showFilters ? '\u25B2 Hide' : '\u25BC Show'}
            </button>
          </div>
          {showFilters && (
            <div className="px-4 pb-4 pt-2 border-t border-surface-700/20">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-surface-400 mb-1">Start Date</label>
                  <input type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} className="w-full rounded bg-surface-800 border border-surface-600/40 px-2 py-1.5 text-surface-100 text-xs focus:border-accent focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-surface-400 mb-1">End Date</label>
                  <input type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} className="w-full rounded bg-surface-800 border border-surface-600/40 px-2 py-1.5 text-surface-100 text-xs focus:border-accent focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-surface-400 mb-1">Symbol</label>
                  <input type="text" placeholder="e.g., AAPL" value={filters.symbol} onChange={(e) => setFilters({ ...filters, symbol: e.target.value })} className="w-full rounded bg-surface-800 border border-surface-600/40 px-2 py-1.5 text-surface-100 text-xs focus:border-accent focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-surface-400 mb-1">Setup</label>
                  <input type="text" placeholder="e.g., Breakout" value={filters.setup} onChange={(e) => setFilters({ ...filters, setup: e.target.value })} className="w-full rounded bg-surface-800 border border-surface-600/40 px-2 py-1.5 text-surface-100 text-xs focus:border-accent focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-surface-400 mb-1">Side</label>
                  <select value={filters.side} onChange={(e) => setFilters({ ...filters, side: e.target.value })} className="w-full rounded bg-surface-800 border border-surface-600/40 px-2 py-1.5 text-surface-100 text-xs focus:border-accent focus:outline-none">
                    <option value="">All</option>
                    <option value="LONG">LONG</option>
                    <option value="SHORT">SHORT</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-surface-400 mb-1">Min P&L ($)</label>
                  <input type="number" placeholder="0" value={filters.minPnL} onChange={(e) => setFilters({ ...filters, minPnL: e.target.value })} className="w-full rounded bg-surface-800 border border-surface-600/40 px-2 py-1.5 text-surface-100 text-xs focus:border-accent focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-surface-400 mb-1">Max P&L ($)</label>
                  <input type="number" placeholder="1000" value={filters.maxPnL} onChange={(e) => setFilters({ ...filters, maxPnL: e.target.value })} className="w-full rounded bg-surface-800 border border-surface-600/40 px-2 py-1.5 text-surface-100 text-xs focus:border-accent focus:outline-none" />
                </div>
              </div>
              <div className="flex gap-2 pt-2 col-span-full">
                <button onClick={applyFilters} className="px-4 py-1.5 bg-accent hover:brightness-110 text-white font-medium rounded-full text-[12px] transition-all duration-200">Apply</button>
                <button onClick={clearFilters} className="px-4 py-1.5 bg-surface-700 hover:bg-surface-600 text-surface-100 font-medium rounded text-xs transition-colors">Clear</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="rounded-xl bg-surface-900/80 border border-surface-700/50 backdrop-blur-sm p-8">
          <div className="max-w-md mx-auto">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-surface-300 font-medium">{loadingStep.label}</span>
                <span className="text-sm text-surface-400 font-mono">{loadingStep.total > 0 ? Math.round((loadingStep.current / loadingStep.total) * 100) : 0}%</span>
              </div>
              <div className="w-full h-2 bg-surface-800 rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full transition-all duration-300 ease-out" style={{ width: `${Math.max(loadingStep.total > 0 ? (loadingStep.current / loadingStep.total) * 100 : 2, 2)}%` }} />
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm">
              <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
              <span className="text-surface-400">Step <span className="text-surface-200 font-mono font-medium">{loadingStep.current}</span><span className="text-surface-500"> of {loadingStep.total}</span></span>
            </div>
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
        <div key={activeTab} className="animate-fade-in">
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
    </div>
  );
};

export default TradingAnalysis;
