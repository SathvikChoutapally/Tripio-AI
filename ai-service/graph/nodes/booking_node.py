"""
TripioAI — Booking Node
Executes actual Duffel flight order + LiteAPI hotel booking after payment.
Also exposes execute_booking() for direct call from /agent/book endpoint.
"""

import asyncio
from services.db import db_service
from services.duffel import duffel_service
from services.liteapi import liteapi_service
import sse_registry


async def booking_node(state: dict) -> dict:
    """Booking node within the graph — not typically reached via graph flow"""
    await _emit_sse(state, {
        "type": "node_start",
        "node": "booking",
        "message": "🎫 Processing your booking...",
    })
    return state


async def execute_booking(payload: dict) -> dict:
    """
    Execute real booking after payment.
    Called directly from /agent/book endpoint (not via graph).
    
    Flow:
    1. Fetch flight offer from DB → call Duffel to create Order
    2. Fetch hotel offer from DB → call LiteAPI to prebook then book
    3. Update bookings table with results
    4. On partial failure: mark, don't refund here (handled separately)
    """
    booking_id = payload["booking_id"]
    trip_id = payload["trip_id"]
    user_id = payload["user_id"]
    flight_offer_id = payload["flight_offer_id"]
    hotel_offer_id = payload["hotel_offer_id"]
    
    print(f"[Booking] Starting for trip {trip_id}")
    
    # Fetch offers from DB
    flight_offer = await db_service.get_flight_offer(flight_offer_id)
    hotel_offer = await db_service.get_hotel_offer(hotel_offer_id)
    
    if not flight_offer:
        raise ValueError(f"Flight offer {flight_offer_id} not found")
    if not hotel_offer:
        raise ValueError(f"Hotel offer {hotel_offer_id} not found")

    # Fetch passengers from DB
    passenger_records = []
    try:
        res = db_service.client.table("passengers").select("*").eq("trip_id", trip_id).order("created_at").execute()
        passenger_records = res.data or []
        print(f"[Booking] Fetched {len(passenger_records)} passengers from DB")
    except Exception as e:
        print(f"[Booking] Warning: failed to fetch passengers: {e}")
    
    results = {
        "duffel_order_id": None,
        "liteapi_booking_id": None,
        "duffel_status": "pending",
        "liteapi_status": "pending",
    }
    
    # ── Step 1: Book flight via Duffel ────────────────────────
    try:
        print(f"[Booking] Creating Duffel order for offer {flight_offer['duffel_offer_id']}")
        duffel_passengers = _build_passenger_list(passenger_records, flight_offer)
        duffel_order = await duffel_service.create_order(
            offer_id=flight_offer["duffel_offer_id"],
            passengers=duffel_passengers,
            payment_amount=flight_offer["amount_original"],
            payment_currency=flight_offer["currency_original"],
        )
        results["duffel_order_id"] = duffel_order.get("id")
        results["duffel_status"] = "confirmed"
        
        # Update booking in DB
        await db_service.update_booking(booking_id, {
            "duffel_order_id": results["duffel_order_id"],
            "duffel_booking_status": "confirmed",
            "booking_status": "flight_booked",
        })
        print(f"[Booking] ✓ Duffel order {results['duffel_order_id']} created")
        
    except Exception as e:
        print(f"[Booking] ✗ Duffel failed: {e}")
        results["duffel_status"] = "failed"
        results["duffel_error"] = str(e)
        await db_service.update_booking(booking_id, {
            "duffel_booking_status": "failed",
            "booking_status": "partial_failure",
            "failure_reason": f"Flight booking failed: {str(e)}",
        })
        # Don't proceed with hotel if flight fails
        await db_service.update_trip_status(trip_id, "failed")
        return results
    
    # ── Step 2: Book hotels via LiteAPI ────────────────────
    liteapi_guest = _build_guest_info(passenger_records)
    
    # Query hotel segments
    segments = await db_service.get_hotel_segments(trip_id)
    if not segments:
        segments = [{
            "segment_order": 1,
            "checkin_date": hotel_offer.get("checkin_date") or payload.get("checkin_date"),
            "checkout_date": hotel_offer.get("checkout_date") or payload.get("checkout_date"),
            "hotel_offer_id": hotel_offer_id,
            "booking_status": "pending"
        }]
        
    booked_count = 0
    failed_segments = []
    
    for seg in segments:
        seg_order = seg.get("segment_order", 1)
        seg_id = seg.get("id")
        seg_offer_id = seg.get("hotel_offer_id")
        
        try:
            print(f"[Booking] Processing segment {seg_order} | Offer: {seg_offer_id}")
            if not seg_offer_id:
                raise ValueError("No hotel offer selected for segment")
                
            seg_offer = await db_service.get_hotel_offer(seg_offer_id)
            if not seg_offer:
                raise ValueError(f"Hotel offer {seg_offer_id} not found in DB")
                
            print(f"[Booking] Prebooking segment {seg_order} | LiteAPI rate {seg_offer['liteapi_rate_id']}")
            prebook_result = await liteapi_service.prebook_rate(
                rate_id=seg_offer["liteapi_rate_id"],
            )
            
            print(f"[Booking] Confirming segment {seg_order} | Prebook ID: {prebook_result.get('prebookId')}")
            book_result = await liteapi_service.book_rate(
                prebook_id=prebook_result.get("prebookId"),
                guest_info=liteapi_guest,
            )
            
            booking_id_str = book_result.get("bookingId")
            
            # Update segment in DB
            if seg_id:
                await db_service.update_hotel_segment(seg_id, {
                    "liteapi_booking_id": booking_id_str,
                    "booking_status": "confirmed"
                })
            else:
                # If we fell back, save it to DB so we have a record
                await db_service.save_hotel_segments(trip_id, [{
                    "segment_order": seg_order,
                    "checkin_date": seg.get("checkin_date"),
                    "checkout_date": seg.get("checkout_date"),
                    "hotel_offer_id": seg_offer_id,
                    "price_per_night_inr": seg_offer.get("amount_per_night_inr"),
                    "total_price_inr": seg_offer.get("total_amount_inr"),
                    "liteapi_booking_id": booking_id_str,
                    "booking_status": "confirmed"
                }])
                
            booked_count += 1
            print(f"[Booking] ✓ Segment {seg_order} confirmed: {booking_id_str}")
            
        except Exception as seg_err:
            err_msg = str(seg_err)
            print(f"[Booking] ✗ Segment {seg_order} failed: {err_msg}")
            failed_segments.append(f"Segment {seg_order}: {err_msg}")
            if seg_id:
                await db_service.update_hotel_segment(seg_id, {
                    "booking_status": "failed",
                    "failure_reason": err_msg
                })
                
    # Update main booking entry and trip status
    total_segments = len(segments)
    if booked_count == total_segments:
        results["liteapi_status"] = "confirmed"
        results["liteapi_booking_id"] = "multi" if total_segments > 1 else segments[0].get("liteapi_booking_id")
        
        await db_service.update_booking(booking_id, {
            "liteapi_booking_status": "confirmed",
            "booking_status": "fully_confirmed",
        })
        await db_service.update_trip_status(trip_id, "confirmed")
        print("[Booking] ✓ All hotel segments confirmed!")
    elif booked_count > 0:
        results["liteapi_status"] = "partial_failure"
        fail_details = "; ".join(failed_segments)
        
        await db_service.update_booking(booking_id, {
            "liteapi_booking_status": "failed",
            "booking_status": "partial_failure",
            "failure_reason": f"Hotel booking partially succeeded ({booked_count} of {total_segments} booked). Failures: {fail_details}",
        })
        await db_service.update_trip_status(trip_id, "failed")
        print(f"[Booking] ⚠️ Hotel booking partially confirmed ({booked_count}/{total_segments})")
    else:
        results["liteapi_status"] = "failed"
        fail_details = "; ".join(failed_segments)
        
        await db_service.update_booking(booking_id, {
            "liteapi_booking_status": "failed",
            "booking_status": "partial_failure",
            "failure_reason": f"All hotel bookings failed. Failures: {fail_details}",
        })
        await db_service.update_trip_status(trip_id, "failed")
        print("[Booking] ✗ All hotel bookings failed!")
        
    return results


def _build_passenger_list(passengers: list[dict], flight_offer: dict) -> list[dict]:
    """Build Duffel passenger payload using real passengers from DB with offer passenger IDs attached."""
    offer_passengers = flight_offer.get("raw_payload", {}).get("passengers", [])
    
    if not passengers:
        # Fallback to dummy passenger if DB is empty
        dummy = {
            "type": "adult",
            "title": "mr",
            "given_name": "Trip",
            "family_name": "Traveller",
            "gender": "m",
            "date_of_birth": "1990-01-01",
            "email": "traveller@tripio.ai",
            "phone_number": "+919999999999",
        }
        if offer_passengers:
            dummy["id"] = offer_passengers[0].get("id")
        return [dummy]
    
    res = []
    for i, p in enumerate(passengers):
        gender_code = "m"
        if p.get("gender") == "female":
            gender_code = "f"
        elif p.get("gender") == "other":
            gender_code = "u"

        item = {
            "type": p.get("passenger_type", "adult").lower(),
            "title": p.get("title", "mr").lower(),
            "given_name": p.get("first_name", ""),
            "family_name": p.get("last_name", ""),
            "gender": gender_code,
            "date_of_birth": p.get("date_of_birth", "1990-01-01"),
            "email": p.get("email", ""),
            "phone_number": p.get("phone", ""),
        }
        # Attach passenger ID from original offer request if matched by index
        if i < len(offer_passengers):
            item["id"] = offer_passengers[i].get("id")
            
        res.append(item)
    return res


def _build_guest_info(passengers: list[dict]) -> dict:
    """Build LiteAPI guest payload using primary passenger's real details."""
    if not passengers:
        return {
            "firstName": "Trip",
            "lastName": "Traveller",
            "email": "traveller@tripio.ai",
            "phone": "+919999999999",
        }
    
    p = passengers[0]
    return {
        "firstName": p.get("first_name", "Trip"),
        "lastName": p.get("last_name", "Traveller"),
        "email": p.get("email", "traveller@tripio.ai"),
        "phone": p.get("phone", "+919999999999"),
    }


async def _emit_sse(state: dict, event: dict):
    trip_id = state.get("trip_id")
    if trip_id:
        await sse_registry.put(trip_id, event)
