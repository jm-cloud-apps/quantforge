import { useState, useRef, useEffect } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ZAxis,
  ReferenceLine,
} from 'recharts';
import { loadDefaultTrades, uploadTradeData, analyzeTradeData, getTradeStatistics, getSetupStatistics, getSymbolStatistics, getDrawdownAnalysis, getTimePerformance, getRollingPerformance, getAdvancedMetrics, getEntryTimingAnalysis, getStreakDetection, getMarketCapPerformance, getBenchmarkComparison, getRMultipleAnalysis } from '../api/tradingAnalysis';

const INPUT_STYLE = 'w-full rounded-lg bg-surface-800 border border-surface-600/40 px-4 py-2.5 text-sm text-surface-100 placeholder-surface-500 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 transition-colors';

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'rgba(15, 22, 35, 0.95)',
    border: '0.5px solid rgba(30, 41, 59, 0.5)',
    borderRadius: '8px',
    backdropFilter: 'blur(20px)',
  },
  labelStyle: { color: '#E2E8F0', fontFamily: 'monospace', fontSize: '12px' },
  itemStyle: { color: '#E2E8F0', fontFamily: 'monospace', fontSize: '12px' },
};

const TradingAnalysis = () => {
  const [uploadedFile, setUploadedFile] = useState(null);
  const [trades, setTrades] = useState([]);
  const [allTrades, setAllTrades] = useState([]); // Store all trades before filtering
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  // Heatmap hover tooltip
  const [heatmapTooltip, setHeatmapTooltip] = useState(null);

  // Entry/Exit timing month filter
  const [timingMonthFilter, setTimingMonthFilter] = useState('all');

  // Filter state
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

  // Sorting state
  const [setupSort, setSetupSort] = useState({ column: 'total_pnl', direction: 'desc' });
  const [symbolSort, setSymbolSort] = useState({ column: 'total_pnl', direction: 'desc' });

  // Pagination state
  const [tradesPage, setTradesPage] = useState(1);
  const tradesPerPage = 20;

  // Load default trades on mount
  useEffect(() => {
    loadTrades();
  }, []);

  const loadTrades = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadDefaultTrades();
      setAllTrades(result.trades);
      setTrades(result.trades);
      await updateAnalytics(result.trades);
    } catch (err) {
      setError(err.message);
      console.error('Error loading trades:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateAnalytics = async (tradesToAnalyze) => {
    try {
      // Get metrics
      const metricsData = calculateClientMetrics(tradesToAnalyze);
      setMetrics(metricsData);

      // Get analysis data (monthly/cumulative P&L)
      const analysis = await analyzeTradeData(tradesToAnalyze);
      setAnalysisData(analysis);

      // Get detailed statistics
      const stats = await getTradeStatistics(tradesToAnalyze);
      setStatistics(stats);

      // Get setup statistics
      const setupData = await getSetupStatistics(tradesToAnalyze);
      setSetupStats(setupData);

      // Get symbol statistics
      const symbolData = await getSymbolStatistics(tradesToAnalyze);
      setSymbolStats(symbolData);

      // Get advanced analytics
      const drawdown = await getDrawdownAnalysis(tradesToAnalyze);
      setDrawdownData(drawdown);

      const timePerf = await getTimePerformance(tradesToAnalyze);
      setTimePerformance(timePerf);

      const rolling = await getRollingPerformance(tradesToAnalyze);
      setRollingPerformance(rolling);

      const advanced = await getAdvancedMetrics(tradesToAnalyze);
      setAdvancedMetrics(advanced);

      const entryTiming = await getEntryTimingAnalysis(tradesToAnalyze);
      setEntryTimingData(entryTiming);

      const streaks = await getStreakDetection(tradesToAnalyze);
      setStreakData(streaks);

      const marketCap = await getMarketCapPerformance(tradesToAnalyze);
      setMarketCapData(marketCap);

      const benchmark = await getBenchmarkComparison(tradesToAnalyze);
      setBenchmarkData(benchmark);

      const rMultiple = await getRMultipleAnalysis(tradesToAnalyze);
      setRMultipleData(rMultiple);
    } catch (err) {
      console.error('Error updating analytics:', err);
    }
  };

  const calculateClientMetrics = (tradesToAnalyze) => {
    if (!tradesToAnalyze || tradesToAnalyze.length === 0) {
      return {
        total_pnl: 0,
        win_rate: 0,
        avg_win: 0,
        avg_loss: 0,
        profit_factor: 0,
        total_trades: 0,
        winning_trades: 0,
        losing_trades: 0,
      };
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

  // Apply filters
  const applyFilters = async () => {
    let filtered = [...allTrades];

    if (filters.startDate) {
      filtered = filtered.filter(t =>
        t.entry_date && new Date(t.entry_date) >= new Date(filters.startDate)
      );
    }

    if (filters.endDate) {
      filtered = filtered.filter(t =>
        t.exit_date && new Date(t.exit_date) <= new Date(filters.endDate)
      );
    }

    if (filters.symbol) {
      filtered = filtered.filter(t =>
        t.symbol && t.symbol.toLowerCase().includes(filters.symbol.toLowerCase())
      );
    }

    if (filters.setup) {
      filtered = filtered.filter(t =>
        t.setup && t.setup.toLowerCase().includes(filters.setup.toLowerCase())
      );
    }

    if (filters.side) {
      filtered = filtered.filter(t => t.side === filters.side);
    }

    if (filters.minPnL) {
      filtered = filtered.filter(t => t.pnl >= parseFloat(filters.minPnL));
    }

    if (filters.maxPnL) {
      filtered = filtered.filter(t => t.pnl <= parseFloat(filters.maxPnL));
    }

    setTrades(filtered);
    await updateAnalytics(filtered);
  };

  const clearFilters = async () => {
    setFilters({
      startDate: '',
      endDate: '',
      symbol: '',
      setup: '',
      side: '',
      minPnL: '',
      maxPnL: '',
    });
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

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      const fakeEvent = { target: { files: [file] } };
      await handleFileUpload(fakeEvent);
    }
  };

  // Prepare metrics cards data
  const metricsCards = metrics ? [
    {
      label: 'Total P&L',
      value: `$${metrics.total_pnl.toFixed(2).toLocaleString()}`,
      change: metrics.total_pnl > 0 ? 'Profit' : 'Loss',
      positive: metrics.total_pnl > 0,
    },
    {
      label: 'Win Rate',
      value: `${metrics.win_rate.toFixed(2)}%`,
      change: `${metrics.winning_trades}W / ${metrics.losing_trades}L`,
      positive: metrics.win_rate >= 50,
    },
    {
      label: 'Avg Win',
      value: `$${Math.abs(metrics.avg_win).toFixed(2)}`,
      change: 'Per winning trade',
      positive: true,
    },
    {
      label: 'Avg Loss',
      value: `$${Math.abs(metrics.avg_loss).toFixed(2)}`,
      change: 'Per losing trade',
      positive: false,
    },
    {
      label: 'Profit Factor',
      value: metrics.profit_factor.toFixed(2),
      change: metrics.profit_factor > 1 ? 'Good' : 'Poor',
      positive: metrics.profit_factor > 1,
    },
    {
      label: 'Total Trades',
      value: metrics.total_trades.toString(),
      change: 'Completed',
      positive: true,
    },
  ] : [];

  // Prepare chart data
  const cumulativePnLData = analysisData?.cumulative_pnl?.map(item => ({
    date: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    pnl: item.cumulative_pnl
  })) || [];

  const monthlyPnLData = analysisData?.monthly_pnl?.map(item => ({
    month: item.month,
    pnl: item.pnl
  })) || [];

  const winLossData = metrics ? [
    { name: 'Wins', value: metrics.winning_trades, color: '#10B981' },
    { name: 'Losses', value: metrics.losing_trades, color: '#EF4444' },
  ] : [];

  // Sorting functions
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

  // Sort setup stats
  const sortedSetupStats = setupStats?.setups ? [...setupStats.setups].sort((a, b) => {
    const aVal = a[setupSort.column];
    const bVal = b[setupSort.column];
    const multiplier = setupSort.direction === 'desc' ? -1 : 1;
    return (aVal > bVal ? 1 : -1) * multiplier;
  }) : [];

  // Sort symbol stats
  const sortedSymbolStats = symbolStats?.symbols ? [...symbolStats.symbols].sort((a, b) => {
    const aVal = a[symbolSort.column];
    const bVal = b[symbolSort.column];
    const multiplier = symbolSort.direction === 'desc' ? -1 : 1;
    return (aVal > bVal ? 1 : -1) * multiplier;
  }) : [];

  // Pagination for recent trades
  const totalPages = Math.ceil(trades.length / tradesPerPage);
  const startIndex = (tradesPage - 1) * tradesPerPage;
  const endIndex = startIndex + tradesPerPage;
  const paginatedTrades = trades.slice().reverse().slice(startIndex, endIndex);

  // Sort indicator component
  const SortIcon = ({ column, currentSort }) => {
    if (currentSort.column !== column) {
      return <span className="text-surface-600 ml-1">↕</span>;
    }
    return currentSort.direction === 'desc'
      ? <span className="text-success ml-1">↓</span>
      : <span className="text-success ml-1">↑</span>;
  };

  // Info tooltip component
  const InfoTooltip = ({ text }) => {
    return (
      <div className="group relative inline-block ml-1">
        <span className="text-surface-500 text-xs cursor-help">ⓘ</span>
        <div className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-surface-900/95 backdrop-blur-xl border border-surface-600/40 rounded-xl shadow-card text-[12px] text-surface-200 z-50 leading-relaxed">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-surface-900/95"></div>
        </div>
      </div>
    );
  };

  const CustomTooltip = ({ active, payload }) => {
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
  };

  return (
    <div className="space-y-8">
      {/* Header + Upload Inline */}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-3xl text-surface-50 mb-1">
            Trading Analysis
          </h1>
          <p className="text-surface-400 text-sm">
            Upload your trade history to analyze performance metrics and visualize results
          </p>
        </div>

        {/* Compact Upload Box */}
        <div
          className="flex-shrink-0 rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 px-5 py-3 flex items-center gap-3 hover:border-accent/30 transition-colors cursor-pointer min-w-[240px]"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileUpload}
            className="hidden"
          />
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
      </div>

      {error && (
        <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-3">
          <p className="text-danger text-sm">{error}</p>
        </div>
      )}

      {/* Filters Section - Sticky & Compact */}
      {!loading && trades.length > 0 && (
        <div className="sticky top-14 z-40 rounded-xl bg-surface-950/90 backdrop-blur-xl border border-surface-700/50 shadow-lg">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-4">
              <h2 className="font-display font-semibold text-sm text-surface-50">
                Filters
              </h2>
              <span className="text-xs text-surface-400">
                {trades.length} of {allTrades.length} trades
              </span>
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="text-xs text-success hover:text-success-bright transition-colors px-3 py-1 rounded bg-surface-900/50"
            >
              {showFilters ? '▲ Hide' : '▼ Show'}
            </button>
          </div>

          {showFilters && (
            <div className="px-4 pb-4 pt-2 border-t border-surface-700/20">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Date Range */}
              <div>
                <label className="block text-xs text-surface-400 mb-1">Start Date</label>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                  className="w-full rounded bg-surface-800 border border-surface-600/40 px-2 py-1.5 text-surface-100 text-xs focus:border-accent focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-surface-400 mb-1">End Date</label>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                  className="w-full rounded bg-surface-800 border border-surface-600/40 px-2 py-1.5 text-surface-100 text-xs focus:border-accent focus:outline-none"
                />
              </div>

              {/* Symbol */}
              <div>
                <label className="block text-xs text-surface-400 mb-1">Symbol</label>
                <input
                  type="text"
                  placeholder="e.g., AAPL"
                  value={filters.symbol}
                  onChange={(e) => setFilters({ ...filters, symbol: e.target.value })}
                  className="w-full rounded bg-surface-800 border border-surface-600/40 px-2 py-1.5 text-surface-100 text-xs focus:border-accent focus:outline-none"
                />
              </div>

              {/* Setup */}
              <div>
                <label className="block text-xs text-surface-400 mb-1">Setup</label>
                <input
                  type="text"
                  placeholder="e.g., Breakout"
                  value={filters.setup}
                  onChange={(e) => setFilters({ ...filters, setup: e.target.value })}
                  className="w-full rounded bg-surface-800 border border-surface-600/40 px-2 py-1.5 text-surface-100 text-xs focus:border-accent focus:outline-none"
                />
              </div>

              {/* Side */}
              <div>
                <label className="block text-xs text-surface-400 mb-1">Side</label>
                <select
                  value={filters.side}
                  onChange={(e) => setFilters({ ...filters, side: e.target.value })}
                  className="w-full rounded bg-surface-800 border border-surface-600/40 px-2 py-1.5 text-surface-100 text-xs focus:border-accent focus:outline-none"
                >
                  <option value="">All</option>
                  <option value="LONG">LONG</option>
                  <option value="SHORT">SHORT</option>
                </select>
              </div>

              {/* Min P&L */}
              <div>
                <label className="block text-xs text-surface-400 mb-1">Min P&L ($)</label>
                <input
                  type="number"
                  placeholder="0"
                  value={filters.minPnL}
                  onChange={(e) => setFilters({ ...filters, minPnL: e.target.value })}
                  className="w-full rounded bg-surface-800 border border-surface-600/40 px-2 py-1.5 text-surface-100 text-xs focus:border-accent focus:outline-none"
                />
              </div>

              {/* Max P&L */}
              <div>
                <label className="block text-xs text-surface-400 mb-1">Max P&L ($)</label>
                <input
                  type="number"
                  placeholder="1000"
                  value={filters.maxPnL}
                  onChange={(e) => setFilters({ ...filters, maxPnL: e.target.value })}
                  className="w-full rounded bg-surface-800 border border-surface-600/40 px-2 py-1.5 text-surface-100 text-xs focus:border-accent focus:outline-none"
                />
              </div>
              </div>

              {/* Filter Actions */}
              <div className="flex gap-2 pt-2 col-span-full">
                <button
                  onClick={applyFilters}
                  className="px-4 py-1.5 bg-accent hover:brightness-110 text-white font-medium rounded-full text-[12px] transition-all duration-200"
                >
                  Apply
                </button>
                <button
                  onClick={clearFilters}
                  className="px-4 py-1.5 bg-surface-700 hover:bg-surface-600 text-surface-100 font-medium rounded text-xs transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-12 text-center">
          <p className="text-surface-400">Loading trade data...</p>
        </div>
      )}

      {/* Performance Metrics */}
      {!loading && metrics && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-xl text-surface-50 mb-6">
            Performance Metrics
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {metricsCards.map((metric, index) => (
              <div
                key={index}
                className="rounded-lg bg-surface-900/60 border border-surface-700/20 p-4"
              >
                <p className="text-surface-400 text-xs mb-1">{metric.label}</p>
                <p className="font-mono font-bold text-xl text-surface-50 mb-1">
                  {metric.value}
                </p>
                <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                  metric.positive
                    ? 'bg-accent/15 text-accent'
                    : 'bg-danger/10 text-danger'
                }`}>
                  {metric.change}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Key Insights Summary */}
      {!loading && metrics && statistics && trades.length > 0 && (
        (() => {
          const insights = [];

          // Categorize: what to continue doing (strengths)
          const strengths = [];
          // Categorize: what to avoid (weaknesses)
          const warnings = [];
          // Categorize: opportunities
          const opportunities = [];

          // Win rate analysis
          if (metrics.win_rate >= 55) {
            strengths.push(`Strong win rate at ${metrics.win_rate.toFixed(1)}% - your edge is working`);
          } else if (metrics.win_rate < 40) {
            warnings.push(`Win rate is low at ${metrics.win_rate.toFixed(1)}% - review your entry criteria or consider tighter screening`);
          }

          // Profit factor
          if (metrics.profit_factor >= 2) {
            strengths.push(`Excellent profit factor of ${metrics.profit_factor.toFixed(2)} - your winners significantly outweigh losers`);
          } else if (metrics.profit_factor < 1) {
            warnings.push(`Profit factor below 1 (${metrics.profit_factor.toFixed(2)}) - you're losing more than you win overall`);
          }

          // Risk/Reward
          if (statistics.risk_reward_ratio >= 2) {
            strengths.push(`Great risk/reward ratio of ${statistics.risk_reward_ratio}:1 - you're letting winners run`);
          } else if (statistics.risk_reward_ratio < 1 && statistics.risk_reward_ratio > 0) {
            warnings.push(`Risk/reward is ${statistics.risk_reward_ratio}:1 - your average loss is bigger than your average win`);
          }

          // Hold time analysis
          if (statistics.avg_winner_duration_days > statistics.avg_loser_duration_days * 1.5) {
            strengths.push(`Winners held ${statistics.avg_winner_duration_days.toFixed(1)} days vs losers ${statistics.avg_loser_duration_days.toFixed(1)} days - good discipline cutting losers`);
          } else if (statistics.avg_loser_duration_days > statistics.avg_winner_duration_days * 1.3) {
            warnings.push(`Holding losers (${statistics.avg_loser_duration_days.toFixed(1)}d) longer than winners (${statistics.avg_winner_duration_days.toFixed(1)}d) - cut losses faster`);
          }

          // Consecutive losses
          if (statistics.consecutive_losses >= 5) {
            warnings.push(`Max ${statistics.consecutive_losses} consecutive losses detected - consider reducing size after 3 losses in a row`);
          }

          // Streak data
          if (streakData) {
            if (streakData.tilt_score > 60) {
              warnings.push(`Tilt score of ${streakData.tilt_score}% - ${streakData.total_revenge_trades} revenge trades mostly lost. Walk away after a loss.`);
            } else if (streakData.tilt_score < 40 && streakData.total_revenge_trades > 5) {
              strengths.push('Good emotional control - you handle losses well without revenge trading');
            }
          }

          // Setup analysis
          if (setupStats?.setups?.length > 1) {
            const bestSetup = setupStats.setups.reduce((best, s) => s.avg_pnl > best.avg_pnl ? s : best);
            const worstSetup = setupStats.setups.reduce((worst, s) => s.avg_pnl < worst.avg_pnl ? s : worst);
            if (bestSetup.avg_pnl > 0) {
              strengths.push(`Best setup: "${bestSetup.setup}" averaging $${bestSetup.avg_pnl.toFixed(0)}/trade at ${bestSetup.win_rate}% win rate`);
            }
            if (worstSetup.avg_pnl < 0 && worstSetup.total_trades >= 3) {
              warnings.push(`"${worstSetup.setup}" is losing $${Math.abs(worstSetup.avg_pnl).toFixed(0)}/trade over ${worstSetup.total_trades} trades - consider dropping or refining this setup`);
            }
          }

          // Market cap analysis
          if (marketCapData?.categories?.length > 1) {
            const bestCap = marketCapData.categories.reduce((best, c) => c.avg_pnl > best.avg_pnl ? c : best);
            if (bestCap.avg_pnl > 0) {
              opportunities.push(`You perform best in ${bestCap.market_cap} stocks (avg $${bestCap.avg_pnl.toFixed(0)}/trade) - consider focusing more here`);
            }
            const worstCap = marketCapData.categories.reduce((worst, c) => c.avg_pnl < worst.avg_pnl ? c : worst);
            if (worstCap.avg_pnl < -50 && worstCap.total_trades >= 3) {
              warnings.push(`Losing avg $${Math.abs(worstCap.avg_pnl).toFixed(0)} in ${worstCap.market_cap} stocks - consider avoiding this segment`);
            }
          }

          // Time analysis
          if (timePerformance?.day_of_week) {
            const bestDay = timePerformance.day_of_week.reduce((best, d) => d.avg_pnl > best.avg_pnl ? d : best);
            const worstDay = timePerformance.day_of_week.reduce((worst, d) => d.avg_pnl < worst.avg_pnl ? d : worst);
            if (bestDay.avg_pnl > 0 && worstDay.avg_pnl < 0) {
              opportunities.push(`Best day: ${bestDay.day} ($${bestDay.avg_pnl.toFixed(0)} avg). Worst: ${worstDay.day} ($${worstDay.avg_pnl.toFixed(0)} avg)`);
            }
          }

          // R-Multiple insights
          if (rMultipleData) {
            if (rMultipleData.avg_r > 0.3) {
              strengths.push(`Average R of ${rMultipleData.avg_r}R means you're earning ${rMultipleData.avg_r}x your risk per trade`);
            } else if (rMultipleData.avg_r < 0) {
              warnings.push(`Negative average R (${rMultipleData.avg_r}R) - you're losing more than your risk per trade`);
            }
          }

          // Expectancy
          if (statistics.expectancy > 100) {
            strengths.push(`Strong expectancy of $${statistics.expectancy.toFixed(0)} per trade - you have a clear edge`);
          } else if (statistics.expectancy < 0) {
            warnings.push(`Negative expectancy ($${statistics.expectancy.toFixed(0)}) - each trade costs you money on average`);
          }

          // Benchmark
          if (benchmarkData && !benchmarkData.error && benchmarkData.alpha) {
            if (benchmarkData.alpha > 5) {
              strengths.push(`Generating ${benchmarkData.alpha.toFixed(1)}% alpha over SPY - outperforming the market`);
            } else if (benchmarkData.alpha < -5) {
              opportunities.push(`Underperforming SPY by ${Math.abs(benchmarkData.alpha).toFixed(1)}% - consider if active trading is adding value`);
            }
          }

          if (strengths.length === 0 && warnings.length === 0 && opportunities.length === 0) return null;

          return (
            <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
              <h2 className="font-display font-semibold text-xl text-surface-50 mb-6">
                Key Insights
              </h2>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Keep Doing */}
                {strengths.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-success" />
                      <h3 className="text-success text-sm font-semibold">Keep Doing</h3>
                    </div>
                    <ul className="space-y-2">
                      {strengths.map((s, i) => (
                        <li key={i} className="text-surface-300 text-xs leading-relaxed pl-4 border-l-2 border-success/30">
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Avoid / Fix */}
                {warnings.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-danger" />
                      <h3 className="text-danger text-sm font-semibold">Avoid / Fix</h3>
                    </div>
                    <ul className="space-y-2">
                      {warnings.map((w, i) => (
                        <li key={i} className="text-surface-300 text-xs leading-relaxed pl-4 border-l-2 border-danger/30">
                          {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Opportunities */}
                {opportunities.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-cyan" />
                      <h3 className="text-cyan text-sm font-semibold">Opportunities</h3>
                    </div>
                    <ul className="space-y-2">
                      {opportunities.map((o, i) => (
                        <li key={i} className="text-surface-300 text-xs leading-relaxed pl-4 border-l-2 border-cyan/30">
                          {o}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          );
        })()
      )}

      {/* Charts Grid */}
      {!loading && analysisData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Cumulative P&L Chart */}
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">
              Cumulative P&L
            </h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cumulativePnLData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis
                    dataKey="date"
                    stroke="#64748B"
                    style={{ fontSize: '12px', fontFamily: 'monospace' }}
                  />
                  <YAxis
                    stroke="#64748B"
                    style={{ fontSize: '12px', fontFamily: 'monospace' }}
                    tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="pnl"
                    stroke="#10B981"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Win/Loss Distribution */}
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">
              Win/Loss Distribution
            </h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={winLossData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {winLossData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    {...TOOLTIP_STYLE}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Monthly P&L */}
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6 lg:col-span-2">
            <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">
              Monthly P&L
            </h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyPnLData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis
                    dataKey="month"
                    stroke="#64748B"
                    style={{ fontSize: '12px', fontFamily: 'monospace' }}
                  />
                  <YAxis
                    stroke="#64748B"
                    style={{ fontSize: '12px', fontFamily: 'monospace' }}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar
                    dataKey="pnl"
                    fill="#10B981"
                    radius={[8, 8, 0, 0]}
                  >
                    {monthlyPnLData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.pnl >= 0 ? '#10B981' : '#EF4444'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Setup and Symbol Performance Side by Side */}
      {!loading && setupStats && setupStats.setups && setupStats.setups.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Setup Statistics */}
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">
              Performance by Setup
            </h2>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-700">
                  <th className="text-left py-3 px-4 text-surface-400 text-sm font-medium">Setup</th>
                  <th
                    className="text-center py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200"
                    onClick={() => handleSetupSort('total_trades')}
                  >
                    Trades <SortIcon column="total_trades" currentSort={setupSort} />
                  </th>
                  <th
                    className="text-center py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200"
                    onClick={() => handleSetupSort('win_rate')}
                  >
                    Win Rate <SortIcon column="win_rate" currentSort={setupSort} />
                  </th>
                  <th
                    className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200"
                    onClick={() => handleSetupSort('total_pnl')}
                  >
                    Total P&L <SortIcon column="total_pnl" currentSort={setupSort} />
                  </th>
                  <th
                    className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200"
                    onClick={() => handleSetupSort('avg_pnl')}
                  >
                    Avg P&L <SortIcon column="avg_pnl" currentSort={setupSort} />
                  </th>
                  <th
                    className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200"
                    onClick={() => handleSetupSort('best_trade')}
                  >
                    Best Trade <SortIcon column="best_trade" currentSort={setupSort} />
                  </th>
                  <th
                    className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200"
                    onClick={() => handleSetupSort('worst_trade')}
                  >
                    Worst Loss <SortIcon column="worst_trade" currentSort={setupSort} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedSetupStats.map((setup, index) => (
                  <tr key={index} className="border-b border-surface-800 hover:bg-surface-900/30 transition-colors">
                    <td className="py-3 px-4 text-surface-100 font-mono text-sm font-semibold">
                      {setup.setup || 'N/A'}
                    </td>
                    <td className="py-3 px-4 text-surface-100 font-mono text-sm text-center">
                      {setup.total_trades} <span className="text-surface-500">({setup.winning_trades}W / {setup.losing_trades}L)</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`font-mono text-sm font-semibold ${setup.win_rate >= 50 ? 'text-success' : 'text-danger'}`}>
                        {setup.win_rate}%
                      </span>
                    </td>
                    <td className={`py-3 px-4 font-mono text-sm font-semibold text-right ${
                      setup.total_pnl >= 0 ? 'text-success' : 'text-danger'
                    }`}>
                      ${setup.total_pnl.toFixed(2)}
                    </td>
                    <td className={`py-3 px-4 font-mono text-sm text-right ${
                      setup.avg_pnl >= 0 ? 'text-success' : 'text-danger'
                    }`}>
                      ${setup.avg_pnl.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-success font-mono text-sm text-right">
                      ${setup.best_trade.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-mono text-sm text-right">
                      {setup.worst_trade < -100 ? (
                        <span className="text-danger">${setup.worst_trade.toFixed(2)}</span>
                      ) : (
                        <span className="text-surface-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Symbol Performance */}
        {symbolStats && symbolStats.symbols && symbolStats.symbols.length > 0 && (
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">
              Performance by Symbol (Top 20)
            </h2>

            <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-700">
                  <th className="text-left py-3 px-4 text-surface-400 text-sm font-medium">Symbol</th>
                  <th
                    className="text-center py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200"
                    onClick={() => handleSymbolSort('total_trades')}
                  >
                    Trades <SortIcon column="total_trades" currentSort={symbolSort} />
                  </th>
                  <th
                    className="text-center py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200"
                    onClick={() => handleSymbolSort('win_rate')}
                  >
                    Win Rate <SortIcon column="win_rate" currentSort={symbolSort} />
                  </th>
                  <th
                    className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200"
                    onClick={() => handleSymbolSort('total_pnl')}
                  >
                    Total P&L <SortIcon column="total_pnl" currentSort={symbolSort} />
                  </th>
                  <th
                    className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200"
                    onClick={() => handleSymbolSort('avg_pnl')}
                  >
                    Avg P&L <SortIcon column="avg_pnl" currentSort={symbolSort} />
                  </th>
                  <th
                    className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200"
                    onClick={() => handleSymbolSort('best_trade')}
                  >
                    Best Trade <SortIcon column="best_trade" currentSort={symbolSort} />
                  </th>
                  <th
                    className="text-right py-3 px-4 text-surface-400 text-sm font-medium cursor-pointer hover:text-surface-200"
                    onClick={() => handleSymbolSort('worst_trade')}
                  >
                    Worst Loss <SortIcon column="worst_trade" currentSort={symbolSort} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedSymbolStats.slice(0, 20).map((symbol, index) => (
                  <tr key={index} className="border-b border-surface-800 hover:bg-surface-900/30 transition-colors">
                    <td className="py-3 px-4 text-surface-100 font-mono text-sm font-semibold">
                      {symbol.symbol}
                    </td>
                    <td className="py-3 px-4 text-surface-100 font-mono text-sm text-center">
                      {symbol.total_trades} <span className="text-surface-500">({symbol.winning_trades}W / {symbol.losing_trades}L)</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`font-mono text-sm font-semibold ${symbol.win_rate >= 50 ? 'text-success' : 'text-danger'}`}>
                        {symbol.win_rate}%
                      </span>
                    </td>
                    <td className={`py-3 px-4 font-mono text-sm font-semibold text-right ${
                      symbol.total_pnl >= 0 ? 'text-success' : 'text-danger'
                    }`}>
                      ${symbol.total_pnl.toFixed(2)}
                    </td>
                    <td className={`py-3 px-4 font-mono text-sm text-right ${
                      symbol.avg_pnl >= 0 ? 'text-success' : 'text-danger'
                    }`}>
                      ${symbol.avg_pnl.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-success font-mono text-sm text-right">
                      ${symbol.best_trade.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-mono text-sm text-right">
                      {symbol.worst_trade < -100 ? (
                        <span className="text-danger">${symbol.worst_trade.toFixed(2)}</span>
                      ) : (
                        <span className="text-surface-500">—</span>
                      )}
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

      {/* Trade Statistics Grid - More Compact */}
      {!loading && statistics && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Trade Statistics */}
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">
              Trade Statistics
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-surface-400 text-xs">Largest Win</p>
                <p className="font-mono text-success font-semibold text-lg">${statistics.largest_win.toFixed(2)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-surface-400 text-xs">Largest Loss</p>
                <p className="font-mono text-danger font-semibold text-lg">${Math.abs(statistics.largest_loss).toFixed(2)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-surface-400 text-xs">Consecutive Wins</p>
                <p className="font-mono text-success font-semibold text-lg">{statistics.consecutive_wins}</p>
              </div>
              <div className="space-y-1">
                <p className="text-surface-400 text-xs">Consecutive Losses</p>
                <p className="font-mono text-danger font-semibold text-lg">{statistics.consecutive_losses}</p>
              </div>
              <div className="space-y-1">
                <p className="text-surface-400 text-xs flex items-center">
                  Expectancy
                  <InfoTooltip text="Average $ you expect to make per trade. Must be positive to be profitable long-term. Higher is better." />
                </p>
                <p className={`font-mono font-semibold text-lg ${statistics.expectancy > 0 ? 'text-success' : 'text-danger'}`}>
                  ${statistics.expectancy.toFixed(2)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-surface-400 text-xs flex items-center">
                  Risk/Reward
                  <InfoTooltip text="Avg win size ÷ avg loss size. >2 means your wins are 2x your losses. >1.5 is good with 50%+ win rate." />
                </p>
                <p className="font-mono text-surface-100 font-semibold text-lg">{statistics.risk_reward_ratio}</p>
              </div>
            </div>
          </div>

          {/* Middle Column - Duration Statistics */}
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">
              Hold Time Analysis
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-surface-400 text-xs">Avg Duration</p>
                <p className="font-mono text-surface-100 font-semibold text-lg">
                  {statistics.avg_trade_duration_days > 1
                    ? `${statistics.avg_trade_duration_days} days`
                    : `${statistics.avg_trade_duration_hours.toFixed(1)} hrs`}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-surface-400 text-xs flex items-center">
                  Kelly Criterion
                  <InfoTooltip text="Optimal position size as % of capital. Suggests how much to risk per trade based on your edge. >2% is aggressive, <1% is conservative." />
                </p>
                <p className="font-mono text-surface-100 font-semibold text-lg">{statistics.kelly_criterion_pct}%</p>
              </div>
              <div className="space-y-1">
                <p className="text-surface-400 text-xs flex items-center">
                  Winner Hold Time
                  <InfoTooltip text="Average time you hold winning trades. If much longer than losers, you're letting winners run (good)." />
                </p>
                <p className="font-mono text-success font-semibold text-lg">
                  {statistics.avg_winner_duration_days.toFixed(1)} days
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-surface-400 text-xs flex items-center">
                  Loser Hold Time
                  <InfoTooltip text="Average time you hold losing trades. Ideally shorter than winners - means you cut losses quickly." />
                </p>
                <p className="font-mono text-danger font-semibold text-lg">
                  {statistics.avg_loser_duration_days.toFixed(1)} days
                </p>
              </div>
            </div>
          </div>

          {/* Right Column - Risk-Adjusted Metrics */}
          {advancedMetrics && (
            <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
              <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">
                Risk-Adjusted Returns
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-surface-400 text-xs flex items-center">
                    Sharpe Ratio
                    <InfoTooltip text="Return per unit of total risk. >1 is good, >2 is excellent, >3 is exceptional. Measures consistency of returns." />
                  </p>
                  <p className={`font-mono font-semibold text-lg ${advancedMetrics.sharpe_ratio > 1 ? 'text-success' : 'text-surface-100'}`}>
                    {advancedMetrics.sharpe_ratio}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-surface-400 text-xs flex items-center">
                    Sortino Ratio
                    <InfoTooltip text="Like Sharpe but only penalizes downside volatility. Better for asymmetric returns. >1.5 is good, >2 is excellent." />
                  </p>
                  <p className={`font-mono font-semibold text-lg ${advancedMetrics.sortino_ratio > 1 ? 'text-success' : 'text-surface-100'}`}>
                    {advancedMetrics.sortino_ratio}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-surface-400 text-xs flex items-center">
                    Calmar Ratio
                    <InfoTooltip text="Total return divided by maximum drawdown. Higher is better. >3 is excellent. Shows return efficiency relative to worst loss." />
                  </p>
                  <p className={`font-mono font-semibold text-lg ${advancedMetrics.calmar_ratio > 1 ? 'text-success' : 'text-surface-100'}`}>
                    {advancedMetrics.calmar_ratio}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-surface-400 text-xs flex items-center">
                    Std Deviation
                    <InfoTooltip text="Measures trade outcome variability. Lower means more consistent results. Compare to your avg trade size." />
                  </p>
                  <p className="font-mono text-surface-100 font-semibold text-lg">
                    ${advancedMetrics.std_return.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Drawdown Analysis */}
      {!loading && drawdownData && !drawdownData.error && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-xl text-surface-50 mb-6">
            Drawdown Analysis
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">
                Max Drawdown
                <InfoTooltip text="Your worst peak-to-trough decline. This is the most you've lost from a high point. Critical metric - keep under 30%." />
              </p>
              <p className="font-mono text-danger font-semibold text-lg">${Math.abs(drawdownData.max_drawdown).toFixed(2)}</p>
              <p className="text-surface-500 text-xs">{drawdownData.max_drawdown_pct.toFixed(1)}%</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">
                Current Drawdown
                <InfoTooltip text="How far you are from your equity peak right now. $0 means you're at all-time highs. Anything else means you're in drawdown." />
              </p>
              <p className={`font-mono font-semibold text-lg ${drawdownData.current_drawdown === 0 ? 'text-success' : 'text-danger'}`}>
                ${Math.abs(drawdownData.current_drawdown).toFixed(2)}
              </p>
              <p className="text-surface-500 text-xs">{Math.abs(drawdownData.current_drawdown_pct).toFixed(1)}%</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">
                Recovery Time
                <InfoTooltip text="How long it took to recover from max drawdown. Faster recovery = better resilience. >90 days is concerning." />
              </p>
              <p className="font-mono text-surface-100 font-semibold text-lg">
                {drawdownData.days_to_recover ? `${drawdownData.days_to_recover} days` : 'N/A'}
              </p>
              <p className="text-surface-500 text-xs">{drawdownData.recovered ? 'Recovered' : 'In DD'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">
                Avg Drawdown
                <InfoTooltip text="Typical drawdown size you experience. If much smaller than max, your max DD was an outlier." />
              </p>
              <p className="font-mono text-danger font-semibold text-lg">${Math.abs(drawdownData.avg_drawdown).toFixed(2)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">
                Avg DD Duration
                <InfoTooltip text="Average number of trades you stay in drawdown. Lower is better - means you bounce back quickly." />
              </p>
              <p className="font-mono text-surface-100 font-semibold text-lg">{drawdownData.avg_drawdown_duration.toFixed(0)} trades</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">
                DD Periods
                <InfoTooltip text="Number of separate drawdown periods. Fewer, shorter periods = more stable performance." />
              </p>
              <p className="font-mono text-surface-100 font-semibold text-lg">{drawdownData.total_drawdown_periods}</p>
            </div>
          </div>

          {/* Equity Curve with Drawdown */}
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={drawdownData.equity_curve?.slice(-100) || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis
                  dataKey="date"
                  stroke="#64748B"
                  style={{ fontSize: '12px', fontFamily: 'monospace' }}
                  tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                />
                <YAxis
                  stroke="#64748B"
                  style={{ fontSize: '12px', fontFamily: 'monospace' }}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="cumulative_pnl"
                  stroke="#10B981"
                  strokeWidth={2}
                  dot={false}
                  name="Equity"
                />
                <Line
                  type="monotone"
                  dataKey="peak"
                  stroke="#06B6D4"
                  strokeWidth={1}
                  strokeDasharray="5 5"
                  dot={false}
                  name="Peak"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Time-Based Performance */}
      {!loading && timePerformance && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Day of Week Performance */}
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">
              Performance by Day of Week
            </h2>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-700">
                    <th className="text-left py-2 px-3 text-surface-400 text-xs font-medium">Day</th>
                    <th className="text-center py-2 px-3 text-surface-400 text-xs font-medium">Trades</th>
                    <th className="text-center py-2 px-3 text-surface-400 text-xs font-medium">Win Rate</th>
                    <th className="text-right py-2 px-3 text-surface-400 text-xs font-medium">Total P&L</th>
                    <th className="text-right py-2 px-3 text-surface-400 text-xs font-medium">Avg P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {timePerformance.day_of_week?.map((day, index) => (
                    <tr key={index} className="border-b border-surface-800">
                      <td className="py-2 px-3 text-surface-100 font-mono text-xs font-semibold">{day.day}</td>
                      <td className="py-2 px-3 text-surface-100 font-mono text-xs text-center">{day.total_trades}</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`font-mono text-xs font-semibold ${day.win_rate >= 50 ? 'text-success' : 'text-danger'}`}>
                          {day.win_rate}%
                        </span>
                      </td>
                      <td className={`py-2 px-3 font-mono text-xs font-semibold text-right ${day.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                        ${day.total_pnl.toFixed(2)}
                      </td>
                      <td className={`py-2 px-3 font-mono text-xs text-right ${day.avg_pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                        ${day.avg_pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Monthly Performance */}
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">
              Monthly Performance
            </h2>

            <div className="overflow-x-auto max-h-96">
              <table className="w-full">
                <thead className="sticky top-0 bg-surface-900">
                  <tr className="border-b border-surface-700">
                    <th className="text-left py-2 px-3 text-surface-400 text-xs font-medium">Month</th>
                    <th className="text-center py-2 px-3 text-surface-400 text-xs font-medium">Trades</th>
                    <th className="text-center py-2 px-3 text-surface-400 text-xs font-medium">Win Rate</th>
                    <th className="text-right py-2 px-3 text-surface-400 text-xs font-medium">Total P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {timePerformance.monthly?.map((month, index) => (
                    <tr key={index} className="border-b border-surface-800">
                      <td className="py-2 px-3 text-surface-100 font-mono text-xs font-semibold">{month.month}</td>
                      <td className="py-2 px-3 text-surface-100 font-mono text-xs text-center">{month.total_trades}</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`font-mono text-xs font-semibold ${month.win_rate >= 50 ? 'text-success' : 'text-danger'}`}>
                          {month.win_rate}%
                        </span>
                      </td>
                      <td className={`py-2 px-3 font-mono text-xs font-semibold text-right ${month.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                        ${month.total_pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Rolling Performance (30-Trade Window) */}
      {!loading && rollingPerformance && rollingPerformance.rolling_30_trades && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">
            Rolling 30-Trade Performance (Learning Curve)
          </h2>

          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rollingPerformance.rolling_30_trades}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis
                  dataKey="trade_number"
                  stroke="#64748B"
                  style={{ fontSize: '12px', fontFamily: 'monospace' }}
                  label={{ value: 'Trade Number', position: 'insideBottom', offset: -5 }}
                />
                <YAxis
                  yAxisId="left"
                  stroke="#10B981"
                  style={{ fontSize: '12px', fontFamily: 'monospace' }}
                  tickFormatter={(value) => `$${value}`}
                  label={{ value: 'P&L ($)', angle: -90, position: 'insideLeft' }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#06B6D4"
                  style={{ fontSize: '12px', fontFamily: 'monospace' }}
                  tickFormatter={(value) => `${value}%`}
                  label={{ value: 'Win Rate (%)', angle: 90, position: 'insideRight' }}
                />
                <Tooltip
                  {...TOOLTIP_STYLE}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="pnl"
                  stroke="#10B981"
                  strokeWidth={2}
                  dot={false}
                  name="30-Trade P&L"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="win_rate"
                  stroke="#06B6D4"
                  strokeWidth={2}
                  dot={false}
                  name="Win Rate"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* P&L Distribution Histogram */}
      {!loading && trades.length > 0 && (
        (() => {
          // Compute P&L distribution bins
          const pnlValues = trades.map(t => t.pnl).filter(v => v !== undefined && v !== null);
          if (pnlValues.length === 0) return null;

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
            bins.push({
              range: `$${low.toFixed(0)}`,
              low,
              high,
              count,
              isPositive: (low + high) / 2 >= 0,
            });
          }

          return (
            <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
              <h2 className="font-display font-semibold text-xl text-surface-50 mb-2">
                P&L Distribution
              </h2>
              <p className="text-surface-400 text-sm mb-4">
                How your trade outcomes are distributed
              </p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bins}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis
                      dataKey="range"
                      stroke="#64748B"
                      style={{ fontSize: '10px', fontFamily: 'monospace' }}
                      interval={Math.max(0, Math.floor(binCount / 8))}
                    />
                    <YAxis
                      stroke="#64748B"
                      style={{ fontSize: '11px', fontFamily: 'monospace' }}
                      allowDecimals={false}
                    />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(value, name, props) => [
                        `${value} trades`,
                        `$${props.payload.low.toFixed(0)} to $${props.payload.high.toFixed(0)}`
                      ]}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {bins.map((entry, index) => (
                        <Cell key={index} fill={entry.isPositive ? '#10B981' : '#EF4444'} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })()
      )}

      {/* Daily P&L Calendar Heatmap + Hold Time Scatter (side by side) */}
      {!loading && trades.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Daily P&L Calendar Heatmap */}
          {(() => {
            const dailyPnL = {};
            trades.forEach(t => {
              if (t.exit_date) {
                const dateStr = new Date(t.exit_date).toISOString().split('T')[0];
                dailyPnL[dateStr] = (dailyPnL[dateStr] || 0) + t.pnl;
              }
            });

            const dates = Object.keys(dailyPnL).sort();
            if (dates.length === 0) return null;

            const maxAbsPnl = Math.max(...Object.values(dailyPnL).map(Math.abs), 1);

            // Build weeks grid (Mon-Fri only)
            const startDate = new Date(dates[0]);
            const endDate = new Date(dates[dates.length - 1]);
            // Rewind to Monday of first week
            const startDow = startDate.getDay();
            const mondayOffset = startDow === 0 ? -6 : 1 - startDow;
            startDate.setDate(startDate.getDate() + mondayOffset);

            const weeks = [];
            const monthLabels = []; // { weekIndex, label }
            let current = new Date(startDate);
            let currentWeek = [];
            let lastMonth = -1;

            while (current <= endDate) {
              const dow = current.getDay();
              // Skip weekends
              if (dow === 0 || dow === 6) {
                current.setDate(current.getDate() + 1);
                continue;
              }

              const dateStr = current.toISOString().split('T')[0];
              const month = current.getMonth();

              // Track month boundaries (check on Monday = start of visual week)
              if (dow === 1 && month !== lastMonth) {
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                monthLabels.push({ weekIndex: weeks.length, label: monthNames[month] });
                lastMonth = month;
              }

              currentWeek.push({
                date: dateStr,
                dayOfWeek: dow, // 1=Mon .. 5=Fri
                pnl: dailyPnL[dateStr] || null,
                hasData: dateStr in dailyPnL,
              });

              // End of week (Friday)
              if (dow === 5) {
                weeks.push(currentWeek);
                currentWeek = [];
              }
              current.setDate(current.getDate() + 1);
            }
            if (currentWeek.length > 0) weeks.push(currentWeek);

            const getColor = (pnl) => {
              if (pnl === null) return 'bg-surface-800/30';
              const intensity = Math.min(Math.abs(pnl) / maxAbsPnl, 1);
              if (pnl > 0) {
                if (intensity > 0.7) return 'bg-emerald-500';
                if (intensity > 0.4) return 'bg-emerald-600/80';
                if (intensity > 0.15) return 'bg-emerald-700/60';
                return 'bg-emerald-800/40';
              } else {
                if (intensity > 0.7) return 'bg-red-500';
                if (intensity > 0.4) return 'bg-red-600/80';
                if (intensity > 0.15) return 'bg-red-700/60';
                return 'bg-red-800/40';
              }
            };

            const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

            return (
              <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
                <h2 className="font-display font-semibold text-xl text-surface-50 mb-2">
                  Daily P&L Heatmap
                </h2>
                <p className="text-surface-400 text-sm mb-4">
                  Each square = one trading day. Green = profit, Red = loss. Hover for details.
                </p>

                <div className="overflow-x-auto">
                  {/* Month labels row */}
                  <div className="flex ml-[38px] mb-1" style={{ gap: '3px' }}>
                    {weeks.map((_, wi) => {
                      const monthLabel = monthLabels.find(m => m.weekIndex === wi);
                      return (
                        <div key={wi} className="w-[14px] flex-shrink-0">
                          {monthLabel && (
                            <span className="text-[10px] text-surface-400 font-mono whitespace-nowrap">
                              {monthLabel.label}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex min-w-fit">
                    {/* Day of week labels */}
                    <div className="flex flex-col gap-[3px] mr-2 flex-shrink-0">
                      {dayLabels.map(label => (
                        <div key={label} className="h-[14px] flex items-center">
                          <span className="text-[10px] text-surface-500 font-mono w-7 text-right">{label}</span>
                        </div>
                      ))}
                    </div>

                    {/* Grid */}
                    <div className="flex gap-[3px] relative">
                      {weeks.map((week, wi) => (
                        <div key={wi} className="flex flex-col gap-[3px]">
                          {[1, 2, 3, 4, 5].map(dow => {
                            const day = week.find(d => d.dayOfWeek === dow);
                            if (!day) return <div key={dow} className="w-[14px] h-[14px]" />;
                            return (
                              <div
                                key={dow}
                                className={`w-[14px] h-[14px] rounded-[2px] ${getColor(day.pnl)} ${day.hasData ? 'cursor-pointer hover:ring-1 hover:ring-surface-300/50' : ''} transition-all`}
                                onMouseEnter={(e) => {
                                  if (day.hasData) {
                                    const rect = e.target.getBoundingClientRect();
                                    const parentRect = e.target.closest('.overflow-x-auto').getBoundingClientRect();
                                    setHeatmapTooltip({
                                      x: rect.left - parentRect.left + rect.width / 2,
                                      y: rect.top - parentRect.top,
                                      date: new Date(day.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }),
                                      pnl: day.pnl,
                                    });
                                  }
                                }}
                                onMouseLeave={() => setHeatmapTooltip(null)}
                              />
                            );
                          })}
                        </div>
                      ))}

                      {/* Floating tooltip */}
                      {heatmapTooltip && (
                        <div
                          className="absolute z-50 pointer-events-none rounded-lg bg-surface-900/95 backdrop-blur-xl border border-surface-700/50 px-3 py-2 shadow-card"
                          style={{ left: heatmapTooltip.x, top: heatmapTooltip.y - 8, transform: 'translate(-50%, -100%)' }}
                        >
                          <p className="text-surface-200 text-xs font-medium whitespace-nowrap">{heatmapTooltip.date}</p>
                          <p className={`font-mono text-sm font-semibold ${heatmapTooltip.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                            {heatmapTooltip.pnl >= 0 ? '+' : ''}${heatmapTooltip.pnl.toFixed(2)}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-4 text-xs text-surface-400">
                  <span>Loss</span>
                  <div className="flex gap-1">
                    <div className="w-3 h-3 rounded-[2px] bg-red-500" />
                    <div className="w-3 h-3 rounded-[2px] bg-red-700/60" />
                    <div className="w-3 h-3 rounded-[2px] bg-surface-800/30" />
                    <div className="w-3 h-3 rounded-[2px] bg-emerald-700/60" />
                    <div className="w-3 h-3 rounded-[2px] bg-emerald-500" />
                  </div>
                  <span>Profit</span>
                </div>
              </div>
            );
          })()}

          {/* Hold Time vs P&L Scatter Plot */}
          {(() => {
            const scatterData = trades
              .filter(t => t.duration_days !== undefined && t.duration_days !== null && t.pnl !== undefined)
              .map(t => ({
                duration: t.duration_days,
                pnl: t.pnl,
                symbol: t.symbol,
                isWin: t.pnl > 0,
              }));

            if (scatterData.length === 0) return null;

            return (
              <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
                <h2 className="font-display font-semibold text-xl text-surface-50 mb-2">
                  Hold Time vs P&L
                </h2>
                <p className="text-surface-400 text-sm mb-4">
                  Relationship between how long you hold and your outcome
                </p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                      <XAxis
                        type="number"
                        dataKey="duration"
                        name="Days"
                        stroke="#64748B"
                        style={{ fontSize: '11px', fontFamily: 'monospace' }}
                        label={{ value: 'Hold Days', position: 'insideBottom', offset: -5, style: { fill: '#64748B', fontSize: '11px' } }}
                      />
                      <YAxis
                        type="number"
                        dataKey="pnl"
                        name="P&L"
                        stroke="#64748B"
                        style={{ fontSize: '11px', fontFamily: 'monospace' }}
                        tickFormatter={(v) => `$${v}`}
                      />
                      <ZAxis range={[30, 30]} />
                      <Tooltip
                        {...TOOLTIP_STYLE}
                        formatter={(value, name) => [
                          name === 'P&L' ? `$${value.toFixed(2)}` : `${value} days`,
                          name
                        ]}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.symbol || ''}
                      />
                      <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
                      <Scatter
                        data={scatterData.filter(d => d.isWin)}
                        fill="#10B981"
                        fillOpacity={0.6}
                        name="Winners"
                      />
                      <Scatter
                        data={scatterData.filter(d => !d.isWin)}
                        fill="#EF4444"
                        fillOpacity={0.6}
                        name="Losers"
                      />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Streak / Tilt Detection */}
      {!loading && streakData && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-xl text-surface-50 mb-2">
            Streak & Tilt Detection
          </h2>
          <p className="text-surface-400 text-sm mb-6">
            Identifies patterns of consecutive wins/losses and potential revenge trading
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
            <div className="space-y-1">
              <p className="text-surface-400 text-xs">Longest Win Streak</p>
              <p className="font-mono text-success font-semibold text-lg">{streakData.longest_winning_streak}</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs">Longest Loss Streak</p>
              <p className="font-mono text-danger font-semibold text-lg">{streakData.longest_losing_streak}</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs">Worst Streak P&L</p>
              <p className="font-mono text-danger font-semibold text-lg">
                ${Math.abs(streakData.worst_streak_pnl).toFixed(2)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">
                Revenge Trades
                <InfoTooltip text="Trades entered within 24 hours of a loss. These are often emotional and tend to have worse outcomes." />
              </p>
              <p className="font-mono text-warning font-semibold text-lg">{streakData.total_revenge_trades}</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">
                Tilt Score
                <InfoTooltip text="% of revenge trades that were also losses. High score (>60%) means you're making bad decisions after losses." />
              </p>
              <p className={`font-mono font-semibold text-lg ${streakData.tilt_score > 60 ? 'text-danger' : streakData.tilt_score > 40 ? 'text-warning' : 'text-success'}`}>
                {streakData.tilt_score}%
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs">Total Streaks (3+)</p>
              <p className="font-mono text-surface-100 font-semibold text-lg">
                {streakData.winning_streaks + streakData.losing_streaks}
              </p>
            </div>
          </div>

          {/* Streak Timeline */}
          {streakData.streaks && streakData.streaks.length > 0 && (
            <div>
              <h3 className="text-surface-200 text-sm font-medium mb-3">Notable Streaks</h3>
              <div className="flex flex-wrap gap-2">
                {streakData.streaks.slice(0, 12).map((streak, i) => (
                  <div
                    key={i}
                    className={`px-3 py-2 rounded-lg border text-xs font-mono ${
                      streak.type === 'win'
                        ? 'bg-success/10 border-success/30 text-success'
                        : 'bg-danger/10 border-danger/30 text-danger'
                    }`}
                  >
                    <span className="font-semibold">{streak.length}x {streak.type === 'win' ? 'W' : 'L'}</span>
                    <span className="text-surface-400 ml-2">
                      ${Math.abs(streak.total_pnl).toFixed(0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Win Rate by Market Cap */}
      {!loading && marketCapData && marketCapData.categories && marketCapData.categories.length > 0 && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-xl text-surface-50 mb-2">
            Performance by Market Cap
          </h2>
          <p className="text-surface-400 text-sm mb-4">
            How you perform across different market cap segments
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Bar Chart */}
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={marketCapData.categories} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis
                    type="number"
                    stroke="#64748B"
                    style={{ fontSize: '11px', fontFamily: 'monospace' }}
                    tickFormatter={(v) => `$${v}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="market_cap"
                    stroke="#64748B"
                    style={{ fontSize: '11px', fontFamily: 'monospace' }}
                    width={90}
                  />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(value) => [`$${value.toFixed(2)}`, 'Total P&L']}
                  />
                  <Bar dataKey="total_pnl" radius={[0, 4, 4, 0]}>
                    {marketCapData.categories.map((entry, index) => (
                      <Cell key={index} fill={entry.total_pnl >= 0 ? '#10B981' : '#EF4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
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
                      <td className="py-2 px-3 text-center">
                        <span className={`font-mono text-xs font-semibold ${cat.win_rate >= 50 ? 'text-success' : 'text-danger'}`}>
                          {cat.win_rate}%
                        </span>
                      </td>
                      <td className={`py-2 px-3 font-mono text-xs font-semibold text-right ${cat.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                        ${cat.total_pnl.toFixed(2)}
                      </td>
                      <td className={`py-2 px-3 font-mono text-xs text-right ${cat.avg_pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                        ${cat.avg_pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Benchmark vs SPY */}
      {!loading && benchmarkData && !benchmarkData.error && benchmarkData.spy_data && benchmarkData.spy_data.length > 0 && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-xl text-surface-50 mb-2">
            Portfolio vs SPY Benchmark
          </h2>
          <p className="text-surface-400 text-sm mb-4">
            Comparing your cumulative returns against the S&P 500
          </p>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="space-y-1">
              <p className="text-surface-400 text-xs">Your Return</p>
              <p className={`font-mono font-semibold text-lg ${benchmarkData.portfolio_total_return >= 0 ? 'text-success' : 'text-danger'}`}>
                {benchmarkData.portfolio_total_return.toFixed(2)}%
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs">SPY Return</p>
              <p className={`font-mono font-semibold text-lg ${benchmarkData.spy_total_return >= 0 ? 'text-success' : 'text-danger'}`}>
                {benchmarkData.spy_total_return.toFixed(2)}%
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">
                Alpha
                <InfoTooltip text="Your excess return over SPY. Positive = you're beating the market. This is what separates skilled traders from index investors." />
              </p>
              <p className={`font-mono font-semibold text-lg ${benchmarkData.alpha >= 0 ? 'text-success' : 'text-danger'}`}>
                {benchmarkData.alpha >= 0 ? '+' : ''}{benchmarkData.alpha.toFixed(2)}%
              </p>
            </div>
          </div>

          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis
                  dataKey="date"
                  stroke="#64748B"
                  style={{ fontSize: '10px', fontFamily: 'monospace' }}
                  allowDuplicatedCategory={false}
                  tickFormatter={(v) => {
                    const d = new Date(v);
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  }}
                />
                <YAxis
                  stroke="#64748B"
                  style={{ fontSize: '11px', fontFamily: 'monospace' }}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  {...TOOLTIP_STYLE}
                  formatter={(value, name) => [`${value.toFixed(2)}%`, name]}
                />
                <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
                <Line
                  data={benchmarkData.portfolio_data}
                  type="monotone"
                  dataKey="portfolio_return_pct"
                  stroke="#10B981"
                  strokeWidth={2}
                  dot={false}
                  name="Your Portfolio"
                />
                <Line
                  data={benchmarkData.spy_data}
                  type="monotone"
                  dataKey="spy_return_pct"
                  stroke="#06B6D4"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  name="SPY"
                />
                <Legend
                  wrapperStyle={{ fontSize: '12px', fontFamily: 'monospace' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* R-Multiple Analysis */}
      {!loading && rMultipleData && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-xl text-surface-50 mb-2">
            R-Multiple Analysis
          </h2>
          <p className="text-surface-400 text-sm mb-6">
            Risk-normalized returns (1R = 1% portfolio risk per trade)
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">
                Avg R
                <InfoTooltip text="Average R-multiple per trade. Positive means you're profitable on a risk-adjusted basis. >0.5R is excellent." />
              </p>
              <p className={`font-mono font-semibold text-lg ${rMultipleData.avg_r >= 0 ? 'text-success' : 'text-danger'}`}>
                {rMultipleData.avg_r}R
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs">Median R</p>
              <p className={`font-mono font-semibold text-lg ${rMultipleData.median_r >= 0 ? 'text-success' : 'text-danger'}`}>
                {rMultipleData.median_r}R
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs">Best R</p>
              <p className="font-mono text-success font-semibold text-lg">{rMultipleData.best_r}R</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs">Worst R</p>
              <p className="font-mono text-danger font-semibold text-lg">{rMultipleData.worst_r}R</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">
                Cumulative R
                <InfoTooltip text="Total R earned across all trades. This is your edge expressed in risk units. Higher is better." />
              </p>
              <p className={`font-mono font-semibold text-lg ${rMultipleData.cumulative_r >= 0 ? 'text-success' : 'text-danger'}`}>
                {rMultipleData.cumulative_r}R
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs">+R Trades</p>
              <p className="font-mono text-success font-semibold text-lg">{rMultipleData.positive_r_trades}</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs">-R Trades</p>
              <p className="font-mono text-danger font-semibold text-lg">{rMultipleData.negative_r_trades}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* R Distribution Histogram */}
            {rMultipleData.distribution && rMultipleData.distribution.length > 0 && (
              <div>
                <h3 className="text-surface-200 text-sm font-medium mb-3">R Distribution</h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rMultipleData.distribution}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                      <XAxis
                        dataKey="bucket"
                        stroke="#64748B"
                        style={{ fontSize: '10px', fontFamily: 'monospace' }}
                      />
                      <YAxis
                        stroke="#64748B"
                        style={{ fontSize: '11px', fontFamily: 'monospace' }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        {...TOOLTIP_STYLE}
                        formatter={(value) => [`${value} trades`, 'Count']}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {rMultipleData.distribution.map((entry, index) => (
                          <Cell
                            key={index}
                            fill={entry.bucket.includes('-') || entry.bucket.startsWith('<') ? '#EF4444' : '#10B981'}
                            fillOpacity={0.8}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Cumulative R over Time */}
            {rMultipleData.trades && rMultipleData.trades.length > 0 && (
              <div>
                <h3 className="text-surface-200 text-sm font-medium mb-3">Cumulative R Over Time</h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rMultipleData.trades.map((t, i) => ({
                      trade: i + 1,
                      cumR: rMultipleData.trades.slice(0, i + 1).reduce((sum, tr) => sum + tr.r_multiple, 0),
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                      <XAxis
                        dataKey="trade"
                        stroke="#64748B"
                        style={{ fontSize: '11px', fontFamily: 'monospace' }}
                        label={{ value: 'Trade #', position: 'insideBottom', offset: -5, style: { fill: '#64748B', fontSize: '11px' } }}
                      />
                      <YAxis
                        stroke="#64748B"
                        style={{ fontSize: '11px', fontFamily: 'monospace' }}
                        tickFormatter={(v) => `${v}R`}
                      />
                      <Tooltip
                        {...TOOLTIP_STYLE}
                        formatter={(value) => [`${value.toFixed(2)}R`, 'Cumulative R']}
                      />
                      <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
                      <Line
                        type="monotone"
                        dataKey="cumR"
                        stroke="#8B5CF6"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Entry/Exit Timing Analysis */}
      {!loading && entryTimingData && !entryTimingData.error && entryTimingData.entry_timing && (
        <div>
          {/* Month filter */}
          <div className="flex items-center gap-3 mb-4">
            <h2 className="font-display font-semibold text-xl text-surface-50">Entry & Exit Timing</h2>
            <select
              value={timingMonthFilter}
              onChange={async (e) => {
                const month = e.target.value;
                setTimingMonthFilter(month);
                if (month === 'all') {
                  const data = await getEntryTimingAnalysis(trades);
                  setEntryTimingData(data);
                } else {
                  const filtered = trades.filter(t => {
                    if (!t.entry_date) return false;
                    const d = new Date(t.entry_date);
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === month;
                  });
                  if (filtered.length > 0) {
                    const data = await getEntryTimingAnalysis(filtered);
                    setEntryTimingData(data);
                  }
                }
              }}
              className="rounded-lg bg-surface-800 border border-surface-600/40 px-3 py-1.5 text-xs text-surface-100 focus:border-accent focus:outline-none"
            >
              <option value="all">All Months</option>
              {(() => {
                const months = new Set();
                trades.forEach(t => {
                  if (t.entry_date) {
                    const d = new Date(t.entry_date);
                    months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                  }
                });
                return [...months].sort().map(m => (
                  <option key={m} value={m}>
                    {new Date(m + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </option>
                ));
              })()}
            </select>
          </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Entry Timing */}
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-lg text-surface-50 mb-2">
              Entry Timing
            </h2>
            <p className="text-surface-400 text-sm mb-4">
              Performance by time of entry relative to market open (9:30 AM)
            </p>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-700">
                    <th className="text-left py-2 px-3 text-surface-400 text-xs font-medium">Time Bucket</th>
                    <th className="text-center py-2 px-3 text-surface-400 text-xs font-medium">Trades</th>
                    <th className="text-center py-2 px-3 text-surface-400 text-xs font-medium">Win Rate</th>
                    <th className="text-right py-2 px-3 text-surface-400 text-xs font-medium">Total P&L</th>
                    <th className="text-right py-2 px-3 text-surface-400 text-xs font-medium">Avg P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {entryTimingData.entry_timing.map((bucket, index) => (
                    <tr key={index} className="border-b border-surface-800">
                      <td className="py-2 px-3 text-surface-100 font-mono text-xs font-semibold">
                        {bucket.time_bucket}
                      </td>
                      <td className="py-2 px-3 text-surface-100 font-mono text-xs text-center">
                        {bucket.total_trades}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={`font-mono text-xs font-semibold ${bucket.win_rate >= 50 ? 'text-success' : 'text-danger'}`}>
                          {bucket.win_rate}%
                        </span>
                      </td>
                      <td className={`py-2 px-3 font-mono text-xs font-semibold text-right ${bucket.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                        ${bucket.total_pnl.toFixed(2)}
                      </td>
                      <td className={`py-2 px-3 font-mono text-xs text-right ${bucket.avg_pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                        ${bucket.avg_pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Key insights */}
            <div className="mt-4 p-3 rounded-lg bg-surface-900/60 border border-surface-700/20">
              <p className="text-xs text-surface-400 mb-1">💡 Key Insight:</p>
              <p className="text-xs text-surface-300">
                {(() => {
                  const first5min = entryTimingData.entry_timing.find(b => b.time_bucket === '0-5 min');
                  const after30min = entryTimingData.entry_timing.find(b => b.time_bucket === '30-60 min');

                  if (first5min && after30min) {
                    const diff = first5min.win_rate - after30min.win_rate;
                    if (Math.abs(diff) > 10) {
                      return diff > 0
                        ? `You perform ${Math.abs(diff).toFixed(0)}% better when entering in the first 5 minutes. The early bird catches the worm!`
                        : `You perform ${Math.abs(diff).toFixed(0)}% better when entering after 30 minutes. Consider waiting for confirmation before entering.`;
                    }
                  }

                  const bestBucket = entryTimingData.entry_timing.reduce((best, current) =>
                    current.avg_pnl > best.avg_pnl ? current : best
                  );
                  const worstBucket = entryTimingData.entry_timing.reduce((worst, current) =>
                    current.avg_pnl < worst.avg_pnl ? current : worst
                  );

                  return `Your best entry timing is "${bestBucket.time_bucket}" (avg $${bestBucket.avg_pnl.toFixed(2)}), worst is "${worstBucket.time_bucket}" (avg $${worstBucket.avg_pnl.toFixed(2)})`;
                })()}
              </p>
            </div>
          </div>

          {/* Exit Timing */}
          {entryTimingData.exit_timing && entryTimingData.exit_timing.length > 0 && (
            <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
              <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">
                Exit Timing Analysis
              </h2>
              <p className="text-surface-400 text-sm mb-4">
                Performance by time of exit relative to market open
              </p>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-700">
                      <th className="text-left py-2 px-3 text-surface-400 text-xs font-medium">Time Bucket</th>
                      <th className="text-center py-2 px-3 text-surface-400 text-xs font-medium">Trades</th>
                      <th className="text-center py-2 px-3 text-surface-400 text-xs font-medium">Win Rate</th>
                      <th className="text-right py-2 px-3 text-surface-400 text-xs font-medium">Total P&L</th>
                      <th className="text-right py-2 px-3 text-surface-400 text-xs font-medium">Avg P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entryTimingData.exit_timing.map((bucket, index) => (
                      <tr key={index} className="border-b border-surface-800">
                        <td className="py-2 px-3 text-surface-100 font-mono text-xs font-semibold">
                          {bucket.time_bucket}
                        </td>
                        <td className="py-2 px-3 text-surface-100 font-mono text-xs text-center">
                          {bucket.total_trades}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className={`font-mono text-xs font-semibold ${bucket.win_rate >= 50 ? 'text-success' : 'text-danger'}`}>
                            {bucket.win_rate}%
                          </span>
                        </td>
                        <td className={`py-2 px-3 font-mono text-xs font-semibold text-right ${bucket.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                          ${bucket.total_pnl.toFixed(2)}
                        </td>
                        <td className={`py-2 px-3 font-mono text-xs text-right ${bucket.avg_pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                          ${bucket.avg_pnl.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Key insights */}
              <div className="mt-4 p-3 rounded-lg bg-surface-900/60 border border-surface-700/20">
                <p className="text-xs text-surface-400 mb-1">💡 Key Insight:</p>
                <p className="text-xs text-surface-300">
                  {(() => {
                    const powerHour = entryTimingData.exit_timing.find(b => b.time_bucket === 'Power hour (3:00-4:00)');
                    const midDay = entryTimingData.exit_timing.find(b => b.time_bucket === 'Mid-day (11:30-3:00)');

                    if (powerHour && midDay && powerHour.total_trades >= 5) {
                      const diff = powerHour.avg_pnl - midDay.avg_pnl;
                      if (Math.abs(diff) > 50) {
                        return diff > 0
                          ? `Holding into power hour adds $${diff.toFixed(0)} avg profit. Consider holding winners longer.`
                          : `Exiting mid-day saves $${Math.abs(diff).toFixed(0)} avg. Don't hold losers into close.`;
                      }
                    }

                    const bestBucket = entryTimingData.exit_timing.reduce((best, current) =>
                      current.avg_pnl > best.avg_pnl ? current : best
                    );

                    return `Best exit timing: "${bestBucket.time_bucket}" with avg $${bestBucket.avg_pnl.toFixed(2)} per trade`;
                  })()}
                </p>
              </div>
            </div>
          )}
        </div>
        </div>
      )}

      {/* Recent Trades Table */}
      {!loading && trades.length > 0 && (
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
                    <td className="py-3 px-4 text-surface-100 font-mono text-sm">
                      {trade.entry_date ? new Date(trade.entry_date).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="py-3 px-4 text-surface-100 font-mono text-sm">
                      {trade.exit_date ? new Date(trade.exit_date).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="py-3 px-4 text-surface-100 font-mono text-sm font-semibold">
                      {trade.symbol}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-1 rounded ${
                        trade.side === 'LONG'
                          ? 'bg-accent/15 text-accent'
                          : 'bg-danger/10 text-danger'
                      }`}>
                        {trade.side || 'N/A'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-surface-100 font-mono text-sm text-right">
                      ${trade.entry_price?.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-surface-100 font-mono text-sm text-right">
                      ${trade.exit_price?.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-surface-100 font-mono text-sm text-right">
                      {trade.quantity}
                    </td>
                    <td className={`py-3 px-4 font-mono text-sm font-semibold text-right ${
                      trade.pnl >= 0 ? 'text-success' : 'text-danger'
                    }`}>
                      {trade.pnl >= 0 ? '+' : ''}${trade.pnl?.toFixed(2)}
                    </td>
                    <td className={`py-3 px-4 font-mono text-sm font-semibold text-right ${
                      trade.pnl_pct >= 0 ? 'text-success' : 'text-danger'
                    }`}>
                      {trade.pnl_pct >= 0 ? '+' : ''}{trade.pnl_pct?.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-surface-700">
              <div className="text-surface-400 text-sm">
                Showing {startIndex + 1}-{Math.min(endIndex, trades.length)} of {trades.length} trades
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTradesPage(prev => Math.max(1, prev - 1))}
                  disabled={tradesPage === 1}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                    tradesPage === 1
                      ? 'bg-surface-700 text-surface-500 cursor-not-allowed'
                      : 'bg-surface-700 text-surface-100 hover:bg-surface-600'
                  }`}
                >
                  Previous
                </button>

                <div className="flex items-center gap-1">
                  {[...Array(totalPages)].map((_, i) => {
                    const pageNum = i + 1;
                    // Show first page, last page, current page, and pages around current
                    if (
                      pageNum === 1 ||
                      pageNum === totalPages ||
                      (pageNum >= tradesPage - 1 && pageNum <= tradesPage + 1)
                    ) {
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setTradesPage(pageNum)}
                          className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                            tradesPage === pageNum
                              ? 'bg-surface-700 text-surface-50 font-semibold shadow-sm'
                              : 'bg-surface-700 text-surface-100 hover:bg-surface-600'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    } else if (
                      pageNum === tradesPage - 2 ||
                      pageNum === tradesPage + 2
                    ) {
                      return (
                        <span key={pageNum} className="text-surface-500 px-1">
                          ...
                        </span>
                      );
                    }
                    return null;
                  })}
                </div>

                <button
                  onClick={() => setTradesPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={tradesPage === totalPages}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                    tradesPage === totalPages
                      ? 'bg-surface-700 text-surface-500 cursor-not-allowed'
                      : 'bg-surface-700 text-surface-100 hover:bg-surface-600'
                  }`}
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
};

export default TradingAnalysis;
