"""
TripioAI — Python FastAPI AI Service
Hosts all LangGraph agent logic, tools, and RAG retrieval
"""

import asyncio
import json
import os
import sys

# Fix Windows console encoding issues (emoji / UTF-8 chars crash on cp1252)
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from contextlib import asynccontextmanager
from typing import AsyncIterator

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

load_dotenv()

# Import graph after env is loaded
from graph.graph import build_graph, get_or_create_graph
from graph.state import TripBrief, ChatTurn, BookingPayload
from services.db import db_service
import sse_registry


class ConfirmSelectionsPayload(BaseModel):
    """POST /agent/confirm-selections request body"""
    trip_id: str
    user_id: str
    selected_flight_offer_id: str
    selected_hotel_offer_ids: list[dict]  # [{segment_order, hotel_offer_id}, ...]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle"""
    print("[TripioAI] AI Service starting...")
    await db_service.init()
    yield
    print("[TripioAI] AI Service shutting down...")
    await db_service.close()


app = FastAPI(
    title="TripioAI Agent Service",
    version="1.0.0",
    description="LangGraph multi-agent travel planner",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Node server only — restrict in prod
    allow_methods=["*"],
    allow_headers=["*"],
)


# -- Health Check --------------------------------------------------------------
@app.get("/health")
async def health():
    return {"status": "ok", "service": "tripio-ai-service"}


# -- GET /agent/resolve-city ---------------------------------------------------
@app.get("/agent/resolve-city")
async def resolve_city_endpoint(q: str):
    """
    Endpoint for live city autocomplete / resolution.
    Calls resolve_city and returns matches.
    """
    from tools.city_resolver import resolve_city
    res = await resolve_city(q)
    return res.dict()



# -- POST /agent/plan ----------------------------------------------------------
@app.post("/agent/plan")
async def plan_trip(brief: TripBrief):
    """
    Kick off a new trip planning run.
    Creates a LangGraph thread for this trip and streams progress via SSE queue.
    Returns immediately; client polls /agent/stream/:trip_id for updates.
    """
    trip_id = brief.trip_id

    # Create SSE queue for this trip (via registry — NOT stored in graph state)
    sse_registry.get_or_create(trip_id)

    async def run_graph():
        try:
            graph = await build_graph()
            await graph.ainvoke(
                {
                    "trip_id": trip_id,
                    "user_id": brief.user_id,
                    "num_adults": brief.num_adults,
                    "num_children": brief.num_children,
                    "date_start": brief.date_start,
                    "date_end": brief.date_end,
                    "budget_inr": brief.budget_inr,
                    "origin_iata": brief.origin_iata,
                    "destination_iata": brief.destination_iata,
                    "origin_city": brief.origin_city,
                    "destination_city": brief.destination_city,
                    "messages": [],
                    "flight_offers": [],
                    "hotel_offers": [],
                    "itinerary": None,
                    "budget_breakdown": {},
                    "status": "planning",
                    "loop_count": 0,
                    # NOTE: sse_queue is intentionally NOT in state — it cannot be
                    # serialized by MemorySaver. Nodes use sse_registry.put() instead.
                },
                config={
                    "configurable": {"thread_id": trip_id},
                    "run_name": f"trip_plan_{trip_id}",
                    "tags": [f"trip:{trip_id}", f"user:{brief.user_id}"],
                    "metadata": {
                        "trip_id": trip_id,
                        "user_id": brief.user_id,
                    },
                },
            )
        except Exception as e:
            print(f"[Graph Error] {trip_id}: {e}")
            await sse_registry.put(trip_id, {"type": "error", "message": str(e)})
        finally:
            await sse_registry.put(trip_id, {"type": "done"})

    # Run graph in background
    asyncio.create_task(run_graph())

    return {"trip_id": trip_id, "status": "planning_started"}


# -- POST /agent/chat ----------------------------------------------------------
@app.post("/agent/chat")
async def chat_turn(turn: ChatTurn):
    """
    Send a conversational message to the running agent for a trip.
    """
    trip_id = turn.trip_id

    # Create or reuse SSE queue (via registry)
    sse_registry.get_or_create(trip_id)

    async def run_chat():
        try:
            graph = await build_graph()
            
            # Restore trip context from DB so IATA codes, dates, budget etc.
            # survive across chat invocations (MemorySaver checkpoint merges on
            # the same thread_id, but we must seed any fields that may be missing)
            trip_context = {}
            try:
                trip_row = await db_service.get_trip(trip_id)
                if trip_row:
                    trip_context = {
                        "num_adults":        trip_row.get("num_adults", 1),
                        "num_children":      trip_row.get("num_children", 0),
                        "date_start":        trip_row.get("date_start"),
                        "date_end":          trip_row.get("date_end"),
                        "budget_inr":        trip_row.get("budget_inr"),
                        "origin_iata":       trip_row.get("origin_iata"),
                        "destination_iata":  trip_row.get("destination_iata"),
                        "origin_city":       trip_row.get("origin_city"),
                        "destination_city":  trip_row.get("destination_city"),
                    }
            except Exception as ctx_err:
                print(f"[Chat] Warning: could not load trip context: {ctx_err}")
            
            await graph.ainvoke(
                {
                    **trip_context,  # restore all trip fields first
                    "trip_id":    trip_id,
                    "user_id":    turn.user_id,
                    "messages":   [{"role": "user", "content": turn.message}],
                    "status":     "chat",
                    "loop_count": 0,
                },
                config={
                    "configurable": {"thread_id": trip_id},
                    "run_name": f"chat_{trip_id}",
                    "tags": [f"trip:{trip_id}", f"user:{turn.user_id}", "chat"],
                },
            )
        except Exception as e:
            print(f"[Chat Error] {trip_id}: {e}")
            await sse_registry.put(trip_id, {"type": "error", "message": str(e)})
        finally:
            await sse_registry.put(trip_id, {"type": "chat_done"})

    asyncio.create_task(run_chat())
    return {"trip_id": trip_id, "status": "processing"}


# -- GET /agent/stream/{trip_id} -----------------------------------------------
@app.get("/agent/stream/{trip_id}")
async def stream_agent(trip_id: str, request: Request):
    """
    SSE endpoint streaming agent step-by-step progress for a trip.
    """
    # Ensure queue exists (client may connect before plan starts)
    sse_registry.get_or_create(trip_id)
    queue = sse_registry.get(trip_id)

    async def event_generator() -> AsyncIterator[dict]:
        try:
            while True:
                if await request.is_disconnected():
                    break

                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                except asyncio.TimeoutError:
                    # Send keepalive ping
                    yield {"event": "ping", "data": ""}
                    continue

                yield {"event": event.get("type", "message"), "data": json.dumps(event)}

                if event.get("type") in ("done", "error"):
                    break
        finally:
            pass  # Queue persists for reconnections

    return EventSourceResponse(event_generator())


# -- POST /agent/book ----------------------------------------------------------
@app.post("/agent/book")
async def trigger_booking(payload: BookingPayload):
    """
    Trigger actual Duffel + LiteAPI booking after payment verification.
    Called by the Node server after Razorpay webhook confirms payment.
    """
    from graph.nodes.booking_node import execute_booking

    try:
        result = await execute_booking(payload.dict())
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# -- GET /admin/metrics --------------------------------------------------------
@app.get("/admin/metrics")
async def get_metrics(days: int = 7):
    """
    Return LangSmith-style metrics from agent_traces table.
    """
    try:
        metrics = await db_service.get_agent_metrics(days)
        return metrics
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# -- POST /agent/confirm-selections --------------------------------------------
@app.post("/agent/confirm-selections")
async def confirm_selections(payload: ConfirmSelectionsPayload):
    """
    Persist user flight + hotel selections, then resume the graph to
    generate the itinerary and budget breakdown.
    """
    trip_id = payload.trip_id
    user_id = payload.user_id

    # Save flight selection to trips table
    await db_service.update_trip(trip_id, {
        "selected_flight_offer_id": payload.selected_flight_offer_id,
        "status": "searching",
    })

    # Save each hotel segment selection
    for sel in payload.selected_hotel_offer_ids:
        seg_order = sel.get("segment_order")
        hotel_offer_id = sel.get("hotel_offer_id")
        if not seg_order or not hotel_offer_id:
            continue
        # Fetch the offer to get price details
        hotel_offer = await db_service.get_hotel_offer(str(hotel_offer_id))
        if hotel_offer:
            await db_service.update_hotel_segment_by_order(trip_id, int(seg_order), {
                "hotel_offer_id": hotel_offer_id,
                "price_per_night_inr": hotel_offer.get("amount_per_night_inr"),
                "total_price_inr": hotel_offer.get("total_amount_inr"),
                "booking_status": "pending",
            })

    # Ensure SSE queue exists
    sse_registry.get_or_create(trip_id)

    async def run_generate():
        try:
            graph = await build_graph()
            trip_row = await db_service.get_trip(trip_id) or {}
            await graph.ainvoke(
                {
                    "trip_id": trip_id,
                    "user_id": user_id,
                    "num_adults": trip_row.get("num_adults", 1),
                    "num_children": trip_row.get("num_children", 0),
                    "date_start": trip_row.get("date_start"),
                    "date_end": trip_row.get("date_end"),
                    "budget_inr": float(trip_row.get("budget_inr", 0)),
                    "origin_iata": trip_row.get("origin_iata"),
                    "destination_iata": trip_row.get("destination_iata"),
                    "origin_city": trip_row.get("origin_city"),
                    "destination_city": trip_row.get("destination_city"),
                    "messages": [],
                    "status": "generating_plan",
                    "loop_count": 0,
                },
                config={
                    "configurable": {"thread_id": trip_id},
                    "run_name": f"confirm_selections_{trip_id}",
                },
            )
        except Exception as e:
            print(f"[ConfirmSelections Error] {trip_id}: {e}")
            await sse_registry.put(trip_id, {"type": "error", "message": str(e)})
        finally:
            await sse_registry.put(trip_id, {"type": "done"})

    asyncio.create_task(run_generate())
    return {"trip_id": trip_id, "status": "generating_plan"}


# -- GET /agent/trip/{trip_id}/pdf --------------------------------------------
@app.get("/agent/trip/{trip_id}/pdf")
async def download_trip_pdf(trip_id: str):
    """
    Generate and stream a PDF summary of the trip:
    flight, hotel segments, day-by-day itinerary, budget breakdown.
    Uses reportlab for PDF generation.
    """
    try:
        from io import BytesIO
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
        from reportlab.lib.enums import TA_LEFT, TA_CENTER
        import datetime

        trip = await db_service.get_trip(trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        segments = await db_service.get_hotel_segments(trip_id)
        selected_flight = None
        if trip.get("selected_flight_offer_id"):
            selected_flight = await db_service.get_flight_offer(str(trip["selected_flight_offer_id"]))

        selected_hotels = []
        for seg in segments:
            if seg.get("hotel_offer_id"):
                h = await db_service.get_hotel_offer(str(seg["hotel_offer_id"]))
                if h:
                    selected_hotels.append({"seg": seg, "hotel": h})

        itinerary = trip.get("itinerary") or []
        budget = trip.get("budget_breakdown") or {}

        buf = BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20*mm, rightMargin=20*mm, topMargin=20*mm, bottomMargin=20*mm)
        styles = getSampleStyleSheet()
        BRAND = colors.HexColor("#4f5fff")
        TEAL = colors.HexColor("#14b8a6")

        title_style = ParagraphStyle("title", parent=styles["Title"], textColor=BRAND, fontSize=22, spaceAfter=4)
        h2_style = ParagraphStyle("h2", parent=styles["Heading2"], textColor=BRAND, fontSize=13, spaceBefore=12, spaceAfter=4)
        body_style = styles["BodyText"]
        small_style = ParagraphStyle("small", parent=body_style, fontSize=9, textColor=colors.grey)

        story = []
        story.append(Paragraph("TripioAI — Trip Summary", title_style))
        story.append(Paragraph(f"{trip.get('origin_city','?')} → {trip.get('destination_city','?')}", styles["Heading3"]))
        story.append(Paragraph(f"{trip.get('date_start')} to {trip.get('date_end')} | Budget: ₹{float(trip.get('budget_inr',0)):,.0f}", small_style))
        story.append(Paragraph(f"Generated: {datetime.datetime.now().strftime('%d %b %Y, %I:%M %p')}", small_style))
        story.append(HRFlowable(width="100%", thickness=1, color=BRAND, spaceAfter=8))

        # Flight
        story.append(Paragraph("✈ Selected Flight", h2_style))
        if selected_flight:
            story.append(Paragraph(f"<b>{selected_flight.get('airline','?')}</b> | Departure: {selected_flight.get('departure_at','?')} | ₹{float(selected_flight.get('amount_inr',0)):,.0f}", body_style))
        else:
            story.append(Paragraph("No flight selected.", body_style))

        # Hotels
        story.append(Paragraph("🏨 Hotel Stays", h2_style))
        if selected_hotels:
            for item in selected_hotels:
                seg = item["seg"]
                hotel = item["hotel"]
                story.append(Paragraph(
                    f"<b>Day {seg.get('segment_order')}</b>: {seg.get('checkin_date')} → {seg.get('checkout_date')} | "
                    f"{hotel.get('hotel_name','?')} ({hotel.get('star_rating','?')}★) | ₹{float(hotel.get('total_amount_inr',0)):,.0f}",
                    body_style
                ))
        else:
            story.append(Paragraph("No hotel selections found.", body_style))

        # Itinerary
        story.append(Paragraph("📅 Day-by-Day Itinerary", h2_style))
        if itinerary:
            for day in itinerary:
                story.append(Paragraph(f"<b>Day {day.get('day')}: {day.get('date','?')} — {day.get('theme','')}</b>", body_style))
                for act in (day.get("activities") or []):
                    activity = (
                        act.get("activity")
                        or act.get("name")
                        or act.get("title")
                        or act.get("description")
                        or "No activity available"
                    )

                    story.append(
                        Paragraph(
                            f"• {act.get('time','')}: {activity}",
                            small_style
                        )
                    )
                story.append(Spacer(1, 4))
        else:
            story.append(Paragraph("Itinerary not yet generated.", body_style))

        # Budget
        story.append(Paragraph("💰 Budget Breakdown", h2_style))
        if budget:
            tdata = [
                ["Category", "Amount (INR)"],
                ["Flights", f"₹{float(budget.get('flights_inr',0)):,.0f}"],
                ["Hotels", f"₹{float(budget.get('hotel_inr',0)):,.0f}"],
                ["Activities/Food", f"₹{float(budget.get('remaining_for_itinerary_inr',0)):,.0f}"],
                ["Total", f"₹{float(budget.get('combined_inr',0)):,.0f}"],
            ]
            tbl = Table(tdata, colWidths=[100*mm, 60*mm])
            tbl.setStyle(TableStyle([
                ("BACKGROUND", (0,0), (-1,0), BRAND),
                ("TEXTCOLOR", (0,0), (-1,0), colors.white),
                ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
                ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#f0f0ff")]),
                ("GRID", (0,0), (-1,-1), 0.5, colors.HexColor("#cccccc")),
            ]))
            story.append(tbl)
        else:
            story.append(Paragraph("Budget not yet calculated.", body_style))

        doc.build(story)
        buf.seek(0)
        pdf_bytes = buf.read()

        from fastapi.responses import Response
        filename = f"Tripio_{trip_id[:8].upper()}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except ImportError:
        raise HTTPException(status_code=500, detail="reportlab not installed. Run: pip install reportlab")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
