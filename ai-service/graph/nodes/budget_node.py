"""
TripioAI — Budget Reconciliation Node
Checks if the combined flight + hotel cost is within the user's budget.
After confirm_selections / replan, uses actual confirmed costs instead of estimates.
"""

from services.db import db_service
import sse_registry


async def budget_node(state: dict) -> dict:
    """Check if combined costs fit within budget, using confirmed selections when available"""
    trip_id = state.get("trip_id")
    user_id = state.get("user_id")
    budget_inr = state.get("budget_inr", 0)
    status = state.get("status", "")
    
    await _emit_sse(state, {
        "type": "node_start",
        "node": "budget_check",
        "message": "💰 Reconciling your trip budget...",
    })
    
    await db_service.record_trace(trip_id, user_id, "budget_check", "started")
    
    try:
        # In generating_plan / replan modes, use actual confirmed selections from DB
        trip_row = await db_service.get_trip(trip_id) or {}
        selected_flight_offer_id = trip_row.get("selected_flight_offer_id")
        segments = await db_service.get_hotel_segments(trip_id)
        
        flight_cost = 0.0
        using_confirmed = False
        
        if selected_flight_offer_id:
            sel_flight = await db_service.get_flight_offer(str(selected_flight_offer_id))
            if sel_flight:
                flight_cost = float(sel_flight.get("amount_inr", 0))
                using_confirmed = True
        
        hotel_cost = 0.0
        segments_with_hotels = [s for s in segments if s.get("hotel_offer_id")]
        if segments_with_hotels:
            for seg in segments_with_hotels:
                hotel_offer = await db_service.get_hotel_offer(str(seg["hotel_offer_id"]))
                if hotel_offer:
                    hotel_cost += float(hotel_offer.get("total_amount_inr", 0))
            using_confirmed = True
        
        # Fallback to state estimates if no confirmed selections yet
        if not using_confirmed:
            flight_offers = state.get("flight_offers", [])
            hotel_offers = state.get("hotel_offers", [])
            
            if not flight_offers or not hotel_offers:
                await db_service.record_trace(trip_id, user_id, "budget_check", "completed",
                                              output={"budget_satisfied": False, "reason": "no_offers"})
                return {**state, "budget_satisfied": False, "loop_count": state.get("loop_count", 0) + 1}
            
            cheapest_flight = min(flight_offers, key=lambda o: o.get("amount_inr", 999999999))
            flight_cost = float(cheapest_flight.get("amount_inr", 0))
            
            segments_seen = set(o.get("segment_order", 1) for o in hotel_offers)
            for seg_order in sorted(segments_seen):
                seg_offers = [o for o in hotel_offers if o.get("segment_order", 1) == seg_order]
                if seg_offers:
                    cheapest_seg = min(seg_offers, key=lambda o: o.get("total_amount_inr", 999999999))
                    hotel_cost += float(cheapest_seg.get("total_amount_inr", 0))
                
        combined = flight_cost + hotel_cost
        remaining = budget_inr - combined
        
        # Keep at least 15% of budget for itinerary + food
        min_itinerary_budget = budget_inr * 0.15
        budget_satisfied = combined <= budget_inr and remaining >= min_itinerary_budget
        
        breakdown = {
            "flights_inr": flight_cost,
            "hotel_inr": hotel_cost,
            "combined_inr": combined,
            "remaining_for_itinerary_inr": max(0, remaining),
            "budget_satisfied": budget_satisfied,
            "budget_inr": budget_inr,
        }
        
        await _emit_sse(state, {
            "type": "budget_result",
            "data": breakdown,
            "message": (
                f"✅ Budget check passed! Flights: ₹{flight_cost:,.0f} + Hotel: ₹{hotel_cost:,.0f} = ₹{combined:,.0f} "
                f"(₹{remaining:,.0f} left for activities)"
                if budget_satisfied else
                f"⚠️ Over budget by ₹{combined - budget_inr:,.0f} with your confirmed selections."
            ),
        })
        
        await db_service.record_trace(trip_id, user_id, "budget_check", "completed", output=breakdown)
        
        # Persist breakdown + final status to DB
        # When generating plan after confirm, set status to pending_confirmation
        # Do NOT re-loop to search cheaper options — user chose these deliberately
        new_trip_status = "pending_confirmation"
        await db_service.update_trip(trip_id, {
            "budget_breakdown": breakdown,
            "status": new_trip_status,
        })
        
        return {
            **state,
            "budget_satisfied": budget_satisfied,
            "budget_breakdown": breakdown,
            "loop_count": 0,
            "cheaper_constraint": False,
            "status": "generating_plan" if status in ("generating_plan", "replan_budget", "replan_itinerary") else state.get("status"),
        }
        
    except Exception as e:
        await db_service.record_trace(trip_id, user_id, "budget_check", "failed", error=str(e))
        await _emit_sse(state, {"type": "error", "message": f"Budget check failed: {str(e)}"})
        return {**state, "budget_satisfied": True, "error_message": str(e)}


async def _emit_sse(state: dict, event: dict):
    trip_id = state.get("trip_id")
    if trip_id:
        await sse_registry.put(trip_id, event)
