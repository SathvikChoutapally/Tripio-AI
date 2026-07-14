"""
TripioAI — LangGraph Shared State Definition
Pydantic models for the graph state and API request bodies
"""

from __future__ import annotations

import asyncio
from datetime import date
from typing import Any, Optional
from pydantic import BaseModel, Field


class FlightOffer(BaseModel):
    """Normalized flight offer from Duffel"""
    id: Optional[str] = None
    duffel_offer_id: str
    airline: str
    airline_logo_url: Optional[str] = None
    departure_at: str
    arrival_at: str
    duration_minutes: int
    stops: int = 0
    amount_inr: float
    amount_original: float
    currency_original: str
    fx_rate_used: float
    rank: int = 0


class HotelOffer(BaseModel):
    """Normalized hotel offer from LiteAPI"""
    id: Optional[str] = None
    liteapi_hotel_id: str
    liteapi_rate_id: str
    hotel_name: str
    hotel_address: Optional[str] = None
    star_rating: Optional[float] = None
    review_score: Optional[float] = None
    image_url: Optional[str] = None
    room_type: Optional[str] = None
    is_refundable: bool = False
    amount_per_night_inr: float
    total_amount_inr: float
    amount_per_night_original: float
    currency_original: str
    fx_rate_used: float
    num_nights: int
    rank: int = 0


class ItineraryDay(BaseModel):
    """A single day in the generated itinerary"""
    day: int
    date: str
    theme: str
    activities: list[dict[str, Any]]
    meals: list[dict[str, str]]
    transport_tips: list[str]
    estimated_cost_inr: float
    notes: Optional[str] = None


class ChatMessage(BaseModel):
    role: str  # 'user' | 'assistant' | 'tool'
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class TripState(BaseModel):
    """The full shared state of the LangGraph trip planning session"""
    
    # Identity
    trip_id: str
    user_id: str
    
    # Trip inputs
    num_adults: int = 1
    num_children: int = 0
    date_start: str = ""
    date_end: str = ""
    budget_inr: float = 0.0
    origin_iata: str = ""
    destination_iata: str = ""
    origin_city: str = ""
    destination_city: str = ""
    
    # Agent state
    messages: list[ChatMessage] = Field(default_factory=list)
    flight_offers: list[FlightOffer] = Field(default_factory=list)
    hotel_offers: list[HotelOffer] = Field(default_factory=list)
    itinerary: Optional[list[ItineraryDay]] = None
    budget_breakdown: dict[str, float] = Field(default_factory=dict)
    
    # Control flow
    status: str = "planning"  # planning | searching | budget_check | itinerary | chat | confirmed | failed | awaiting_selection
    loop_count: int = 0
    max_loops: int = 3
    budget_satisfied: bool = False
    cheaper_constraint: bool = False
    awaiting_user_selection: bool = False
    replan_segment: Optional[int] = None
    
    # Errors
    error_message: Optional[str] = None
    
    # City Resolver Pending Confirmations
    pending_resolutions: Optional[dict] = None
    
    # SSE Queue (runtime only — not persisted)
    sse_queue: Optional[Any] = Field(default=None, exclude=True)
    
    model_config = {"arbitrary_types_allowed": True}


# ── Request Bodies ────────────────────────────────────────────

class TripBrief(BaseModel):
    """POST /agent/plan request body"""
    trip_id: str
    user_id: str
    num_adults: int = 1
    num_children: int = 0
    date_start: str
    date_end: str
    budget_inr: float
    origin_iata: str
    destination_iata: str
    origin_city: str
    destination_city: str
    origin_liteapi_id: Optional[str] = None
    destination_liteapi_id: Optional[str] = None


class ChatTurn(BaseModel):
    """POST /agent/chat request body"""
    trip_id: str
    user_id: str
    message: str


class BookingPayload(BaseModel):
    """POST /agent/book request body"""
    booking_id: str
    trip_id: str
    user_id: str
    flight_offer_id: str
    hotel_offer_id: str
    razorpay_order_id: str
    razorpay_payment_id: str
