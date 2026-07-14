import React from 'react';
import { motion } from 'framer-motion';
import { formatINR } from '../lib/currency';
import { Calendar, MapPin, Coffee, Compass, CheckCircle2 } from 'lucide-react';

export default function ItineraryTimeline({ itinerary }) {
  if (!itinerary || itinerary.length === 0) return null;

  return (
    <div className="relative py-8 px-4 md:px-8 max-w-4xl mx-auto overflow-hidden">
      {/* 3D Track Perspective Wrap */}
      <div className="absolute left-[29px] md:left-1/2 top-0 bottom-0 w-[3px] bg-gradient-to-b from-brand-500 via-violet-500 to-teal-400 opacity-60 rounded-full" />

      <div className="space-y-12 relative" style={{ perspective: '1200px' }}>
        {itinerary.map((day, index) => {
          const isEven = index % 2 === 0;
          
          return (
            <motion.div
              key={day.day}
              initial={{ opacity: 0, y: 50, rotateX: 15, rotateY: isEven ? -10 : 10 }}
              whileInView={{ opacity: 1, y: 0, rotateX: 0, rotateY: 0 }}
              viewport={{ once: true, margin: '-100px' }}
              transition={{ type: 'spring', stiffness: 80, damping: 15 }}
              className={`flex flex-col md:flex-row items-start gap-8 relative ${
                isEven ? 'md:flex-row-reverse' : ''
              }`}
            >
              {/* Timeline Center Bullet Point */}
              <div className="absolute left-[18px] md:left-1/2 md:-translate-x-1/2 top-1.5 w-6 h-6 rounded-full bg-slate-900 border-4 border-brand-500 flex items-center justify-center shadow-brand z-10">
                <div className="w-1.5 h-1.5 rounded-full bg-teal-400" />
              </div>

              {/* Spacer/Left side for alignment */}
              <div className="hidden md:block w-1/2" />

              {/* Day Card content */}
              <div className="w-full md:w-1/2 glass-card p-6 border-white/5 transition-all duration-300 hover:border-brand-500/30 hover:shadow-brand relative overflow-hidden group">
                {/* Floating neon number */}
                <span className="absolute -top-6 -right-2 text-8xl font-black font-display text-white/5 tracking-tighter pointer-events-none select-none group-hover:text-brand-500/5 transition-colors">
                  0{day.day}
                </span>

                {/* Day Header */}
                <div className="flex items-center gap-3 mb-4 pb-3 border-b border-white/5">
                  <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-extrabold text-lg text-white/90">
                      Day {day.day}: {day.theme}
                    </h3>
                    <p className="text-xs text-white/40 font-mono mt-0.5">{day.date}</p>
                  </div>
                </div>

                {/* Activities list */}
                <div className="space-y-4">
                  {day.activities?.map((act, aIdx) => (
                    <div key={aIdx} className="bg-white/5 p-3.5 rounded-xl border border-white/5 flex items-start gap-3">
                      <Compass className="w-4.5 h-4.5 text-teal-400 mt-1 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-sm text-white/90">{act.name}</span>
                          <span className="text-[10px] font-mono font-semibold bg-teal-500/10 text-teal-300 px-1.5 py-0.5 rounded">
                            {act.time}
                          </span>
                        </div>
                        <p className="text-xs text-white/60 mt-1">{act.description}</p>
                        {act.estimated_cost_inr > 0 && (
                          <span className="text-[10px] font-bold text-white/40 mt-1.5 block">
                            Est. cost: <span className="text-teal-400">{formatINR(act.estimated_cost_inr)}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Meal Suggestions */}
                {day.meals && day.meals.length > 0 && (
                  <div className="mt-4 pt-3.5 border-t border-white/5 space-y-2">
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1">
                      Dining Suggestions
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {day.meals.map((meal, mIdx) => (
                        <div key={mIdx} className="flex items-center gap-2 text-xs text-white/70 bg-white/3 px-3 py-2 rounded-lg border border-white/3">
                          <Coffee className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                          <span title={`${meal.type}: ${meal.suggestion}`}>
                            <span className="font-semibold capitalize text-white/50">{meal.type}:</span> {meal.suggestion}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Transport / Tips */}
                {day.transport_tips && day.transport_tips.length > 0 && (
                  <div className="mt-4 pt-3.5 border-t border-white/5">
                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest block mb-1">
                      Local Transport & Tips
                    </span>
                    <ul className="space-y-1.5">
                      {day.transport_tips.map((tip, tIdx) => (
                        <li key={tIdx} className="text-xs text-white/50 flex items-start gap-1.5">
                          <span className="text-teal-400 mt-0.5">•</span>
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Day Cost Summary Footer */}
                {day.estimated_cost_inr > 0 && (
                  <div className="mt-5 pt-3 border-t border-white/5 flex items-center justify-between text-xs bg-brand-500/5 -mx-6 -mb-6 px-6 py-3">
                    <span className="text-white/40 font-semibold uppercase tracking-wider">Est. Day Spend</span>
                    <span className="font-bold text-teal-300 font-mono">{formatINR(day.estimated_cost_inr)}</span>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
