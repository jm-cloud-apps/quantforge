import { useState, useMemo } from 'react';
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { TOOLTIP_STYLE, InfoTooltip } from './shared';

export default function BehaviorTab({
  streakData, emotionData, rollingPerformance, calendarData, trades,
}) {
  const [heatmapTooltip, setHeatmapTooltip] = useState(null);

  return (
    <div className="space-y-6">
      {/* Streak & Tilt Detection */}
      {streakData && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-xl text-surface-50 mb-2">Streak & Tilt Detection</h2>
          <p className="text-surface-400 text-sm mb-6">Identifies patterns of consecutive wins/losses and potential revenge trading</p>
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
              <p className="font-mono text-danger font-semibold text-lg">${Math.abs(streakData.worst_streak_pnl).toFixed(2)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">Revenge Trades <InfoTooltip text="Trades entered within 24 hours of a loss. Often emotional." /></p>
              <p className="font-mono text-warning font-semibold text-lg">{streakData.total_revenge_trades}</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs flex items-center">Tilt Score <InfoTooltip text="% of revenge trades that were also losses. High score (>60%) means bad decisions after losses." /></p>
              <p className={`font-mono font-semibold text-lg ${streakData.tilt_score > 60 ? 'text-danger' : streakData.tilt_score > 40 ? 'text-warning' : 'text-success'}`}>{streakData.tilt_score}%</p>
            </div>
            <div className="space-y-1">
              <p className="text-surface-400 text-xs">Total Streaks (3+)</p>
              <p className="font-mono text-surface-100 font-semibold text-lg">{streakData.winning_streaks + streakData.losing_streaks}</p>
            </div>
          </div>
          {streakData.streaks?.length > 0 && (
            <div>
              <h3 className="text-surface-200 text-sm font-medium mb-3">Notable Streaks</h3>
              <div className="flex flex-wrap gap-2">
                {streakData.streaks.slice(0, 12).map((streak, i) => (
                  <div key={i} className={`px-3 py-2 rounded-lg border text-xs font-mono ${streak.type === 'win' ? 'bg-success/10 border-success/30 text-success' : 'bg-danger/10 border-danger/30 text-danger'}`}>
                    <span className="font-semibold">{streak.length}x {streak.type === 'win' ? 'W' : 'L'}</span>
                    <span className="text-surface-400 ml-2">${Math.abs(streak.total_pnl).toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Emotion & Process Analysis */}
      {emotionData && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <div className="mb-6">
            <h2 className="font-display font-semibold text-xl text-surface-50">Emotion & Process Analysis</h2>
            <p className="text-surface-400 text-sm mt-1">How your mental state and process discipline correlate with P&L</p>
          </div>

          {emotionData.emotions.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-surface-200">Performance by Emotion at Entry</h3>
                <span className="text-xs text-surface-500">{emotionData.trades_with_emotion} of {emotionData.trades_with_emotion + emotionData.trades_without_emotion} trades tagged</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-700">
                      <th className="text-left py-2.5 px-3 text-surface-400 text-xs font-medium">Emotion</th>
                      <th className="text-right py-2.5 px-3 text-surface-400 text-xs font-medium">Trades</th>
                      <th className="text-right py-2.5 px-3 text-surface-400 text-xs font-medium">Win Rate</th>
                      <th className="text-right py-2.5 px-3 text-surface-400 text-xs font-medium">Avg P&L</th>
                      <th className="text-right py-2.5 px-3 text-surface-400 text-xs font-medium">Total P&L</th>
                      <th className="text-right py-2.5 px-3 text-surface-400 text-xs font-medium">Avg Win</th>
                      <th className="text-right py-2.5 px-3 text-surface-400 text-xs font-medium">Avg Loss</th>
                      <th className="text-right py-2.5 px-3 text-surface-400 text-xs font-medium">Best</th>
                      <th className="text-right py-2.5 px-3 text-surface-400 text-xs font-medium">Worst</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emotionData.emotions.map((row) => {
                      const emotionColors = {
                        Calm: 'text-cyan-400 bg-cyan-400/10',
                        Confident: 'text-success bg-success/10',
                        FOMO: 'text-warning bg-warning/10',
                        Nervous: 'text-purple-400 bg-purple-400/10',
                        Revenge: 'text-danger bg-danger/10',
                        Bored: 'text-surface-400 bg-surface-700/50',
                        Frustrated: 'text-danger bg-danger/10',
                        Euphoric: 'text-warning bg-warning/10',
                      };
                      const colorClass = emotionColors[row.emotion] || 'text-surface-300 bg-surface-700/50';
                      return (
                        <tr key={row.emotion} className="border-b border-surface-800 hover:bg-surface-900/30 transition-colors">
                          <td className="py-2.5 px-3"><span className={`text-xs px-2 py-1 rounded-full font-medium ${colorClass}`}>{row.emotion}</span></td>
                          <td className="py-2.5 px-3 text-right text-surface-200 font-mono text-sm">{row.total_trades}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-sm"><span className={row.win_rate >= 50 ? 'text-success' : 'text-danger'}>{row.win_rate}%</span></td>
                          <td className={`py-2.5 px-3 text-right font-mono text-sm font-semibold ${row.avg_pnl >= 0 ? 'text-success' : 'text-danger'}`}>{row.avg_pnl >= 0 ? '+' : ''}${Math.abs(row.avg_pnl).toLocaleString()}</td>
                          <td className={`py-2.5 px-3 text-right font-mono text-sm font-bold ${row.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>{row.total_pnl >= 0 ? '+' : ''}${Math.abs(row.total_pnl).toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right text-success font-mono text-sm">+${Math.abs(row.avg_win).toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right text-danger font-mono text-sm">-${Math.abs(row.avg_loss).toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right text-success font-mono text-sm">+${row.best_trade.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-right text-danger font-mono text-sm">-${Math.abs(row.worst_trade).toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {emotionData.trades_without_emotion > 0 && (
                <p className="text-xs text-surface-500 mt-2 italic">{emotionData.trades_without_emotion} trades missing emotion data &mdash; add an &quot;Emotion&quot; column to your spreadsheet</p>
              )}
            </div>
          )}

          {(emotionData.conviction.length > 0 || emotionData.grades.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {emotionData.conviction.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-surface-200 mb-3">Performance by Conviction Level</h3>
                  <div className="space-y-2">
                    {emotionData.conviction.map((row) => {
                      const maxPnl = Math.max(...emotionData.conviction.map(c => Math.abs(c.total_pnl)), 1);
                      const barWidth = Math.max((Math.abs(row.total_pnl) / maxPnl) * 100, 4);
                      return (
                        <div key={row.conviction} className="flex items-center gap-3">
                          <div className="flex items-center gap-1 w-20 flex-shrink-0">
                            {[1, 2, 3, 4, 5].map(star => (
                              <div key={star} className={`w-2.5 h-2.5 rounded-full ${star <= row.conviction ? 'bg-warning' : 'bg-surface-700'}`} />
                            ))}
                          </div>
                          <div className="flex-1 flex items-center gap-2">
                            <div className={`h-5 rounded-sm ${row.total_pnl >= 0 ? 'bg-success/30' : 'bg-danger/30'}`} style={{ width: `${barWidth}%` }} />
                            <span className={`font-mono text-xs font-semibold flex-shrink-0 ${row.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>{row.total_pnl >= 0 ? '+' : ''}${Math.abs(row.total_pnl).toLocaleString()}</span>
                          </div>
                          <span className="text-surface-500 text-xs font-mono w-20 text-right flex-shrink-0">{row.win_rate}% / {row.total_trades}t</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {emotionData.grades.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-surface-200 mb-3">Performance by Trade Grade</h3>
                  <div className="space-y-2">
                    {emotionData.grades.map((row) => {
                      const gradeColors = { A: 'text-success', B: 'text-cyan-400', C: 'text-warning', D: 'text-danger' };
                      const maxPnl = Math.max(...emotionData.grades.map(g => Math.abs(g.total_pnl)), 1);
                      const barWidth = Math.max((Math.abs(row.total_pnl) / maxPnl) * 100, 4);
                      return (
                        <div key={row.grade} className="flex items-center gap-3">
                          <span className={`font-mono font-bold text-lg w-8 flex-shrink-0 ${gradeColors[row.grade] || 'text-surface-400'}`}>{row.grade}</span>
                          <div className="flex-1 flex items-center gap-2">
                            <div className={`h-5 rounded-sm ${row.total_pnl >= 0 ? 'bg-success/30' : 'bg-danger/30'}`} style={{ width: `${barWidth}%` }} />
                            <span className={`font-mono text-xs font-semibold flex-shrink-0 ${row.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>{row.total_pnl >= 0 ? '+' : ''}${Math.abs(row.total_pnl).toLocaleString()}</span>
                          </div>
                          <span className="text-surface-500 text-xs font-mono w-20 text-right flex-shrink-0">{row.win_rate}% / {row.total_trades}t</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {emotionData.emotions.length === 0 && emotionData.conviction.length === 0 && emotionData.grades.length === 0 && (
            <div className="text-center py-6">
              <p className="text-surface-400 text-sm">No emotion/process data found. Add these columns to your spreadsheet:</p>
              <div className="flex justify-center gap-3 mt-3">
                <code className="text-xs bg-surface-800 px-2 py-1 rounded text-surface-300">Emotion</code>
                <code className="text-xs bg-surface-800 px-2 py-1 rounded text-surface-300">Conviction</code>
                <code className="text-xs bg-surface-800 px-2 py-1 rounded text-surface-300">Grade</code>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rolling 30-Trade Performance */}
      {rollingPerformance?.rolling_30_trades && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">Rolling 30-Trade Performance (Learning Curve)</h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rollingPerformance.rolling_30_trades}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="trade_number" stroke="#64748B" style={{ fontSize: '12px', fontFamily: 'monospace' }} label={{ value: 'Trade Number', position: 'insideBottom', offset: -5 }} />
                <YAxis yAxisId="left" stroke="#10B981" style={{ fontSize: '12px', fontFamily: 'monospace' }} tickFormatter={(value) => `$${value}`} label={{ value: 'P&L ($)', angle: -90, position: 'insideLeft' }} />
                <YAxis yAxisId="right" orientation="right" stroke="#06B6D4" style={{ fontSize: '12px', fontFamily: 'monospace' }} tickFormatter={(value) => `${value}%`} label={{ value: 'Win Rate (%)', angle: 90, position: 'insideRight' }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Line yAxisId="left" type="monotone" dataKey="pnl" stroke="#10B981" strokeWidth={2} dot={false} name="30-Trade P&L" />
                <Line yAxisId="right" type="monotone" dataKey="win_rate" stroke="#06B6D4" strokeWidth={2} dot={false} name="Win Rate" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Daily P&L Heatmap */}
      {trades.length > 0 && (() => {
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
        const startDate = new Date(dates[0]);
        const endDate = new Date(dates[dates.length - 1]);
        const startDow = startDate.getDay();
        const mondayOffset = startDow === 0 ? -6 : 1 - startDow;
        startDate.setDate(startDate.getDate() + mondayOffset);

        const weeks = [];
        const monthLabels = [];
        let current = new Date(startDate);
        let currentWeek = [];
        let lastMonth = -1;

        while (current <= endDate) {
          const dow = current.getDay();
          if (dow === 0 || dow === 6) { current.setDate(current.getDate() + 1); continue; }
          const dateStr = current.toISOString().split('T')[0];
          const month = current.getMonth();
          if (dow === 1 && month !== lastMonth) {
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            monthLabels.push({ weekIndex: weeks.length, label: monthNames[month] });
            lastMonth = month;
          }
          currentWeek.push({ date: dateStr, dayOfWeek: dow, pnl: dailyPnL[dateStr] || null, hasData: dateStr in dailyPnL });
          if (dow === 5) { weeks.push(currentWeek); currentWeek = []; }
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
            <h2 className="font-display font-semibold text-xl text-surface-50 mb-2">Daily P&L Heatmap</h2>
            <p className="text-surface-400 text-sm mb-4">Each square = one trading day. Green = profit, Red = loss. Hover for details.</p>
            <div className="overflow-x-auto">
              <div className="flex ml-[38px] mb-1" style={{ gap: '3px' }}>
                {weeks.map((_, wi) => {
                  const monthLabel = monthLabels.find(m => m.weekIndex === wi);
                  return (
                    <div key={wi} className="w-[14px] flex-shrink-0">
                      {monthLabel && <span className="text-[10px] text-surface-400 font-mono whitespace-nowrap">{monthLabel.label}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="flex min-w-fit">
                <div className="flex flex-col gap-[3px] mr-2 flex-shrink-0">
                  {dayLabels.map(label => (
                    <div key={label} className="h-[14px] flex items-center"><span className="text-[10px] text-surface-500 font-mono w-7 text-right">{label}</span></div>
                  ))}
                </div>
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
                                setHeatmapTooltip({ x: rect.left - parentRect.left + rect.width / 2, y: rect.top - parentRect.top, date: new Date(day.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }), pnl: day.pnl });
                              }
                            }}
                            onMouseLeave={() => setHeatmapTooltip(null)}
                          />
                        );
                      })}
                    </div>
                  ))}
                  {heatmapTooltip && (
                    <div className="absolute z-50 pointer-events-none rounded-lg bg-surface-900/95 backdrop-blur-xl border border-surface-700/50 px-3 py-2 shadow-card" style={{ left: heatmapTooltip.x, top: heatmapTooltip.y - 8, transform: 'translate(-50%, -100%)' }}>
                      <p className="text-surface-200 text-xs font-medium whitespace-nowrap">{heatmapTooltip.date}</p>
                      <p className={`font-mono text-sm font-semibold ${heatmapTooltip.pnl >= 0 ? 'text-success' : 'text-danger'}`}>{heatmapTooltip.pnl >= 0 ? '+' : ''}${heatmapTooltip.pnl.toFixed(2)}</p>
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

      {/* P&L Calendar from backend data */}
      {calendarData?.days?.length > 0 && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-display font-semibold text-xl text-surface-50">P&L Calendar</h2>
              <p className="text-surface-400 text-sm mt-1">Daily trading performance heatmap</p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-surface-500">{calendarData.green_days} green</span>
              <span className="text-surface-600">/</span>
              <span className="text-surface-500">{calendarData.red_days} red</span>
              <span className="text-surface-600">/</span>
              <span className="text-surface-500">{calendarData.total_trading_days} days</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6">
            {calendarData.best_day && (
              <div className="rounded-lg bg-success/5 border border-success/20 p-3">
                <p className="text-surface-400 text-xs mb-1">Best Day</p>
                <p className="font-mono font-bold text-lg text-success">+${calendarData.best_day.pnl.toLocaleString()}</p>
                <p className="text-surface-500 text-xs font-mono">{calendarData.best_day.date} &middot; {calendarData.best_day.trades} trades</p>
              </div>
            )}
            {calendarData.worst_day && (
              <div className="rounded-lg bg-danger/5 border border-danger/20 p-3">
                <p className="text-surface-400 text-xs mb-1">Worst Day</p>
                <p className="font-mono font-bold text-lg text-danger">-${Math.abs(calendarData.worst_day.pnl).toLocaleString()}</p>
                <p className="text-surface-500 text-xs font-mono">{calendarData.worst_day.date} &middot; {calendarData.worst_day.trades} trades</p>
              </div>
            )}
          </div>
          {calendarData.months?.length > 1 && (
            <div className="pt-4 border-t border-surface-700/30">
              <h3 className="text-sm font-semibold text-surface-200 mb-3">Monthly Summary</h3>
              <div className="flex items-end gap-2 h-32">
                {calendarData.months.map((m) => {
                  const maxMonthPnl = Math.max(...calendarData.months.map(m2 => Math.abs(m2.pnl)), 1);
                  const height = Math.max((Math.abs(m.pnl) / maxMonthPnl) * 100, 4);
                  const isPositive = m.pnl >= 0;
                  return (
                    <div key={m.month} className="flex flex-col items-center flex-1 min-w-0">
                      <span className={`text-[10px] font-mono mb-1 ${isPositive ? 'text-success' : 'text-danger'}`}>
                        {isPositive ? '+' : ''}{m.pnl >= 1000 || m.pnl <= -1000 ? `${(m.pnl / 1000).toFixed(1)}k` : m.pnl.toFixed(0)}
                      </span>
                      <div className={`w-full rounded-t-sm ${isPositive ? 'bg-success/30' : 'bg-danger/30'}`} style={{ height: `${height}%`, minHeight: '4px' }} />
                      <span className="text-[9px] text-surface-500 mt-1 truncate w-full text-center">{m.month.substring(5)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
