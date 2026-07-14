import { create } from 'zustand';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';

export const useTripStore = create((set, get) => ({
  trips: [],
  currentTrip: null,
  flightOffers: [],
  hotelOffers: [],
  selectedFlightId: null,
  selectedHotelId: null,
  // Map of segmentOrder -> hotelOfferId for multi-segment tracking
  selectedHotelOfferIds: {},
  hotelSegments: [],
  itinerary: null,
  budgetBreakdown: null,
  chatMessages: [],

  // UI/Streaming state
  isStreaming: false,
  streamLogs: [],
  streamError: null,
  currentStreamingResponse: '',
  activeNode: null,
  // Set to true when the graph has paused and is awaiting user selection
  awaitingSelection: false,
  // Set to true while confirm-selections request is in-flight
  isConfirmingSelections: false,

  // Booking/Payment state
  bookingStatus: null,
  bookingDetails: null,
  isProcessingBooking: false,

  setTrips: (trips) => set({ trips }),
  setCurrentTrip: (trip) => set({ currentTrip: trip }),

  fetchTrips: async () => {
    try {
      const { trips } = await api.getTrips();
      set({ trips });
    } catch (error) {
      console.error('Failed to fetch trips:', error);
    }
  },

  fetchTripDetails: async (tripId) => {
    try {
      const { trip } = await api.getTrip(tripId);

      const flightOffers = trip.flight_offers || [];
      const hotelOffers = trip.hotel_offers || [];
      const selectedFlightId = trip.selected_flight_offer_id;
      const hotelSegments = trip.hotel_segments || [];
      const itinerary = trip.itinerary || null;
      const selectedHotelId = trip.selected_hotel_offer_id;
      const budgetBreakdown = trip.budget_breakdown || null;
      const chatMessages = (trip.chat_messages || []).sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      );

      // Build per-segment selection map from DB
      const selectedHotelOfferIds = {};
      for (const seg of hotelSegments) {
        if (seg.hotel_offer_id) {
          selectedHotelOfferIds[seg.segment_order] = seg.hotel_offer_id;
        }
      }

      // Determine if the trip is in awaiting_selection state
      const awaitingSelection = trip.status === 'awaiting_selection' ||
        (flightOffers.length > 0 && hotelOffers.length > 0 && !itinerary && !budgetBreakdown);

      set({
        currentTrip: trip,
        flightOffers,
        hotelOffers,
        selectedFlightId,
        selectedHotelId,
        selectedHotelOfferIds,
        hotelSegments,
        itinerary,
        budgetBreakdown,
        chatMessages,
        awaitingSelection,
        streamError: null,
      });

      // Fetch existing booking if any
      get().fetchBookingStatus(tripId);
    } catch (error) {
      console.error('Failed to fetch trip details:', error);
      set({ streamError: error.message });
    }
  },

  fetchBookingStatus: async (tripId) => {
    try {
      const { booking } = await api.getBookingStatus(tripId);
      if (booking) {
        set({
          bookingStatus: booking.booking_status,
          bookingDetails: booking,
        });
      } else {
        set({
          bookingStatus: null,
          bookingDetails: null,
        });
      }
    } catch (error) {
      console.error('Failed to fetch booking status:', error);
    }
  },

  // ── Send a message (typed/voice) ──────────────────────────
  sendMessage: async (tripId, message) => {
    if (!message.trim()) return;

    // 1. Optimistic UI update for the chat panel
    const optimisticMessage = {
      id: Math.random().toString(),
      role: 'user',
      content: message,
      created_at: new Date().toISOString(),
    };

    set((state) => ({
      chatMessages: [...state.chatMessages, optimisticMessage],
      isStreaming: true,
      currentStreamingResponse: '',
      streamError: null,
    }));

    try {
      // 2. Call Node server proxy
      await api.sendMessage(tripId, message);

      // 3. Connect to the SSE stream to catch agent steps and response tokens
      get().connectStream(tripId);
    } catch (error) {
      set({
        isStreaming: false,
        streamError: error.message,
      });
    }
  },

  // ── Establish Server-Sent Events stream ─────────────────────
  connectStream: (tripId) => {
    const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

    // Clean up existing stream connection if any
    if (get().eventSource) {
      get().eventSource.close();
    }

    set({
      isStreaming: true,
      streamError: null,
      streamLogs: [],
      currentStreamingResponse: '',
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      const token = session?.access_token;
      const url = `${VITE_API_URL}/api/chat/stream/${tripId}?token=${token}`;
      const eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          if (payload.type === 'node_start') {
            set((state) => ({
              activeNode: payload.node,
              streamLogs: [...state.streamLogs, payload.message],
            }));
          } else if (payload.type === 'flight_results') {
            set((state) => ({
              streamLogs: [...state.streamLogs, payload.message || '✈ Flight options ready.'],
            }));
            // Refresh trip data to show flight cards
            get().fetchTripDetails(tripId);
          } else if (payload.type === 'hotel_results') {
            set((state) => ({
              streamLogs: [...state.streamLogs, payload.message || '🏨 Hotel options ready.'],
            }));
            // Refresh trip data to show hotel cards
            get().fetchTripDetails(tripId);
          } else if (payload.type === 'awaiting_selection') {
            // Graph has paused — user must pick flight + hotels
            eventSource.close();
            set({
              isStreaming: false,
              activeNode: null,
              awaitingSelection: true,
              streamLogs: [],
            });
            get().fetchTripDetails(tripId);
          } else if (payload.type === 'budget_result') {
            set((state) => ({
              streamLogs: [...state.streamLogs, payload.message],
              budgetBreakdown: payload.data,
            }));
          } else if (payload.type === 'rag_retrieval' || payload.type === 'rag_complete') {
            set((state) => ({
              streamLogs: [...state.streamLogs, payload.message],
            }));
          } else if (payload.type === 'itinerary_complete') {
            set((state) => ({
              streamLogs: [...state.streamLogs, payload.message],
            }));
          } else if (payload.type === 'stream_start') {
            set({ currentStreamingResponse: '' });
          } else if (payload.type === 'stream_token') {
            set((state) => ({
              currentStreamingResponse: state.currentStreamingResponse + payload.token,
            }));
          } else if (payload.type === 'stream_end') {
            set({ currentStreamingResponse: '' });
          } else if (payload.type === 'done' || payload.type === 'chat_done') {
            eventSource.close();
            set({ isStreaming: false, activeNode: null });
            get().fetchTripDetails(tripId);
          } else if (payload.type === 'info') {
            set((state) => ({
              streamLogs: [...state.streamLogs, payload.message],
            }));
          } else if (payload.type === 'error') {
            set({
              streamError: payload.message,
              isStreaming: false,
              activeNode: null,
            });
            eventSource.close();
          }
        } catch (err) {
          console.error('Error parsing SSE event:', err);
        }
      };

      eventSource.onerror = () => {
        // EventSource auto-reconnects on error; close it intentionally
        // since graph may have ended/paused
        eventSource.close();
        set({ isStreaming: false, activeNode: null });
        // Refresh trip data — graph may have completed or paused
        get().fetchTripDetails(tripId);
      };

      set({ eventSource });
    });
  },

  disconnectStream: () => {
    const { eventSource } = get();
    if (eventSource) {
      eventSource.close();
      set({ eventSource: null, isStreaming: false, activeNode: null });
    }
  },

  // ── Select Flight ──────────────────────────────────────────
  selectFlight: async (tripId, flightOfferId) => {
    try {
      set({ selectedFlightId: flightOfferId });
      await api.updateTrip(tripId, { selected_flight_offer_id: flightOfferId });
    } catch (error) {
      console.error('Failed to select flight:', error);
    }
  },

  // ── Select Hotel (single segment, legacy compat) ───────────
  selectHotel: async (tripId, hotelOfferId) => {
    try {
      set({ selectedHotelId: hotelOfferId });
      await api.updateTrip(tripId, { selected_hotel_offer_id: hotelOfferId });

      // Also update segment 1 as fallback to keep segments table in sync
      try {
        await api.selectHotelSegment(tripId, 1, hotelOfferId);
      } catch (e) {
        console.warn('Silent segment sync failed:', e);
      }
    } catch (error) {
      console.error('Failed to select hotel:', error);
    }
  },

  // ── Select Hotel for a specific segment ───────────────────
  selectHotelSegment: async (tripId, segmentOrder, hotelOfferId) => {
    try {
      // Optimistically update both the segment list and the per-segment map
      set((state) => ({
        hotelSegments: state.hotelSegments.map((seg) =>
          seg.segment_order === segmentOrder
            ? { ...seg, hotel_offer_id: hotelOfferId }
            : seg
        ),
        selectedHotelOfferIds: {
          ...state.selectedHotelOfferIds,
          [segmentOrder]: hotelOfferId,
        },
      }));

      // Call API
      const res = await api.selectHotelSegment(tripId, segmentOrder, hotelOfferId);

      if (res && res.budget_breakdown) {
        set({ budgetBreakdown: res.budget_breakdown });
      }

      // If updating first segment, also sync with single selected_hotel_offer_id
      if (segmentOrder === 1) {
        set({ selectedHotelId: hotelOfferId });
        await api.updateTrip(tripId, { selected_hotel_offer_id: hotelOfferId });
      }
    } catch (error) {
      console.error(`Failed to select hotel for segment ${segmentOrder}:`, error);
    }
  },

  // ── Confirm Selections (trigger itinerary + budget gen) ────
  confirmSelections: async (tripId) => {
    const { selectedFlightId, selectedHotelOfferIds, hotelSegments } = get();

    if (!selectedFlightId) {
      set({ streamError: 'Please select a flight before confirming.' });
      return;
    }

    // Build per-segment array
    const selectedHotelOfferIdsArr = hotelSegments.map((seg) => ({
      segment_order: seg.segment_order,
      hotel_offer_id: selectedHotelOfferIds[seg.segment_order] || null,
    })).filter((s) => s.hotel_offer_id !== null);

    if (selectedHotelOfferIdsArr.length === 0) {
      set({ streamError: 'Please select a hotel for each night segment before confirming.' });
      return;
    }

    set({ isConfirmingSelections: true, streamError: null, awaitingSelection: false });

    try {
      await api.confirmSelections(tripId, selectedFlightId, selectedHotelOfferIdsArr);

      set({
        isConfirmingSelections: false,
        isStreaming: true,
        streamLogs: ['⚙️ Confirmed! Generating your personalized itinerary & budget...'],
        streamError: null,
      });

      // Reconnect to SSE stream to receive itinerary + budget events
      get().connectStream(tripId);
    } catch (error) {
      set({
        isConfirmingSelections: false,
        streamError: error.message,
      });
    }
  },

  // ── Download PDF ───────────────────────────────────────────
  downloadPdf: async (tripId) => {
    try {
      const blob = await api.downloadPdf(tripId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Tripio_${tripId.slice(0, 8).toUpperCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('PDF download failed:', error);
      set({ streamError: 'Failed to download PDF: ' + error.message });
    }
  },

  // ── Razorpay Payment Trigger ───────────────────────────────
  checkoutTrip: async (tripId, flightOfferId, hotelOfferId, onSuccess, onFailure) => {
    set({ isProcessingBooking: true, streamError: null });
    try {
      // 1. Create order on Express backend
      const orderData = await api.createBookingOrder(tripId, flightOfferId, hotelOfferId);

      const { order_id, amount_inr, breakdown } = orderData;

      // 2. Open Razorpay checkout on the frontend
      const options = {
        key: import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_placeholder',
        amount: amount_inr * 100, // Razorpay amount in paise
        currency: 'INR',
        name: 'TripioAI',
        description: 'Complete Trip Booking (Flights + Hotel)',
        order_id: order_id,
        handler: async function (response) {
          try {
            set({ isProcessingBooking: true, bookingStatus: 'booking' });

            // Verify payment signature on backend
            await api.verifyBookingPayment(
              response.razorpay_payment_id,
              response.razorpay_order_id,
              response.razorpay_signature
            );

            // Notify payment checkout handler
            onSuccess(response);

            // Poll booking status until fully confirmed or max attempts reached
            let attempts = 0;
            const interval = setInterval(async () => {
              attempts++;
              await get().fetchBookingStatus(tripId);
              const currentStatus = get().bookingStatus;

              if (
                currentStatus === 'fully_confirmed' ||
                currentStatus === 'failed' ||
                currentStatus === 'partial_failure' ||
                attempts >= 30
              ) {
                clearInterval(interval);
                set({ isProcessingBooking: false });
              }
            }, 3000);
          } catch (verifyErr) {
            console.error('Payment verification failed:', verifyErr);
            set({ isProcessingBooking: false, streamError: verifyErr.message });
            if (onFailure) onFailure(verifyErr.message);
          }
        },
        prefill: {
          name: 'Trip Traveller',
          email: 'traveller@tripio.ai',
          contact: '+919999999999',
        },
        theme: {
          color: '#4f5fff',
        },
        modal: {
          ondismiss: function () {
            set({ isProcessingBooking: false });
            if (onFailure) onFailure('Payment cancelled by user');
          },
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (error) {
      set({ isProcessingBooking: false, streamError: error.message });
      if (onFailure) onFailure(error.message);
    }
  },
}));
