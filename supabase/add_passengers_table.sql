-- ============================================================
-- TripioAI — Passengers Table Migration
-- Run this in your Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.passengers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,

  -- Personal details
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'other')),
  date_of_birth DATE NOT NULL,
  nationality TEXT NOT NULL,    -- ISO 3166-1 alpha-2 country code or full name

  -- Passenger type (from trip planning)
  passenger_type TEXT NOT NULL DEFAULT 'adult' CHECK (passenger_type IN ('adult', 'child', 'infant')),

  -- Duffel title (mr/ms/mrs/dr/prof)
  title TEXT DEFAULT 'mr',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_passengers_trip_id ON public.passengers(trip_id);
CREATE INDEX IF NOT EXISTS idx_passengers_booking_id ON public.passengers(booking_id);

-- RLS
ALTER TABLE public.passengers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "passengers_select_own" ON public.passengers
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "passengers_insert_own" ON public.passengers
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "passengers_update_own" ON public.passengers
  FOR UPDATE USING (auth.uid() = user_id);

-- Service role can manage all passenger records (for booking node)
CREATE POLICY "passengers_service_all" ON public.passengers
  FOR ALL USING (TRUE) WITH CHECK (TRUE);
