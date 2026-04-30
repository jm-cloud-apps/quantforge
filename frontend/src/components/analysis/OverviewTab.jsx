import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { CustomTooltip } from './shared';
import PnLCalendar from '../PnLCalendar';
import SetupComparison from './SetupComparison';

export default function OverviewTab({
  metrics, metricsCards, statistics, streakData, setupStats,
  marketCapData, timePerformance, rMultipleData, benchmarkData,
  cumulativePnLData, monthlyPnLData, trades, calendarData,
}) {
  // Build key insights
  const strengths = [];
  const warnings = [];
  const opportunities = [];

  if (metrics) {
    if (metrics.win_rate >= 55) {
      strengths.push(`Strong win rate at ${metrics.win_rate.toFixed(1)}% - your edge is working`);
    } else if (metrics.win_rate < 40) {
      warnings.push(`Win rate is low at ${metrics.win_rate.toFixed(1)}% - review your entry criteria or consider tighter screening`);
    }

    if (metrics.profit_factor >= 2) {
      strengths.push(`Excellent profit factor of ${metrics.profit_factor.toFixed(2)} - your winners significantly outweigh losers`);
    } else if (metrics.profit_factor < 1) {
      warnings.push(`Profit factor below 1 (${metrics.profit_factor.toFixed(2)}) - you're losing more than you win overall`);
    }
  }

  if (statistics) {
    if (statistics.risk_reward_ratio >= 2) {
      strengths.push(`Great risk/reward ratio of ${statistics.risk_reward_ratio}:1 - you're letting winners run`);
    } else if (statistics.risk_reward_ratio < 1 && statistics.risk_reward_ratio > 0) {
      warnings.push(`Risk/reward is ${statistics.risk_reward_ratio}:1 - your average loss is bigger than your average win`);
    }

    if (statistics.avg_winner_duration_days > statistics.avg_loser_duration_days * 1.5) {
      strengths.push(`Winners held ${statistics.avg_winner_duration_days.toFixed(1)} days vs losers ${statistics.avg_loser_duration_days.toFixed(1)} days - good discipline cutting losers`);
    } else if (statistics.avg_loser_duration_days > statistics.avg_winner_duration_days * 1.3) {
      warnings.push(`Holding losers (${statistics.avg_loser_duration_days.toFixed(1)}d) longer than winners (${statistics.avg_winner_duration_days.toFixed(1)}d) - cut losses faster`);
    }

    if (statistics.consecutive_losses >= 5) {
      warnings.push(`Max ${statistics.consecutive_losses} consecutive losses detected - consider reducing size after 3 losses in a row`);
    }

    if (statistics.expectancy > 100) {
      strengths.push(`Strong expectancy of $${statistics.expectancy.toFixed(0)} per trade - you have a clear edge`);
    } else if (statistics.expectancy < 0) {
      warnings.push(`Negative expectancy ($${statistics.expectancy.toFixed(0)}) - each trade costs you money on average`);
    }
  }

  if (streakData) {
    if (streakData.tilt_score > 60) {
      warnings.push(`Tilt score of ${streakData.tilt_score}% - ${streakData.total_revenge_trades} revenge trades mostly lost. Walk away after a loss.`);
    } else if (streakData.tilt_score < 40 && streakData.total_revenge_trades > 5) {
      strengths.push('Good emotional control - you handle losses well without revenge trading');
    }
  }

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

  if (timePerformance?.day_of_week) {
    const bestDay = timePerformance.day_of_week.reduce((best, d) => d.avg_pnl > best.avg_pnl ? d : best);
    const worstDay = timePerformance.day_of_week.reduce((worst, d) => d.avg_pnl < worst.avg_pnl ? d : worst);
    if (bestDay.avg_pnl > 0 && worstDay.avg_pnl < 0) {
      opportunities.push(`Best day: ${bestDay.day} ($${bestDay.avg_pnl.toFixed(0)} avg). Worst: ${worstDay.day} ($${worstDay.avg_pnl.toFixed(0)} avg)`);
    }
  }

  if (rMultipleData) {
    if (rMultipleData.avg_r > 0.3) {
      strengths.push(`Average R of ${rMultipleData.avg_r}R means you're earning ${rMultipleData.avg_r}x your risk per trade`);
    } else if (rMultipleData.avg_r < 0) {
      warnings.push(`Negative average R (${rMultipleData.avg_r}R) - you're losing more than your risk per trade`);
    }
  }

  if (benchmarkData && !benchmarkData.error && benchmarkData.alpha) {
    if (benchmarkData.alpha > 5) {
      strengths.push(`Generating ${benchmarkData.alpha.toFixed(1)}% alpha over SPY - outperforming the market`);
    } else if (benchmarkData.alpha < -5) {
      opportunities.push(`Underperforming SPY by ${Math.abs(benchmarkData.alpha).toFixed(1)}% - consider if active trading is adding value`);
    }
  }

  const hasInsights = strengths.length > 0 || warnings.length > 0 || opportunities.length > 0;

  return (
    <div className="space-y-8">
      {/* P&L Calendar */}
      <PnLCalendar calendarData={calendarData} loading={!calendarData} />

      {/* Performance Metrics — staggered card entrance */}
      {metrics && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-lg text-surface-50 mb-6">
            Performance Metrics
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {metricsCards.map((metric, index) => (
              <div key={index} className={`rounded-xl bg-surface-900/60 border border-surface-700/20 p-4 hover:border-accent/20 transition-colors animate-fade-in-up stagger-${index + 1}`}>
                <p className="text-surface-400 text-[11px] font-medium uppercase tracking-wider mb-1.5">{metric.label}</p>
                <p className="font-mono font-bold text-xl text-surface-50 mb-1.5">{metric.value}</p>
                <span className={`text-[11px] font-mono px-2 py-0.5 rounded-md ${
                  metric.positive ? 'bg-accent/15 text-accent' : 'bg-danger/10 text-danger'
                }`}>
                  {metric.change}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* EP vs HTF Comparison */}
      <SetupComparison trades={trades} />

      {/* Key Insights */}
      {hasInsights && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-lg text-surface-50 mb-6">Key Insights</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {strengths.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-success" />
                  <h3 className="text-success text-sm font-semibold">Keep Doing</h3>
                </div>
                <ul className="space-y-3">
                  {strengths.map((s, i) => (
                    <li key={i} className="text-surface-300 text-sm leading-relaxed pl-4 border-l-2 border-success/30">{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {warnings.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-danger" />
                  <h3 className="text-danger text-sm font-semibold">Avoid / Fix</h3>
                </div>
                <ul className="space-y-3">
                  {warnings.map((w, i) => (
                    <li key={i} className="text-surface-300 text-sm leading-relaxed pl-4 border-l-2 border-danger/30">{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {opportunities.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-cyan" />
                  <h3 className="text-cyan text-sm font-semibold">Opportunities</h3>
                </div>
                <ul className="space-y-3">
                  {opportunities.map((o, i) => (
                    <li key={i} className="text-surface-300 text-sm leading-relaxed pl-4 border-l-2 border-cyan/30">{o}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Cumulative P&L */}
        {cumulativePnLData.length > 0 && (
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6 lg:col-span-2">
            <h2 className="font-display font-semibold text-lg text-surface-50 mb-4">Cumulative P&L</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cumulativePnLData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="date" stroke="#64748B" style={{ fontSize: '12px', fontFamily: 'monospace' }} />
                  <YAxis stroke="#64748B" style={{ fontSize: '12px', fontFamily: 'monospace' }} tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="pnl" stroke="#10B981" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Monthly P&L */}
        {monthlyPnLData.length > 0 && (
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6 lg:col-span-2">
            <h2 className="font-display font-semibold text-lg text-surface-50 mb-4">Monthly P&L</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyPnLData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="month" stroke="#64748B" style={{ fontSize: '12px', fontFamily: 'monospace' }} />
                  <YAxis stroke="#64748B" style={{ fontSize: '12px', fontFamily: 'monospace' }} tickFormatter={(value) => `$${value}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="pnl" fill="#10B981" radius={[8, 8, 0, 0]}>
                    {monthlyPnLData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10B981' : '#EF4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
