"""
TripioAI — Itinerary Tool Node
RAG + Gemini generation of day-by-day itinerary
"""

import json
import os
import time
import asyncio
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage

from rag.retriever import retrieve_knowledge, format_chunks_as_context
from services.db import db_service
import sse_registry

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash-lite")


async def itinerary_tool_node(state: dict) -> dict:
    """
    Generate a day-by-day itinerary using RAG retrieval + Gemini.
    Has retry logic for 429 rate limits and rich fallback if all retries fail.
    """
    trip_id = state.get("trip_id")
    user_id = state.get("user_id")
    destination_city = state.get("destination_city", "")

    await _emit_sse(state, {
        "type": "node_start",
        "node": "itinerary_tool",
        "message": f"🗺️ Building your {destination_city} itinerary using local knowledge...",
    })

    start_time = time.time()
    await db_service.record_trace(trip_id, user_id, "itinerary_tool", "started")

    try:
        # Calculate trip duration
        from datetime import datetime
        date_start = state.get("date_start", "")
        date_end = state.get("date_end", "")
        start_dt = datetime.strptime(date_start, "%Y-%m-%d")
        end_dt = datetime.strptime(date_end, "%Y-%m-%d")
        num_days = max((end_dt - start_dt).days, 1)

        # Get selected flight details from DB
        trip_row = await db_service.get_trip(trip_id) or {}
        selected_flight_offer_id = trip_row.get("selected_flight_offer_id")
        selected_flight = None
        if selected_flight_offer_id:
            selected_flight = await db_service.get_flight_offer(str(selected_flight_offer_id))

        # Get all segments with their selected hotels from DB
        segments = await db_service.get_hotel_segments(trip_id)
        selected_hotels = []
        for seg in segments:
            hotel_offer_id = seg.get("hotel_offer_id")
            if hotel_offer_id:
                hotel_offer = await db_service.get_hotel_offer(str(hotel_offer_id))
                if hotel_offer:
                    selected_hotels.append({
                        "segment_order": seg.get("segment_order"),
                        "hotel_name": hotel_offer.get("hotel_name"),
                        "checkin_date": seg.get("checkin_date"),
                        "checkout_date": seg.get("checkout_date"),
                    })

        # Calculate actual cost breakdown if we have selections, to update remaining budget
        flight_cost = float(selected_flight.get("amount_inr", 0)) if selected_flight else 0.0
        hotel_cost = sum(float(seg.get("total_price_inr") or 0.0) for seg in segments)
        combined = flight_cost + hotel_cost
        
        budget_inr = state.get("budget_inr", 0)
        remaining_budget = max(budget_inr - combined, budget_inr * 0.15)

        # ── RAG: Retrieve knowledge about destination ─────────
        await _emit_sse(state, {
            "type": "rag_retrieval",
            "message": f"📚 Retrieving local knowledge about {destination_city}...",
        })

        rag_query = (
            f"{num_days} day trip, budget ₹{remaining_budget:,.0f} for activities, "
            f"attractions, food, local transport, culture"
        )

        chunks = []
        try:
            chunks = await retrieve_knowledge(
                destination=destination_city,
                query=rag_query,
                top_k=6,
                threshold=0.4,
            )
        except Exception as rag_err:
            print(f"[ItineraryTool] RAG retrieval failed (non-fatal): {rag_err}")

        context = format_chunks_as_context(chunks) if chunks else ""

        await _emit_sse(state, {
            "type": "rag_complete",
            "chunks_retrieved": len(chunks),
            "message": f"📚 Found {len(chunks)} knowledge chunks for {destination_city}",
        })

        # ── Generate itinerary with retry ──────────────────────
        prompt = _build_itinerary_prompt(state, num_days, remaining_budget, context, selected_flight, selected_hotels)
        itinerary = await _generate_with_retry(prompt, num_days, date_start, destination_city)

        # Save to DB
        await db_service.update_trip(trip_id, {"itinerary": itinerary})

        latency_ms = int((time.time() - start_time) * 1000)

        await _emit_sse(state, {
            "type": "itinerary_complete",
            "data": itinerary,
            "days": len(itinerary),
            "message": f"✅ {num_days}-day itinerary ready! Your complete trip plan is below.",
        })

        await db_service.record_trace(trip_id, user_id, "itinerary_tool", "completed",
                                      output={"days": len(itinerary), "rag_chunks": len(chunks)},
                                      latency_ms=latency_ms)

        return {**state, "itinerary": itinerary}

    except Exception as e:
        latency_ms = int((time.time() - start_time) * 1000)
        print(f"[ItineraryTool] Fatal error: {e}")
        await db_service.record_trace(trip_id, user_id, "itinerary_tool", "failed",
                                      error=str(e), latency_ms=latency_ms)

        # Generate a rich fallback itinerary so the user never sees a blank screen
        date_start = state.get("date_start", "2026-01-01")
        num_days_fb = 5
        fallback = _build_fallback_itinerary(destination_city, date_start, num_days_fb, state)
        await db_service.update_trip(trip_id, {"itinerary": fallback})

        await _emit_sse(state, {
            "type": "itinerary_complete",
            "data": fallback,
            "days": len(fallback),
            "message": f"✅ {num_days_fb}-day itinerary ready (AI-generated template).",
        })

        return {**state, "itinerary": fallback, "error_message": str(e)}


async def _generate_with_retry(prompt: str, num_days: int, date_start: str, destination: str) -> list:
    """Call Gemini with exponential backoff on 429; fall back to template if all retries fail."""
    models_to_try = [
        os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
        "gemini-2.5-flash",
        "gemini-2.0-flash-lite",
        "gemini-2.0-flash",
    ]

    for model_name in models_to_try:
        for attempt in range(3):
            try:
                llm = ChatGoogleGenerativeAI(model=model_name, temperature=0.4)
                response = await llm.ainvoke([HumanMessage(content=prompt)])
                return _parse_itinerary(response.content, num_days, date_start)
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    wait = (attempt + 1) * 15  # 15s, 30s, 45s
                    print(f"[ItineraryTool] Rate limit on {model_name}, waiting {wait}s (attempt {attempt+1}/3)")
                    await asyncio.sleep(wait)
                else:
                    print(f"[ItineraryTool] Non-rate-limit error on {model_name}: {e}")
                    break  # Try next model

    # All models failed — return destination-specific fallback
    return _build_fallback_itinerary(destination, date_start, num_days, {})


def _build_itinerary_prompt(state: dict, num_days: int, remaining_budget: float, context: str, selected_flight: dict = None, selected_hotels: list = None) -> str:
    destination = state.get("destination_city", "")
    origin = state.get("origin_city", "")
    num_adults = state.get("num_adults", 1)
    budget_breakdown = state.get("budget_breakdown", {})
    over_budget = not budget_breakdown.get("budget_satisfied", True)

    flight_info = ""
    if selected_flight:
        flight_info = f"Airline: {selected_flight.get('airline')} (Departure: {selected_flight.get('departure_at')}, Price: ₹{selected_flight.get('amount_inr'):,.0f})"
    else:
        flight_info = "Airline: Not specified"

    hotel_info = ""
    if selected_hotels:
        hotel_info = "Hotel stays for each segment/day:\n" + "\n".join([
            f"  - Segment {h['segment_order']} ({h['checkin_date']} to {h['checkout_date']}): Stay at {h['hotel_name']}"
            for h in selected_hotels
        ])
    else:
        hotel_info = "Hotel stays: Not specified"

    over_budget_note = (
        "\nNote: The flight + hotel cost slightly exceeds the total budget. "
        "Please keep activity costs minimal and suggest free/low-cost attractions."
        if over_budget else ""
    )

    return f"""You are an expert travel planner creating a detailed itinerary for {destination}.
{context}
{over_budget_note}

Trip details:
- Route: {origin} → {destination}
- Travellers: {num_adults} adult(s)
- Dates: {state.get('date_start')} to {state.get('date_end')} ({num_days} days)
- {hotel_info}
- {flight_info}
- Budget for activities/food/transport: ₹{remaining_budget:,.0f} total
- Per-day budget: ~₹{remaining_budget / max(num_days, 1):,.0f}

Create a VERY detailed {num_days}-day itinerary with:
1. Real places, attractions and restaurants specific to {destination}
2. Morning, afternoon and evening activities with specific times
3. Estimated costs in INR for each activity and meal
4. Local transport advice (metro, taxi, walking distances)
5. Cultural tips and insider advice for each day

Respond with ONLY valid JSON in this exact format (no markdown, no backticks):
{{
  "days": [
    {{
      "day": 1,
      "date": "{state.get('date_start')}",
      "theme": "Arrival & City Overview",
      "activities": [
        {{
          "time": "10:00 AM",
          "name": "Activity name",
          "description": "Detailed description of what to do",
          "estimated_cost_inr": 500,
          "tips": "Practical tip"
        }}
      ],
      "meals": [
        {{
          "type": "breakfast",
          "suggestion": "Restaurant name or dish",
          "estimated_cost_inr": 400
        }},
        {{
          "type": "lunch",
          "suggestion": "Restaurant name or dish",
          "estimated_cost_inr": 700
        }},
        {{
          "type": "dinner",
          "suggestion": "Restaurant name or dish",
          "estimated_cost_inr": 1000
        }}
      ],
      "transport_tips": ["Use metro line X", "Walk 10min from hotel"],
      "estimated_cost_inr": 3000,
      "notes": "Day summary"
    }}
  ]
}}"""


def _parse_itinerary(response_text: str, num_days: int, date_start: str) -> list:
    """Parse Gemini JSON response into itinerary list"""
    from datetime import datetime, timedelta
    import re

    start_dt = datetime.strptime(date_start, "%Y-%m-%d")

    # Strip markdown code fences if present
    clean = response_text.strip()
    clean = re.sub(r'^```(?:json)?', '', clean, flags=re.MULTILINE).strip()
    clean = re.sub(r'```$', '', clean, flags=re.MULTILINE).strip()

    # Extract JSON object
    json_match = re.search(r'\{.*\}', clean, re.DOTALL)
    if json_match:
        try:
            data = json.loads(json_match.group())
            days = data.get("days", [])
            if days:
                for i, day in enumerate(days):
                    day["date"] = (start_dt + timedelta(days=i)).strftime("%Y-%m-%d")
                    day["day"] = i + 1
                return days
        except json.JSONDecodeError as e:
            print(f"[ItineraryTool] JSON parse error: {e}")

    # Fallback
    return _build_fallback_itinerary("the destination", date_start, num_days, {})


def _build_fallback_itinerary(destination: str, date_start: str, num_days: int, state: dict) -> list:
    """Rich fallback itinerary used when LLM fails completely."""
    from datetime import datetime, timedelta

    try:
        start_dt = datetime.strptime(date_start, "%Y-%m-%d")
    except Exception:
        start_dt = datetime.today()

    # Destination-specific fallback data
    dest_lower = destination.lower()
    if "madrid" in dest_lower or "spain" in dest_lower:
        themes = ["Arrival & Plaza Mayor", "Prado Museum & Retiro Park", "Royal Palace & Buen Retiro", "Day Trip to Toledo", "Farewell & Shopping"]
        activities_template = [
            [{"time": "2:00 PM", "name": "Plaza Mayor", "description": "Historic main square, tapas bars nearby", "estimated_cost_inr": 0, "tips": "Visit at sunset"}, {"time": "7:00 PM", "name": "Gran Vía walk", "description": "Madrid's main boulevard", "estimated_cost_inr": 0, "tips": "Great for window shopping"}],
            [{"time": "10:00 AM", "name": "Museo del Prado", "description": "World-class art museum with Goya & Velázquez", "estimated_cost_inr": 1200, "tips": "Book online to skip queues"}, {"time": "3:00 PM", "name": "Retiro Park", "description": "Rowing on the lake, rose garden", "estimated_cost_inr": 300, "tips": "Free on Sunday mornings"}],
            [{"time": "10:00 AM", "name": "Royal Palace of Madrid", "description": "Official residence of the Spanish Royal Family", "estimated_cost_inr": 1500, "tips": "Audio guide recommended"}, {"time": "3:00 PM", "name": "Almudena Cathedral", "description": "Stunning neo-Gothic cathedral adjacent to palace", "estimated_cost_inr": 0, "tips": "Free to enter"}],
            [{"time": "9:00 AM", "name": "Day Trip: Toledo", "description": "UNESCO medieval city, El Greco paintings", "estimated_cost_inr": 1800, "tips": "Take ALSA bus from Madrid"}, {"time": "6:00 PM", "name": "Return to Madrid", "description": "Evening at leisure", "estimated_cost_inr": 0, "tips": ""}],
            [{"time": "10:00 AM", "name": "El Rastro Flea Market", "description": "Sunday market with antiques and souvenirs", "estimated_cost_inr": 2000, "tips": "Best visited on Sunday"}, {"time": "2:00 PM", "name": "Malasaña neighbourhood", "description": "Hip district with indie shops and cafes", "estimated_cost_inr": 500, "tips": ""}],
        ]
        meals_template = [
            [{"type": "dinner", "suggestion": "Sobrino de Botín (world's oldest restaurant)", "estimated_cost_inr": 2500}],
            [{"type": "breakfast", "suggestion": "Churros con chocolate at San Ginés", "estimated_cost_inr": 400}, {"type": "lunch", "suggestion": "Mercado de San Miguel tapas", "estimated_cost_inr": 1200}, {"type": "dinner", "suggestion": "Taberna La Daniela (cocido madrileño)", "estimated_cost_inr": 1800}],
            [{"type": "breakfast", "suggestion": "Café de Oriente", "estimated_cost_inr": 600}, {"type": "lunch", "suggestion": "La Barraca (paella)", "estimated_cost_inr": 1500}, {"type": "dinner", "suggestion": "Bar Zara (pintxos)", "estimated_cost_inr": 1200}],
            [{"type": "breakfast", "suggestion": "Hotel breakfast", "estimated_cost_inr": 600}, {"type": "lunch", "suggestion": "Toledo local restaurant", "estimated_cost_inr": 1200}, {"type": "dinner", "suggestion": "Bodega de Santiago, Madrid", "estimated_cost_inr": 1800}],
            [{"type": "breakfast", "suggestion": "Local café", "estimated_cost_inr": 400}, {"type": "lunch", "suggestion": "Lateral (modern Spanish)", "estimated_cost_inr": 1500}, {"type": "dinner", "suggestion": "Airport or farewell dinner", "estimated_cost_inr": 1500}],
        ]
    elif "paris" in dest_lower or "france" in dest_lower:
        themes = ["Arrival & Eiffel Tower", "Louvre & Marais", "Versailles Day Trip", "Montmartre & Sacré-Cœur", "Farewell Paris"]
        activities_template = [[{"time": "3:00 PM", "name": "Eiffel Tower", "description": "Iconic iron lattice tower, city views", "estimated_cost_inr": 2000, "tips": "Book summit ticket online"}]] * 5
        meals_template = [[{"type": "dinner", "suggestion": "Bistrot Paul Bert", "estimated_cost_inr": 3000}]] * 5
    else:
        themes = [f"Day {i+1} in {destination}" for i in range(num_days)]
        activities_template = [[{"time": "10:00 AM", "name": f"Explore {destination}", "description": f"Discover the highlights of {destination}", "estimated_cost_inr": 1000, "tips": "Ask locals for recommendations"}]] * num_days
        meals_template = [[{"type": "breakfast", "suggestion": "Local café", "estimated_cost_inr": 400}, {"type": "lunch", "suggestion": "Local restaurant", "estimated_cost_inr": 800}, {"type": "dinner", "suggestion": "Recommended restaurant", "estimated_cost_inr": 1200}]] * num_days

    transport_tips = ["Use public metro/bus", "Taxi apps (Uber/local) available", "Walk when distances allow"]

    days = []
    for i in range(num_days):
        theme_idx = min(i, len(themes) - 1)
        act_idx = min(i, len(activities_template) - 1)
        meal_idx = min(i, len(meals_template) - 1)

        days.append({
            "day": i + 1,
            "date": (start_dt + timedelta(days=i)).strftime("%Y-%m-%d"),
            "theme": themes[theme_idx],
            "activities": activities_template[act_idx],
            "meals": meals_template[meal_idx],
            "transport_tips": transport_tips,
            "estimated_cost_inr": sum(a.get("estimated_cost_inr", 0) for a in activities_template[act_idx]) +
                                   sum(m.get("estimated_cost_inr", 0) for m in meals_template[meal_idx]),
            "notes": f"Enjoy Day {i+1} in {destination}!",
        })

    return days


async def _emit_sse(state: dict, event: dict):
    trip_id = state.get("trip_id")
    if trip_id:
        await sse_registry.put(trip_id, event)
