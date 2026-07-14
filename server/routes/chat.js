import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sendChatTurn, relaySSEStream } from '../services/aiProxy.js';
import supabase from '../lib/supabase.js';

const router = Router();

const chatSchema = z.object({
  trip_id: z.string().uuid(),
  message: z.string().min(1).max(2000),
});

/**
 * POST /api/chat
 * Send a conversational message to the AI agent
 */
router.post('/', requireAuth, validate(chatSchema), async (req, res) => {
  try {
    const { trip_id, message } = req.body;
    const userId = req.user.id;
    
    // Verify trip belongs to user
    const { data: trip } = await supabase
      .from('trips')
      .select('id')
      .eq('id', trip_id)
      .eq('user_id', userId)
      .single();
    
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    
    // Save user message
    await supabase.from('chat_messages').insert({
      trip_id,
      user_id: userId,
      role: 'user',
      content: message,
    });
    
    // Forward to AI service
    const result = await sendChatTurn(trip_id, userId, message);
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/chat/stream/:tripId
 * SSE endpoint — relays the AI service's SSE stream to the client
 */
router.get('/stream/:tripId', requireAuth, async (req, res) => {
  const { tripId } = req.params;
  const userId = req.user.id;
  
  // Verify trip belongs to user
  const { data: trip } = await supabase
    .from('trips')
    .select('id')
    .eq('id', tripId)
    .eq('user_id', userId)
    .single();
  
  if (!trip) {
    res.status(404).json({ error: 'Trip not found' });
    return;
  }
  
  // Relay SSE
  await relaySSEStream(tripId, res);
});

/**
 * GET /api/chat/history/:tripId
 * Get full chat history for a trip
 */
router.get('/history/:tripId', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('trip_id', req.params.tripId)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: true });
    
    if (error) throw error;
    res.json({ messages: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
