import React, { useState, useEffect, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '../lib/api';
import { PlaneTakeoff, PlaneLanding, Users, Calendar, IndianRupee, MapPin } from 'lucide-react';

// Form validation schema via Zod
const tripSchema = z.object({
  origin: z.object({
    city_name: z.string(),
    iata_code: z.string().length(3),
    latitude: z.number(),
    longitude: z.number(),
    liteapi_city_id: z.string().nullable().optional(),
  }, { required_error: 'Origin city is required' }),
  destination: z.object({
    city_name: z.string(),
    iata_code: z.string().length(3),
    latitude: z.number(),
    longitude: z.number(),
    liteapi_city_id: z.string().nullable().optional(),
  }, { required_error: 'Destination city is required' }),
  date_start: z.string().min(1, 'Departure date is required'),
  date_end: z.string().min(1, 'Return date is required'),
  budget: z.number().min(10000, 'Budget must be at least ₹10,000'),
  adults: z.number().int().min(1, 'At least 1 adult required').max(20),
  children: z.number().int().min(0).max(10).default(0),
});

export default function TripInputForm({ onSubmit, onSelectOrigin, onSelectDestination }) {
  const [showChildInput, setShowChildInput] = useState(false);
  
  // Autocomplete state
  const [originSearch, setOriginSearch] = useState('');
  const [originResults, setOriginResults] = useState([]);
  const [showOriginDropdown, setShowOriginDropdown] = useState(false);
  const originRef = useRef(null);

  const [destSearch, setDestSearch] = useState('');
  const [destResults, setDestResults] = useState([]);
  const [showDestDropdown, setShowDestDropdown] = useState(false);
  const destRef = useRef(null);

  const { register, handleSubmit, control, setValue, watch, formState: { errors } } = useForm({
    resolver: zodResolver(tripSchema),
    defaultValues: {
      date_start: '',
      date_end: '',
      budget: 150000,
      adults: 1,
      children: 0,
    }
  });

  // Watch start/end date for validation
  const dateStart = watch('date_start');
  const dateEnd = watch('date_end');

  // Handle autocomplete click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (originRef.current && !originRef.current.contains(event.target)) {
        setShowOriginDropdown(false);
      }
      if (destRef.current && !destRef.current.contains(event.target)) {
        setShowDestDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch Origin Autocomplete results
  useEffect(() => {
    if (originSearch.length < 2) {
      setOriginResults([]);
      return;
    }
    const delayDebounce = setTimeout(async () => {
      try {
        const { cities } = await api.searchCities(originSearch);
        console.log(cities); //edited
        setOriginResults(cities);
      } catch (err) {
        console.error(err);
      }
    }, 200);

    return () => clearTimeout(delayDebounce);
  }, [originSearch]);

  // Fetch Destination Autocomplete results
  useEffect(() => {
    if (destSearch.length < 2) {
      setDestResults([]);
      return;
    }
    const delayDebounce = setTimeout(async () => {
      try {
        const { cities } = await api.searchCities(destSearch);
        console.log(cities); //edited
        setDestResults(cities);
      } catch (err) {
        console.error(err);
      }
    }, 200);

    return () => clearTimeout(delayDebounce);
  }, [destSearch]);

  const handleFormSubmit = (data) => {
    onSubmit({
      num_adults: data.adults,
      num_children: data.children,
      date_start: data.date_start,
      date_end: data.date_end,
      budget_inr: data.budget,
      origin_city: data.origin.city_name,
      origin_iata: data.origin.iata_code,
      destination_city: data.destination.city_name,
      destination_iata: data.destination.iata_code,
      origin_liteapi_id: data.origin.liteapi_city_id ?? undefined,
      destination_liteapi_id: data.destination.liteapi_city_id ?? undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">
      {/* Origin (Airport Autocomplete) */}
      <div className="relative" ref={originRef}>
        <label className="text-xs font-semibold text-white/50 uppercase tracking-wider block mb-1">
          Departure Location
        </label>
        <div className="relative">
          <PlaneTakeoff className="absolute left-4 top-3.5 w-5 h-5 text-white/40" />
          <input
            type="text"
            placeholder="Search city or airport code (e.g. Mumbai)"
            value={originSearch}
            onChange={(e) => {
              setOriginSearch(e.target.value);
              setShowOriginDropdown(true);
            }}
            onFocus={() => setShowOriginDropdown(true)}
            className={`input-glass pl-12 pr-4 ${errors.origin ? 'border-red-500/50 focus:border-red-500' : ''}`}
          />
        </div>
        {errors.origin && <p className="text-red-400 text-xs mt-1">{errors.origin.message}</p>}

        {showOriginDropdown && originResults.length > 0 && (
          <ul className="absolute z-10 w-full mt-1 bg-[#101035] border border-white/10 rounded-xl overflow-hidden shadow-2xl max-h-60 overflow-y-auto">
            {originResults.map((city) => (
              <li
                key={city.iata_code}
                onClick={() => {
                  setValue('origin', city, {
                    shouldValidate: true,
                    shouldDirty: true,
                    shouldTouch: true,
                  });
                  setOriginSearch(`${city.city_name} (${city.iata_code})`);
                  setShowOriginDropdown(false);
                  if (onSelectOrigin) onSelectOrigin({ lat: city.latitude, lon: city.longitude });
                }}
                className="px-4 py-3 hover:bg-brand-500/10 cursor-pointer flex items-center justify-between border-b border-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-brand-400" />
                  <div>
                    <span className="font-medium text-sm">{city.city_name}</span>
                    <span className="text-xs text-white/40 block">{city.country}</span>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold bg-white/5 px-2 py-1 rounded text-teal-400">
                  {city.iata_code}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Destination (Airport Autocomplete) */}
      <div className="relative" ref={destRef}>
        <label className="text-xs font-semibold text-white/50 uppercase tracking-wider block mb-1">
          Where to?
        </label>
        <div className="relative">
          <PlaneLanding className="absolute left-4 top-3.5 w-5 h-5 text-white/40" />
          <input
            type="text"
            placeholder="Search destination (e.g. Paris)"
            value={destSearch}
            onChange={(e) => {
              setDestSearch(e.target.value);
              setShowDestDropdown(true);
            }}
            onFocus={() => setShowDestDropdown(true)}
            className={`input-glass pl-12 pr-4 ${errors.destination ? 'border-red-500/50 focus:border-red-500' : ''}`}
          />
        </div>
        {errors.destination && <p className="text-red-400 text-xs mt-1">{errors.destination.message}</p>}

        {showDestDropdown && destResults.length > 0 && (
          <ul className="absolute z-10 w-full mt-1 bg-[#101035] border border-white/10 rounded-xl overflow-hidden shadow-2xl max-h-60 overflow-y-auto">
            {destResults.map((city) => (
              <li
                key={city.iata_code}
                onClick={() => {
                  setValue('destination', city, {
                    shouldValidate: true,
                    shouldDirty: true,
                    shouldTouch: true,
                  });
                  setDestSearch(`${city.city_name} (${city.iata_code})`);
                  setShowDestDropdown(false);
                  if (onSelectDestination) onSelectDestination({ lat: city.latitude, lon: city.longitude });
                }}
                className="px-4 py-3 hover:bg-brand-500/10 cursor-pointer flex items-center justify-between border-b border-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-teal-400" />
                  <div>
                    <span className="font-medium text-sm">{city.city_name}</span>
                    <span className="text-xs text-white/40 block">{city.country}</span>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold bg-white/5 px-2 py-1 rounded text-brand-400">
                  {city.iata_code}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Date Range (Start, End) */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-semibold text-white/50 uppercase tracking-wider block mb-1">
            Start Date
          </label>
          <div className="relative">
            <Calendar className="absolute left-4 top-3.5 w-5 h-5 text-white/40 pointer-events-none" />
            <input
              type="date"
              min={new Date().toISOString().split('T')[0]}
              {...register('date_start')}
              className={`input-glass pl-12 pr-4 ${errors.date_start ? 'border-red-500/50 focus:border-red-500' : ''}`}
            />
          </div>
          {errors.date_start && <p className="text-red-400 text-xs mt-1">{errors.date_start.message}</p>}
        </div>

        <div>
          <label className="text-xs font-semibold text-white/50 uppercase tracking-wider block mb-1">
            End Date
          </label>
          <div className="relative">
            <Calendar className="absolute left-4 top-3.5 w-5 h-5 text-white/40 pointer-events-none" />
            <input
              type="date"
              min={dateStart || new Date().toISOString().split('T')[0]}
              {...register('date_end')}
              className={`input-glass pl-12 pr-4 ${errors.date_end ? 'border-red-500/50 focus:border-red-500' : ''}`}
            />
          </div>
          {errors.date_end && <p className="text-red-400 text-xs mt-1">{errors.date_end.message}</p>}
        </div>
      </div>

      {/* Budget (INR) */}
      <div>
        <label className="text-xs font-semibold text-white/50 uppercase tracking-wider block mb-1">
          Total Trip Budget (INR)
        </label>
        <div className="relative">
          <IndianRupee className="absolute left-4 top-3.5 w-5 h-5 text-white/40 pointer-events-none" />
          <input
            type="number"
            placeholder="e.g. 150000"
            {...register('budget', { valueAsNumber: true })}
            className={`input-glass pl-12 pr-4 ${errors.budget ? 'border-red-500/50 focus:border-red-500' : ''}`}
          />
        </div>
        {errors.budget && <p className="text-red-400 text-xs mt-1">{errors.budget.message}</p>}
      </div>

      {/* Passengers count */}
      <div className="bg-white/5 p-4 rounded-xl border border-white/5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-brand-400" />
            <span className="text-sm font-semibold">Travellers</span>
          </div>
          <button
            type="button"
            onClick={() => setShowChildInput(!showChildInput)}
            className="text-xs font-semibold text-teal-400 hover:text-teal-300 transition-colors"
          >
            {showChildInput ? '- Remove Children' : '+ Add Children'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-white/50 block mb-1">Adults (12+ yrs)</label>
            <input
              type="number"
              min={1}
              max={20}
              {...register('adults', { valueAsNumber: true })}
              className="input-glass"
            />
            {errors.adults && <p className="text-red-400 text-xs mt-1">{errors.adults.message}</p>}
          </div>

          {showChildInput && (
            <div>
              <label className="text-xs text-white/50 block mb-1">Children (2-11 yrs)</label>
              <input
                type="number"
                min={0}
                max={10}
                {...register('children', { valueAsNumber: true })}
                className="input-glass"
              />
              {errors.children && <p className="text-red-400 text-xs mt-1">{errors.children.message}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        className="w-full btn-brand py-4 rounded-xl font-bold font-display uppercase tracking-wider text-base shadow-brand flex items-center justify-center gap-2 transition-transform duration-300 active:scale-95"
      >
        <span>Plan My Perfect Trip</span>
        <PlaneTakeoff className="w-5 h-5" />
      </button>
    </form>
  );
}
