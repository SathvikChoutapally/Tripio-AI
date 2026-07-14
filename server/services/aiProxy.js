/**
 * AI Service Proxy
 * Handles HTTP communication between Node server and Python FastAPI service.
 * Also manages SSE relay from Python to the client.
 */

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

/**
 * Kick off a new trip planning run
 * @param {Object} tripBrief - { tripId, userId, numAdults, numChildren, dateStart, dateEnd, budgetInr, originIata, destinationIata, originCity, destinationCity }
 */
export async function startTripPlan(tripBrief) {
  console.log("[AI Proxy] Calling AI service...");
  console.log(tripBrief);
  const { default: fetch } = await import('node-fetch');
  
  const resp = await fetch(`${AI_SERVICE_URL}/agent/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tripBrief),
    signal: AbortSignal.timeout(30000),
  });
  
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI service error ${resp.status}: ${text}`);
  }
  
  return resp.json();
}

/**
 * Send a conversational chat turn to the AI service
 */
export async function sendChatTurn(tripId, userId, message) {
  const { default: fetch } = await import('node-fetch');
  
  const resp = await fetch(`${AI_SERVICE_URL}/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trip_id: tripId, user_id: userId, message }),
    signal: AbortSignal.timeout(30000),
  });
  
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI service error ${resp.status}: ${text}`);
  }
  
  return resp.json();
}

/**
 * Relay SSE stream from Python AI service to Express response
 * This pipes the Server-Sent Events from Python through Node to the client
 */
export async function relaySSEStream(tripId, clientRes) {
  const { default: fetch } = await import('node-fetch');
  
  // Set up SSE headers on the Express response
  clientRes.setHeader('Content-Type', 'text/event-stream');
  clientRes.setHeader('Cache-Control', 'no-cache');
  clientRes.setHeader('Connection', 'keep-alive');
  clientRes.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering
  clientRes.flushHeaders();
  
  try {
    const aiResp = await fetch(`${AI_SERVICE_URL}/agent/stream/${tripId}`, {
      headers: { Accept: 'text/event-stream' },
    });
    
    if (!aiResp.ok) {
      clientRes.write(`data: ${JSON.stringify({ type: 'error', message: 'AI service unavailable' })}\n\n`);
      clientRes.end();
      return;
    }
    
    // Pipe AI service SSE to client
    aiResp.body.on('data', (chunk) => {
      clientRes.write(chunk);
    });
    
    aiResp.body.on('end', () => {
      // Normal graph completion — client EventSource handles reconnect logic
      clientRes.end();
    });
    
    aiResp.body.on('error', (err) => {
      // "Premature close" means the Python graph paused (awaiting_selection).
      // This is NOT a fatal error — just end the response cleanly so the client
      // can reconnect when the confirm-selections call resumes the graph.
      if (err.message && err.message.toLowerCase().includes('premature close')) {
        console.log('[SSE Relay] Graph paused (awaiting selection) — closing relay cleanly.');
        clientRes.end();
        return;
      }
      console.error('[SSE Relay] Stream error:', err.message);
      clientRes.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      clientRes.end();
    });
    
    // Clean up if client disconnects
    clientRes.on('close', () => {
      aiResp.body.destroy();
    });
    
  } catch (err) {
    console.error('[SSE Relay] Connection error:', err.message);
    clientRes.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    clientRes.end();
  }
}

/**
 * Trigger booking after payment verification
 */
export async function triggerBooking(payload) {
  const { default: fetch } = await import('node-fetch');
  
  const resp = await fetch(`${AI_SERVICE_URL}/agent/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000), // booking can take time
  });
  
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI service booking error ${resp.status}: ${text}`);
  }
  
  return resp.json();
}

/**
 * Fetch agent run metrics for admin dashboard
 */
export async function getMetrics(params = {}) {
  const { default: fetch } = await import('node-fetch');
  const qs = new URLSearchParams(params).toString();
  
  const resp = await fetch(`${AI_SERVICE_URL}/admin/metrics${qs ? '?' + qs : ''}`, {
    signal: AbortSignal.timeout(15000),
  });
  
  if (!resp.ok) {
    throw new Error(`Metrics fetch failed: ${resp.status}`);
  }
  
  return resp.json();
}

/**
 * Call city resolver on AI service
 * @param {string} query - The city search input string
 */
export async function resolveCity(query) {
  const { default: fetch } = await import('node-fetch');
  
  const resp = await fetch(`${AI_SERVICE_URL}/agent/resolve-city?q=${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(15000),
  });
  
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI service resolveCity error ${resp.status}: ${text}`);
  }
  
  return resp.json();
}

/**
 * Confirm flight + hotel selections and trigger itinerary/budget generation
 * @param {Object} payload - { trip_id, user_id, selected_flight_offer_id, selected_hotel_offer_ids }
 */
export async function confirmSelections(payload) {
  const { default: fetch } = await import('node-fetch');

  const resp = await fetch(`${AI_SERVICE_URL}/agent/confirm-selections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`AI service confirm-selections error ${resp.status}: ${text}`);
  }

  return resp.json();
}

/**
 * Stream a PDF download from the AI service back to the Express response.
 * Pipes the binary PDF stream directly so no buffering in Node.
 * @param {string} tripId
 * @param {import('express').Response} clientRes
 */
export async function streamTripPDF(tripId, clientRes) {
  const { default: fetch } = await import('node-fetch');

  const resp = await fetch(`${AI_SERVICE_URL}/agent/trip/${tripId}/pdf`, {
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    clientRes.status(resp.status).json({ error: text });
    return;
  }

  const filename = resp.headers.get('content-disposition') || `attachment; filename="Tripio_${tripId.slice(0,8).toUpperCase()}.pdf"`;
  clientRes.setHeader('Content-Type', 'application/pdf');
  clientRes.setHeader('Content-Disposition', filename);
  resp.body.pipe(clientRes);
}
