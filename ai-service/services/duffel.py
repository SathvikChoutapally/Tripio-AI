"""
TripioAI — Duffel API Client
Handles flight search (offer requests) and booking (orders)
"""

import os
import traceback
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

DUFFEL_API_URL = os.environ.get("DUFFEL_API_URL", "https://api.duffel.com")
DUFFEL_API_KEY = os.environ.get("DUFFEL_API_KEY", "")


class DuffelService:
    def __init__(self):
        self.headers = {
            "Authorization": f"Bearer {DUFFEL_API_KEY}",
            "Duffel-Version": "v2",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def create_offer_request(
        self,
        origin_iata: str,
        destination_iata: str,
        date_start: str,
        date_end: str,
        num_adults: int,
        num_children: int = 0,
        cabin_class: str = "economy",
    ) -> list[dict]:
        """
        Create a Duffel offer request for return flights.
        Returns list of normalized offer dicts.
        """
        slices = [
            {
                "origin": origin_iata,
                "destination": destination_iata,
                "departure_date": date_start,
            },
            {
                "origin": destination_iata,
                "destination": origin_iata,
                "departure_date": date_end,
            },
        ]
        
        passengers = [{"type": "adult"} for _ in range(num_adults)]
        if num_children > 0:
            passengers += [{"type": "child"} for _ in range(num_children)]
        
        payload = {
            "data": {
                "slices": slices,
                "passengers": passengers,
                "cabin_class": cabin_class,
                "return_offers": True,
            }
        }
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{DUFFEL_API_URL}/air/offer_requests",
                headers=self.headers,
                json=payload,
            )
            
            if resp.status_code == 429:
                raise Exception("Duffel API rate limit reached. Please try again in a moment.")
            
            if not resp.is_success:
                error_data = resp.json() if resp.content else {}
                raise Exception(f"Duffel API error {resp.status_code}: {error_data}")
            
            data = resp.json()
            offer_request_id = data["data"]["id"]
            offers = data["data"].get("offers", [])
            
            return offer_request_id, offers
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def get_places_suggestions(self, query: str) -> list[dict]:
        """
        Search for places/airports/cities matching the query.
        Uses Duffel GET /places/suggestions endpoint.
        """
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{DUFFEL_API_URL}/places/suggestions",
                headers=self.headers,
                params={"query": query},
            )
            
            if resp.status_code == 429:
                raise Exception("Duffel API rate limit reached. Please try again in a moment.")
            
            if not resp.is_success:
                error_data = resp.json() if resp.content else {}
                raise Exception(f"Duffel API suggestions error {resp.status_code}: {error_data}")
            
            data = resp.json()
            return data.get("data", [])

    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def create_order(
        self,
        offer_id: str,
        passengers: list[dict],
        payment_amount: float,
        payment_currency: str,
    ) -> dict:
        """
        Create a Duffel order (book a flight).
        In test mode, uses Duffel's balance payment method.
        """
        payload = {
            "data": {
                "type": "instant",
                "selected_offers": [offer_id],
                "passengers": passengers,
                "payments": [
                    {
                        "type": "balance",
                        "amount": str(payment_amount),
                        "currency": payment_currency,
                    }
                ],
            }
        }
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{DUFFEL_API_URL}/air/orders",
                headers=self.headers,
                json=payload,
            )
            
            if not resp.is_success:
                error_data = resp.json() if resp.content else {}
                raise Exception(f"Duffel order error {resp.status_code}: {error_data}")
            
            return resp.json()["data"]
    
    def normalize_offer(self, offer: dict, offer_request_id: str, rank: int) -> dict:
        """Convert Duffel offer to our normalized schema"""
        try:
            slices = offer.get("slices", [])
            first_slice = slices[0] if slices else {}
            segments = first_slice.get("segments", [])
            first_seg = segments[0] if segments else {}
            
            # Calculate total duration
            # Calculate total duration in minutes
            total_minutes = 0

            for sl in slices:
                for seg in sl.get("segments", []):
                    duration = seg.get("duration")

                    if isinstance(duration, str):
                        total_minutes += _parse_duration(duration)
                    elif isinstance(duration, (int, float)):
                        total_minutes += duration

            # Fallback to offer duration
            if total_minutes == 0:
                total_minutes = _parse_duration(offer.get("duration", "PT0H"))
            
            # Count stops
            stops = sum(max(0, len(sl.get("segments", [])) - 1) for sl in slices)
            
            airline = (first_seg.get("marketing_carrier", {}).get("name") or
                       first_seg.get("operating_carrier", {}).get("name") or "Unknown")
            airline_iata = (first_seg.get("marketing_carrier", {}).get("iata_code") or
                           first_seg.get("operating_carrier", {}).get("iata_code") or "")
            
            return {
                "duffel_offer_request_id": offer_request_id,
                "duffel_offer_id": offer["id"],
                "airline": airline,
                "airline_logo_url": f"https://assets.duffel.com/img/airlines/for-light-background/full-color-logo/{airline_iata}.svg" if airline_iata else None,
                "departure_at": first_seg.get("departing_at"),
                "arrival_at": slices[-1].get("segments", [{}])[-1].get("arriving_at") if slices else None,
                "duration_minutes": total_minutes,
                "stops": stops,
                "amount_original": float(offer.get("total_amount", 0)),
                "currency_original": offer.get("total_currency", "USD"),
                "rank": rank,
                "raw_payload": offer,
            }
        except Exception as e:
            print("========== DUFFEL NORMALIZE ERROR ==========")
            traceback.print_exc()
            print("============================================")
            return None


def _parse_duration(duration_str: str) -> int:
    """Parse ISO 8601 duration string to minutes"""
    import re
    match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?", duration_str)
    if not match:
        return 0
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    return hours * 60 + minutes


# Singleton instance
duffel_service = DuffelService()
