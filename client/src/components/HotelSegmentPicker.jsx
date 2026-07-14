import React from 'react';
import { Calendar, Hotel, Check, ChevronRight } from 'lucide-react';
import { formatINR } from '../lib/currency';

export default function HotelSegmentPicker({ segments, activeSegment, onSelectSegment, hotelOffers, selectedHotelOfferIds = {} }) {
  if (!segments || segments.length === 0) return null;

  return (
    <div className="space-y-3 mb-6 bg-white/[0.02] border border-white/5 rounded-2xl p-4">
      <div className="flex items-center justify-between pb-2 border-b border-white/5">
        <h3 className="text-xs font-bold text-white/50 uppercase tracking-widest flex items-center gap-1.5">
          <Hotel className="w-3.5 h-3.5" />
          <span>Split Stay Hotel Segments</span>
        </h3>
        <span className="text-[10px] font-mono text-brand-400 bg-brand-500/10 px-2 py-0.5 rounded-full">
          {segments.length} segments
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {segments.map((seg) => {
          const isSelected = activeSegment === seg.segment_order;
          
          // Find currently selected hotel for this segment (prefer optimistic map, fallback to DB record)
          const confirmedOfferId = selectedHotelOfferIds[seg.segment_order] || seg.hotel_offer_id;
          const selectedOffer = hotelOffers.find(o => o.id === confirmedOfferId);
          const hotelName = selectedOffer ? selectedOffer.hotel_name : 'No hotel selected yet';
          const hotelPrice = selectedOffer ? (selectedOffer.total_amount_inr || selectedOffer.total_price_inr) : 0;
          const hasHotelPicked = !!confirmedOfferId;
          
          const checkinFormatted = new Date(seg.checkin_date).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
          });
          const checkoutFormatted = new Date(seg.checkout_date).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
          });

          return (
            <button
              key={seg.segment_order}
              onClick={() => onSelectSegment(seg.segment_order)}
              className={`text-left p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                isSelected
                  ? 'bg-brand-500/10 border-brand-500 shadow-md shadow-brand-500/5'
                  : 'bg-white/[0.02] border-white/5 hover:border-white/10 hover:bg-white/[0.04]'
              }`}
            >
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold bg-white/10 px-1.5 py-0.5 rounded text-white/70">
                    SEGMENT #{seg.segment_order}
                  </span>
                  <span className="text-xs text-white/50 flex items-center gap-1 font-medium">
                    <Calendar className="w-3 h-3" />
                    {checkinFormatted} – {checkoutFormatted}
                  </span>
                  <span className="text-[10px] text-brand-400 font-bold">
                    ({seg.nights} nights)
                  </span>
                </div>
                
                <p className="text-xs font-semibold text-white/90 truncate">
                  {hotelName}
                </p>
                
                {selectedOffer && (
                  <p className="text-[10px] font-bold text-teal-400 font-mono">
                    {formatINR(hotelPrice)} total
                  </p>
                )}
              </div>

              <div className="flex flex-col items-end justify-between self-stretch">
                {hasHotelPicked ? (
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shadow-md ${
                    isSelected ? 'bg-brand-500 shadow-brand-500/20' : 'bg-teal-500 shadow-teal-500/20'
                  } text-white`}>
                    <Check className="w-3 h-3 stroke-[3]" />
                  </span>
                ) : (
                  <span className="text-[10px] text-white/30 flex items-center gap-0.5 font-semibold">
                    Select <ChevronRight className="w-3 h-3" />
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
