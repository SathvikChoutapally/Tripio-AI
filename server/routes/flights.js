import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import supabase from '../lib/supabase.js';

const router = Router();

/**
 * GET /api/flights/offers/:tripId
 * Get all flight offers for a trip
 */
router.get('/offers/:tripId', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('flight_offers')
      .select('*')
      .eq('trip_id', req.params.tripId)
      .order('rank', { ascending: true });
    
    if (error) throw error;
    res.json({ offers: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
