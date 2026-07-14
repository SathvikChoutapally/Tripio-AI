# TripioAI — AI Multi-Agent Travel Planner

> **A production-grade, full-stack travel planner powered by a LangGraph multi-agent system, Retrieval-Augmented Generation (RAG), real API integrations (Duffel flights, LiteAPI hotels, Razorpay payments), real-time streaming UI, 3D visuals, and LangSmith observability.**

[![Stack](https://img.shields.io/badge/Stack-PERN-blue)](.) [![AI](https://img.shields.io/badge/AI-LangGraph%20%2B%20Gemini-purple)](.) [![Payments](https://img.shields.io/badge/Payments-Razorpay%20INR-green)](.)

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                        TRIPIO AI                               │
│                                                                │
│  ┌─────────────┐    ┌────────────────┐    ┌────────────────┐  │
│  │  React 19   │    │  Node Express  │    │  Python FastAPI│  │
│  │  + Vite     │◄──►│  (API Gateway) │◄──►│  (AI Service)  │  │
│  │  + Three.js │    │  + Razorpay    │    │  + LangGraph   │  │
│  │  + Framer   │    │  + Auth        │    │  + RAG         │  │
│  └─────────────┘    └────────────────┘    └────────────────┘  │
│         │                   │                      │           │
│         └───────────────────┴──────────────────────┘           │
│                             │                                  │
│                    ┌────────▼────────┐                         │
│                    │   Supabase      │                         │
│                    │  PostgreSQL     │                         │
│                    │  + pgvector     │                         │
│                    │  + Auth         │                         │
│                    │  + RLS          │                         │
│                    └─────────────────┘                         │
└────────────────────────────────────────────────────────────────┘

External APIs:
  ├── Duffel API (flights: search → offer → order)
  ├── LiteAPI (hotels: rates → prebook → book)
  ├── Razorpay (payments: order → checkout → webhook)
  ├── LangSmith (tracing, evals, metrics)
  └── ExchangeRate API (live INR FX conversion)
```

## Skills Demonstrated (for Technical Interviews)

| Skill | Implementation |
|-------|---------------|
| **Multi-Agent Orchestration** | LangGraph `StateGraph` with 7 nodes (Orchestrator, Flight, Hotel, Itinerary, Budget, Booking, Conversation), conditional edges for budget loops |
| **RAG with Vector Database** | pgvector + Supabase for knowledge_chunks, Gemini text-embedding-004, cosine similarity retrieval in Itinerary node |
| **Real External API Integration** | Duffel (offer request → order flow), LiteAPI (rates → prebook → book), Razorpay (order → webhook → booking) |
| **Real-Time Streaming UI** | Server-Sent Events from Python → Node → React, token-by-token rendering |
| **LangSmith Observability** | Every graph run traced with trip_id + user_id tags, custom evals (itinerary relevance, budget adherence, hallucination) |
| **3D UI** | react-three-fiber rotating Earth globe with flight arc animations, tilt-on-hover cards, isometric itinerary timeline |
| **Voice I/O** | Web Speech API SpeechRecognition + SpeechSynthesis with canvas waveform visualizer |
| **Security** | Supabase RLS, Razorpay webhook signature verification, Zod input validation, helmet, rate-limiting |
| **Full INR Localization** | Server-side FX conversion, `Intl.NumberFormat('en-IN')` throughout |
| **Idempotency** | Idempotency keys on booking/payment endpoints to prevent double-charging |

---

## Folder Structure

```
TRIPIOAI/
├── client/                          # React 19 + Vite frontend
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Landing.jsx          # Hero + 3D globe + trip input form
│   │   │   ├── TripPlanner.jsx      # Chat panel + results (split layout)
│   │   │   ├── TripResults.jsx      # Flight/hotel cards + itinerary
│   │   │   ├── BookingFlow.jsx      # Multi-step payment confirmation
│   │   │   ├── Admin.jsx            # LangSmith metrics dashboard
│   │   │   └── Auth.jsx             # Supabase Auth UI
│   │   ├── components/
│   │   │   ├── Globe.jsx            # react-three-fiber 3D Earth
│   │   │   ├── ChatPanel.jsx        # SSE streaming chat + voice I/O
│   │   │   ├── FlightCard.jsx       # 3D tilt glassmorphic card
│   │   │   ├── HotelCard.jsx        # 3D tilt glassmorphic card
│   │   │   ├── ItineraryTimeline.jsx# Isometric scroll-linked timeline
│   │   │   ├── BudgetChart.jsx      # Recharts budget breakdown
│   │   │   └── VoiceWaveform.jsx    # Canvas mic waveform
│   │   ├── store/tripStore.js       # Zustand global state
│   │   └── lib/
│   │       ├── supabase.js          # Supabase client
│   │       ├── api.js               # Server API helpers
│   │       └── currency.js          # INR formatter
│   └── ...
│
├── server/                          # Node.js + Express API gateway
│   ├── routes/
│   │   ├── auth.js                  # Supabase Auth proxy
│   │   ├── trips.js                 # Trip CRUD
│   │   ├── chat.js                  # AI service proxy + SSE relay
│   │   ├── bookings.js              # Razorpay + booking trigger
│   │   ├── cities.js                # Autocomplete city search
│   │   └── admin.js                 # LangSmith metrics aggregation
│   ├── middleware/
│   │   ├── auth.js                  # JWT verification
│   │   └── validate.js              # Zod middleware factory
│   ├── services/
│   │   ├── razorpay.js              # Razorpay helpers
│   │   ├── aiProxy.js               # HTTP client to Python service
│   │   └── fx.js                    # Live FX rate fetcher
│   └── index.js                     # Express app entry
│
├── ai-service/                      # Python FastAPI + LangGraph
│   ├── graph/
│   │   ├── graph.py                 # LangGraph StateGraph definition
│   │   ├── state.py                 # TripState Pydantic model
│   │   └── nodes/
│   │       ├── orchestrator.py      # Router node
│   │       ├── budget_node.py       # Budget reconciliation
│   │       ├── conversation_node.py # Free-form chat
│   │       └── booking_node.py      # Post-payment booking
│   ├── tools/
│   │   ├── flight_tool.py           # Duffel wrapper
│   │   ├── hotel_tool.py            # LiteAPI wrapper
│   │   ├── itinerary_tool.py        # RAG + generation
│   │   ├── budget_tool.py           # Cost reconciliation
│   │   └── booking_trigger_tool.py  # Duffel order + LiteAPI book
│   ├── rag/
│   │   ├── retriever.py             # pgvector similarity search
│   │   └── embedder.py              # Gemini embeddings
│   ├── services/
│   │   ├── duffel.py                # Duffel API client
│   │   ├── liteapi.py               # LiteAPI client
│   │   ├── fx.py                    # Currency converter
│   │   └── db.py                    # Supabase DB operations
│   ├── checkpointer.py              # LangGraph Postgres checkpointer
│   └── main.py                      # FastAPI entry
│
├── supabase/
│   ├── schema.sql                   # All tables + pgvector + RLS
│   ├── seed_knowledge.py            # Embed destination guides
│   └── seed_cities.py               # Seed cities from Duffel/LiteAPI
│
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## End-to-End Flow (Interview Walkthrough)

```
1. INPUT
   User fills the trip form: persons=2, dates=Dec 15–22, budget=₹1,50,000,
   origin=Mumbai (BOM), destination=Paris (CDG)

2. AGENT GRAPH STARTS
   Node server receives POST /api/trips → calls Python ai-service POST /agent/plan
   LangGraph creates a new TripState and starts the graph run (traced in LangSmith)

3. ORCHESTRATOR NODE
   Reads state, decides to call Flight Tool + Hotel Tool in parallel

4. FLIGHT TOOL NODE (Duffel)
   Calls Duffel: POST /air/offer_requests with slices BOM→CDG Dec 15–22, 2 adults
   Duffel returns ~20 offers → agent picks top 5 by price/duration/stops
   All prices converted to INR via FX service → stored in flight_offers table

5. HOTEL TOOL NODE (LiteAPI)
   Calls LiteAPI: POST /hotels/rates for Paris, Dec 15–22, 2 adults
   Returns hotel list → agent picks top 5 by rating/price/location
   All prices converted to INR → stored in hotel_offers table

6. BUDGET RECONCILIATION NODE
   Sum: cheapest flight (₹55,000) + mid-range hotel (₹60,000) = ₹1,15,000
   Remaining budget: ₹35,000 for itinerary — passes budget check
   (If over budget: loops back to Flight/Hotel nodes with "cheapest" constraint)

7. RAG RETRIEVAL (in Itinerary Tool Node)
   Embeds query: "Paris 7 days culture food budget ₹35000"
   Retrieves top-5 chunks from knowledge_chunks via pgvector similarity search
   Chunks: Louvre tips, Seine boat tours, local bistro recommendations, etc.

8. ITINERARY GENERATION
   Gemini LLM generates 7-day plan grounded in retrieved chunks
   Output: structured JSON with day/activity/cost/notes fields

9. STREAMING TO UI
   Every node's output streams via SSE: Python → Node → React
   Chat panel shows: "🔍 Searching flights...", "🏨 Finding hotels...",
   "🗺️ Building your itinerary..." as each step completes

10. HUMAN-IN-THE-LOOP CONFIRMATION
    Agent presents flight + hotel + itinerary summary in chat
    "Ready to book? Reply 'yes' or adjust any details"
    User replies in chat: "yes, let's go!"

11. RAZORPAY PAYMENT
    Node server creates Razorpay Order for ₹1,15,000 (flights + hotel)
    Razorpay Checkout opens in browser
    User pays → Razorpay sends webhook to server
    Server verifies signature → marks payment as confirmed

12. BOOKING TRIGGER
    Server calls ai-service POST /agent/book
    Booking node calls Duffel POST /air/orders (creates actual flight order)
    Then calls LiteAPI POST /rates/book (creates hotel booking)
    Both booking IDs stored in bookings table
    Graceful rollback + refund if one leg fails

13. CONFIRMATION
    Booking confirmation page with animated 3D checkmark
    All details in ₹ INR, downloadable itinerary PDF
    LangSmith trace shows full reasoning path, token costs, eval scores
```

---

## Setup & Running

### Prerequisites
- Node.js 20+, Python 3.11+, Docker (optional)
- Supabase project with pgvector enabled
- API keys: Duffel, LiteAPI, Razorpay, Google AI Studio, LangSmith, ExchangeRate API

### 1. Clone & Configure

```bash
git clone <repo-url> tripioai
cd tripioai

# Copy env files
cp .env.example server/.env
cp .env.example ai-service/.env
cp .env.example client/.env
# Fill in your actual API keys in each .env
```

### 2. Database Setup

```bash
# Run schema in your Supabase SQL editor
# supabase/schema.sql

# Seed cities (Duffel + LiteAPI)
cd supabase
pip install -r requirements.txt
python seed_cities.py

# Seed knowledge base (destination guides → pgvector)
python seed_knowledge.py
```

### 3. AI Service (Python)

```bash
cd ai-service
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Server (Node.js)

```bash
cd server
npm install
npm run dev
# Runs on http://localhost:3001
```

### 5. Client (React)

```bash
cd client
npm install
npm run dev
# Runs on http://localhost:5173
```

### 6. Docker (All Services)

```bash
docker-compose up --build
# Client: http://localhost:5173
# Server: http://localhost:3001
# AI Service: http://localhost:8000/docs
```

---

## Key Technical Choices

- **No TypeScript** — plain JS/JSX on frontend + backend, Pydantic on Python for strict typing
- **INR-native** — all prices converted server-side before hitting frontend
- **Payment security** — Razorpay webhook signature verification before any booking
- **pgvector over Pinecone** — keeps stack simpler, real vector search capability
- **LangGraph over LangChain** — proper state machine vs chain, supports loops, checkpointing
- **SSE over WebSocket** — simpler for unidirectional agent output streaming
