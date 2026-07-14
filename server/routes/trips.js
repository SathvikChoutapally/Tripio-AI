import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import supabase from '../lib/supabase.js';
import { startTripPlan, confirmSelections, streamTripPDF } from '../services/aiProxy.js';

const router = Router();

const createTripSchema = z.object({
  num_adults: z.number().int().min(1).max(20),
  num_children: z.number().int().min(0).max(10).default(0),
  date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  budget_inr: z.number().positive().max(100000000),
  origin_city: z.string().min(2).max(100),
  origin_iata: z.string().length(3).toUpperCase(),
  destination_city: z.string().min(2).max(100),
  destination_iata: z.string().length(3).toUpperCase(),
origin_liteapi_id: z.string().nullable().optional(),
destination_liteapi_id: z.string().nullable().optional(),
});

/**
 * GET /api/trips
 * Get all trips for the current user
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('trips')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json({ trips: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/trips
 * Create a new trip and kick off the AI planning agent
 */
router.post('/', requireAuth, validate(createTripSchema), async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Validate date range
    const start = new Date(req.body.date_start);
    const end = new Date(req.body.date_end);
    if (end <= start) {
      return res.status(400).json({ error: 'date_end must be after date_start' });
    }
    if (start < new Date()) {
      return res.status(400).json({ error: 'date_start must be in the future' });
    }
    
    // Create trip record
    const { data: trip, error } = await supabase
      .from('trips')
      .insert({
        user_id: userId,
        ...req.body,
        status: 'planning',
      })
      .select()
      .single();
    
    if (error) throw error;
    console.log("[Trips] Starting AI planning...");
    // Kick off AI planning asynchronously (don't await — SSE handles updates)
    startTripPlan({
      trip_id: trip.id,
      user_id: userId,
      num_adults: trip.num_adults,
      num_children: trip.num_children,
      date_start: trip.date_start,
      date_end: trip.date_end,
      budget_inr: trip.budget_inr,
      origin_iata: trip.origin_iata,
      destination_iata: trip.destination_iata,
      origin_city: trip.origin_city,
      destination_city: trip.destination_city,
      origin_liteapi_id: trip.origin_liteapi_id,
      destination_liteapi_id: trip.destination_liteapi_id,
    }).catch((err) => {
      console.error(`[Trip ${trip.id}] AI planning failed:`, err.message);
    });
    
    res.status(201).json({ trip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/trips/:id
 * Get a single trip with its offers and booking status
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { data: trip, error } = await supabase
      .from('trips')
      .select(`
        *,
        flight_offers(*),
        hotel_offers(*),
        hotel_segments(*),
        bookings(*),
        chat_messages(id, role, content, created_at, metadata)
      `)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();
    
    if (error || !trip) return res.status(404).json({ error: 'Trip not found' });
    
    res.json({ trip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/trips/:id/segments/:segment_order
 * Update selected hotel offer for a specific segment of the trip
 */
router.put('/:id/segments/:segment_order', requireAuth, async (req, res) => {
  try {
    const { hotel_offer_id } = req.body;
    const { id: tripId, segment_order } = req.params;
    const userId = req.user.id;

    // Verify trip belongs to user
    const { data: trip } = await supabase
      .from('trips')
      .select('*')
      .eq('id', tripId)
      .eq('user_id', userId)
      .single();

    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    // Fetch the hotel offer to get price details
    const { data: offer } = await supabase
      .from('hotel_offers')
      .select('*')
      .eq('id', hotel_offer_id)
      .single();

    if (!offer) return res.status(404).json({ error: 'Hotel offer not found' });

    // Update the segment
    const { data: segment, error } = await supabase
      .from('hotel_segments')
      .update({
        hotel_offer_id,
        price_per_night_inr: offer.amount_per_night_inr,
        total_price_inr: offer.total_amount_inr
      })
      .eq('trip_id', tripId)
      .eq('segment_order', Number(segment_order))
      .select()
      .single();

    if (error) throw error;

    // Recompute budget breakdown and update the trip's budget breakdown in the DB
    // 1. Fetch flight cost
    let flightCost = 0;
    if (trip.selected_flight_offer_id) {
      const { data: flightOffer } = await supabase
        .from('flight_offers')
        .select('amount_inr')
        .eq('id', trip.selected_flight_offer_id)
        .maybe_single();
      if (flightOffer) {
        flightCost = Number(flightOffer.amount_inr);
      }
    }

    // 2. Fetch all segments
    const { data: segments } = await supabase
      .from('hotel_segments')
      .select('total_price_inr')
      .eq('trip_id', tripId);

    const hotelCost = (segments || []).reduce((sum, s) => sum + Number(s.total_price_inr || 0), 0);
    const combined = flightCost + hotelCost;
    const remaining = Number(trip.budget_inr || 0) - combined;
    const minItineraryBudget = Number(trip.budget_inr || 0) * 0.15;
    const budgetSatisfied = combined <= Number(trip.budget_inr || 0) && remaining >= minItineraryBudget;

    const breakdown = {
      flights_inr: flightCost,
      hotel_inr: hotelCost,
      combined_inr: combined,
      remaining_for_itinerary_inr: Math.max(0, remaining),
      budget_satisfied: budgetSatisfied,
      budget_inr: Number(trip.budget_inr || 0)
    };

    await supabase
      .from('trips')
      .update({ budget_breakdown: breakdown })
      .eq('id', tripId);

    res.json({ segment, budget_breakdown: breakdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/trips/:id
 * Update trip (select flight/hotel offer, update status)
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const allowed = ['selected_flight_offer_id', 'selected_hotel_offer_id', 'status'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    
    const { data, error } = await supabase
      .from('trips')
      .update(update)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();
    
    if (error || !data) return res.status(404).json({ error: 'Trip not found' });
    res.json({ trip: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/trips/:id
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('trips')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/trips/:id/confirm-selections
 * Persist user's chosen flight + hotel-per-segment, then kick off
 * itinerary + budget generation in the AI service.
 *
 * Body: { selected_flight_offer_id: string, selected_hotel_offer_ids: [{segment_order, hotel_offer_id}] }
 */
const confirmSchema = z.object({
  selected_flight_offer_id: z.string().uuid(),
  selected_hotel_offer_ids: z.array(z.object({
    segment_order: z.number().int().positive(),
    hotel_offer_id: z.string().uuid(),
  })),
});

router.post('/:id/confirm-selections', requireAuth, validate(confirmSchema), async (req, res) => {
  try {
    const tripId = req.params.id;
    const userId = req.user.id;

    // Verify ownership
    const { data: trip } = await supabase
      .from('trips')
      .select('id, status')
      .eq('id', tripId)
      .eq('user_id', userId)
      .single();

    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    const { selected_flight_offer_id, selected_hotel_offer_ids } = req.body;

    // Fire-and-forget: AI service will write back via SSE
    confirmSelections({
      trip_id: tripId,
      user_id: userId,
      selected_flight_offer_id,
      selected_hotel_offer_ids,
    }).catch((err) => {
      console.error(`[Trip ${tripId}] confirm-selections failed:`, err.message);
    });

    res.json({ trip_id: tripId, status: 'generating_plan' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/trips/:id/pdf
 * Streams a PDF summary of the confirmed trip plan.
 */
router.get('/:id/pdf', requireAuth, async (req, res) => {
  try {
    const tripId = req.params.id;
    const userId = req.user.id;

    // Verify ownership
    const { data: trip } = await supabase
      .from('trips')
      .select('id')
      .eq('id', tripId)
      .eq('user_id', userId)
      .single();

    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    await streamTripPDF(tripId, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
