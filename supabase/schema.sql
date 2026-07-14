-- ============================================================
-- TripioAI — Supabase PostgreSQL Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================
-- USERS (mirrors Supabase auth.users — extended profile)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  preferences JSONB DEFAULT '{}',  -- e.g. { "preferBudget": true, "preferCity": true }
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- CITIES CACHE (seeded from Duffel + LiteAPI)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cities_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  city_name TEXT NOT NULL,
  country TEXT NOT NULL,
  country_code CHAR(2),
  iata_code CHAR(3),                    -- Airport/city IATA code for Duffel
  liteapi_city_id TEXT,                 -- LiteAPI city identifier
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  region TEXT,                          -- 'Asia', 'Europe', 'Americas', etc.
  is_major BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(iata_code)
);

CREATE INDEX IF NOT EXISTS idx_cities_name ON public.cities_cache
  USING gin(to_tsvector('english', city_name || ' ' || country));
CREATE INDEX IF NOT EXISTS idx_cities_iata ON public.cities_cache(iata_code);

-- ============================================================
-- TRIPS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.trips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  
  -- Core inputs
  num_adults INTEGER NOT NULL DEFAULT 1,
  num_children INTEGER NOT NULL DEFAULT 0,
  date_start DATE NOT NULL,
  date_end DATE NOT NULL,
  budget_inr NUMERIC(12, 2) NOT NULL,         -- User's budget in INR
  
  -- Origin & destination
  origin_city TEXT NOT NULL,
  origin_iata CHAR(3),
  origin_liteapi_id TEXT,
  destination_city TEXT NOT NULL,
  destination_iata CHAR(3),
  destination_liteapi_id TEXT,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'searching', 'awaiting_selection', 'pending_confirmation',
                      'pending_payment', 'booking', 'confirmed', 'failed', 'cancelled')),
  
  -- Selected offers (set after user confirmation)
  selected_flight_offer_id UUID,
  selected_hotel_offer_id UUID,
  
  -- Generated content
  itinerary JSONB,                    -- day-by-day plan
  budget_breakdown JSONB,             -- { flights: X, hotel: Y, itinerary: Z, total: W }
  
  -- LangGraph session
  langgraph_thread_id TEXT,           -- for checkpointer resumption
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trips_user_id ON public.trips(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_status ON public.trips(status);

-- ============================================================
-- CHAT MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',        -- { tool_name, node_name, is_streaming, etc. }
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_trip_id ON public.chat_messages(trip_id);
CREATE INDEX IF NOT EXISTS idx_chat_created_at ON public.chat_messages(trip_id, created_at);

-- ============================================================
-- AGENT TRACES (LangSmith integration)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agent_traces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  langsmith_run_id TEXT,
  node_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  input_payload JSONB,
  output_payload JSONB,
  latency_ms INTEGER,
  token_input INTEGER,
  token_output INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_traces_trip_id ON public.agent_traces(trip_id);
CREATE INDEX IF NOT EXISTS idx_traces_node_name ON public.agent_traces(node_name);
CREATE INDEX IF NOT EXISTS idx_traces_status ON public.agent_traces(status);

-- ============================================================
-- FLIGHT OFFERS (from Duffel)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.flight_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  
  -- Duffel identifiers
  duffel_offer_request_id TEXT NOT NULL,
  duffel_offer_id TEXT NOT NULL UNIQUE,
  
  -- Key fields (normalized)
  airline TEXT,
  airline_logo_url TEXT,
  departure_at TIMESTAMPTZ,
  arrival_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  stops INTEGER DEFAULT 0,
  
  -- Pricing (both original and INR)
  amount_original NUMERIC(12, 2),
  currency_original CHAR(3),
  amount_inr NUMERIC(12, 2) NOT NULL,
  fx_rate_used NUMERIC(12, 6),
  
  -- Full Duffel response
  raw_payload JSONB,
  
  -- Ranking
  rank INTEGER,
  is_selected BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flight_offers_trip_id ON public.flight_offers(trip_id);
CREATE INDEX IF NOT EXISTS idx_flight_offers_amount_inr ON public.flight_offers(amount_inr);

-- ============================================================
-- HOTEL OFFERS (from LiteAPI)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hotel_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  
  -- LiteAPI identifiers
  liteapi_hotel_id TEXT NOT NULL,
  liteapi_rate_id TEXT NOT NULL UNIQUE,
  
  -- Key fields (normalized)
  hotel_name TEXT,
  hotel_address TEXT,
  star_rating NUMERIC(2, 1),
  review_score NUMERIC(3, 1),
  image_url TEXT,
  room_type TEXT,
  is_refundable BOOLEAN DEFAULT FALSE,
  
  -- Pricing (both original and INR)
  amount_per_night_original NUMERIC(12, 2),
  currency_original CHAR(3),
  amount_per_night_inr NUMERIC(12, 2) NOT NULL,
  total_amount_inr NUMERIC(12, 2) NOT NULL,
  fx_rate_used NUMERIC(12, 6),
  num_nights INTEGER,
  
  -- Full LiteAPI response
  raw_payload JSONB,
  
  -- Ranking
  rank INTEGER,
  is_selected BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotel_offers_trip_id ON public.hotel_offers(trip_id);
CREATE INDEX IF NOT EXISTS idx_hotel_offers_amount_inr ON public.hotel_offers(amount_per_night_inr);

-- ============================================================
-- BOOKINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  
  -- Razorpay
  razorpay_order_id TEXT UNIQUE,
  razorpay_payment_id TEXT,
  razorpay_signature TEXT,
  payment_status TEXT DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  
  -- Total in INR
  amount_inr NUMERIC(12, 2) NOT NULL,
  
  -- Duffel booking
  duffel_order_id TEXT,
  duffel_booking_status TEXT,
  
  -- LiteAPI booking
  liteapi_booking_id TEXT,
  liteapi_booking_status TEXT,
  
  -- Overall status
  booking_status TEXT DEFAULT 'pending'
    CHECK (booking_status IN ('pending', 'flight_booked', 'hotel_booked',
                               'fully_confirmed', 'partial_failure', 'failed', 'refunded')),
  
  -- Idempotency
  idempotency_key TEXT UNIQUE,
  
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_trip_id ON public.bookings(trip_id);
CREATE INDEX IF NOT EXISTS idx_bookings_razorpay ON public.bookings(razorpay_order_id);

-- ============================================================
-- KNOWLEDGE CHUNKS (RAG vector store)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  destination TEXT NOT NULL,            -- e.g. "Paris", "Tokyo"
  country TEXT,
  topic TEXT NOT NULL,                  -- e.g. "attractions", "food", "visa", "transport"
  content TEXT NOT NULL,               -- ~500-token passage
  source_url TEXT,
  embedding vector(768),               -- Gemini text-embedding-004 produces 768-dim
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- IVFFlat index for ANN similarity search (use HNSW for better recall)
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON public.knowledge_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_knowledge_destination ON public.knowledge_chunks(destination);
CREATE INDEX IF NOT EXISTS idx_knowledge_topic ON public.knowledge_chunks(topic);

-- Similarity search function
CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  query_embedding vector(768),
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5,
  filter_destination TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  destination TEXT,
  topic TEXT,
  content TEXT,
  source_url TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    kc.id,
    kc.destination,
    kc.topic,
    kc.content,
    kc.source_url,
    kc.metadata,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE
    (filter_destination IS NULL OR kc.destination ILIKE filter_destination)
    AND 1 - (kc.embedding <=> query_embedding) > match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ============================================================
-- TIMESTAMPS auto-update trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trips_updated_at BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flight_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities_cache ENABLE ROW LEVEL SECURITY;

-- Users: can only see/update their own profile
CREATE POLICY "users_select_own" ON public.users
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- Trips: full CRUD on own trips
CREATE POLICY "trips_select_own" ON public.trips
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "trips_insert_own" ON public.trips
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "trips_update_own" ON public.trips
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "trips_delete_own" ON public.trips
  FOR DELETE USING (auth.uid() = user_id);

-- Chat messages: read/write own trip's messages
CREATE POLICY "chat_select_own" ON public.chat_messages
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "chat_insert_own" ON public.chat_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Agent traces: read own trip traces
CREATE POLICY "traces_select_own" ON public.agent_traces
  FOR SELECT USING (auth.uid() = user_id);
-- Service role can insert traces
CREATE POLICY "traces_insert_service" ON public.agent_traces
  FOR INSERT WITH CHECK (TRUE); -- AI service uses service role key

-- Flight offers: read own trip's offers
CREATE POLICY "flight_offers_select_own" ON public.flight_offers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.trips WHERE trips.id = flight_offers.trip_id AND trips.user_id = auth.uid())
  );
CREATE POLICY "flight_offers_insert_service" ON public.flight_offers
  FOR INSERT WITH CHECK (TRUE);

-- Hotel offers: read own trip's offers
CREATE POLICY "hotel_offers_select_own" ON public.hotel_offers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.trips WHERE trips.id = hotel_offers.trip_id AND trips.user_id = auth.uid())
  );
CREATE POLICY "hotel_offers_insert_service" ON public.hotel_offers
  FOR INSERT WITH CHECK (TRUE);

-- Bookings: read/update own bookings
CREATE POLICY "bookings_select_own" ON public.bookings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "bookings_insert_own" ON public.bookings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "bookings_update_service" ON public.bookings
  FOR UPDATE USING (TRUE); -- server uses service role

-- Knowledge chunks: public read (no user restriction)
CREATE POLICY "knowledge_chunks_select_all" ON public.knowledge_chunks
  FOR SELECT USING (TRUE);
CREATE POLICY "knowledge_chunks_insert_service" ON public.knowledge_chunks
  FOR INSERT WITH CHECK (TRUE);

-- Cities cache: public read
CREATE POLICY "cities_select_all" ON public.cities_cache
  FOR SELECT USING (TRUE);
CREATE POLICY "cities_insert_service" ON public.cities_cache
  FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "cities_update_service" ON public.cities_cache
  FOR UPDATE USING (TRUE);
