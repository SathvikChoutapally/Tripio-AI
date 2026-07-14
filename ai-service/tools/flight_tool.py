"""
TripioAI — Flight Tool Node
Calls Duffel API, normalizes offers, converts to INR, stores in DB
"""

import time
from tenacity import RetryError
from services.duffel import duffel_service
from services.fx import convert_to_inr
from services.db import db_service
import sse_registry


async def flight_tool_node(state: dict) -> dict:
    """Fetch flight offers from Duffel and store in DB"""
    trip_id = state.get("trip_id")
    user_id = state.get("user_id")
    
    await _emit_sse(state, {
        "type": "node_start",
        "node": "flight_tool",
        "message": f"✈️ Searching flights from {state.get('origin_city')} to {state.get('destination_city')}...",
    })
    
    start_time = time.time()
    await db_service.record_trace(trip_id, user_id, "flight_tool", "started")
    
    try:
        origin = state.get("origin_iata")
        destination = state.get("destination_iata")
        
        if not origin or not destination:
            from tools.city_resolver import resolve_city
            
            if not origin and state.get("origin_city"):
                origin_res = await resolve_city(state.get("origin_city"))
                if origin_res.resolved and origin_res.matches:
                    origin = origin_res.matches[0].iata_city_code or origin_res.matches[0].iata_code
            
            if not destination and state.get("destination_city"):
                dest_res = await resolve_city(state.get("destination_city"))
                if dest_res.resolved and dest_res.matches:
                    destination = dest_res.matches[0].iata_city_code or dest_res.matches[0].iata_code
                    
        if not origin or not destination:
            raise ValueError("Origin and destination IATA codes are required")
        
        # Add "cheapest" constraint if budget check failed
        cabin = "economy"  # could vary by constraint
        
        # Call Duffel
        offer_request_id, raw_offers = await duffel_service.create_offer_request(
            origin_iata=origin,
            destination_iata=destination,
            date_start=state.get("date_start"),
            date_end=state.get("date_end"),
            num_adults=state.get("num_adults", 1),
            num_children=state.get("num_children", 0),
            cabin_class=cabin,
        )

        print("=" * 60)
        print("RAW OFFERS:", len(raw_offers) if raw_offers else 0)
        print("=" * 60)
        
        if not raw_offers:
            await _emit_sse(state, {
                "type": "warning",
                "message": "No flights found for this route and dates. Try adjusting your dates.",
            })
            return {**state, "flight_offers": [], "error_message": "No flights found"}
        
        # Sort by price and take top 5
        sorted_offers = sorted(raw_offers, key=lambda o: float(o.get("total_amount", 999999)))[:5]
        
        # Normalize and convert to INR
        normalized = []
        for rank, raw_offer in enumerate(sorted_offers):
            norm = duffel_service.normalize_offer(raw_offer, offer_request_id, rank)
            if norm:
                amount_inr, fx_rate = await convert_to_inr(
                    norm["amount_original"],
                    norm["currency_original"]
                )
                norm["amount_inr"] = amount_inr
                norm["fx_rate_used"] = fx_rate
                normalized.append(norm)

        print("=" * 60)
        print("NORMALIZED OFFERS:", len(normalized))
        if normalized:
            print(normalized[0])
        print("=" * 60)
        
        # Save to DB
        saved_offers = await db_service.save_flight_offers(trip_id, normalized)

        print("=" * 60)
        print("SAVED OFFERS:", len(saved_offers))
        print(saved_offers)
        print("=" * 60)
        
        # Build lightweight state offers (just key fields)
        state_offers = [
            {
                "id": o.get("id"),
                "duffel_offer_id": o.get("duffel_offer_id"),
                "airline": o.get("airline"),
                "departure_at": o.get("departure_at"),
                "duration_minutes": o.get("duration_minutes"),
                "stops": o.get("stops", 0),
                "amount_inr": o.get("amount_inr"),
                "amount_original": o.get("amount_original"),
                "currency_original": o.get("currency_original"),
                "fx_rate_used": o.get("fx_rate_used"),
                "rank": o.get("rank"),
            }
            for o in (saved_offers if saved_offers else normalized)
        ]
        
        latency_ms = int((time.time() - start_time) * 1000)
        
        await _emit_sse(state, {
            "type": "flight_results",
            "count": len(state_offers),
            "cheapest_inr": min((o["amount_inr"] for o in state_offers), default=0),
            "message": f"✅ Found {len(state_offers)} flight options! Cheapest: ₹{min((o['amount_inr'] for o in state_offers), default=0):,.0f}",
        })
        
        # Update status if in replan_flight
        ret_status = state.get("status")
        ret_awaiting = state.get("awaiting_user_selection", False)
        if ret_status == "replan_flight":
            ret_status = "awaiting_selection"
            ret_awaiting = True
            await db_service.update_trip(trip_id, {
                "status": "awaiting_selection",
                "selected_flight_offer_id": None
            })
            
        return {
            **state,
            "flight_offers": state_offers,
            "status": ret_status,
            "awaiting_user_selection": ret_awaiting
        }
        
    except Exception as e:
        latency_ms = int((time.time() - start_time) * 1000)
        
        # Unwrap tenacity RetryError to expose the real root cause
        underlying = e
        if isinstance(e, RetryError):
            underlying = e.last_attempt.exception()
        
        print(f"[FlightTool] Real error: {underlying!r}")
        await db_service.record_trace(trip_id, user_id, "flight_tool", "failed",
                                      error=repr(underlying), latency_ms=latency_ms)
        
        # Graceful degradation — explain in SSE
        await _emit_sse(state, {
            "type": "tool_error",
            "node": "flight_tool",
            "message": f"⚠️ Couldn't search flights right now: {str(underlying)[:200]}. Please try again.",
        })
        
        return {**state, "flight_offers": [], "error_message": f"Flight search failed: {str(underlying)}"}


async def _emit_sse(state: dict, event: dict):
    trip_id = state.get("trip_id")
    if trip_id:
        await sse_registry.put(trip_id, event)
