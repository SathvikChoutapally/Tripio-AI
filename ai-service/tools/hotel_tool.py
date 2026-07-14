"""
TripioAI — Hotel Tool Node
Calls LiteAPI, normalizes offers, converts to INR, stores in DB
"""
import asyncio
import time
from datetime import datetime
from services.liteapi import liteapi_service
from services.fx import convert_to_inr
from services.db import db_service
import sse_registry


async def hotel_tool_node(state: dict) -> dict:
    print("\n==============================")
    print("HOTEL TOOL STARTED")
    print("Trip:", state.get("trip_id"))
    print("==============================")
    """Fetch hotel rates from LiteAPI and store in DB"""
    trip_id = state.get("trip_id")
    user_id = state.get("user_id")
    
    destination_city = state.get("destination_city", "")
    
    await _emit_sse(state, {
        "type": "node_start",
        "node": "hotel_tool",
        "message": f"🏨 Searching hotels in {destination_city}...",
    })
    
    start_time = time.time()
    await db_service.record_trace(trip_id, user_id, "hotel_tool", "started")
    try:
        # Collect or create segments
        segments = state.get("hotel_segments")
        if not segments:
            # Query DB as backup
            segments = await db_service.get_hotel_segments(trip_id)
            
        if not segments:
            # Default: split stay into 1-day segments (one segment per night)
            date_start = state.get("date_start")
            date_end = state.get("date_end")
            
            from datetime import datetime, timedelta
            start_dt = datetime.strptime(date_start, "%Y-%m-%d")
            end_dt = datetime.strptime(date_end, "%Y-%m-%d")
            delta = (end_dt - start_dt).days
            
            segments = []
            for i in range(max(delta, 1)):
                seg_start = (start_dt + timedelta(days=i)).strftime("%Y-%m-%d")
                seg_end = (start_dt + timedelta(days=i+1)).strftime("%Y-%m-%d")
                segments.append({
                    "segment_order": i + 1,
                    "checkin_date": seg_start,
                    "checkout_date": seg_end,
                    "destination_area": None
                })
            
        # Filter if re-planning a specific segment
        replan_seg = state.get("replan_segment")
        if replan_seg:
            segments = [seg for seg in segments if seg.get("segment_order") == int(replan_seg)]
            
        # Get LiteAPI city ID/IATA code
        destination_iata = state.get("destination_iata")
        if not destination_iata:
            await _emit_sse(state, {
                "type": "warning",
                "message": f"⚠️ Could not find hotel search city code for {destination_city}. Skipping hotel search.",
            })
            return {**state, "hotel_offers": []}
            
        all_normalized_offers = []
        
        async def process_segment(seg):
            seg_order = seg.get("segment_order", 1)
            checkin = seg.get("checkin_date")
            checkout = seg.get("checkout_date")
            
            if not checkin or not checkout:
                return []
                
            if not isinstance(checkin, str):
                checkin = checkin.strftime("%Y-%m-%d")
            if not isinstance(checkout, str):
                checkout = checkout.strftime("%Y-%m-%d")
                
            start_dt = datetime.strptime(checkin, "%Y-%m-%d")
            end_dt = datetime.strptime(checkout, "%Y-%m-%d")
            seg_nights = (end_dt - start_dt).days
            
            if seg_nights <= 0:
                print(f"[HotelTool] Segment {seg_order} has invalid nights: {seg_nights}")
                return []
                
            print(f"[HotelTool] Searching segment {seg_order}: {checkin} to {checkout} ({seg_nights} nights)")
            
            raw_hotels = await liteapi_service.search_rates(
                iata_code=destination_iata,
                checkin=checkin,
                checkout=checkout,
                num_adults=state.get("num_adults", 1),
                num_children=state.get("num_children", 0),
                currency="INR",
            )
            
            if not raw_hotels:
                print(f"[HotelTool] No hotels found for segment {seg_order}")
                return []
                
            # Sort by price and take top 5
            def get_price(h):
                try:
                    room = h["roomTypes"][0]
                    rate = room["rates"][0]
                    return float(rate["retailRate"]["total"][0]["amount"])
                except Exception:
                    return float("inf")
            
            sorted_hotels = sorted(raw_hotels, key=get_price)[:5]
            details_tasks = [liteapi_service.get_hotel_details(hotel["hotelId"]) for hotel in sorted_hotels]
            details_list = await asyncio.gather(*details_tasks)
            
            seg_offers = []
            for rank, (raw_hotel, details) in enumerate(zip(sorted_hotels, details_list)):
                raw_hotel["details"] = details
                norm = liteapi_service.normalize_hotel(
                    raw_hotel,
                    seg_nights,
                    rank,
                    currency="INR"
                )
                if norm:
                    amount_inr, fx_rate = await convert_to_inr(
                        norm["amount_per_night_original"],
                        norm["currency_original"]
                    )
                    total_inr, _ = await convert_to_inr(
                        norm["total_amount_original"],
                        norm["currency_original"]
                    )
                    norm["amount_per_night_inr"] = amount_inr
                    norm["total_amount_inr"] = total_inr
                    norm["fx_rate_used"] = fx_rate
                    norm["segment_order"] = seg_order
                    norm["checkin_date"] = checkin
                    norm["checkout_date"] = checkout
                    
                    # Sanity check: warn on impossible INR prices
                    hotel_name = norm.get("hotel_name", "Unknown")
                    if amount_inr < 500:
                        print(f"[HotelTool] ⚠️  Sanity check FAIL: {hotel_name} = ₹{amount_inr:.0f}/night is suspiciously cheap")
                    elif amount_inr > 500_000:
                        print(f"[HotelTool] ⚠️  Sanity check FAIL: {hotel_name} = ₹{amount_inr:.0f}/night is suspiciously expensive")
                    else:
                        print(f"[HotelTool] ✓  Sanity check OK: {hotel_name} = ₹{amount_inr:,.0f}/night (currency: {norm['currency_original']}, fx: {fx_rate})")
                        
                    seg_offers.append(norm)
            return seg_offers

        tasks = [process_segment(seg) for seg in segments]
        results = await asyncio.gather(*tasks)
        for r in results:
            all_normalized_offers.extend(r)
            
        if not all_normalized_offers:
            await _emit_sse(state, {
                "type": "warning",
                "message": "No hotels found for these dates. Try different dates.",
            })
            return {**state, "hotel_offers": [], "error_message": "No hotels found"}

        # Save to DB
        replan_seg = state.get("replan_segment")
        saved_offers = await db_service.save_hotel_offers(trip_id, all_normalized_offers, segment_order=replan_seg)
        
        # Populate hotel_segments table.
        # If we are replanning a specific segment, we merge with existing segments.
        # Otherwise, we create clean pending segments.
        existing_segs = await db_service.get_hotel_segments(trip_id)
        
        seg_records = []
        if replan_seg:
            # Re-planning a single segment: retain others, clear/update the target one
            for seg in existing_segs:
                if seg.get("segment_order") == int(replan_seg):
                    seg_records.append({
                        "segment_order": seg.get("segment_order"),
                        "checkin_date": seg.get("checkin_date"),
                        "checkout_date": seg.get("checkout_date"),
                        "hotel_offer_id": None,
                        "price_per_night_inr": None,
                        "total_price_inr": None,
                        "booking_status": "pending"
                    })
                else:
                    seg_records.append(seg)
        else:
            # Initial search: create all segments as empty / pending selection
            segs_to_use = segments if segments else existing_segs
            for seg in segs_to_use:
                seg_order = seg.get("segment_order", 1)
                checkin = seg.get("checkin_date")
                checkout = seg.get("checkout_date")
                
                seg_records.append({
                    "segment_order": seg_order,
                    "checkin_date": checkin,
                    "checkout_date": checkout,
                    "hotel_offer_id": None,
                    "price_per_night_inr": None,
                    "total_price_inr": None,
                    "booking_status": "pending"
                })
        
        await db_service.save_hotel_segments(trip_id, seg_records)
        
        # Build lightweight state offers
        state_offers = [
            {
                "id": o.get("id"),
                "liteapi_hotel_id": o.get("liteapi_hotel_id"),
                "liteapi_rate_id": o.get("liteapi_rate_id"),
                "hotel_name": o.get("hotel_name"),
                "star_rating": o.get("star_rating"),
                "review_score": o.get("review_score"),
                "is_refundable": o.get("is_refundable"),
                "amount_per_night_inr": o.get("amount_per_night_inr"),
                "total_amount_inr": o.get("total_amount_inr"),
                "num_nights": o.get("num_nights"),
                "rank": o.get("rank"),
                "segment_order": o.get("segment_order", 1),
                "checkin_date": o.get("checkin_date"),
                "checkout_date": o.get("checkout_date"),
            }
            for o in (saved_offers if saved_offers else all_normalized_offers)
        ]
        
        latency_ms = int((time.time() - start_time) * 1000)
        
        # We fetch all active hotel offers to compute average cheapest for logging
        try:
            db_offers_res = db_service.client.table("hotel_offers").select("*").eq("trip_id", trip_id).execute()
            all_current_offers = db_offers_res.data or state_offers
        except Exception:
            all_current_offers = state_offers

        cheapest_per_seg = []
        unique_segs = set(o.get("segment_order", 1) for o in all_current_offers)
        for seg_order in unique_segs:
            seg_offers_list = [o for o in all_current_offers if o.get("segment_order") == seg_order]
            if seg_offers_list:
                cheapest_per_seg.append(min((o["amount_per_night_inr"] for o in seg_offers_list), default=0))
        cheapest = sum(cheapest_per_seg) / len(cheapest_per_seg) if cheapest_per_seg else 0
        
        await _emit_sse(state, {
            "type": "hotel_results",
            "count": len(state_offers),
            "cheapest_per_night_inr": cheapest,
            "message": f"✅ Found {len(state_offers)} hotels! Average cheapest: ₹{cheapest:,.0f}/night",
        })
        
        await db_service.record_trace(trip_id, user_id, "hotel_tool", "completed",
                                      output={"offers_found": len(state_offers)},
                                      latency_ms=latency_ms)
        
        # Update trip status in DB to awaiting_selection
        await db_service.update_trip(trip_id, {"status": "awaiting_selection"})

        # Notify client to switch into selection mode
        await _emit_sse(state, {
            "type": "awaiting_selection",
            "message": "🎯 Flights & hotels ready — please select your preferences to generate the itinerary!",
        })

        return {
            **state,
            "hotel_offers": all_current_offers,
            "hotel_segments": seg_records,
            "status": "awaiting_selection",
            "awaiting_user_selection": True,
            "replan_segment": None
        }
        
    except Exception as e:
        latency_ms = int((time.time() - start_time) * 1000)
        print(f"[HotelTool] Error: {e}")
        await db_service.record_trace(trip_id, user_id, "hotel_tool", "failed",
                                      error=str(e), latency_ms=latency_ms)
        
        await _emit_sse(state, {
            "type": "tool_error",
            "node": "hotel_tool",
            "message": f"⚠️ Hotel search unavailable: {str(e)[:200]}. Please try again.",
        })
        
        return {**state, "hotel_offers": [], "error_message": f"Hotel search failed: {str(e)}"}


async def _get_liteapi_city_id(state: dict) -> str:
    """Get LiteAPI city ID from DB cities_cache"""
    destination_iata = state.get("destination_iata")
    destination_city = state.get("destination_city", "")
    
    try:
        result = db_service.client.table("cities_cache").select("liteapi_city_id").or_(
            f"iata_code.eq.{destination_iata},city_name.ilike.%25{destination_city}%25"
        ).maybe_single().execute()
        
        if result.data and result.data.get("liteapi_city_id"):
            return result.data["liteapi_city_id"]
    except Exception:
        pass
    
    # Fallback: use destination city name directly (LiteAPI may accept it)
    return destination_city


async def _emit_sse(state: dict, event: dict):
    trip_id = state.get("trip_id")
    if trip_id:
        await sse_registry.put(trip_id, event)
