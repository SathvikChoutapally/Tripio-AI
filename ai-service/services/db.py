"""
TripioAI — Database Service
Async Supabase client for all DB operations from the Python AI service
"""

import os
from typing import Any, Optional
from supabase import create_client, Client


class DBService:
    def __init__(self):
        self._client: Optional[Client] = None
    
    async def init(self):
        """Initialize Supabase client.
        Prefers SUPABASE_SERVICE_ROLE_KEY (bypasses RLS) but falls back to
        SUPABASE_ANON_KEY if the service role key is not set (e.g. ai-service .env).
        """
        url = os.environ.get("SUPABASE_URL")
        key = (
            os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            or os.environ.get("SUPABASE_ANON_KEY")
        )
        
        if not url or not key:
            print("[DB] Warning: SUPABASE_URL and at least one Supabase key must be set")
            return
        
        self._client = create_client(url, key)
        key_type = "service_role" if os.environ.get("SUPABASE_SERVICE_ROLE_KEY") else "anon"
        print(f"[DB] Supabase client initialized (key_type={key_type})")
    
    async def close(self):
        pass  # Supabase Python client doesn't need explicit close
    
    @property
    def client(self) -> Client:
        if not self._client:
            # Lazy init — prefer service role, fall back to anon
            url = os.environ.get("SUPABASE_URL", "")
            key = (
                os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
                or os.environ.get("SUPABASE_ANON_KEY", "")
            )
            self._client = create_client(url, key)
        return self._client
    
    # ── Trip Operations ────────────────────────────────────────
    
    async def update_trip(self, trip_id: str, data: dict):
        result = self.client.table("trips").update(data).eq("id", trip_id).execute()
        return result.data
    
    async def update_trip_status(self, trip_id: str, status: str):
        return await self.update_trip(trip_id, {"status": status})
    
    async def get_trip(self, trip_id: str) -> Optional[dict]:
        result = self.client.table("trips").select("*").eq("id", trip_id).maybe_single().execute()
        return result.data
    
    # ── Chat Messages ──────────────────────────────────────────
    
    async def save_message(self, trip_id: str, user_id: str, role: str, content: str, metadata: dict = None):
        result = self.client.table("chat_messages").insert({
            "trip_id": trip_id,
            "user_id": user_id,
            "role": role,
            "content": content,
            "metadata": metadata or {},
        }).execute()
        return result.data
    
    # ── Agent Traces ───────────────────────────────────────────
    
    async def record_trace(
        self,
        trip_id: str,
        user_id: str,
        node_name: str,
        status: str,
        input: dict = None,
        output: dict = None,
        latency_ms: int = None,
        error: str = None,
    ):
        try:
            self.client.table("agent_traces").insert({
                "trip_id": trip_id,
                "user_id": user_id,
                "node_name": node_name,
                "status": status,
                "input_payload": input or {},
                "output_payload": output or {},
                "latency_ms": latency_ms,
                "error_message": error,
            }).execute()
        except Exception as e:
            print(f"[DB] Trace record failed: {e}")
    
    # ── Flight Offers ──────────────────────────────────────────
    
    async def save_flight_offers(self, trip_id: str, offers: list[dict]) -> list[dict]:
        # Clear existing offers for this trip
        self.client.table("flight_offers").delete().eq("trip_id", trip_id).execute()
        
        records = [{**o, "trip_id": trip_id} for o in offers if o]
        if not records:
            return []
        
        result = self.client.table("flight_offers").insert(records).execute()
        return result.data or []
    
    async def get_flight_offer(self, offer_id: str) -> Optional[dict]:
        result = self.client.table("flight_offers").select("*").eq("id", offer_id).maybe_single().execute()
        return result.data
    
    # ── Hotel Offers ───────────────────────────────────────────
    
    async def save_hotel_offers(self, trip_id: str, offers: list[dict], segment_order: Optional[int] = None) -> list[dict]:
        if segment_order is not None:
            # Re-planning a specific segment: clear its references and delete only that segment's offers
            self.client.table("hotel_segments").update({
                "hotel_offer_id": None,
                "price_per_night_inr": None,
                "total_price_inr": None
            }).eq("trip_id", trip_id).eq("segment_order", segment_order).execute()
            self.client.table("hotel_offers").delete().eq("trip_id", trip_id).eq("segment_order", segment_order).execute()
        else:
            # Delete segments first to avoid foreign key violations
            self.client.table("hotel_segments").delete().eq("trip_id", trip_id).execute()
            self.client.table("hotel_offers").delete().eq("trip_id", trip_id).execute()
        
        records = [{**o, "trip_id": trip_id} for o in offers if o]
        if not records:
            return []
        
        result = self.client.table("hotel_offers").insert(records).execute()
        return result.data or []
    
    async def get_hotel_offer(self, offer_id: str) -> Optional[dict]:
        result = self.client.table("hotel_offers").select("*").eq("id", offer_id).maybe_single().execute()
        return result.data
    
    # ── Hotel Segments ──────────────────────────────────────────
    
    async def save_hotel_segments(self, trip_id: str, segments: list[dict]) -> list[dict]:
        self.client.table("hotel_segments").delete().eq("trip_id", trip_id).execute()
        records = [{**s, "trip_id": trip_id} for s in segments if s]
        if not records:
            return []
        result = self.client.table("hotel_segments").insert(records).execute()
        return result.data or []
        
    async def get_hotel_segments(self, trip_id: str) -> list[dict]:
        result = self.client.table("hotel_segments").select("*").eq("trip_id", trip_id).order("segment_order").execute()
        return result.data or []
        
    async def update_hotel_segment(self, segment_id: str, data: dict) -> list[dict]:
        result = self.client.table("hotel_segments").update(data).eq("id", segment_id).execute()
        return result.data or []

    async def update_hotel_segment_by_order(self, trip_id: str, segment_order: int, data: dict) -> list[dict]:
        """Update a hotel segment by trip_id + segment_order (for confirm-selections flow)."""
        result = (
            self.client.table("hotel_segments")
            .update(data)
            .eq("trip_id", trip_id)
            .eq("segment_order", segment_order)
            .execute()
        )
        return result.data or []
    
    # ── Bookings ───────────────────────────────────────────────
    
    async def update_booking(self, booking_id: str, data: dict):
        result = self.client.table("bookings").update(data).eq("id", booking_id).execute()
        return result.data
    
    # ── Knowledge Chunks (RAG) ─────────────────────────────────
    
    async def similarity_search(
        self,
        embedding: list[float],
        destination: str,
        top_k: int = 5,
        threshold: float = 0.5,
    ) -> list[dict]:
        try:
            result = self.client.rpc("match_knowledge_chunks", {
                "query_embedding": embedding,
                "match_threshold": threshold,
                "match_count": top_k,
                "filter_destination": destination,
            }).execute()
            return result.data or []
        except Exception as e:
            print(f"[DB] Similarity search failed: {e}")
            return []
    
    # ── Metrics ────────────────────────────────────────────────
    
    async def get_agent_metrics(self, days: int = 7) -> dict:
        from datetime import datetime, timedelta
        since = (datetime.utcnow() - timedelta(days=days)).isoformat()
        
        traces = self.client.table("agent_traces").select("*").gte("created_at", since).execute()
        trace_data = traces.data or []
        
        node_stats = {}
        for trace in trace_data:
            node = trace.get("node_name", "unknown")
            if node not in node_stats:
                node_stats[node] = {"total": 0, "success": 0, "failed": 0, "total_latency_ms": 0}
            node_stats[node]["total"] += 1
            if trace.get("status") == "completed":
                node_stats[node]["success"] += 1
            if trace.get("status") == "failed":
                node_stats[node]["failed"] += 1
            if trace.get("latency_ms"):
                node_stats[node]["total_latency_ms"] += trace["latency_ms"]
        
        for node in node_stats.values():
            total = node["total"]
            node["avg_latency_ms"] = round(node["total_latency_ms"] / total) if total > 0 else 0
            node["success_rate"] = round(node["success"] / total * 100, 1) if total > 0 else 0
        
        return {"period_days": days, "by_node": node_stats, "total_traces": len(trace_data)}


# Singleton
db_service = DBService()
