"""
TripioAI — LiteAPI Client
Handles hotel search (rates), prebooking, and booking
"""
import os
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

LITEAPI_API_URL = os.environ.get("LITEAPI_API_URL", "https://api.liteapi.travel/v3.0")
LITEAPI_API_KEY = os.environ.get("LITEAPI_API_KEY", "")

class LiteAPIService:
    def __init__(self):
        self.headers = {
            "X-API-Key": LITEAPI_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def search_rates(
        self,
        iata_code: str,
        checkin: str,
        checkout: str,
        num_adults: int,
        num_children: int = 0,
        currency: str = "INR",
    ) -> list[dict]:
        """
        Search hotel rates for a destination.
        Uses LiteAPI POST /hotels/rates endpoint.
        """
        occupancies = []
        
        # Split adults across rooms (max 3 adults per room)
        rooms_needed = max(1, -(-num_adults // 3))  # ceiling division
        adults_per_room = num_adults // rooms_needed
        
        for i in range(rooms_needed):
            adults_in_room = adults_per_room + (1 if i < num_adults % rooms_needed else 0)
            occ = {"adults": max(1, adults_in_room)}
            if num_children > 0 and i == 0:
                occ["children"] = [10] * min(num_children, 2)  # max 2 children per room
            occupancies.append(occ)
        
        payload = {
            "iataCode": iata_code,
            "checkin": checkin,
            "checkout": checkout,
            "occupancies": occupancies,
            "currency": currency,
            "guestNationality": "IN",
        }
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            print("\n========== LITEAPI REQUEST ==========")
            print("URL:", f"{LITEAPI_API_URL}/hotels/rates")
            print("Payload:", payload)
            print("====================================")

            resp = await client.post(
                f"{LITEAPI_API_URL}/hotels/rates",
                headers=self.headers,
                json=payload,
            )
            
            print(f"[LiteAPI] Rates API Status: {resp.status_code}")

            if resp.status_code == 429:
                raise Exception("LiteAPI rate limit reached. Please try again in a moment.")
            
            if not resp.is_success:
                error_data = resp.text[:500]
                raise Exception(f"LiteAPI error {resp.status_code}: {error_data}")
            
            data = resp.json()

            return data.get("data", [])

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10)
    )
    async def get_hotel_details(self, hotel_id: str) -> dict:
        async with httpx.AsyncClient(timeout=30.0) as client:

            resp = await client.get(
                f"{LITEAPI_API_URL}/data/hotel",
                headers=self.headers,
                params={
                    "hotelId": hotel_id
                }
            )

            if not resp.is_success:
                raise Exception(
                    f"LiteAPI hotel details error {resp.status_code}: {resp.text[:500]}"
                )

            return resp.json().get("data", {})
        
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def prebook_rate(self, rate_id: str) -> dict:
        """Lock and revalidate a hotel rate before booking"""
        payload = {"rateId": rate_id}
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{LITEAPI_API_URL}/rates/prebook",
                headers=self.headers,
                json=payload,
            )
            
            if not resp.is_success:
                raise Exception(f"LiteAPI prebook error {resp.status_code}: {resp.text[:500]}")
            
            return resp.json().get("data", {})
    
    @retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def book_rate(self, prebook_id: str, guest_info: dict) -> dict:
        """Confirm hotel booking"""
        payload = {
            "prebookId": prebook_id,
            "guestInfo": guest_info,
        }
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{LITEAPI_API_URL}/rates/book",
                headers=self.headers,
                json=payload,
            )
            
            if not resp.is_success:
                raise Exception(f"LiteAPI book error {resp.status_code}: {resp.text[:500]}")
            
            return resp.json().get("data", {})
    
    def normalize_hotel(
        self,
        hotel_data: dict,
        num_nights: int,
        rank: int,
        currency: str = "USD",
    ) -> dict:
        """
        Normalize LiteAPI hotel response into TripioAI schema.
        Expects hotel_data to contain:
            - roomTypes/rates from /hotels/rates
            - details from /data/hotel
        """

        try:
            details = hotel_data.get("details", {})

            room_types = hotel_data.get("roomTypes", [])
            if not room_types:
                return None

            room = room_types[0]

            rates = room.get("rates", [])
            if not rates:
                return None

            rate = rates[0]

            retail_rate = rate.get("retailRate", {})
            total = retail_rate.get("total", [])

            if not total:
                return None

            amount = float(total[0].get("amount", 0))
            currency_code = total[0].get("currency", currency)

            refundable_tag = (
                rate.get("cancellationPolicies", {})
                .get("refundableTag", "")
            )

            hotel_images = details.get("hotelImages", [])

            image_url = ""
            if hotel_images:
                image_url = hotel_images[0].get("url", "")

            return {
                # IDs
                "liteapi_hotel_id": hotel_data.get("hotelId", ""),
                "liteapi_rate_id": rate.get("rateId", ""),
                "liteapi_offer_id": hotel_data.get("offerId", ""),

                # Hotel info
                "hotel_name": details.get("name", "Unknown Hotel"),
                "hotel_address": details.get("address", ""),
                "hotel_description": details.get("hotelDescription", ""),
                "city": details.get("cityName", ""),
                "country": details.get("country", ""),
                "latitude": details.get("latitude"),
                "longitude": details.get("longitude"),

                # Ratings
                "star_rating": float(details.get("stars", 0) or 0),
                "review_score": float(details.get("rating", 0) or 0),

                # Images
                "image_url": image_url,

                # Room
                "room_type": rate.get("name", "Standard Room"),
                "board_type": rate.get("boardType", ""),
                "board_name": rate.get("boardName", ""),

                # Refund
                "is_refundable": refundable_tag.upper() != "NRFN",

                # Pricing
                "amount_per_night_original": amount / num_nights if num_nights > 0 else amount,
                "total_amount_original": amount,
                "currency_original": currency_code,

                # Stay
                "num_nights": num_nights,

                # Sorting
                "rank": rank,

                # Keep raw payload for debugging/booking
                "raw_payload": hotel_data,
            }

        except Exception as e:
            print(f"[LiteAPI] normalize_hotel failed: {e}")
            return None


# Singleton instance
liteapi_service = LiteAPIService()
