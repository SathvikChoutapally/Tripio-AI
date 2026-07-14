import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createOrder, verifyWebhookSignature } from '../services/razorpay.js';
import { triggerBooking } from '../services/aiProxy.js';
import { generateBookingPdf } from '../services/pdfGenerator.js';
import { sendBookingConfirmation } from '../services/emailService.js';
import supabase from '../lib/supabase.js';

const router = Router();

const createOrderSchema = z.object({
  trip_id: z.string().uuid(),
  flight_offer_id: z.string().uuid(),
  hotel_offer_id: z.string().uuid(),
});

const passengerSchema = z.object({
  trip_id: z.string().uuid(),
  passengers: z.array(z.object({
    first_name: z.string().min(1).max(100),
    last_name: z.string().min(1).max(100),
    email: z.string().email(),
    phone: z.string().min(5).max(20),
    gender: z.enum(['male', 'female', 'other']),
    date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    nationality: z.string().min(2).max(100),
    passenger_type: z.enum(['adult', 'child']).default('adult'),
    title: z.enum(['mr', 'ms', 'mrs', 'dr', 'prof']).default('mr'),
  })).min(1),
});

/**
 * POST /api/bookings/passengers
 * Save passenger details for a trip before checkout
 */
router.post('/passengers', requireAuth, validate(passengerSchema), async (req, res) => {
  try {
    const { trip_id, passengers } = req.body;
    const userId = req.user.id;

    // Verify trip belongs to user
    const { data: trip } = await supabase
      .from('trips')
      .select('id')
      .eq('id', trip_id)
      .eq('user_id', userId)
      .single();

    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    // Delete existing passengers for this trip (re-save on each submit)
    await supabase.from('passengers').delete().eq('trip_id', trip_id).eq('user_id', userId);

    // Insert all passengers
    const records = passengers.map(({ id, created_at, ...p }) => ({
      ...p,
      trip_id,
      user_id: userId,
    }));

    const { data, error } = await supabase.from('passengers').insert(records).select();
    if (error) throw error;

    res.json({ passengers: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bookings/passengers/:tripId
 * Fetch saved passengers for a trip
 */
router.get('/passengers/:tripId', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('passengers')
      .select('*')
      .eq('trip_id', req.params.tripId)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ passengers: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bookings/create-order
 * Create a Razorpay order for the selected trip components
 */
router.post('/create-order', requireAuth, validate(createOrderSchema), async (req, res) => {
  try {
    const { trip_id, flight_offer_id, hotel_offer_id } = req.body;
    const userId = req.user.id;
    
    // Idempotency: check for existing pending booking
    const idempotencyKey = `${trip_id}_${flight_offer_id}_${hotel_offer_id}`;
    const { data: existing } = await supabase
      .from('bookings')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .single();
    
    if (existing && existing.payment_status === 'paid') {
      return res.json({ booking: existing, already_paid: true });
    }
    
    if (existing && existing.razorpay_order_id) {
      return res.json({ booking: existing, order_id: existing.razorpay_order_id });
    }
    
    // Fetch offers to calculate total
    const [{ data: flightOffer }, { data: hotelOffer }] = await Promise.all([
      supabase.from('flight_offers').select('*').eq('id', flight_offer_id).single(),
      supabase.from('hotel_offers').select('*').eq('id', hotel_offer_id).single(),
    ]);
    
    if (!flightOffer || !hotelOffer) {
      return res.status(404).json({ error: 'Offers not found' });
    }
    
    const serviceFeeRate = 0.025; // 2.5% service fee
    const flightAmount = Number(flightOffer.amount_inr);
    let hotelAmount = Number(hotelOffer.total_amount_inr);

    // Sum hotel segments if they exist to support split stays
    const { data: segments } = await supabase
      .from('hotel_segments')
      .select('total_price_inr')
      .eq('trip_id', trip_id);

    if (segments && segments.length > 0) {
      hotelAmount = segments.reduce((sum, seg) => sum + Number(seg.total_price_inr || 0), 0);
    }

    const subtotal = flightAmount + hotelAmount;
    const serviceFee = Math.round(subtotal * serviceFeeRate);
    const totalInr = subtotal + serviceFee;
    
    // Create Razorpay order
    const order = await createOrder(totalInr, trip_id, idempotencyKey);
    
    // Create booking record
    const { data: booking, error } = await supabase
      .from('bookings')
      .insert({
        trip_id,
        user_id: userId,
        razorpay_order_id: order.id,
        payment_status: 'pending',
        amount_inr: totalInr,
        idempotency_key: idempotencyKey,
        booking_status: 'pending',
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // Update trip with selected offers
    await supabase
      .from('trips')
      .update({
        selected_flight_offer_id: flight_offer_id,
        selected_hotel_offer_id: hotel_offer_id,
        status: 'pending_payment',
        budget_breakdown: {
          flights_inr: flightAmount,
          hotel_inr: hotelAmount,
          service_fee_inr: serviceFee,
          total_inr: totalInr,
          combined_inr: subtotal,
          remaining_for_itinerary_inr: 0,
          budget_satisfied: true,
        },
      })
      .eq('id', trip_id);
    
    res.json({
      booking,
      order_id: order.id,
      amount_inr: totalInr,
      breakdown: {
        flights: flightAmount,
        hotel: hotelAmount,
        service_fee: serviceFee,
        total: totalInr,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const verifySchema = z.object({
  razorpay_payment_id: z.string(),
  razorpay_order_id: z.string(),
  razorpay_signature: z.string(),
});

/**
 * POST /api/bookings/verify
 * Client-side Razorpay payment verification
 */
router.post('/verify', requireAuth, validate(verifySchema), async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    const userId = req.user.id;

    // Verify signature
    const crypto = await import('crypto');
    const { RAZORPAY_KEY_SECRET } = process.env;
    const hmac = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET || '');
    hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const generated_signature = hmac.digest('hex');

    if (generated_signature !== razorpay_signature) {
      if (RAZORPAY_KEY_SECRET) {
        return res.status(400).json({ error: 'Invalid payment signature verification' });
      }
    }

    // Find the booking
    const { data: booking } = await supabase
      .from('bookings')
      .select('*, trips(*)')
      .eq('razorpay_order_id', razorpay_order_id)
      .eq('user_id', userId)
      .single();

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.payment_status === 'paid') {
      return res.json({ success: true, booking, message: 'Already verified' });
    }

    // Update payment status
    const { data: updatedBooking } = await supabase
      .from('bookings')
      .update({
        razorpay_payment_id,
        razorpay_signature,
        payment_status: 'paid',
        booking_status: 'booking',
      })
      .eq('id', booking.id)
      .select()
      .single();

    await supabase
      .from('trips')
      .update({ status: 'booking' })
      .eq('id', booking.trip_id);

    // Trigger actual Duffel + LiteAPI booking, then PDF + email asynchronously
    triggerBooking({
      booking_id: booking.id,
      trip_id: booking.trip_id,
      user_id: booking.user_id,
      flight_offer_id: booking.trips.selected_flight_offer_id,
      hotel_offer_id: booking.trips.selected_hotel_offer_id,
      razorpay_order_id: razorpay_order_id,
      razorpay_payment_id,
    }).then(async (bookingResult) => {
      try {
        await _sendBookingConfirmationEmail(booking.id, booking.trip_id, booking.user_id);
      } catch (emailErr) {
        console.error('[Verify] Email/PDF failed (non-fatal):', emailErr.message);
      }
    }).catch((err) => {
      console.error(`[Verify] Booking trigger failed:`, err.message);
    });

    res.json({ success: true, booking: updatedBooking });
  } catch (err) {
    console.error('[Verify Error]:', err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * POST /api/bookings/webhook
 * Razorpay webhook — verifies payment and triggers booking + PDF + email
 */
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    
    if (!verifyWebhookSignature(req.body, signature)) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }
    
    const event = JSON.parse(req.body.toString());
    
    if (event.event === 'payment.captured') {
      const payment = event.payload.payment.entity;
      const orderId = payment.order_id;
      
      // Find the booking
      const { data: booking } = await supabase
        .from('bookings')
        .select('*, trips(*)')
        .eq('razorpay_order_id', orderId)
        .single();
      
      if (!booking) {
        console.error(`[Webhook] Booking not found for order: ${orderId}`);
        return res.json({ received: true });
      }
      
      // Update payment status
      await supabase
        .from('bookings')
        .update({
          razorpay_payment_id: payment.id,
          razorpay_signature: signature,
          payment_status: 'paid',
          booking_status: 'booking',
        })
        .eq('id', booking.id);
      
      await supabase
        .from('trips')
        .update({ status: 'booking' })
        .eq('id', booking.trip_id);
      
      // Trigger actual Duffel + LiteAPI booking, then PDF + email
      triggerBooking({
        booking_id: booking.id,
        trip_id: booking.trip_id,
        user_id: booking.user_id,
        flight_offer_id: booking.trips.selected_flight_offer_id,
        hotel_offer_id: booking.trips.selected_hotel_offer_id,
        razorpay_order_id: orderId,
        razorpay_payment_id: payment.id,
      }).then(async (bookingResult) => {
        // After booking completes (success or partial), send PDF confirmation
        if (bookingResult && (bookingResult.duffel_status === 'confirmed' || bookingResult.liteapi_status === 'confirmed')) {
          try {
            await _sendBookingConfirmationEmail(booking.id, booking.trip_id, booking.user_id);
          } catch (emailErr) {
            console.error('[Webhook] Email/PDF failed (non-fatal):', emailErr.message);
          }
        }
      }).catch((err) => {
        console.error(`[Webhook] Booking trigger failed:`, err.message);
      });
    }
    
    res.json({ received: true });
  } catch (err) {
    console.error('[Webhook] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Internal: generate PDF and send Resend confirmation email
 */
async function _sendBookingConfirmationEmail(bookingId, tripId, userId) {
  // Fetch all data needed for the email
  const [
    { data: booking },
    { data: trip },
    { data: passengers },
    { data: dbUser },
  ] = await Promise.all([
    supabase.from('bookings').select('*').eq('id', bookingId).single(),
    supabase.from('trips').select(`
      *,
      flight_offers(*),
      hotel_offers(*)
    `).eq('id', tripId).single(),
    supabase.from('passengers').select('*').eq('trip_id', tripId).order('created_at', { ascending: true }),
    supabase.from('users').select('email').eq('id', userId).single(),
  ]);

  if (!booking || !trip) {
    console.error('[Email] Could not load booking/trip data');
    return;
  }

  const selectedFlight = trip.flight_offers?.find(o => o.id === trip.selected_flight_offer_id)
    || trip.flight_offers?.[0];
  const selectedHotel = trip.hotel_offers?.find(o => o.id === trip.selected_hotel_offer_id)
    || trip.hotel_offers?.[0];

  const passengerList = passengers || [];

  // Generate PDF
  const pdfBuffer = await generateBookingPdf({
    booking,
    trip,
    passengers: passengerList,
    flightOffer: selectedFlight,
    hotelOffer: selectedHotel,
  });

  // Get primary passenger email
  const primaryPassenger = passengerList[0];
  const toEmail = primaryPassenger?.email || dbUser?.email || 'traveller@tripio.ai';

  if (!toEmail) {
    console.error('[Email] No email address found for passenger');
    return;
  }

  // Send via Resend
  await sendBookingConfirmation({
    to: toEmail,
    passengerName: primaryPassenger
      ? `${primaryPassenger.first_name} ${primaryPassenger.last_name}`
      : 'Traveller',
    trip,
    booking,
    flightOffer: selectedFlight,
    hotelOffer: selectedHotel,
    pdfBuffer,
  });

  console.log(`[Email] Booking confirmation sent to ${toEmail}`);
}

/**
 * GET /api/bookings/:tripId/download-pdf
 * Download booking confirmation PDF for a trip
 */
router.get('/:tripId/download-pdf', requireAuth, async (req, res) => {
  try {
    const tripId = req.params.tripId;
    const userId = req.user.id;

    // Fetch booking, trip, passengers
    const [
      { data: booking },
      { data: trip },
      { data: passengers },
    ] = await Promise.all([
      supabase.from('bookings').select('*').eq('trip_id', tripId).eq('user_id', userId).order('created_at', { ascending: false }).limit(1).single(),
      supabase.from('trips').select(`
        *,
        flight_offers(*),
        hotel_offers(*)
      `).eq('id', tripId).eq('user_id', userId).single(),
      supabase.from('passengers').select('*').eq('trip_id', tripId).order('created_at', { ascending: true }),
    ]);

    if (!booking) {
      return res.status(404).json({ error: 'No booking found for this trip' });
    }
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }

    const selectedFlight = trip.flight_offers?.find(o => o.id === trip.selected_flight_offer_id)
      || trip.flight_offers?.[0];
    const selectedHotel = trip.hotel_offers?.find(o => o.id === trip.selected_hotel_offer_id)
      || trip.hotel_offers?.[0];

    const pdfBuffer = await generateBookingPdf({
      booking,
      trip,
      passengers: passengers || [],
      flightOffer: selectedFlight,
      hotelOffer: selectedHotel,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Tripio_Booking_${tripId.slice(0, 8).toUpperCase()}.pdf`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[PDF Download] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bookings/:tripId
 * Get booking status for a trip
 */
router.get('/:tripId', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('trip_id', req.params.tripId)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    res.json({ booking: data || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

