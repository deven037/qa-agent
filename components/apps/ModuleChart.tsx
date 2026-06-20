'use client'

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const COLORS = ['#06b6d4', '#8b5cf6', '#f97316', '#22c55e', '#ec4899', '#3b82f6', '#a855f7', '#14b8a6']

interface Props {
  data: { name: string; count: number }[]
}

export default function ModuleChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
        No test cases found
      </div>
    )
  }

  const chartData = data.map((d) => ({ name: d.name, value: d.count }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={3}
          dataKey="value"
        >
          {chartData.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: '#1e293b', border: 'none', borderRadius: 8, color: '#f1f5f9', fontSize: 12 }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: '#64748b' }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
