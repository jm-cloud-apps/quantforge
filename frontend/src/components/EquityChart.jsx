import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'

export default function EquityChart({ data, initialCapital }) {
  if (!data?.length) return null

  const minVal = Math.min(...data.map(d => d.value))
  const maxVal = Math.max(...data.map(d => d.value))

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(30, 41, 59, 0.5)" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#64748B', fontSize: 11, fontFamily: 'Inter' }}
            tickFormatter={(v) => {
              const d = new Date(v)
              return `${d.getMonth() + 1}/${d.getFullYear()}`
            }}
            axisLine={{ stroke: 'rgba(30, 41, 59, 0.4)' }}
            tickLine={false}
          />
          <YAxis
            domain={[minVal * 0.98, maxVal * 1.02]}
            tick={{ fill: '#64748B', fontSize: 11, fontFamily: 'Inter' }}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(15, 22, 35, 0.95)',
              border: '0.5px solid rgba(30, 41, 59, 0.5)',
              borderRadius: '12px',
              backdropFilter: 'blur(40px)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
              fontFamily: 'Inter',
              fontSize: '13px',
            }}
            labelStyle={{ color: '#E2E8F0' }}
            formatter={(value) => [`$${value.toLocaleString()}`, 'Portfolio Value']}
            labelFormatter={(label) => `Date: ${label}`}
          />
          <ReferenceLine y={initialCapital} stroke="#475569" strokeDasharray="3 3" strokeOpacity={0.5} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#10B981"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
