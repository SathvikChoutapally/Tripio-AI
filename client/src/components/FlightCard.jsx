import React from 'react';
import { motion, useMotionValue, useTransform, useSpring } from 'framer-motion';
import { formatINR } from '../lib/currency';
import { Plane, ArrowRight, Clock } from 'lucide-react';

export default function FlightCard({ offer, isSelected, onSelect }) {
  // ── 3D Hover Tilt Effect via Framer Motion ──────────────────
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [10, -10]), { stiffness: 300, damping: 20 });
  const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-10, 10]), { stiffness: 300, damping: 20 });

  function handleMouseMove(event) {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    
    // Normalize coordinates from -0.5 to 0.5
    const xc = (event.clientX - rect.left) / rect.width - 0.5;
    const yc = (event.clientY - rect.top) / rect.height - 0.5;
    
    x.set(xc);
    y.set(yc);
  }

  function handleMouseLeave() {
    x.set(0);
    y.set(0);
  }

  // Format date / times
  const depDate = new Date(offer.departure_at);
  const arrDate = new Date(offer.arrival_at);

  const formatTime = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const formatDate = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });

  const durationHours = Math.floor(offer.duration_minutes / 60);
  const durationMins = offer.duration_minutes % 60;

  return (
    <motion.div
      style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={() => onSelect(offer.id)}
      className={`relative cursor-pointer rounded-2xl p-5 border backdrop-blur-md transition-all duration-300 ${
        isSelected
          ? 'bg-brand-500/15 border-brand-500 shadow-brand'
          : 'bg-glass-mid border-white/5 shadow-card hover:border-white/20 hover:shadow-card-hover'
      }`}
    >
      {/* 3D Depth layered background glow */}
      {isSelected && (
        <div className="absolute inset-0 rounded-2xl bg-gradient-brand opacity-5 blur-xl -z-10" />
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4" style={{ transform: 'translateZ(20px)' }}>
        {/* Left segment: Airline / Carrier info */}
        <div className="flex items-center gap-3">
          {offer.airline_logo_url ? (
            <img
              src={offer.airline_logo_url}
              alt={offer.airline}
              className="w-12 h-12 rounded-xl object-contain bg-white/5 p-1 border border-white/10"
              onError={(e) => {
                e.target.style.display = 'none'; // Fallback to icon
              }}
            />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-brand-500/10 flex items-center justify-center border border-brand-500/20">
              <Plane className="w-6 h-6 text-brand-400" />
            </div>
          )}
          <div>
            <h4 className="font-display font-bold text-sm tracking-tight text-white/90">{offer.airline}</h4>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-white/40">
              <Clock className="w-3.5 h-3.5" />
              <span>{durationHours}h {durationMins}m</span>
            </div>
          </div>
        </div>

        {/* Center segment: Timeline & stops */}
        <div className="flex-1 flex items-center justify-center gap-6 px-4">
          <div className="text-center">
            <span className="font-bold font-mono text-base block">{formatTime(depDate)}</span>
            <span className="text-[10px] text-white/40 block mt-0.5">{formatDate(depDate)}</span>
          </div>

          <div className="flex-1 flex flex-col items-center max-w-[120px]">
            <span className="text-[10px] font-semibold text-white/50 tracking-wider">
              {offer.stops === 0 ? 'NON-STOP' : `${offer.stops} STOP${offer.stops > 1 ? 'S' : ''}`}
            </span>
            <div className="relative w-full h-[1px] bg-white/10 my-1 flex items-center justify-center">
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-teal-400" />
              <ArrowRight className="w-3.5 h-3.5 text-brand-400 bg-[#12122c] px-0.5" />
            </div>
            <span className="text-[9px] text-white/30 tracking-widest uppercase">economy</span>
          </div>

          <div className="text-center">
            <span className="font-bold font-mono text-base block">{formatTime(arrDate)}</span>
            <span className="text-[10px] text-white/40 block mt-0.5">{formatDate(arrDate)}</span>
          </div>
        </div>

        {/* Right segment: Price and Selection badge */}
        <div className="text-right flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-4 sm:gap-1 w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-t-0 border-white/5">
          <div>
            <span className="text-white/40 text-[10px] tracking-wider uppercase block">Total Fare</span>
            <span className="font-display font-extrabold text-lg text-teal-400">{formatINR(offer.amount_inr)}</span>
          </div>
          
          <div className={`px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wider uppercase ${
            isSelected
              ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
              : 'bg-white/5 text-white/40 border border-white/5'
          }`}>
            {isSelected ? 'Selected' : 'Select'}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
