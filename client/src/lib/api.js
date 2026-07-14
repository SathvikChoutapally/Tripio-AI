import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * Perform an authenticated fetch request to the server API.
 */
async function fetchWithAuth(endpoint, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = 'An error occurred';
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error || errorMessage;
    } catch (_) {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

export const api = {
  // Trips
  getTrips: () => fetchWithAuth('/api/trips'),
  getTrip: (id) => fetchWithAuth(`/api/trips/${id}`),
  createTrip: (tripData) => fetchWithAuth('/api/trips', {
    method: 'POST',
    body: JSON.stringify(tripData),
  }),
  updateTrip: (id, updateData) => fetchWithAuth(`/api/trips/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updateData),
  }),
  deleteTrip: (id) => fetchWithAuth(`/api/trips/${id}`, {
    method: 'DELETE',
  }),

  // Chat
  sendMessage: (tripId, message) => fetchWithAuth('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ trip_id: tripId, message }),
  }),
  getChatHistory: (tripId) => fetchWithAuth(`/api/chat/history/${tripId}`),

  // Offers
  getFlightOffers: (tripId) => fetchWithAuth(`/api/flights/offers/${tripId}`),
  getHotelOffers: (tripId) => fetchWithAuth(`/api/hotels/offers/${tripId}`),
  selectHotelSegment: (tripId, segmentOrder, hotelOfferId) => fetchWithAuth(`/api/trips/${tripId}/segments/${segmentOrder}`, {
    method: 'PUT',
    body: JSON.stringify({ hotel_offer_id: hotelOfferId }),
  }),

  // Bookings
  createBookingOrder: (tripId, flightOfferId, hotelOfferId) => fetchWithAuth('/api/bookings/create-order', {
    method: 'POST',
    body: JSON.stringify({
      trip_id: tripId,
      flight_offer_id: flightOfferId,
      hotel_offer_id: hotelOfferId,
    }),
  }),
  verifyBookingPayment: (paymentId, orderId, signature) => fetchWithAuth('/api/bookings/verify', {
    method: 'POST',
    body: JSON.stringify({
      razorpay_payment_id: paymentId,
      razorpay_order_id: orderId,
      razorpay_signature: signature,
    }),
  }),
  getBookingStatus: (tripId) => fetchWithAuth(`/api/bookings/${tripId}`),
  savePassengers: (tripId, passengers) => fetchWithAuth('/api/bookings/passengers', {
    method: 'POST',
    body: JSON.stringify({ trip_id: tripId, passengers }),
  }),
  getPassengers: (tripId) => fetchWithAuth(`/api/bookings/passengers/${tripId}`),
  downloadPdf: async (tripId) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const response = await fetch(`${API_URL}/api/trips/${tripId}/pdf`, {
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      }
    });
    if (!response.ok) throw new Error('Failed to download PDF');
    return response.blob();
  },

  // Selection-first flow: confirm flight + hotel picks
  confirmSelections: (tripId, selectedFlightOfferId, selectedHotelOfferIds) =>
    fetchWithAuth(`/api/trips/${tripId}/confirm-selections`, {
      method: 'POST',
      body: JSON.stringify({
        selected_flight_offer_id: selectedFlightOfferId,
        selected_hotel_offer_ids: selectedHotelOfferIds,
      }),
    }),

  // Cities autocomplete
  searchCities: (query) => fetchWithAuth(`/api/cities/search?q=${encodeURIComponent(query)}&limit=8`),
  getMajorCities: () => fetchWithAuth('/api/cities'),

  // Admin
  getMetrics: (days = 7) => fetchWithAuth(`/api/admin/metrics?days=${days}`),
};
