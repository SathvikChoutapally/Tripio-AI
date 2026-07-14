import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import supabase from '../lib/supabase.js';

const router = Router();

// Simple admin check (in production, check for admin role in user metadata)
function requireAdmin(req, res, next) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail && req.user.email !== adminEmail) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * GET /api/admin/metrics
 * Aggregate metrics from agent_traces for the LangSmith dashboard
 */
router.get('/metrics', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
    
    // Parallel queries for different metrics
    const [tracesRes, tripsRes, bookingsRes] = await Promise.all([
      // Agent trace stats by node
      supabase
        .from('agent_traces')
        .select('node_name, status, latency_ms, token_input, token_output')
        .gte('created_at', since),
      
      // Trip stats
      supabase
        .from('trips')
        .select('status, created_at, budget_breakdown')
        .gte('created_at', since),
      
      // Booking + revenue
      supabase
        .from('bookings')
        .select('payment_status, booking_status, amount_inr, created_at')
        .gte('created_at', since),
    ]);
    
    const traces = tracesRes.data || [];
    const trips = tripsRes.data || [];
    const bookings = bookingsRes.data || [];
    
    // Compute metrics
    const nodeMetrics = {};
    let totalLatencyMs = 0;
    let totalTokens = 0;
    
    for (const trace of traces) {
      if (!nodeMetrics[trace.node_name]) {
        nodeMetrics[trace.node_name] = { total: 0, success: 0, failed: 0, avgLatencyMs: 0, totalLatencyMs: 0 };
      }
      const m = nodeMetrics[trace.node_name];
      m.total++;
      if (trace.status === 'completed') m.success++;
      if (trace.status === 'failed') m.failed++;
      if (trace.latency_ms) m.totalLatencyMs += trace.latency_ms;
      if (trace.token_input) totalTokens += (trace.token_input + (trace.token_output || 0));
      if (trace.latency_ms) totalLatencyMs += trace.latency_ms;
    }
    
    for (const node of Object.values(nodeMetrics)) {
      node.avgLatencyMs = node.total > 0 ? Math.round(node.totalLatencyMs / node.total) : 0;
      node.successRate = node.total > 0 ? ((node.success / node.total) * 100).toFixed(1) : 0;
    }
    
    const paidBookings = bookings.filter(b => b.payment_status === 'paid');
    const totalRevenueInr = paidBookings.reduce((sum, b) => sum + Number(b.amount_inr), 0);
    
    res.json({
      period_days: Number(days),
      trips: {
        total: trips.length,
        by_status: trips.reduce((acc, t) => {
          acc[t.status] = (acc[t.status] || 0) + 1;
          return acc;
        }, {}),
      },
      bookings: {
        total: bookings.length,
        paid: paidBookings.length,
        revenue_inr: totalRevenueInr,
      },
      agent_traces: {
        total: traces.length,
        avg_latency_ms: traces.length > 0 ? Math.round(totalLatencyMs / traces.length) : 0,
        total_tokens: totalTokens,
        by_node: nodeMetrics,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
