"""
TripioAI — Orchestrator / Router Node
Receives the trip brief or chat turn and decides which tool nodes to invoke
"""

import json
import os
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage

from services.db import db_service
import sse_registry
from typing import Optional, Dict, List  # etc — merge with whatever's already there

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")


async def orchestrator_node(state: dict) -> dict:
    """
    Router node — analyzes the current state and decides the next action.
    Sends an SSE event to notify the frontend.
    """
    trip_id = state.get("trip_id")
    status = state.get("status", "planning")
    messages = state.get("messages", [])
    
    await _emit_sse(state, {
        "type": "node_start",
        "node": "orchestrator",
        "message": "🤔 Analyzing your trip request...",
    })
    
    # Record trace
    await db_service.record_trace(trip_id, state.get("user_id"), "orchestrator", "started")
    
    try:
        # Handle selection confirmation
        if status == "confirm_selections":
            new_state = {**state, "status": "generating_plan"}
            await _emit_sse(state, {
                "type": "info",
                "message": "⚙️ Confirmed selections received! Generating your personalized itinerary & budget...",
            })
            await db_service.record_trace(trip_id, state.get("user_id"), "orchestrator", "completed",
                                          output={"action": "confirm_selections"})
            return new_state

        # If it's a chat message, classify intent / check for replanning
        if status == "chat" and messages:
            last_message = messages[-1].get("content", "") if messages else ""
            
            # Check for re-planning change request first
            replan_label = await _classify_replan_request(last_message, state)
            if replan_label != "other":
                new_state = {**state}
                if replan_label == "flight":
                    new_state["status"] = "replan_flight"
                elif replan_label.startswith("hotel:"):
                    try:
                        seg_num = int(replan_label.split(":")[1])
                    except Exception:
                        seg_num = 1
                    new_state["status"] = "replan_hotel"
                    new_state["replan_segment"] = seg_num
                elif replan_label == "itinerary":
                    new_state["status"] = "replan_itinerary"
                elif replan_label == "budget":
                    new_state["status"] = "replan_budget"
                
                await _emit_sse(state, {
                    "type": "info",
                    "message": f"🔄 Re-planning request: updating {replan_label.replace(':', ' segment ')}... Recalculating plan.",
                })
                await db_service.record_trace(trip_id, state.get("user_id"), "orchestrator", "completed",
                                              output={"action": "re_planning", "replan_label": replan_label})
                return new_state

            # Check for split stay request (e.g. split stay, stay at two different hotels, etc.)
            is_split_request = any(k in last_message.lower() for k in ["split", "different hotel", "two hotels", "multiple hotels", "stay at 2", "stay at two", "change hotel", "nights here", "nights at"])
            if is_split_request:
                parsed_segments = await _parse_split_stay_segments(last_message, state)
                if parsed_segments:
                    new_state = {**state, "hotel_segments": parsed_segments, "status": "searching"}
                    await db_service.save_hotel_segments(trip_id, parsed_segments)
                    await db_service.update_trip(trip_id, {"hotel_segments": parsed_segments})
                    
                    await _emit_sse(state, {
                        "type": "info",
                        "message": f"🏨 Splitting your stay into {len(parsed_segments)} segments! Re-searching hotels...",
                    })
                    await db_service.record_trace(trip_id, state.get("user_id"), "orchestrator", "completed",
                                                  output={"action": "split_stay_parsed", "segments": parsed_segments})
                    return new_state

            # Check for pending confirmations first
            pending = state.get("pending_resolutions")
            if pending:
                resolved_fields = await _resolve_pending_selection(last_message, pending, state)
                if resolved_fields:
                    updated_state = {**state, **resolved_fields}
                    
                    # Update status in DB for the trip if it changed to searching
                    if updated_state.get("status") == "searching":
                        await db_service.update_trip(trip_id, {
                            "origin_iata": updated_state.get("origin_iata"),
                            "destination_iata": updated_state.get("destination_iata"),
                            "origin_city": updated_state.get("origin_city"),
                            "destination_city": updated_state.get("destination_city"),
                            "status": "searching"
                        })
                    
                    await db_service.record_trace(
                        trip_id, state.get("user_id"), "orchestrator", "completed",
                        output={"action": "resolved_pending", "resolved_fields": resolved_fields}
                    )
                    return updated_state
            
            intent = await _classify_intent(last_message, state)
            
            if intent == "re_search":
                new_state = {**state, "status": "searching", "cheaper_constraint": True, "loop_count": 0}
            elif intent == "booking":
                new_state = {**state, "status": "booking"}
            elif intent == "info":
                new_state = {**state, "status": "chat"}
            else:
                new_state = {**state, "status": "chat"}
            
            await db_service.record_trace(trip_id, state.get("user_id"), "orchestrator", "completed",
                                          output={"intent": intent, "next_status": new_state["status"]})
            return new_state
        
        # Initial planning or searching
        if status in ("planning", "searching"):
            origin_city = state.get("origin_city")
            destination_city = state.get("destination_city")
            
            # If IATA codes are already resolved, skip city resolution entirely
            if state.get("origin_iata") and state.get("destination_iata"):
                print(f"[Orchestrator] IATA codes already set: {state.get('origin_iata')} → {state.get('destination_iata')}, skipping resolver")
                new_state = {**state, "status": "searching" if status == "planning" else status}
                await db_service.record_trace(trip_id, state.get("user_id"), "orchestrator", "completed",
                                              output={"action": "iata_already_set", "origin": state.get("origin_iata"), "destination": state.get("destination_iata")})
                return new_state
            
            from tools.city_resolver import resolve_city
            
            origin_res = await resolve_city(origin_city)
            dest_res = await resolve_city(destination_city)
            
            # Check for error or confirmation needed
            if origin_res.needs_confirmation or dest_res.needs_confirmation:
                pending = {}
                if origin_res.needs_confirmation:
                    pending["origin"] = {
                        "raw_input": origin_city,
                        "matches": [m.dict() for m in origin_res.matches]
                    }
                if dest_res.needs_confirmation:
                    pending["destination"] = {
                        "raw_input": destination_city,
                        "matches": [m.dict() for m in dest_res.matches]
                    }
                
                new_state = {
                    **state,
                    "status": "chat",  # Pause and route to conversation
                    "pending_resolutions": pending
                }
                
                await db_service.record_trace(
                    trip_id, state.get("user_id"), "orchestrator", "completed",
                    output={"action": "needs_confirmation", "pending": pending}
                )
                return new_state
                
            # If not resolved (failed lookup / Duffel offline)
            if not origin_res.resolved or not dest_res.resolved:
                err_msg = "couldn't verify that city right now, please try again or type the IATA code directly"
                new_state = {
                    **state,
                    "status": "chat",
                    "error_message": err_msg
                }
                await db_service.record_trace(
                    trip_id, state.get("user_id"), "orchestrator", "failed",
                    error=err_msg
                )
                return new_state
                
            # Both resolved cleanly! Save resolved IATA codes into state
            origin_iata = origin_res.matches[0].iata_city_code or origin_res.matches[0].iata_code
            destination_iata = dest_res.matches[0].iata_city_code or dest_res.matches[0].iata_code
            
            # Update database record for trip to have official names and IATA codes
            await db_service.update_trip(trip_id, {
                "origin_iata": origin_iata,
                "destination_iata": destination_iata,
                "origin_city": origin_res.matches[0].name,
                "destination_city": dest_res.matches[0].name,
            })
            
            new_state = {
                **state,
                "origin_iata": origin_iata,
                "destination_iata": destination_iata,
                "origin_city": origin_res.matches[0].name,
                "destination_city": dest_res.matches[0].name,
                "status": "searching" if status == "planning" else status
            }
            
            await db_service.record_trace(
                trip_id, state.get("user_id"), "orchestrator", "completed",
                output={"origin_iata": origin_iata, "destination_iata": destination_iata}
            )
            return new_state
        
        await db_service.record_trace(trip_id, state.get("user_id"), "orchestrator", "completed")
        return state

        
    except Exception as e:
        await db_service.record_trace(trip_id, state.get("user_id"), "orchestrator", "failed",
                                      error=str(e))
        await _emit_sse(state, {"type": "error", "message": f"Orchestrator error: {str(e)}"})
        return {**state, "error_message": str(e), "status": "chat"}


async def _classify_intent(message: str, state: dict) -> str:
    """Use Gemini to classify user intent — falls back to keyword matching on rate limit."""
    msg_lower = message.lower()

    # Fast keyword fallback (no LLM needed)
    booking_keywords = ["book", "confirm", "yes", "proceed", "pay", "checkout", "go ahead", "reserve"]
    search_keywords = ["cheaper", "change", "modify", "different", "another", "search again", "find more", "budget"]
    if any(k in msg_lower for k in booking_keywords):
        return "booking"
    if any(k in msg_lower for k in search_keywords):
        return "re_search"

    # Try LLM classification with models in priority order
    models_to_try = ["gemini-2.5-flash", "gemini-2.0-flash-lite", "gemini-2.0-flash"]
    prompt = f"""Classify this travel chat message into exactly one of: re_search, booking, info

Message: "{message}"
Context: {state.get('origin_city')} → {state.get('destination_city')}, Budget: ₹{state.get('budget_inr', 0):,.0f}

Respond with ONLY the single intent word."""

    for model_name in models_to_try:
        try:
            llm = ChatGoogleGenerativeAI(model=model_name, temperature=0)
            response = await llm.ainvoke([HumanMessage(content=prompt)])
            intent = response.content.strip().lower()
            if intent in ("re_search", "booking", "info"):
                return intent
            return "info"
        except Exception as e:
            if "429" not in str(e) and "RESOURCE_EXHAUSTED" not in str(e):
                break

    return "info"  # Safe default


async def _emit_sse(state: dict, event: dict):
    """Push an event to the SSE queue via registry (keyed by trip_id)"""
    trip_id = state.get("trip_id")
    if trip_id:
        await sse_registry.put(trip_id, event)


async def _resolve_pending_selection(message: str, pending: dict, state: dict) -> Optional[dict]:
    """
    Examines message to determine which match is selected.
    Returns a dict with updated state fields, or None if no selection.
    """
    from typing import Optional
    
    # Find which city needs confirmation (origin or destination)
    city_type = "origin" if "origin" in pending else "destination"
    city_pending = pending[city_type]
    matches = city_pending.get("matches", [])
    
    if not matches:
        return None
        
    # We can use the fast LLM to find which option was selected.
    matches_text = ""
    for idx, m in enumerate(matches):
        matches_text += f"{idx + 1}. {m.get('name')}, {m.get('country_name', m.get('iata_country_code'))} ({m.get('iata_code')})\n"
        
    prompt = f"""
    The user was asked to choose between multiple matching cities for a travel plan.
    Which one did they select based on their response?
    
    Options:
    {matches_text}
    
    User's response: "{message}"
    
    If they selected one of the options (by number, name, code, etc.), output ONLY the 0-based index of the chosen option (e.g. 0, 1, 2).
    If they want to change the city or search for a different city entirely, or if the response is unclear/nonsense, output ONLY "none".
    
    Output format: a single integer index or the word "none". No extra text.
    """
    
    try:
        from llm_helper import get_fast_llm
        from langchain_core.messages import HumanMessage
        llm = get_fast_llm(temperature=0)
        resp = await llm.ainvoke([HumanMessage(content=prompt)])
        ans = resp.content.strip().lower()
        
        if ans.isdigit():
            idx = int(ans)
            if 0 <= idx < len(matches):
                selected = matches[idx]
                resolved_code = selected.get("iata_city_code") or selected.get("iata_code")
                resolved_name = selected.get("name")
                
                # Update the state
                updated = {}
                if city_type == "origin":
                    updated["origin_iata"] = resolved_code
                    updated["origin_city"] = resolved_name
                else:
                    updated["destination_iata"] = resolved_code
                    updated["destination_city"] = resolved_name
                    
                # Update pending_resolutions
                new_pending = dict(pending)
                del new_pending[city_type]
                updated["pending_resolutions"] = new_pending if new_pending else None
                
                # If no more pending confirmations, transition status to searching
                if not new_pending:
                    updated["status"] = "searching"
                else:
                    updated["status"] = "chat"
                return updated
    except Exception as e:
        print(f"[Orchestrator] Error parsing pending selection: {e}")
        
    return None


async def _parse_split_stay_segments(message: str, state: dict) -> Optional[list[dict]]:
    """
    Parse split stay segments from a user message.
    Ensures dates are calculated relative to trip check-in date.
    Returns a list of segments: [{"segment_order": 1, "checkin_date": "...", "checkout_date": "...", "nights": 3}]
    or None if the durations are not clear or invalid.
    """
    # Calculate trip date range
    date_start = state.get("date_start")
    date_end = state.get("date_end")
    if not date_start or not date_end:
        return None
        
    from datetime import datetime, timedelta
    try:
        start_dt = datetime.strptime(date_start, "%Y-%m-%d")
        end_dt = datetime.strptime(date_end, "%Y-%m-%d")
        total_nights = (end_dt - start_dt).days
    except Exception:
        return None
    
    prompt = f"""
You are a travel assistant. A user wants to split their stay in a single trip of {total_nights} nights (from {date_start} to {date_end}).
User message: "{message}"

Analyze the message to see if they specify a valid split of the {total_nights} nights (e.g. "3 nights then 4 nights", "stay at 2 different hotels", "3 nights here, 4 nights there").
If the user specifies a split, parse it into JSON segment objects.
If the user says "stay at two different hotels" or similar without specifying night counts, split it as evenly as possible (e.g. for 7 nights, 4 nights and 3 nights).

The response must be valid JSON matching this schema:
{{
  "valid": true,
  "segments": [
    {{
      "segment_order": 1,
      "nights": 3
    }},
    {{
      "segment_order": 2,
      "nights": 4
    }}
  ]
}}

Guidelines:
1. "valid" must be true only if you can split the stay.
2. The sum of "nights" in all segments MUST equal exactly {total_nights}. If they request a split that doesn't sum to {total_nights}, adjust it to sum to {total_nights} or set "valid" to false.
3. Keep the segments ordered.

Respond with ONLY the JSON object. Do not include any explanation or markdown code fences.
"""
    try:
        from llm_helper import get_fast_llm
        from langchain_core.messages import HumanMessage
        llm = get_fast_llm(temperature=0)
        
        # Bind JSON mode response format if possible
        try:
            llm = llm.bind(response_format={"type": "json_object"})
        except Exception:
            pass
            
        resp = await llm.ainvoke([HumanMessage(content=prompt)])
        content = resp.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()
        
        import json
        data = json.loads(content)
        if data.get("valid") and data.get("segments"):
            parsed_segs = data["segments"]
            
            # Verify sum of nights is exactly total_nights
            sum_nights = sum(s.get("nights", 0) for s in parsed_segs)
            if sum_nights != total_nights:
                print(f"[Orchestrator] Parse error: sum of parsed nights {sum_nights} != total nights {total_nights}")
                return None
                
            # Compute dates for each segment
            current_start = start_dt
            result = []
            for s in parsed_segs:
                nights = s.get("nights")
                current_end = current_start + timedelta(days=nights)
                result.append({
                    "segment_order": s.get("segment_order"),
                    "checkin_date": current_start.strftime("%Y-%m-%d"),
                    "checkout_date": current_end.strftime("%Y-%m-%d"),
                    "destination_area": s.get("destination_area")
                })
                current_start = current_end
                
            return result
    except Exception as e:
        print(f"[Orchestrator] Error parsing split stay segments: {e}")
        
    return None


async def _classify_replan_request(message: str, state: dict) -> str:
    """Classify the re-planning change request using fast LLM"""
    from llm_helper import get_fast_llm
    
    # Retrieve segments to build context
    trip_id = state.get("trip_id")
    try:
        segments = await db_service.get_hotel_segments(trip_id)
    except Exception:
        segments = []
        
    segments_context = ""
    if segments:
        for s in segments:
            segments_context += f"- Segment {s.get('segment_order')}: {s.get('checkin_date')} to {s.get('checkout_date')} ({s.get('nights')} nights)\n"
            
    prompt = f"""
    Analyze the following travel request and determine if the user wants to change/modify part of their confirmed trip, or if it is just a general question.
    
    User message: "{message}"
    
    Current Hotel Stay Segments:
    {segments_context}
    
    Classify the message into exactly one of these labels:
    - flight (if they want to change flight details, airline, times, departures, return flights etc.)
    - hotel:<segment_order> (if they want to change the hotel. Replace <segment_order> with the specific segment_order number based on the segments above. E.g., if they mention "day 1" or "first hotel" it's hotel:1. If they mention "day 2" or "second hotel", it's hotel:2. If there's only 1 segment and they just say "change hotel", output "hotel:1".)
    - itinerary (if they want to change activity schedule, restaurants, places to visit, transport tips)
    - budget (if they want to update their overall budget limit, cost preferences)
    - other (if it's not a change/modification request, or is general chatter / question)
    
    Respond with ONLY the classified label and absolutely no other text.
    Examples:
    "change my flight" -> flight
    "different hotel for the first day" -> hotel:1
    "suggest a different plan for day 2 activities" -> itinerary
    "increase my budget to 50k" -> budget
    "what is the weather like?" -> other
    """
    
    try:
        llm = get_fast_llm(temperature=0)
        from langchain_core.messages import HumanMessage
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        result = response.content.strip().lower()
        print(f"[Orchestrator Classifier] Result: {result}")
        if result in ("flight", "itinerary", "budget", "other") or result.startswith("hotel:"):
            return result
        # Fallback keyword matching
        if "flight" in result:
            return "flight"
        elif "hotel" in result:
            if ":" in result:
                return result
            return "hotel:1"
        elif "itinerary" in result:
            return "itinerary"
        elif "budget" in result:
            return "budget"
        return "other"
    except Exception as e:
        print(f"[Orchestrator Classifier] Error: {e}")
        # Keyword-based fallback
        msg_lower = message.lower()
        if "flight" in msg_lower or "airline" in msg_lower or "departure" in msg_lower:
            return "flight"
        if "hotel" in msg_lower or "stay" in msg_lower or "room" in msg_lower:
            if "day 2" in msg_lower or "second" in msg_lower:
                return "hotel:2"
            if "day 3" in msg_lower or "third" in msg_lower:
                return "hotel:3"
            return "hotel:1"
        if "itinerary" in msg_lower or "activity" in msg_lower or "schedule" in msg_lower or "visit" in msg_lower:
            return "itinerary"
        if "budget" in msg_lower or "cost" in msg_lower or "price" in msg_lower:
            return "budget"
        return "other"


