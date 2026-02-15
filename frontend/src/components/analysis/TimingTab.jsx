import { useState } from 'react';
import {
  ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ZAxis,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { TOOLTIP_STYLE } from './shared';
import { getEntryTimingAnalysis } from '../../api/tradingAnalysis';

export default function TimingTab({
  timePerformance, entryTimingData: initialEntryTimingData, trades,
}) {
  const [timingMonthFilter, setTimingMonthFilter] = useState('all');
  const [entryTimingData, setEntryTimingData] = useState(initialEntryTimingData);

  const scatterData = trades
    .filter(t => t.duration_days !== undefined && t.duration_days !== null && t.pnl !== undefined)
    .map(t => ({ duration: t.duration_days, pnl: t.pnl, symbol: t.symbol, isWin: t.pnl > 0 }));

  return (
    <div className="space-y-6">
      {/* Time-Based Performance */}
      {timePerformance && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Day of Week */}
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">Performance by Day of Week</h2>
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
                      <td className="py-2 px-3 text-center"><span className={`font-mono text-xs font-semibold ${day.win_rate >= 50 ? 'text-success' : 'text-danger'}`}>{day.win_rate}%</span></td>
                      <td className={`py-2 px-3 font-mono text-xs font-semibold text-right ${day.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>${day.total_pnl.toFixed(2)}</td>
                      <td className={`py-2 px-3 font-mono text-xs text-right ${day.avg_pnl >= 0 ? 'text-success' : 'text-danger'}`}>${day.avg_pnl.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Monthly Performance */}
          <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
            <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">Monthly Performance</h2>
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
                      <td className="py-2 px-3 text-center"><span className={`font-mono text-xs font-semibold ${month.win_rate >= 50 ? 'text-success' : 'text-danger'}`}>{month.win_rate}%</span></td>
                      <td className={`py-2 px-3 font-mono text-xs font-semibold text-right ${month.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>${month.total_pnl.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Entry/Exit Timing Analysis */}
      {entryTimingData && !entryTimingData.error && entryTimingData.entry_timing && (
        <div>
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
              <h2 className="font-display font-semibold text-lg text-surface-50 mb-2">Entry Timing</h2>
              <p className="text-surface-400 text-sm mb-4">Performance by time of entry relative to market open (9:30 AM)</p>
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
                        <td className="py-2 px-3 text-surface-100 font-mono text-xs font-semibold">{bucket.time_bucket}</td>
                        <td className="py-2 px-3 text-surface-100 font-mono text-xs text-center">{bucket.total_trades}</td>
                        <td className="py-2 px-3 text-center"><span className={`font-mono text-xs font-semibold ${bucket.win_rate >= 50 ? 'text-success' : 'text-danger'}`}>{bucket.win_rate}%</span></td>
                        <td className={`py-2 px-3 font-mono text-xs font-semibold text-right ${bucket.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>${bucket.total_pnl.toFixed(2)}</td>
                        <td className={`py-2 px-3 font-mono text-xs text-right ${bucket.avg_pnl >= 0 ? 'text-success' : 'text-danger'}`}>${bucket.avg_pnl.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 p-3 rounded-lg bg-surface-900/60 border border-surface-700/20">
                <p className="text-xs text-surface-400 mb-1">Key Insight:</p>
                <p className="text-xs text-surface-300">
                  {(() => {
                    const first5min = entryTimingData.entry_timing.find(b => b.time_bucket === '0-5 min');
                    const after30min = entryTimingData.entry_timing.find(b => b.time_bucket === '30-60 min');
                    if (first5min && after30min) {
                      const diff = first5min.win_rate - after30min.win_rate;
                      if (Math.abs(diff) > 10) {
                        return diff > 0
                          ? `You perform ${Math.abs(diff).toFixed(0)}% better when entering in the first 5 minutes.`
                          : `You perform ${Math.abs(diff).toFixed(0)}% better when entering after 30 minutes.`;
                      }
                    }
                    const bestBucket = entryTimingData.entry_timing.reduce((best, current) => current.avg_pnl > best.avg_pnl ? current : best);
                    const worstBucket = entryTimingData.entry_timing.reduce((worst, current) => current.avg_pnl < worst.avg_pnl ? current : worst);
                    return `Best entry: "${bestBucket.time_bucket}" (avg $${bestBucket.avg_pnl.toFixed(2)}), worst: "${worstBucket.time_bucket}" (avg $${worstBucket.avg_pnl.toFixed(2)})`;
                  })()}
                </p>
              </div>
            </div>

            {/* Exit Timing */}
            {entryTimingData.exit_timing?.length > 0 && (
              <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
                <h2 className="font-display font-semibold text-xl text-surface-50 mb-4">Exit Timing Analysis</h2>
                <p className="text-surface-400 text-sm mb-4">Performance by time of exit relative to market open</p>
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
                          <td className="py-2 px-3 text-surface-100 font-mono text-xs font-semibold">{bucket.time_bucket}</td>
                          <td className="py-2 px-3 text-surface-100 font-mono text-xs text-center">{bucket.total_trades}</td>
                          <td className="py-2 px-3 text-center"><span className={`font-mono text-xs font-semibold ${bucket.win_rate >= 50 ? 'text-success' : 'text-danger'}`}>{bucket.win_rate}%</span></td>
                          <td className={`py-2 px-3 font-mono text-xs font-semibold text-right ${bucket.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>${bucket.total_pnl.toFixed(2)}</td>
                          <td className={`py-2 px-3 font-mono text-xs text-right ${bucket.avg_pnl >= 0 ? 'text-success' : 'text-danger'}`}>${bucket.avg_pnl.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 p-3 rounded-lg bg-surface-900/60 border border-surface-700/20">
                  <p className="text-xs text-surface-400 mb-1">Key Insight:</p>
                  <p className="text-xs text-surface-300">
                    {(() => {
                      const powerHour = entryTimingData.exit_timing.find(b => b.time_bucket === 'Power hour (3:00-4:00)');
                      const midDay = entryTimingData.exit_timing.find(b => b.time_bucket === 'Mid-day (11:30-3:00)');
                      if (powerHour && midDay && powerHour.total_trades >= 5) {
                        const diff = powerHour.avg_pnl - midDay.avg_pnl;
                        if (Math.abs(diff) > 50) {
                          return diff > 0
                            ? `Holding into power hour adds $${diff.toFixed(0)} avg profit.`
                            : `Exiting mid-day saves $${Math.abs(diff).toFixed(0)} avg.`;
                        }
                      }
                      const bestBucket = entryTimingData.exit_timing.reduce((best, current) => current.avg_pnl > best.avg_pnl ? current : best);
                      return `Best exit timing: "${bestBucket.time_bucket}" with avg $${bestBucket.avg_pnl.toFixed(2)} per trade`;
                    })()}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hold Time vs P&L Scatter */}
      {scatterData.length > 0 && (
        <div className="rounded-xl bg-surface-900/80 backdrop-blur-sm border border-surface-700/50 p-6">
          <h2 className="font-display font-semibold text-xl text-surface-50 mb-2">Hold Time vs P&L</h2>
          <p className="text-surface-400 text-sm mb-4">Relationship between how long you hold and your outcome</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis type="number" dataKey="duration" name="Days" stroke="#64748B" style={{ fontSize: '11px', fontFamily: 'monospace' }} label={{ value: 'Hold Days', position: 'insideBottom', offset: -5, style: { fill: '#64748B', fontSize: '11px' } }} />
                <YAxis type="number" dataKey="pnl" name="P&L" stroke="#64748B" style={{ fontSize: '11px', fontFamily: 'monospace' }} tickFormatter={(v) => `$${v}`} />
                <ZAxis range={[30, 30]} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(value, name) => [name === 'P&L' ? `$${value.toFixed(2)}` : `${value} days`, name]} labelFormatter={(_, payload) => payload?.[0]?.payload?.symbol || ''} />
                <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
                <Scatter data={scatterData.filter(d => d.isWin)} fill="#10B981" fillOpacity={0.6} name="Winners" />
                <Scatter data={scatterData.filter(d => !d.isWin)} fill="#EF4444" fillOpacity={0.6} name="Losers" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
