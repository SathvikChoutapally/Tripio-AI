import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { formatINR } from '../lib/currency';

export default function BudgetChart({ breakdown }) {
  if (!breakdown) return null;

  const data = [
    { name: 'Flights', value: breakdown.flights_inr || 0, color: '#4f5fff' },
    { name: 'Hotels', value: breakdown.hotel_inr || 0, color: '#14b8a6' },
    { name: 'Activities / Remaining', value: breakdown.remaining_for_itinerary_inr || breakdown.service_fee_inr || 0, color: '#8b5cf6' },
  ];

  // Filter out zero elements
  const chartData = data.filter(item => item.value > 0);

  const total = chartData.reduce((sum, item) => sum + item.value, 0);

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      const percentage = ((item.value / total) * 100).toFixed(1);
      return (
        <div className="bg-[#101035] border border-white/10 p-3 rounded-xl shadow-2xl">
          <p className="text-xs font-bold text-white">{item.name}</p>
          <p className="text-sm font-extrabold text-teal-400 mt-1 font-mono">{formatINR(item.value)}</p>
          <p className="text-[10px] text-white/40 font-semibold uppercase tracking-wider mt-0.5">{percentage}% of total</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="glass-card p-6 border-white/5 flex flex-col items-center">
      <h3 className="font-display font-bold text-sm tracking-wide text-white/50 uppercase block mb-4 self-start">
        Budget Allocation
      </h3>

      <div className="w-full h-[220px] flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={75}
              paddingAngle={4}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend & Breakdown stats */}
      <div className="w-full space-y-3 mt-4 pt-4 border-t border-white/5">
        {chartData.map((item, index) => (
          <div key={index} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="text-white/60 font-medium">{item.name}</span>
            </div>
            <span className="font-bold font-mono text-white/90">{formatINR(item.value)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between text-sm font-bold pt-2 border-t border-white/5">
          <span className="text-white/90">Total Allocated</span>
          <span className="text-teal-400 font-mono">{formatINR(total)}</span>
        </div>
      </div>
    </div>
  );
}
