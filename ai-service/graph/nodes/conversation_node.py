"""
TripioAI — Conversation Node
Handles free-form chat turns — presents results, answers questions,
or explains why certain options were chosen.
"""

import asyncio
import json
import os
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

from llm_helper import get_llm, stream_with_retry
from services.db import db_service
import sse_registry


async def conversation_node(state: dict) -> dict:
    """Generate a conversational response based on current state"""
    trip_id = state.get("trip_id")
    user_id = state.get("user_id")
    status = state.get("status")
    
    await _emit_sse(state, {
        "type": "node_start",
        "node": "conversation",
        "message": "💬 Composing response...",
    })
    
    await db_service.record_trace(trip_id, user_id, "conversation", "started")
    
    try:
        # ── Fetch fresh context from DB to guarantee absolute consistency ──
        trip = await db_service.get_trip(trip_id) or {}
        
        # Load flight offers
        flight_res = db_service.client.table("flight_offers").select("*").eq("trip_id", trip_id).order("rank").execute()
        flight_offers = flight_res.data or []
        
        # Load hotel offers
        hotel_res = db_service.client.table("hotel_offers").select("*").eq("trip_id", trip_id).order("rank").execute()
        hotel_offers = hotel_res.data or []
        
        # Load passengers
        pass_res = db_service.client.table("passengers").select("*").eq("trip_id", trip_id).execute()
        passengers = pass_res.data or []
        
        # Load full chat history
        chat_res = db_service.client.table("chat_messages").select("role", "content").eq("trip_id", trip_id).order("created_at").execute()
        db_messages = chat_res.data or []
        
        # Build system context
        system_prompt = _build_system_prompt(trip, flight_offers, hotel_offers, passengers, state)
        
        # Build message history for LLM
        lc_messages = [SystemMessage(content=system_prompt)]
        
        # Filter and load last 15 messages for context
        for msg in db_messages[-15:]:
            role = msg.get("role")
            content = msg.get("content")
            if role == "user":
                lc_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                lc_messages.append(AIMessage(content=content))
        
        # If it's a planning response (meaning no user messages existed yet, or graph just generated new plan),
        # force the model to present the trip summary.
        if not db_messages or status in ("planning", "searching"):
            lc_messages.append(HumanMessage(content="Please present the trip plan summary to the user."))
            
        # ── Stream via Groq (primary) → fallback handled inside helper ──
        full_response = ""
        await _emit_sse(state, {"type": "stream_start", "node": "conversation"})

        async def on_token(tok: str):
            nonlocal full_response
            full_response += tok
            await _emit_sse(state, {"type": "stream_token", "token": tok, "node": "conversation"})

        llm = get_llm(temperature=0.5, streaming=True)
        _, ok = await stream_with_retry(llm, lc_messages, on_token)

        # If Groq streaming failed, use template fallback
        if not ok or not full_response:
            full_response = _build_fallback_response(trip, flight_offers, hotel_offers, passengers)
            for word in full_response.split():
                await _emit_sse(state, {"type": "stream_token", "token": word + " ", "node": "conversation"})

        await _emit_sse(state, {"type": "stream_end", "node": "conversation"})

        
        # Save assistant message to DB
        await db_service.save_message(trip_id, user_id, "assistant", full_response, {
            "node": "conversation",
            "status": status,
        })
        
        await db_service.record_trace(trip_id, user_id, "conversation", "completed",
                                       output={"response_length": len(full_response)})
        
        # Determine next status
        next_status = "done"
        if "confirm" in full_response.lower() and "book" in full_response.lower():
            next_status = "pending_confirmation"
            
        # Update state messages
        updated_messages = [{"role": m["role"], "content": m["content"]} for m in db_messages] + \
                           [{"role": "assistant", "content": full_response}]
        
        return {
            **state,
            "messages": updated_messages,
            "status": next_status,
            "flight_offers": flight_offers,
            "hotel_offers": hotel_offers,
            "itinerary": trip.get("itinerary"),
            "budget_breakdown": trip.get("budget_breakdown"),
        }
        
    except Exception as e:
        print(f"[ConversationNode] Error: {e}")
        await db_service.record_trace(trip_id, user_id, "conversation", "failed", error=str(e))
        await _emit_sse(state, {"type": "error", "message": str(e)})
        return {**state, "error_message": str(e), "status": "done"}


def _build_system_prompt(trip: dict, flight_offers: list, hotel_offers: list, passengers: list, state: dict = None) -> str:
    """Build context-rich system prompt"""
    budget_breakdown = trip.get("budget_breakdown") or {}
    budget_inr = trip.get("budget_inr", 0)
    itinerary = trip.get("itinerary")
    
    selected_flight_id = trip.get("selected_flight_offer_id")
    selected_hotel_id = trip.get("selected_hotel_offer_id")
    
    # Identify selected offers or default to first
    best_flight = next((f for f in flight_offers if f.get("id") == selected_flight_id), None)
    if not best_flight and flight_offers:
        best_flight = flight_offers[0]
        
    # Retrieve stay segments
    segments = (state or {}).get("hotel_segments")
    if not segments and trip.get("id"):
        try:
            res_segs = db_service.client.table("hotel_segments").select("*").eq("trip_id", trip.get("id")).order("segment_order").execute()
            segments = res_segs.data or []
        except Exception:
            segments = []

    hotel_info = []
    if segments:
        for seg in segments:
            seg_order = seg.get("segment_order")
            offer_id = seg.get("hotel_offer_id")
            checkin = seg.get("checkin_date")
            checkout = seg.get("checkout_date")
            nights = seg.get("nights")
            
            offer = next((h for h in hotel_offers if h.get("id") == offer_id), None)
            if offer:
                hotel_info.append(
                    f"Segment {seg_order} ({checkin} to {checkout}, {nights} nights): "
                    f"{offer.get('hotel_name')} — ₹{offer.get('amount_per_night_inr', 0):,.0f}/night "
                    f"({offer.get('star_rating', '?')}★, ₹{offer.get('total_amount_inr', 0):,.0f} total)"
                )
            else:
                hotel_info.append(
                    f"Segment {seg_order} ({checkin} to {checkout}, {nights} nights): No hotel selected yet."
                )
    else:
        best_hotel = next((h for h in hotel_offers if h.get("id") == selected_hotel_id), None)
        if not best_hotel and hotel_offers:
            best_hotel = hotel_offers[0]
        if best_hotel:
            hotel_info.append(
                f"Single Stay: {best_hotel.get('hotel_name')} — ₹{best_hotel.get('amount_per_night_inr', 0):,.0f}/night "
                f"({best_hotel.get('star_rating', '?')}★, ₹{best_hotel.get('total_amount_inr', 0):,.0f} total, room: {best_hotel.get('room_type')})"
            )

    parts = [
      "You are Tripio, an expert AI travel planner. You are warm, professional, helpful, and concise.",
      "You have access to the complete trip details and database history.",
      "Always respond in a conversational tone. Format prices as ₹X,XX,XXX (Indian Rupee format).",
      f"Trip Route: {trip.get('origin_city')} → {trip.get('destination_city')}",
      f"Dates: {trip.get('date_start')} to {trip.get('date_end')}",
      f"Travellers: {trip.get('num_adults', 1)} adult(s), {trip.get('num_children', 0)} child(ren)",
      f"Total Trip Budget: ₹{budget_inr:,.0f}",
    ]
    
    if passengers:
        passenger_names = ", ".join([f"{p.get('first_name')} {p.get('last_name')}" for p in passengers])
        parts.append(f"Passengers registered: {passenger_names}")
    
    if best_flight:
        parts.append(f"\n[Flight details]: {best_flight.get('airline')} — ₹{best_flight.get('amount_inr', 0):,.0f} "
                     f"({best_flight.get('stops', 0)} stops, departure: {best_flight.get('departure_at')})")
    
    if hotel_info:
        parts.append("[Hotel details]:\n" + "\n".join([f"  - {h}" for h in hotel_info]))
    
    if budget_breakdown:
        parts.append(f"\n[Budget Breakdown]: Flights ₹{budget_breakdown.get('flights_inr', 0):,.0f}, "
                     f"Hotel ₹{budget_breakdown.get('hotel_inr', 0):,.0f}, "
                     f"Remaining for activities/itinerary ₹{budget_breakdown.get('remaining_for_itinerary_inr', 0):,.0f}")
    
    if itinerary:
        days_summary = "\n".join([f"  Day {d.get('day')}: {d.get('theme')}" for d in itinerary])
        parts.append(f"\n[Itinerary daily highlights]:\n{days_summary}")
    
    parts.append(
        "\nCapabilities:\n"
        "- Answer any user questions about the flight, hotel, daily schedule, or budget details.\n"
        "- Give travel tips, suggest packing lists, or explain RAG knowledge grounding about the destination.\n"
        "- If the user asks to modify search, dates, or find cheaper options, tell them they can change it in the UI input panel or ask you to search again.\n"
        "- If they ask to proceed/confirm/book, tell them: 'Excellent! Go ahead and select the \"Checkout\" tab in the workspace to enter passenger details and complete payment.'"
    )
    
    # Inject city resolution pending confirmations
    pending = (state or {}).get("pending_resolutions")
    if pending:
        city_type = "origin" if "origin" in pending else "destination"
        city_pending = pending[city_type]
        raw_input = city_pending.get("raw_input")
        matches = city_pending.get("matches", [])
        
        matches_lines = []
        for i, m in enumerate(matches):
            matches_lines.append(f"- {i+1}. {m.get('name')}, {m.get('country_name', m.get('iata_country_code'))} ({m.get('iata_code')})")
        matches_text = "\n".join(matches_lines)
        
        parts.append(
            f"\n[CRITICAL INSTRUCTION — PENDING CITY CONFIRMATION]:\n"
            f"The user's requested {city_type} location '{raw_input}' has multiple matches.\n"
            f"You MUST ask the user to clarify which one they meant. List the following options clearly and ask them to choose:\n"
            f"{matches_text}\n"
            f"Keep your response concise, polite, and focused entirely on this selection. Do not talk about flight or hotel details yet."
        )
        
    # Inject city verification error fallback
    err_msg = (state or {}).get("error_message")
    if err_msg and "couldn't verify that city" in err_msg:
        parts.append(
            f"\n[CRITICAL INSTRUCTION — CITY VERIFICATION FAILURE]:\n"
            f"We could not verify the city: {err_msg}.\n"
            f"Politely inform the user and ask them to please try again or type the 3-letter IATA code directly (e.g. LHR, DEL)."
        )
    
    return "\n".join(parts)


async def _emit_sse(state: dict, event: dict):
    trip_id = state.get("trip_id")
    if trip_id:
        await sse_registry.put(trip_id, event)


def _build_fallback_response(trip: dict, flight_offers: list, hotel_offers: list, passengers: list) -> str:
    """Build a rich template response when all LLM calls fail."""
    dest = trip.get("destination_city", "your destination") or "your destination"
    origin = trip.get("origin_city", "your origin") or "your origin"
    date_start = trip.get("date_start", "")
    date_end = trip.get("date_end", "")
    budget = trip.get("budget_inr", 0)
    breakdown = trip.get("budget_breakdown") or {}

    flight_line = ""
    if flight_offers:
        f = flight_offers[0]
        flight_line = f"✈️ **{f.get('airline', 'Flight')}** — ₹{f.get('amount_inr', 0):,.0f} ({f.get('stops', 0) == 0 and 'Non-stop' or str(f.get('stops')) + ' stop(s)'})\n"

    hotel_line = ""
    if hotel_offers:
        h = hotel_offers[0]
        hotel_line = f"🏨 **{h.get('hotel_name', 'Hotel')}** — ₹{h.get('total_amount_inr', 0):,.0f} for {h.get('num_nights', '')} nights\n"

    budget_line = ""
    if breakdown:
        sat = breakdown.get("budget_satisfied", True)
        combined = breakdown.get("combined_inr", 0)
        budget_line = f"💰 Total: ₹{combined:,.0f} {'✅ within' if sat else '⚠️ slightly over'} your ₹{budget:,.0f} budget\n"

    return (
        f"Here's your trip plan for **{origin} → {dest}** ({date_start} – {date_end})!\n\n"
        f"{flight_line}{hotel_line}{budget_line}\n"
        "Your detailed day-by-day itinerary is ready in the **Itinerary** tab. "
        "Check the **Flights** and **Hotels** tabs to browse all options, and the **Budget** tab for a cost breakdown.\n\n"
        "When you're ready to book, click the **Checkout** tab to enter passenger details and complete payment. "
        "Feel free to ask me anything about your trip! 🌍"
    )
