import React from 'react';
import { motion, useMotionValue, useTransform, useSpring } from 'framer-motion';
import { formatINR } from '../lib/currency';
import { Star, ShieldAlert, BadgeInfo, Hotel, Landmark } from 'lucide-react';

export default function HotelCard({ offer, isSelected, onSelect }) {
  // ── 3D Hover Tilt Effect via Framer Motion ──────────────────
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [10, -10]), { stiffness: 300, damping: 20 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-10, 10]), { stiffness: 300, damping: 20 });

  function handleMouseMove(event) {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    
    const xc = (event.clientX - rect.left) / rect.width - 0.5;
    const yc = (event.clientY - rect.top) / rect.height - 0.5;
    
    x.set(xc);
    y.set(yc);
  }

  function handleMouseLeave() {
    x.set(0);
    y.set(0);
  }

  // Fallback hotel image
  const hotelImageUrl = offer.image_url || 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=400&q=80';

  return (
    <motion.div
      style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={() => onSelect(offer.id)}
      className={`relative cursor-pointer rounded-2xl overflow-hidden border backdrop-blur-md transition-all duration-300 flex flex-col md:flex-row ${
        isSelected
          ? 'bg-brand-500/15 border-brand-500 shadow-brand'
          : 'bg-glass-mid border-white/5 shadow-card hover:border-white/20 hover:shadow-card-hover'
      }`}
    >
      {/* Hotel Photo */}
      <div className="w-full md:w-48 h-40 md:h-auto relative overflow-hidden flex-shrink-0">
        <img
          src={hotelImageUrl}
          alt={offer.hotel_name}
          className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
        />
        {offer.star_rating > 0 && (
          <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md px-2 py-1 rounded-lg flex items-center gap-1">
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span className="text-xs font-bold font-mono">{offer.star_rating}</span>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 p-5 flex flex-col justify-between" style={{ transform: 'translateZ(15px)' }}>
        <div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="font-display font-bold text-base leading-tight tracking-tight text-white/90">
                {offer.hotel_name}
              </h4>
              <p className="text-xs text-white/40 mt-1 flex items-center gap-1.5">
                <Landmark className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="line-clamp-2">{offer.hotel_address || 'Central location'}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 mt-3">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white/5 border border-white/5 text-white/60">
              {offer.room_type || 'Standard Room'}
            </span>
            {offer.is_refundable ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-teal-500/10 border border-teal-500/20 text-teal-400">
                Fully Refundable
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white/5 text-white/40">
                Non-Refundable
              </span>
            )}
          </div>
        </div>

        {/* Pricing Segment */}
        <div className="flex items-end justify-between mt-5 pt-3 border-t border-white/5">
          {offer.review_score > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold bg-teal-500/20 text-teal-300 border border-teal-500/20 px-2 py-0.5 rounded-md font-mono">
                {offer.review_score}
              </span>
              <span className="text-[10px] text-white/50 font-semibold uppercase tracking-wider">
                {offer.review_score >= 8.5 ? 'Excellent' : 'Very Good'}
              </span>
            </div>
          )}

          <div className="text-right ml-auto">
            <div className="text-white/40 text-[10px] tracking-wider uppercase">
              {offer.num_nights} nights total
            </div>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="font-display font-extrabold text-lg text-teal-400">
                {formatINR(offer.total_amount_inr)}
              </span>
              <span className="text-xs text-white/40">
                ({formatINR(offer.amount_per_night_inr)}/n)
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
