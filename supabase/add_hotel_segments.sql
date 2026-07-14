-- ============================================================
-- HOTEL SEGMENTS (split-stay multi-hotel support)
-- ============================================================
-- Run this in the Supabase SQL editor or via psql.

CREATE TABLE IF NOT EXISTS public.hotel_segments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id             UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  segment_order       INTEGER NOT NULL,
  checkin_date        DATE NOT NULL,
  checkout_date       DATE NOT NULL,
  nights              INTEGER GENERATED ALWAYS AS
                        ((checkout_date - checkin_date)) STORED,
  destination_area    TEXT,
  hotel_offer_id      UUID REFERENCES public.hotel_offers(id),
  price_per_night_inr NUMERIC(12, 2),
  total_price_inr     NUMERIC(12, 2),
  liteapi_booking_id  TEXT,
  booking_status      TEXT DEFAULT 'pending'
    CHECK (booking_status IN ('pending', 'searching', 'confirmed', 'failed', 'partial_failure')),
  failure_reason      TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (trip_id, segment_order),
  CHECK (checkout_date > checkin_date)
);

CREATE OR REPLACE FUNCTION update_hotel_segments_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_hotel_segments_updated_at ON public.hotel_segments;
CREATE TRIGGER trg_hotel_segments_updated_at
  BEFORE UPDATE ON public.hotel_segments
  FOR EACH ROW EXECUTE FUNCTION update_hotel_segments_updated_at();

CREATE INDEX IF NOT EXISTS idx_hotel_segments_trip_id ON public.hotel_segments(trip_id);
CREATE INDEX IF NOT EXISTS idx_hotel_segments_order   ON public.hotel_segments(trip_id, segment_order);
CREATE INDEX IF NOT EXISTS idx_hotel_segments_offer   ON public.hotel_segments(hotel_offer_id);

ALTER TABLE public.hotel_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hotel_segments_select_own" ON public.hotel_segments
  FOR SELECT USING (trip_id IN (SELECT id FROM public.trips WHERE user_id = auth.uid()));

CREATE POLICY "hotel_segments_service_all" ON public.hotel_segments
  FOR ALL USING (auth.role() = 'service_role');
