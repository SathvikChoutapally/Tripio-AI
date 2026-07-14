import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTripStore } from '../store/tripStore';
import ChatPanel from '../components/ChatPanel';
import FlightCard from '../components/FlightCard';
import HotelCard from '../components/HotelCard';
import HotelSegmentPicker from '../components/HotelSegmentPicker';
import ItineraryTimeline from '../components/ItineraryTimeline';
import BudgetChart from '../components/BudgetChart';
import BookingConfirmation from '../components/BookingConfirmation';
import {
  Plane, Hotel, Calendar, BarChart3, ShieldCheck, ArrowLeft,
  Loader2, CheckCircle2, Download, AlertCircle, CheckCheck,
} from 'lucide-react';

export default function TripPlanner() {
  const { id } = useParams();
  const {
    currentTrip,
    flightOffers,
    hotelOffers,
    selectedFlightId,
    selectedHotelId,
    selectedHotelOfferIds,
    hotelSegments,
    itinerary,
    budgetBreakdown,
    awaitingSelection,
    isConfirmingSelections,
    isStreaming,
    streamLogs,
    streamError,
    fetchTripDetails,
    selectFlight,
    selectHotelSegment,
    confirmSelections,
    downloadPdf,
    connectStream,
    disconnectStream,
  } = useTripStore();

  const [activeTab, setActiveTab] = useState('flights');
  const [activeSeg, setActiveSeg] = useState(1);

  useEffect(() => {
    fetchTripDetails(id);

    // Auto connect to stream if trip is in initial planning/searching stage
    setTimeout(() => {
      const trip = useTripStore.getState().currentTrip;
      if (trip && (trip.status === 'planning' || trip.status === 'searching')) {
        connectStream(id);
      }
    }, 500);

    return () => disconnectStream();
  }, [id]);

  // Auto-switch tabs based on flow phase
  useEffect(() => {
    if (awaitingSelection && flightOffers.length > 0) {
      setActiveTab('flights');
    } else if (itinerary) {
      setActiveTab('itinerary');
    }
  }, [awaitingSelection, itinerary, flightOffers.length]);

  if (!currentTrip) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center text-white/50">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500 mb-3" />
        <p>Loading planning workspace...</p>
      </div>
    );
  }

  const selectedFlight = flightOffers.find(o => o.id === selectedFlightId);
  const selectedHotel = hotelOffers.find(o => o.id === selectedHotelId) || hotelOffers[0];

  // Check all segments have hotel selections for confirmation readiness
  const allHotelsSelected = hotelSegments.length > 0 &&
    hotelSegments.every((seg) => selectedHotelOfferIds[seg.segment_order]);
  const canConfirm = !!selectedFlightId && allHotelsSelected;

  const numNights = Math.round((new Date(currentTrip.date_end) - new Date(currentTrip.date_start)) / 86400000);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 h-[calc(100vh-80px)] flex flex-col">
      {/* Workspace Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 pb-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl md:text-2xl font-black font-display leading-tight tracking-tight">
              {currentTrip.origin_city.split(',')[0]} ✈ {currentTrip.destination_city.split(',')[0]}
            </h1>
            <p className="text-xs text-white/40 font-mono mt-0.5">
              Trip ID: {currentTrip.id.slice(0, 8)} | Budget: ₹{currentTrip.budget_inr.toLocaleString()} | {numNights} nights
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* PDF download — only when itinerary is ready */}
          {itinerary && (
            <button
              onClick={() => downloadPdf(id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs font-semibold transition-all border border-white/5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>PDF</span>
            </button>
          )}

          {/* Tab toggles */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/5 overflow-x-auto max-w-full">
            <button
              onClick={() => setActiveTab('flights')}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                activeTab === 'flights' ? 'bg-brand-500 text-white shadow-md' : 'text-white/60 hover:text-white'
              }`}
            >
              <Plane className="w-3.5 h-3.5" />
              <span>Flights</span>
              {selectedFlightId && (
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400 absolute -top-0.5 -right-0.5" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('hotels')}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                activeTab === 'hotels' ? 'bg-brand-500 text-white shadow-md' : 'text-white/60 hover:text-white'
              }`}
            >
              <Hotel className="w-3.5 h-3.5" />
              <span>Hotels</span>
              {allHotelsSelected && (
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400 absolute -top-0.5 -right-0.5" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('itinerary')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                activeTab === 'itinerary' ? 'bg-brand-500 text-white shadow-md' : 'text-white/60 hover:text-white'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Itinerary</span>
            </button>
            <button
              onClick={() => setActiveTab('budget')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                activeTab === 'budget' ? 'bg-brand-500 text-white shadow-md' : 'text-white/60 hover:text-white'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Budget</span>
            </button>
            <button
              onClick={() => setActiveTab('checkout')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                activeTab === 'checkout' ? 'bg-teal-500 text-white shadow-md' : 'text-teal-400 hover:text-teal-300'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Checkout</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Streaming progress bar ── */}
      {isStreaming && (
        <div className="mb-3 p-3 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-brand-400 shrink-0" />
          <p className="text-xs text-brand-300 font-medium truncate">
            {streamLogs[streamLogs.length - 1] || 'Processing your trip...'}
          </p>
        </div>
      )}

      {/* ── Error banner ── */}
      {streamError && (
        <div className="mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-xs text-red-300">{streamError}</p>
        </div>
      )}

      {/* ── Confirm Selections Banner (selection-first flow CTA) ── */}
      {awaitingSelection && !isStreaming && (
        <div className="mb-3 p-4 rounded-2xl bg-gradient-to-r from-brand-500/20 to-teal-500/20 border border-brand-500/30">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-brand-400" />
                Flights & hotels found — pick your preferences!
              </p>
              <p className="text-xs text-white/50 mt-0.5 ml-6">
                Select a flight and a hotel for each night, then confirm to generate your itinerary & budget.
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {/* Progress dots */}
              <div className="flex items-center gap-2 text-xs text-white/50">
                <span className={`flex items-center gap-1 ${selectedFlightId ? 'text-teal-400' : 'text-white/40'}`}>
                  {selectedFlightId ? <CheckCheck className="w-3 h-3" /> : <span className="w-2 h-2 rounded-full border border-current inline-block" />}
                  Flight
                </span>
                <span className="text-white/20">·</span>
                <span className={`flex items-center gap-1 ${allHotelsSelected ? 'text-teal-400' : 'text-white/40'}`}>
                  {allHotelsSelected ? <CheckCheck className="w-3 h-3" /> : <span className="w-2 h-2 rounded-full border border-current inline-block" />}
                  Hotels
                </span>
              </div>

              <button
                onClick={() => canConfirm && confirmSelections(id)}
                disabled={!canConfirm || isConfirmingSelections}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                  canConfirm && !isConfirmingSelections
                    ? 'bg-gradient-to-r from-brand-500 to-teal-500 text-white hover:opacity-90 shadow-lg shadow-brand-500/25'
                    : 'bg-white/10 text-white/30 cursor-not-allowed'
                }`}
              >
                {isConfirmingSelections ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating...</>
                ) : (
                  <><CheckCheck className="w-3.5 h-3.5" /> Confirm & Generate Plan</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Split Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left column: Chat Panel */}
        <div className="lg:col-span-4 h-full flex flex-col min-h-0">
          <ChatPanel tripId={id} />
        </div>

        {/* Right column: Results and planning details */}
        <div className="lg:col-span-8 h-full overflow-y-auto min-h-0 bg-[#0a0a20]/45 rounded-3xl border border-white/5 p-4 md:p-6">

          {/* ── Flights Tab ── */}
          {activeTab === 'flights' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-white/5">
                <div>
                  <h2 className="font-display font-extrabold text-lg text-white">Flight Options</h2>
                  <p className="text-xs text-white/40">Sourced via Duffel sandbox integration — select your preferred flight</p>
                </div>
                {awaitingSelection && !selectedFlightId && (
                  <span className="text-[10px] font-bold text-brand-400 bg-brand-500/10 px-2 py-1 rounded-lg border border-brand-500/20 animate-pulse">
                    Select a flight ↓
                  </span>
                )}
              </div>

              {flightOffers.length > 0 ? (
                <div className="space-y-4">
                  {flightOffers.map((offer) => (
                      <FlightCard
                        key={offer.id}
                        offer={offer}
                        isSelected={selectedFlightId === offer.id}
                        onSelect={(offerId) => selectFlight(id, offerId)}
                      />
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 text-white/30">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-brand-500" />
                  <p className="text-sm font-medium">Searching flight offers...</p>
                </div>
              )}

              {/* Nudge to hotels once flight is picked */}
              {selectedFlightId && awaitingSelection && !allHotelsSelected && (
                <button
                  onClick={() => setActiveTab('hotels')}
                  className="w-full py-2.5 rounded-xl border border-brand-500/30 bg-brand-500/10 text-brand-300 text-xs font-semibold hover:bg-brand-500/20 transition-all"
                >
                  ✓ Flight selected — now pick your hotels →
                </button>
              )}
            </div>
          )}

          {/* ── Hotels Tab ── */}
          {activeTab === 'hotels' && (() => {
            const displayedOffers = hotelOffers.filter((o) => o.segment_order === activeSeg);
            const currentSegSelectedId = selectedHotelOfferIds[activeSeg];

            return (
              <div className="space-y-6">
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <div>
                    <h2 className="font-display font-extrabold text-lg text-white">Hotel Stays</h2>
                    <p className="text-xs text-white/40">Sourced via LiteAPI rate indexing — pick one per night segment</p>
                  </div>
                  {awaitingSelection && !allHotelsSelected && (
                    <span className="text-[10px] font-bold text-teal-400 bg-teal-500/10 px-2 py-1 rounded-lg border border-teal-500/20 animate-pulse">
                      Select hotel ↓
                    </span>
                  )}
                </div>

                {/* Segment pills */}
                {hotelSegments.length > 1 && (
                  <HotelSegmentPicker
                    segments={hotelSegments}
                    activeSegment={activeSeg}
                    onSelectSegment={setActiveSeg}
                    hotelOffers={hotelOffers}
                    selectedHotelOfferIds={selectedHotelOfferIds}
                  />
                )}

                {displayedOffers.length > 0 ? (
                  <div className="space-y-4">
                    {displayedOffers.map((offer) => (
                      <HotelCard
                        key={offer.id}
                        offer={offer}
                        isSelected={currentSegSelectedId === offer.id}
                        onSelect={(offerId) => selectHotelSegment(id, activeSeg, offerId)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-16 text-white/30">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-brand-500" />
                    <p className="text-sm font-medium">Searching hotel offers for Segment #{activeSeg}...</p>
                  </div>
                )}

                {/* Next-segment nudge */}
                {currentSegSelectedId && hotelSegments.length > 1 && activeSeg < hotelSegments.length && (
                  <button
                    onClick={() => setActiveSeg(activeSeg + 1)}
                    className="w-full py-2.5 rounded-xl border border-teal-500/30 bg-teal-500/10 text-teal-300 text-xs font-semibold hover:bg-teal-500/20 transition-all"
                  >
                    ✓ Segment {activeSeg} selected — pick hotel for Segment {activeSeg + 1} →
                  </button>
                )}

                {/* Confirm CTA at bottom of hotels too */}
                {canConfirm && awaitingSelection && (
                  <button
                    onClick={() => confirmSelections(id)}
                    disabled={isConfirmingSelections}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-500 to-teal-500 text-white text-sm font-bold hover:opacity-90 transition-all shadow-lg shadow-brand-500/25 flex items-center justify-center gap-2"
                  >
                    {isConfirmingSelections ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Generating your plan...</>
                    ) : (
                      <><CheckCheck className="w-4 h-4" /> Confirm Selections & Generate Itinerary</>
                    )}
                  </button>
                )}
              </div>
            );
          })()}

          {/* ── Itinerary Tab ── */}
          {activeTab === 'itinerary' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-white/5">
                <div>
                  <h2 className="font-display font-extrabold text-lg text-white">Daily Travel Schedule</h2>
                  <p className="text-xs text-white/40">Grounded in verified destination guides and vector indices</p>
                </div>
              </div>

              {/* ── Trip Summary Banner ── */}
              <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5 space-y-4">
                <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest">Trip Overview</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-[10px] text-white/30 uppercase tracking-wider">Route</p>
                    <p className="text-sm font-bold text-white mt-0.5">
                      {currentTrip.origin_city?.split(',')[0]} → {currentTrip.destination_city?.split(',')[0]}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-white/30 uppercase tracking-wider">Travel Dates</p>
                    <p className="text-sm font-semibold text-white mt-0.5">
                      {new Date(currentTrip.date_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      {' – '}
                      {new Date(currentTrip.date_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-white/30 uppercase tracking-wider">Duration</p>
                    <p className="text-sm font-semibold text-white mt-0.5">{numNights} nights</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-white/30 uppercase tracking-wider">Passengers</p>
                    <p className="text-sm font-semibold text-white mt-0.5">
                      {currentTrip.num_adults} Adult{currentTrip.num_adults !== 1 ? 's' : ''}
                      {currentTrip.num_children > 0 ? `, ${currentTrip.num_children} Child${currentTrip.num_children !== 1 ? 'ren' : ''}` : ''}
                    </p>
                  </div>
                </div>

                {/* Confirmed Flight + Hotel summary */}
                {(selectedFlightId || hotelSegments.length > 0) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-white/5">
                    {selectedFlightId && (() => {
                      const fl = flightOffers.find(o => o.id === selectedFlightId);
                      return fl ? (
                        <div className="bg-white/[0.04] rounded-xl p-3">
                          <p className="text-[10px] text-brand-400 uppercase tracking-wider font-bold">Confirmed Flight</p>
                          <p className="text-sm font-bold text-white mt-1">{fl.airline}</p>
                          <p className="text-xs text-white/50 mt-0.5">
                            {fl.stops === 0 ? 'Non-stop' : `${fl.stops} stop${fl.stops > 1 ? 's' : ''}`}
                            {' · '}
                            {Math.floor((fl.duration_minutes || 0) / 60)}h {(fl.duration_minutes || 0) % 60}m
                          </p>
                          <p className="text-sm font-extrabold text-teal-400 mt-1">
                            ₹{Number(fl.amount_inr || 0).toLocaleString('en-IN')}
                          </p>
                        </div>
                      ) : null;
                    })()}

                    {hotelSegments.length > 1 ? (
                      <div className="bg-white/[0.04] rounded-xl p-3 space-y-2">
                        <p className="text-[10px] text-brand-400 uppercase tracking-wider font-bold">Confirmed Hotels (Split Stay)</p>
                        {hotelSegments.map((seg) => {
                          const segOffer = hotelOffers.find(o => o.id === selectedHotelOfferIds[seg.segment_order]);
                          return (
                            <div key={seg.segment_order} className="text-xs border-b border-white/5 pb-1.5 last:border-0 last:pb-0">
                              <span className="font-mono text-[9px] text-white/40 block">SEGMENT {seg.segment_order} ({seg.nights} nights)</span>
                              <span className="font-semibold text-white truncate block">{segOffer ? segOffer.hotel_name : 'No hotel selected'}</span>
                              {segOffer && (
                                <span className="font-bold text-teal-400 font-mono block">₹{Number(segOffer.total_amount_inr || 0).toLocaleString('en-IN')} total</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      hotelSegments[0] && selectedHotelOfferIds[1] && (() => {
                        const hOffer = hotelOffers.find(o => o.id === selectedHotelOfferIds[1]);
                        return hOffer ? (
                          <div className="bg-white/[0.04] rounded-xl p-3">
                            <p className="text-[10px] text-brand-400 uppercase tracking-wider font-bold">Confirmed Hotel</p>
                            <p className="text-sm font-bold text-white mt-1">{hOffer.hotel_name}</p>
                            <p className="text-xs text-white/50 mt-0.5">
                              {'⭐'.repeat(Math.round(hOffer.star_rating || 0))} · {hOffer.num_nights} nights
                            </p>
                            <p className="text-sm font-extrabold text-teal-400 mt-1">
                              ₹{Number(hOffer.total_amount_inr || 0).toLocaleString('en-IN')} total
                            </p>
                          </div>
                        ) : null;
                      })()
                    )}
                  </div>
                )}

                {/* Budget status */}
                {budgetBreakdown && (
                  <div className="flex items-center justify-between pt-3 border-t border-white/5">
                    <div className="text-xs text-white/50">
                      Total estimated: <span className="font-bold text-white">
                        ₹{Number(budgetBreakdown.combined_inr || 0).toLocaleString('en-IN')}
                      </span>
                      {' '}of ₹{Number(currentTrip.budget_inr || 0).toLocaleString('en-IN')} budget
                    </div>
                    <span className={`text-xs font-bold px-2 py-1 rounded-lg ${
                      budgetBreakdown.budget_satisfied
                        ? 'bg-teal-500/15 text-teal-400'
                        : 'bg-red-500/15 text-red-400'
                    }`}>
                      {budgetBreakdown.budget_satisfied ? '✓ Within budget' : '⚠ Over budget'}
                    </span>
                  </div>
                )}
              </div>

              {/* Day-by-day itinerary */}
              {itinerary ? (
                <ItineraryTimeline itinerary={itinerary} />
              ) : awaitingSelection ? (
                <div className="text-center py-16 text-white/30 space-y-3">
                  <CheckCircle2 className="w-10 h-10 mx-auto text-brand-500/50" />
                  <p className="text-sm font-medium text-white/50">Select your flight & hotels, then confirm to generate the itinerary.</p>
                  <button
                    onClick={() => setActiveTab('flights')}
                    className="text-xs text-brand-400 hover:text-brand-300 underline underline-offset-2"
                  >
                    Go to Flights →
                  </button>
                </div>
              ) : (
                <div className="text-center py-16 text-white/30">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-brand-500" />
                  <p className="text-sm font-medium">Spawning itinerary node...</p>
                  <p className="text-xs mt-1">AI agent is embedding contextual guidelines from pgvector store.</p>
                </div>
              )}
            </div>
          )}

          {/* ── Budget Tab ── */}
          {activeTab === 'budget' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-white/5">
                <div>
                  <h2 className="font-display font-extrabold text-lg text-white">Cost Reconciliation</h2>
                  <p className="text-xs text-white/40">Ensuring all selected elements satisfy budget requirements</p>
                </div>
              </div>

              {budgetBreakdown ? (
                <div className="space-y-4">
                  {/* Stats row */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'Flights', value: budgetBreakdown.flights_inr, color: 'text-brand-400' },
                      { label: 'Hotel', value: budgetBreakdown.hotel_inr, color: 'text-teal-400' },
                      { label: 'Total Trip Cost', value: budgetBreakdown.combined_inr, color: 'text-white' },
                      { label: 'Remaining Budget', value: budgetBreakdown.remaining_for_itinerary_inr, color: budgetBreakdown.budget_satisfied ? 'text-teal-400' : 'text-red-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-white/[0.04] rounded-xl p-3 border border-white/5">
                        <p className="text-[10px] text-white/30 uppercase tracking-wider">{label}</p>
                        <p className={`text-base font-extrabold font-mono mt-1 ${color}`}>
                          ₹{Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Budget vs total */}
                  <div className="bg-white/[0.03] rounded-xl border border-white/5 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-white/50">Budget used</span>
                      <span className={`text-xs font-bold ${budgetBreakdown.budget_satisfied ? 'text-teal-400' : 'text-red-400'}`}>
                        {budgetBreakdown.budget_satisfied ? '✓ Within budget' : '⚠ Over budget'}
                      </span>
                    </div>
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${budgetBreakdown.budget_satisfied ? 'bg-teal-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(100, ((budgetBreakdown.combined_inr || 0) / (currentTrip.budget_inr || 1)) * 100).toFixed(1)}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px] text-white/30">₹0</span>
                      <span className="text-[10px] text-white/30">₹{Number(currentTrip.budget_inr || 0).toLocaleString('en-IN')}</span>
                    </div>
                  </div>

                  {/* Pie chart */}
                  <div className="max-w-md mx-auto">
                    <BudgetChart breakdown={budgetBreakdown} />
                  </div>
                </div>
              ) : (
                <div className="text-center py-16 text-white/30">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-brand-500" />
                  <p className="text-sm font-medium">Budget analysis in progress...</p>
                  <p className="text-xs mt-1">Waiting for flight and hotel selections to be confirmed.</p>
                </div>
              )}
            </div>
          )}

          {/* ── Checkout Tab ── */}
          {activeTab === 'checkout' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-white/5">
                <div>
                  <h2 className="font-display font-extrabold text-lg text-white">Secure checkout</h2>
                  <p className="text-xs text-white/40">Razorpay payment & Duffel/LiteAPI booking dispatch</p>
                </div>
              </div>

              {selectedFlight && selectedHotel ? (
                <BookingConfirmation
                  tripId={id}
                  flightOffer={selectedFlight}
                  hotelOffer={selectedHotel}
                />
              ) : (
                <div className="text-center py-16 text-white/30">
                  <p className="text-sm font-medium">Select a flight and hotel option to unlock payment checkout.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
