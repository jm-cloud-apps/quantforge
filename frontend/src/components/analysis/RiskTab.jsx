import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { TOOLTIP_STYLE, InfoTooltip, CustomTooltip } from './shared';

export default function RiskTab({
  statistics, advancedMetrics, drawdownData, rMultipleData, benchmarkData,
}) {
  return (
    <div className="space-y-6">
      {/* Trade Statistics Grid */}
      {statistics && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Trade Statistics */}
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">Trade Statistics</h2>
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
                  Expectancy <InfoTooltip text="Average $ you expect to make per trade. Must be positive to be profitable long-term. Higher is better." />
                </p>
                <p className={`font-mono font-semibold text-lg ${statistics.expectancy > 0 ? 'text-success' : 'text-danger'}`}>${statistics.expectancy.toFixed(2)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-surface-400 text-xs flex items-center">
                  Risk/Reward <InfoTooltip text="Avg win size / avg loss size. >2 means your wins are 2x your losses. >1.5 is good with 50%+ win rate." />
                </p>
                <p className="font-mono text-surface-100 font-semibold text-lg">{statistics.risk_reward_ratio}</p>
              </div>
            </div>
          </div>

          {/* Hold Time Analysis */}
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">Hold Time Analysis</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-surface-400 text-xs">Avg Duration</p>
                <p className="font-mono text-surface-100 font-semibold text-lg">
                  {statistics.avg_trade_duration_days > 1 ? `${statistics.avg_trade_duration_days} days` : `${statistics.avg_trade_duration_hours.toFixed(1)} hrs`}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-surface-400 text-xs flex items-center">
                  Kelly Criterion <InfoTooltip text="Optimal position size as % of capital. Suggests how much to risk per trade based on your edge. >2% is aggressive, <1% is conservative." />
                </p>
                <p className="font-mono text-surface-100 font-semibold text-lg">{statistics.kelly_criterion_pct}%</p>
              </div>
              <div className="space-y-1">
                <p className="text-surface-400 text-xs flex items-center">
                  Winner Hold Time <InfoTooltip text="Average time you hold winning trades. If much longer than losers, you're letting winners run (good)." />
                </p>
                <p className="font-mono text-success font-semibold text-lg">{statistics.avg_winner_duration_days.toFixed(1)} days</p>
              </div>
              <div className="space-y-1">
                <p className="text-surface-400 text-xs flex items-center">
                  Loser Hold Time <InfoTooltip text="Average time you hold losing trades. Ideally shorter than winners - means you cut losses quickly." />
                </p>
                <p className="font-mono text-danger font-semibold text-lg">{statistics.avg_loser_duration_days.toFixed(1)} days</p>
              </div>
            </div>
          </div>

          {/* Risk-Adjusted Returns */}
          {advancedMetrics && (
            <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
              <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">Risk-Adjusted Returns</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-surface-400 text-xs flex items-center">
                    Sharpe Ratio <InfoTooltip text="Return per unit of total risk. >1 is good, >2 is excellent, >3 is exceptional." />
                  </p>
                  <p className={`font-mono font-semibold text-lg ${advancedMetrics.sharpe_ratio > 1 ? 'text-success' : 'text-surface-100'}`}>{advancedMetrics.sharpe_ratio}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-surface-400 text-xs flex items-center">
                    Sortino Ratio <InfoTooltip text="Like Sharpe but only penalizes downside volatility. >1.5 is good, >2 is excellent." />
                  </p>
                  <p className={`font-mono font-semibold text-lg ${advancedMetrics.sortino_ratio > 1 ? 'text-success' : 'text-surface-100'}`}>{advancedMetrics.sortino_ratio}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-surface-400 text-xs flex items-center">
                    Calmar Ratio <InfoTooltip text="Total return divided by maximum drawdown. >3 is excellent." />
                  </p>
                  <p className={`font-mono font-semibold text-lg ${advancedMetrics.calmar_ratio > 1 ? 'text-success' : 'text-surface-100'}`}>{advancedMetrics.calmar_ratio}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-surface-400 text-xs flex items-center">
                    Std Deviation <InfoTooltip text="Measures trade outcome variability. Lower means more consistent results." />
                  </p>
                  <p className="font-mono text-surface-100 font-semibold text-lg">${advancedMetrics.std_return.toFixed(2)}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Drawdown Analysis */}
      {drawdownData && !drawdownData.error && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-xl text-surface-50 mb-6">Drawdown Analysis</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">Max Drawdown <InfoTooltip text="Your worst peak-to-trough decline. Keep under 30%." /></p>
              <p className="font-mono text-danger font-semibold text-lg">${Math.abs(drawdownData.max_drawdown).toFixed(2)}</p>
              <p className="text-surface-500 text-xs">{drawdownData.max_drawdown_pct.toFixed(1)}%</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">Current Drawdown <InfoTooltip text="How far you are from your equity peak right now." /></p>
              <p className={`font-mono font-semibold text-lg ${drawdownData.current_drawdown === 0 ? 'text-success' : 'text-danger'}`}>${Math.abs(drawdownData.current_drawdown).toFixed(2)}</p>
              <p className="text-surface-500 text-xs">{Math.abs(drawdownData.current_drawdown_pct).toFixed(1)}%</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">Recovery Time <InfoTooltip text="How long it took to recover from max drawdown." /></p>
              <p className="font-mono text-surface-100 font-semibold text-lg">{drawdownData.days_to_recover ? `${drawdownData.days_to_recover} days` : 'N/A'}</p>
              <p className="text-surface-500 text-xs">{drawdownData.recovered ? 'Recovered' : 'In DD'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">Avg Drawdown <InfoTooltip text="Typical drawdown size you experience." /></p>
              <p className="font-mono text-danger font-semibold text-lg">${Math.abs(drawdownData.avg_drawdown).toFixed(2)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">Avg DD Duration <InfoTooltip text="Average number of trades you stay in drawdown." /></p>
              <p className="font-mono text-surface-100 font-semibold text-lg">{drawdownData.avg_drawdown_duration.toFixed(0)} trades</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">DD Periods <InfoTooltip text="Number of separate drawdown periods." /></p>
              <p className="font-mono text-surface-100 font-semibold text-lg">{drawdownData.total_drawdown_periods}</p>
            </div>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={drawdownData.equity_curve?.slice(-100) || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="date" stroke="#64748B" style={{ fontSize: '12px', fontFamily: 'monospace' }} tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                <YAxis stroke="#64748B" style={{ fontSize: '12px', fontFamily: 'monospace' }} tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="cumulative_pnl" stroke="#10B981" strokeWidth={2} dot={false} name="Equity" />
                <Line type="monotone" dataKey="peak" stroke="#06B6D4" strokeWidth={1} strokeDasharray="5 5" dot={false} name="Peak" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* R-Multiple Analysis */}
      {rMultipleData && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-xl text-surface-50 mb-2">R-Multiple Analysis</h2>
          <p className="text-surface-400 text-sm mb-6">Risk-normalized returns (1R = 1% portfolio risk per trade)</p>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">Avg R <InfoTooltip text="Average R-multiple per trade. >0.5R is excellent." /></p>
              <p className={`font-mono font-semibold text-lg ${rMultipleData.avg_r >= 0 ? 'text-success' : 'text-danger'}`}>{rMultipleData.avg_r}R</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs">Median R</p>
              <p className={`font-mono font-semibold text-lg ${rMultipleData.median_r >= 0 ? 'text-success' : 'text-danger'}`}>{rMultipleData.median_r}R</p>
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
              <p className="text-surface-400 text-xs flex items-center">Cumulative R <InfoTooltip text="Total R earned across all trades." /></p>
              <p className={`font-mono font-semibold text-lg ${rMultipleData.cumulative_r >= 0 ? 'text-success' : 'text-danger'}`}>{rMultipleData.cumulative_r}R</p>
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
            {rMultipleData.distribution?.length > 0 && (
              <div>
                <h3 className="text-surface-200 text-sm font-medium mb-3">R Distribution</h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rMultipleData.distribution}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                      <XAxis dataKey="bucket" stroke="#64748B" style={{ fontSize: '10px', fontFamily: 'monospace' }} />
                      <YAxis stroke="#64748B" style={{ fontSize: '11px', fontFamily: 'monospace' }} allowDecimals={false} />
                      <Tooltip {...TOOLTIP_STYLE} formatter={(value) => [`${value} trades`, 'Count']} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {rMultipleData.distribution.map((entry, index) => (
                          <Cell key={index} fill={entry.bucket.includes('-') || entry.bucket.startsWith('<') ? '#EF4444' : '#10B981'} fillOpacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            {rMultipleData.trades?.length > 0 && (
              <div>
                <h3 className="text-surface-200 text-sm font-medium mb-3">Cumulative R Over Time</h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rMultipleData.trades.map((t, i) => ({ trade: i + 1, cumR: rMultipleData.trades.slice(0, i + 1).reduce((sum, tr) => sum + tr.r_multiple, 0) }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                      <XAxis dataKey="trade" stroke="#64748B" style={{ fontSize: '11px', fontFamily: 'monospace' }} label={{ value: 'Trade #', position: 'insideBottom', offset: -5, style: { fill: '#64748B', fontSize: '11px' } }} />
                      <YAxis stroke="#64748B" style={{ fontSize: '11px', fontFamily: 'monospace' }} tickFormatter={(v) => `${v}R`} />
                      <Tooltip {...TOOLTIP_STYLE} formatter={(value) => [`${value.toFixed(2)}R`, 'Cumulative R']} />
                      <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="cumR" stroke="#8B5CF6" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Benchmark vs SPY */}
      {benchmarkData && !benchmarkData.error && benchmarkData.spy_data?.length > 0 && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-xl text-surface-50 mb-2">Portfolio vs SPY Benchmark</h2>
          <p className="text-surface-400 text-sm mb-4">Comparing your cumulative returns against the S&P 500</p>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="space-y-1">
              <p className="text-surface-400 text-xs">Your Return</p>
              <p className={`font-mono font-semibold text-lg ${benchmarkData.portfolio_total_return >= 0 ? 'text-success' : 'text-danger'}`}>{benchmarkData.portfolio_total_return.toFixed(2)}%</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs">SPY Return</p>
              <p className={`font-mono font-semibold text-lg ${benchmarkData.spy_total_return >= 0 ? 'text-success' : 'text-danger'}`}>{benchmarkData.spy_total_return.toFixed(2)}%</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">Alpha <InfoTooltip text="Your excess return over SPY. Positive = you're beating the market." /></p>
              <p className={`font-mono font-semibold text-lg ${benchmarkData.alpha >= 0 ? 'text-success' : 'text-danger'}`}>{benchmarkData.alpha >= 0 ? '+' : ''}{benchmarkData.alpha.toFixed(2)}%</p>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="date" stroke="#64748B" style={{ fontSize: '10px', fontFamily: 'monospace' }} allowDuplicatedCategory={false} tickFormatter={(v) => { const d = new Date(v); return `${d.getMonth() + 1}/${d.getDate()}`; }} />
                <YAxis stroke="#64748B" style={{ fontSize: '11px', fontFamily: 'monospace' }} tickFormatter={(v) => `${v}%`} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(value, name) => [`${value.toFixed(2)}%`, name]} />
                <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
                <Line data={benchmarkData.portfolio_data} type="monotone" dataKey="portfolio_return_pct" stroke="#10B981" strokeWidth={2} dot={false} name="Your Portfolio" />
                <Line data={benchmarkData.spy_data} type="monotone" dataKey="spy_return_pct" stroke="#06B6D4" strokeWidth={2} strokeDasharray="5 5" dot={false} name="SPY" />
                <Legend wrapperStyle={{ fontSize: '12px', fontFamily: 'monospace' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
