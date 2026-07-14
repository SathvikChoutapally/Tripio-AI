import React, { useState, useEffect } from 'react';
import { useTripStore } from '../store/tripStore';
import { motion, AnimatePresence } from 'framer-motion';
import { formatINR } from '../lib/currency';
import { Plane, Hotel, Check, CreditCard, ChevronRight, AlertCircle, Loader2, Users, User, Mail, Phone, Calendar, Globe2 } from 'lucide-react';
import { api } from '../lib/api';

export default function BookingConfirmation({ tripId, flightOffer, hotelOffer }) {
  const { checkoutTrip, isProcessingBooking, bookingStatus, streamError, currentTrip, hotelSegments, hotelOffers } = useTripStore();
  const [step, setStep] = useState(1); // 1: Passengers, 2: Flight, 3: Hotel, 4: Review & Pay
  const [passengerDetails, setPassengerDetails] = useState([]);
  const [validationError, setValidationError] = useState('');
  const [isSavingPassengers, setIsSavingPassengers] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const handleDownloadPdf = async () => {
    try {
      setIsDownloadingPdf(true);
      const blob = await api.downloadPdf(tripId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Tripio_Booking_${tripId.slice(0, 8).toUpperCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Could not download booking PDF: ' + err.message);
    } finally {
      setIsDownloadingPdf(false);
    }
  };


  useEffect(() => {
    if (!currentTrip) return;
    
    // Load previously saved passengers or initialize default list
    api.getPassengers(tripId)
      .then((res) => {
        if (res && res.passengers && res.passengers.length > 0) {
          setPassengerDetails(res.passengers);
        } else {
          const list = [];
          const numAdults = currentTrip.num_adults || 1;
          const numChildren = currentTrip.num_children || 0;
          
          for (let i = 0; i < numAdults; i++) {
            list.push({
              title: 'mr',
              first_name: '',
              last_name: '',
              email: '',
              phone: '',
              gender: 'male',
              date_of_birth: '',
              nationality: 'Indian',
              passenger_type: 'adult',
            });
          }
          for (let i = 0; i < numChildren; i++) {
            list.push({
              title: 'mr',
              first_name: '',
              last_name: '',
              email: '',
              phone: '',
              gender: 'male',
              date_of_birth: '',
              nationality: 'Indian',
              passenger_type: 'child',
            });
          }
          setPassengerDetails(list);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch passengers:', err);
      });
  }, [tripId, currentTrip]);

  const handlePassengerChange = (index, field, value) => {
    setPassengerDetails((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const validatePassengerForm = () => {
    for (let i = 0; i < passengerDetails.length; i++) {
      const p = passengerDetails[i];
      if (!p.first_name?.trim()) return `Passenger ${i + 1} first name is required.`;
      if (!p.last_name?.trim()) return `Passenger ${i + 1} last name is required.`;
      if (!p.email?.trim()) return `Passenger ${i + 1} email is required.`;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return `Passenger ${i + 1} email format is invalid.`;
      if (!p.phone?.trim()) return `Passenger ${i + 1} phone number is required.`;
      if (!p.date_of_birth) return `Passenger ${i + 1} date of birth is required.`;
      if (!p.nationality?.trim()) return `Passenger ${i + 1} nationality is required.`;
    }
    return '';
  };

  const handleNext = async () => {
    if (step === 1) {
      const err = validatePassengerForm();
      if (err) {
        setValidationError(err);
        return;
      }
      setValidationError('');
      setIsSavingPassengers(true);
      
      try {
        await api.savePassengers(tripId, passengerDetails);
        setStep(2);
      } catch (err) {
        setValidationError(`Failed to save passenger details: ${err.message}`);
      } finally {
        setIsSavingPassengers(false);
      }
    } else {
      setStep((prev) => Math.min(prev + 1, 4));
    }
  };

  const handleBack = () => setStep((prev) => Math.max(prev - 1, 1));

  const handleCheckout = () => {
    checkoutTrip(
      tripId,
      flightOffer.id,
      hotelOffer.id,
      (successRes) => {
        console.log('Payment checkout successful', successRes);
      },
      (err) => {
        console.error('Payment checkout failed', err);
      }
    );
  };

  const steps = [
    { num: 1, label: 'Passengers' },
    { num: 2, label: 'Flight details' },
    { num: 3, label: 'Hotel details' },
    { num: 4, label: 'Confirm payment' },
  ];

  return (
    <div className="glass-card p-6 border-white/5 max-w-2xl mx-auto overflow-hidden relative">
      {/* Step Indicators */}
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/5">
        {steps.map((s, idx) => (
          <React.Fragment key={s.num}>
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold font-mono text-sm transition-all ${
                bookingStatus === 'fully_confirmed'
                  ? 'step-completed text-white'
                  : step === s.num
                  ? 'step-active'
                  : step > s.num
                  ? 'step-completed'
                  : 'step-pending'
              }`}>
                {step > s.num || bookingStatus === 'fully_confirmed' ? <Check className="w-4 h-4" /> : s.num}
              </div>
              <span className={`text-xs font-semibold hidden sm:inline ${
                step === s.num ? 'text-white' : 'text-white/40'
              }`}>
                {s.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <ChevronRight className="w-4 h-4 text-white/20" />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Main Content Area with slide animations */}
      <div className="min-h-[220px] mb-6">
        <AnimatePresence mode="wait">
          {bookingStatus === 'fully_confirmed' ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center text-center py-6"
            >
              <div className="w-16 h-16 rounded-full bg-teal-500/20 border-4 border-teal-400 flex items-center justify-center text-teal-400 mb-4 animate-bounce">
                <Check className="w-8 h-8 stroke-[3]" />
              </div>
              <h2 className="font-display font-extrabold text-2xl text-white">Booking fully confirmed!</h2>
              <p className="text-sm text-white/60 mt-1 max-w-sm">
                Your flight ticket and hotel reservation have been successfully booked. Confirmation emails and PDF itinerary are on the way!
              </p>
              
              <div className="flex flex-col sm:flex-row gap-3 mt-6 items-center">
                <button
                  onClick={handleDownloadPdf}
                  disabled={isDownloadingPdf}
                  className="px-6 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs shadow-teal transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {isDownloadingPdf ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Generating PDF...</span>
                    </>
                  ) : (
                    <>
                      <span>Download PDF Itinerary</span>
                    </>
                  )}
                </button>
              </div>

              <div className="mt-6 p-3 bg-white/5 border border-white/5 rounded-xl text-xs font-mono text-white/50">
                Booking ID: {tripId.slice(0, 8).toUpperCase()}
              </div>
            </motion.div>
          ) : step === 1 ? (
            // Step 1: Passenger details form
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6 max-h-[50vh] overflow-y-auto pr-2"
            >
              <div className="flex items-center gap-2 text-brand-400 font-bold">
                <Users className="w-5 h-5" />
                <h3 className="font-display text-base">Traveller Passenger Details</h3>
              </div>

              {validationError && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  <span>{validationError}</span>
                </div>
              )}

              {passengerDetails.map((passenger, index) => (
                <div key={index} className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-4">
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-xs font-bold text-white/70 uppercase tracking-wider">
                      Passenger #{index + 1} ({passenger.passenger_type})
                    </span>
                    <span className="text-[10px] bg-brand-500/20 text-brand-400 font-bold px-2 py-0.5 rounded-full">
                      Required
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] text-white/40 block mb-1">Title</label>
                      <select
                        value={passenger.title || 'mr'}
                        onChange={(e) => handlePassengerChange(index, 'title', e.target.value)}
                        className="input-glass text-xs py-2 bg-[#101035] text-white border-white/10"
                      >
                        <option value="mr">Mr</option>
                        <option value="ms">Ms</option>
                        <option value="mrs">Mrs</option>
                        <option value="dr">Dr</option>
                        <option value="prof">Prof</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] text-white/40 block mb-1">First Name</label>
                      <input
                        type="text"
                        placeholder="e.g. John"
                        value={passenger.first_name || ''}
                        onChange={(e) => handlePassengerChange(index, 'first_name', e.target.value)}
                        className="input-glass text-xs py-2"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] text-white/40 block mb-1">Last Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Doe"
                        value={passenger.last_name || ''}
                        onChange={(e) => handlePassengerChange(index, 'last_name', e.target.value)}
                        className="input-glass text-xs py-2"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-white/40 block mb-1">Email Address</label>
                      <input
                        type="email"
                        placeholder="e.g. john@example.com"
                        value={passenger.email || ''}
                        onChange={(e) => handlePassengerChange(index, 'email', e.target.value)}
                        className="input-glass text-xs py-2"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] text-white/40 block mb-1">Phone Number (with Country Code)</label>
                      <input
                        type="tel"
                        placeholder="e.g. +919999999999"
                        value={passenger.phone || ''}
                        onChange={(e) => handlePassengerChange(index, 'phone', e.target.value)}
                        className="input-glass text-xs py-2"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] text-white/40 block mb-1">Gender</label>
                      <select
                        value={passenger.gender || 'male'}
                        onChange={(e) => handlePassengerChange(index, 'gender', e.target.value)}
                        className="input-glass text-xs py-2 bg-[#101035] text-white border-white/10"
                      >
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] text-white/40 block mb-1">Date of Birth</label>
                      <input
                        type="date"
                        max={new Date().toISOString().split('T')[0]}
                        value={passenger.date_of_birth || ''}
                        onChange={(e) => handlePassengerChange(index, 'date_of_birth', e.target.value)}
                        className="input-glass text-xs py-2 block w-full"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] text-white/40 block mb-1">Nationality</label>
                      <input
                        type="text"
                        placeholder="e.g. Indian"
                        value={passenger.nationality || ''}
                        onChange={(e) => handlePassengerChange(index, 'nationality', e.target.value)}
                        className="input-glass text-xs py-2"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          ) : step === 2 ? (
            // Step 2: Flight details
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <div className="flex items-center gap-2 text-brand-400 font-bold">
                <Plane className="w-5 h-5" />
                <h3 className="font-display text-base">Selected Departure & Return Flights</h3>
              </div>
              <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                <p className="text-xs text-white/40 font-mono">AIRLINE</p>
                <p className="text-sm font-bold mt-0.5">{flightOffer.airline}</p>
                <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-white/5">
                  <div>
                    <span className="text-[10px] text-white/30 block uppercase">Outbound Departure</span>
                    <span className="text-xs font-semibold mt-0.5">{new Date(flightOffer.departure_at).toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-white/30 block uppercase">Total flight fare</span>
                    <span className="text-xs font-bold text-teal-400 mt-0.5 block">{formatINR(flightOffer.amount_inr)}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : step === 3 ? (
            // Step 3: Hotel details
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <div className="flex items-center gap-2 text-brand-400 font-bold">
                <Hotel className="w-5 h-5" />
                <h3 className="font-display text-base">Selected Hotel Stay</h3>
              </div>
              {hotelSegments.length > 1 ? (
                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                  {hotelSegments.map((seg) => {
                    const segOffer = hotelOffers.find(o => o.id === seg.hotel_offer_id);
                    return (
                      <div key={seg.segment_order} className="bg-white/5 p-3.5 rounded-xl border border-white/5">
                        <span className="font-mono text-[9px] text-white/40 block">SEGMENT {seg.segment_order} ({seg.nights} nights)</span>
                        <p className="text-sm font-bold mt-0.5">{segOffer ? segOffer.hotel_name : 'No hotel selected'}</p>
                        <div className="grid grid-cols-2 gap-4 mt-2 pt-2 border-t border-white/5">
                          <div>
                            <span className="text-[10px] text-white/30 block uppercase">Room</span>
                            <span className="text-xs font-semibold truncate block">{segOffer ? segOffer.room_type : 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-white/30 block uppercase">Price</span>
                            <span className="text-xs font-bold text-teal-400 block">{segOffer ? formatINR(segOffer.total_amount_inr) : '₹0'}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                  <p className="text-xs text-white/40 font-mono">HOTEL NAME</p>
                  <p className="text-sm font-bold mt-0.5">{hotelOffer.hotel_name}</p>
                  <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-white/5">
                    <div>
                      <span className="text-[10px] text-white/30 block uppercase">Room Selected</span>
                      <span className="text-xs font-semibold mt-0.5 truncate block">{hotelOffer.room_type}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-white/30 block uppercase">Total rate ({hotelOffer.num_nights} nights)</span>
                      <span className="text-xs font-bold text-teal-400 mt-0.5 block">{formatINR(hotelOffer.total_amount_inr)}</span>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          ) : (() => {
            const hotelPriceTotal = hotelSegments.length > 0 
              ? hotelSegments.reduce((sum, seg) => sum + (seg.total_price_inr || 0), 0) 
              : hotelOffer.total_amount_inr;
            const subtotal = flightOffer.amount_inr + hotelPriceTotal;
            const fee = Math.round(subtotal * 0.025);
            const grandTotal = subtotal + fee;

            return (
              // Step 4: Review & Pay
              <motion.div
                key="step4"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="flex items-center gap-2 text-brand-400 font-bold">
                  <CreditCard className="w-5 h-5" />
                  <h3 className="font-display text-base">Review pricing & pay secure</h3>
                </div>
                
                <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-2">
                  <div className="flex justify-between text-xs text-white/60">
                    <span>Flights Ticket ({passengerDetails.length} Passengers)</span>
                    <span className="font-mono">{formatINR(flightOffer.amount_inr)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-white/60">
                    <span>Hotel Stay</span>
                    <span className="font-mono">{formatINR(hotelPriceTotal)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-white/40">
                    <span>Booking convenience fee (2.5%)</span>
                    <span className="font-mono">{formatINR(fee)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold border-t border-white/5 pt-2 text-teal-300">
                    <span>Grand Total</span>
                    <span className="font-mono">{formatINR(grandTotal)}</span>
                  </div>
                </div>

                {bookingStatus === 'booking' && (
                  <div className="bg-teal-500/10 border border-teal-500/20 p-3 rounded-xl flex items-center gap-2 text-teal-300 text-xs">
                    <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                    <span>Processing reservations and generating PDF in background, please wait...</span>
                  </div>
                )}
              </motion.div>
            );
          })()}
        </AnimatePresence>
      </div>

      {/* Navigation Buttons */}
      {bookingStatus !== 'fully_confirmed' && (
        <div className="flex items-center justify-between border-t border-white/5 pt-4">
          <button
            onClick={handleBack}
            disabled={step === 1 || isProcessingBooking || isSavingPassengers}
            className="px-4 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-white/60 hover:text-white transition-all text-xs font-semibold disabled:opacity-40"
          >
            Back
          </button>
          
          {step < 4 ? (
            <button
              onClick={handleNext}
              disabled={isSavingPassengers}
              className="px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-xs shadow-brand transition-all flex items-center gap-1 disabled:opacity-55"
            >
              {isSavingPassengers ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <span>Continue</span>
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleCheckout}
              disabled={isProcessingBooking}
              className="px-6 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 text-white font-bold text-xs shadow-teal transition-all flex items-center gap-2 disabled:opacity-40"
            >
              {isProcessingBooking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Paying...</span>
                </>
              ) : (
                <>
                  <CreditCard className="w-4 h-4" />
                  <span>Secure Pay with Razorpay</span>
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
