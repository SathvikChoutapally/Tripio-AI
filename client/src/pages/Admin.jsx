import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatINR } from '../lib/currency';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Shield, Users, Activity, Landmark, Cpu, Loader2, Calendar } from 'lucide-react';

export default function Admin() {
  const [metrics, setMetrics] = useState(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    fetchMetrics();
  }, [days]);

  const fetchMetrics = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const data = await api.getMetrics(days);
      setMetrics(data);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to fetch admin metrics. Make sure you are authenticated as admin.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center text-white/50">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500 mb-3" />
        <p>Fetching metrics from agent trace database...</p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="max-w-md mx-auto mt-16 p-8 glass-card border-red-500/20 text-center">
        <Shield className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <h2 className="font-display font-bold text-lg text-white">Access Denied</h2>
        <p className="text-xs text-white/55 mt-2 leading-relaxed">{errorMsg}</p>
        <p className="text-[10px] text-white/35 mt-4">
          To view this page, log in with admin privileges (default: <span className="font-mono">admin@tripio.ai</span>)
        </p>
      </div>
    );
  }

  const { trips, bookings, agent_traces } = metrics;
  
  // Transform trace node metrics for BarChart
  const chartData = Object.entries(agent_traces.by_node || {}).map(([nodeName, nodeStats]) => ({
    name: nodeName.replace('_tool', '').replace('_check', ''),
    latency: nodeStats.avgLatencyMs,
    success: parseFloat(nodeStats.successRate),
  }));

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black font-display tracking-tight flex items-center gap-2">
            <Shield className="w-8 h-8 text-brand-400" />
            <span>LangSmith Tracer Metrics</span>
          </h1>
          <p className="text-sm text-white/50">Agent trace metrics, latency audits, and transaction summaries</p>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-white/40" />
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-brand-500"
          >
            <option value={1} className="bg-[#0a0a20]">Today</option>
            <option value={7} className="bg-[#0a0a20]">Last 7 days</option>
            <option value={30} className="bg-[#0a0a20]">Last 30 days</option>
          </select>
        </div>
      </div>

      {/* Grid of Key metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Metric 1 */}
        <div className="glass-card p-5 border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Active Plans</span>
            <Users className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h3 className="text-3xl font-black font-mono leading-none">{trips.total}</h3>
            <p className="text-[10px] text-white/40 mt-1.5">
              Planning: {trips.by_status.planning || 0} | Confirmed: {trips.by_status.confirmed || 0}
            </p>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="glass-card p-5 border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Audited Traces</span>
            <Activity className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h3 className="text-3xl font-black font-mono leading-none">{agent_traces.total}</h3>
            <p className="text-[10px] text-white/40 mt-1.5">
              Trace latency average: {agent_traces.avg_latency_ms}ms
            </p>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="glass-card p-5 border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Token cost volume</span>
            <Cpu className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <h3 className="text-3xl font-black font-mono leading-none">{agent_traces.total_tokens.toLocaleString()}</h3>
            <p className="text-[10px] text-white/40 mt-1.5">
              Est. LLM cost: ${(agent_traces.total_tokens * 0.000002).toFixed(4)}
            </p>
          </div>
        </div>

        {/* Metric 4 */}
        <div className="glass-card p-5 border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Verified Revenue</span>
            <Landmark className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-3xl font-black font-mono leading-none text-emerald-400">
              {formatINR(bookings.revenue_inr)}
            </h3>
            <p className="text-[10px] text-white/40 mt-1.5">
              Paid checkout items: {bookings.paid} / {bookings.total}
            </p>
          </div>
        </div>
      </div>

      {/* Latency by Agent Node Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="glass-card p-6 border-white/5 lg:col-span-2">
          <h3 className="font-display font-extrabold text-base text-white/90 mb-6">
            Average Step Latency (ms)
          </h3>
          
          <div className="w-full h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" stroke="rgba(255,255,255,0.4)" tick={{ fontSize: 10 }} />
                <YAxis stroke="rgba(255,255,255,0.4)" tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#101035', borderColor: 'rgba(255,255,255,0.1)' }}
                  labelStyle={{ color: 'white', fontWeight: 'bold' }}
                />
                <Bar dataKey="latency" fill="#4f5fff" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Node stats detail list */}
        <div className="glass-card p-6 border-white/5">
          <h3 className="font-display font-extrabold text-base text-white/90 mb-4">
            Success Audit Summary
          </h3>
          <div className="space-y-4">
            {Object.entries(agent_traces.by_node || {}).map(([nodeName, nodeStats], index) => {
              const success = parseFloat(nodeStats.successRate);
              return (
                <div key={index} className="flex flex-col gap-1.5 pb-3.5 border-b border-white/5 last:border-b-0">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-white/80">{nodeName}</span>
                    <span className={success >= 95 ? 'text-teal-400' : success >= 80 ? 'text-amber-400' : 'text-red-400'}>
                      {nodeStats.successRate}%
                    </span>
                  </div>
                  <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${success}%`,
                        backgroundColor: success >= 95 ? '#14b8a6' : success >= 80 ? '#f59e0b' : '#ef4444'
                      }}
                    />
                  </div>
                  <span className="text-[9px] text-white/30 block mt-0.5">
                    Traces logged: {nodeStats.total} | Average latency: {nodeStats.avgLatencyMs}ms
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
