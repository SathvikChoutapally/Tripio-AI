import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import Globe from '../components/Globe';
import TripInputForm from '../components/TripInputForm';
import { Compass, Sparkles, Shield, ChevronDown, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';

export default function Landing() {
  const navigate = useNavigate();
  const [originCoords, setOriginCoords] = useState(null);
  const [destinationCoords, setDestinationCoords] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleTripSubmit = async (formData) => {
    setIsSubmitting(true);
    setErrorMsg('');
    try {
      // 1. Post to Express endpoint (creates database trip, starts async python agent plan)
      const { trip } = await api.createTrip(formData);
      
      // 2. Redirect to planning workspace
      navigate(`/planner/${trip.id}`);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to initialize trip planning. Check auth session.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-[92vh] flex flex-col justify-between overflow-hidden">
      {/* Background glow orbs */}
      <div className="glow-orb w-[500px] h-[500px] bg-brand-500/10 -top-40 -left-40" />
      <div className="glow-orb w-[500px] h-[500px] bg-teal-500/5 -bottom-40 -right-40" />

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 md:py-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center flex-1 w-full">
        {/* Left Side: Hero content & Input form */}
        <div className="lg:col-span-5 space-y-6 z-10">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-400 text-xs font-semibold uppercase tracking-wider"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Autonomous agent travel system</span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="space-y-3"
          >
            <h1 className="text-4xl md:text-5xl font-black font-display tracking-tight leading-[1.05] text-balance">
              Plan your entire trip <br />
              <span className="gradient-text">with absolute ease.</span>
            </h1>
            <p className="text-sm text-white/50 leading-relaxed text-balance">
              Tell us where you start, where you're going, your dates, and your budget.
              Our LangGraph agent autonomously books flights, hotels, and customizes your itinerary.
            </p>
          </motion.div>

          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-4 py-3 rounded-xl font-medium"
            >
              ⚠️ {errorMsg}
            </motion.div>
          )}

          {/* Clean Input Form card */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-card p-6 border-white/5 bg-[#0e0e29]/75 shadow-glass"
          >
            <TripInputForm
              onSubmit={handleTripSubmit}
              onSelectOrigin={setOriginCoords}
              onSelectDestination={setDestinationCoords}
            />
          </motion.div>
        </div>

        {/* Right Side: Rotating 3D Globe with arcs */}
        <div className="lg:col-span-7 flex items-center justify-center relative w-full h-full min-h-[350px] lg:min-h-[550px]">
          {isSubmitting && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0a0a1e]/80 backdrop-blur-md rounded-3xl">
              <div className="relative flex h-16 w-16 mb-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-16 w-16 bg-brand-500 flex items-center justify-center">
                  <Compass className="w-8 h-8 text-white animate-spin-slow" />
                </span>
              </div>
              <h3 className="font-display font-extrabold text-lg text-white">Spawning agent network...</h3>
              <p className="text-xs text-white/40 mt-1">Orchestrating Duffel flight requests & LiteAPI hotel parameters</p>
            </div>
          )}

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15 }}
            className="w-full h-full"
          >
            <Globe
              originCoords={originCoords}
              destinationCoords={destinationCoords}
            />
          </motion.div>
        </div>
      </div>

      {/* Feature stats footer */}
      <div className="w-full border-t border-white/5 bg-[#08081a]/50 backdrop-blur-md py-6 px-4 md:px-8 flex flex-col sm:flex-row justify-around items-center gap-6 text-center text-xs text-white/40">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-teal-400" />
          <span>Real flights search & booking via <b>Duffel API</b></span>
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-teal-400" />
          <span>Real hotels search & booking via <b>LiteAPI</b></span>
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-teal-400" />
          <span>INR conversion & payment via <b>Razorpay</b></span>
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-teal-400" />
          <span>Traced workflow observability via <b>LangSmith</b></span>
        </div>
      </div>
    </div>
  );
}
