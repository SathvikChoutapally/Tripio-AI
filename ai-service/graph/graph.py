"""
TripioAI — LangGraph StateGraph Definition
Builds the multi-agent graph with all nodes and conditional edges

Selection-First Flow:
  Step 1 (Search): orchestrator → flight_tool → hotel_tool → END (awaiting_selection)
  Step 2 (User selects via UI, calls /confirm-selections)
  Step 3 (Generate): orchestrator → itinerary_tool → budget_check → conversation → END

Re-planning flow:
  - replan_flight: orchestrator → flight_tool → END (awaiting_selection)
  - replan_hotel:  orchestrator → hotel_tool → END (awaiting_selection)
  - replan_itinerary: orchestrator → itinerary_tool → budget_check → conversation → END
"""

import asyncio
import os
from typing import Any

from langchain_core.messages import HumanMessage, AIMessage
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from graph.state import TripState
from graph.nodes.orchestrator import orchestrator_node
from graph.nodes.budget_node import budget_node
from graph.nodes.conversation_node import conversation_node
from graph.nodes.booking_node import booking_node

from tools.flight_tool import flight_tool_node
from tools.hotel_tool import hotel_tool_node
from tools.itinerary_tool import itinerary_tool_node

# ── Graph Build ───────────────────────────────────────────────

_graph_instance = None


async def build_graph():
    """Build and compile the LangGraph StateGraph"""
    global _graph_instance
    if _graph_instance is not None:
        return _graph_instance
    
    # Define the graph with dict as state type
    graph = StateGraph(dict)
    
    # ── Add Nodes ─────────────────────────────────────────────
    graph.add_node("orchestrator", orchestrator_node)
    graph.add_node("flight_tool", flight_tool_node)
    graph.add_node("hotel_tool", hotel_tool_node)
    graph.add_node("budget_check", budget_node)
    graph.add_node("itinerary_tool", itinerary_tool_node)
    graph.add_node("conversation", conversation_node)
    graph.add_node("booking", booking_node)
    
    # ── Entry Point ───────────────────────────────────────────
    graph.set_entry_point("orchestrator")
    
    # ── Orchestrator → Routes ─────────────────────────────────
    graph.add_conditional_edges(
        "orchestrator",
        route_from_orchestrator,
        {
            "flight_tool": "flight_tool",
            "hotel_tool": "hotel_tool",
            "itinerary_tool": "itinerary_tool",
            "conversation": "conversation",
            "booking": "booking",
            "end": END,
        }
    )
    
    # ── After Flight Tool: either pause (awaiting_selection / replan_flight)
    # or continue to hotel_tool for initial search
    graph.add_conditional_edges(
        "flight_tool",
        route_from_flight_tool,
        {
            "hotel_tool": "hotel_tool",
            "end": END,
        }
    )
    
    # ── After Hotel Tool → always END (user must confirm selections)
    graph.add_conditional_edges(
        "hotel_tool",
        route_from_hotel_tool,
        {
            "end": END,
        }
    )
    
    # ── After Itinerary → Budget Check ──────────────────────
    graph.add_edge("itinerary_tool", "budget_check")
    
    # ── Budget Check → Conversation (present full plan) ─────
    graph.add_edge("budget_check", "conversation")
    
    # ── Conversation → End (or back to orchestrator for follow-ups)
    graph.add_conditional_edges(
        "conversation",
        route_from_conversation,
        {
            "orchestrator": "orchestrator",
            "end": END,
        }
    )
    
    # ── Booking → End ─────────────────────────────────────────
    graph.add_edge("booking", END)
    
    # ── Compile with in-memory checkpointer ──────────────────
    checkpointer = MemorySaver()
    compiled = graph.compile(checkpointer=checkpointer)
    
    _graph_instance = compiled
    return compiled


async def get_or_create_graph():
    return await build_graph()


# ── Routing Functions ─────────────────────────────────────────

def route_from_orchestrator(state: dict) -> str:
    """Decide where to go after the orchestrator"""
    status = state.get("status", "planning")
    
    if status == "chat":
        return "conversation"
    elif status == "booking":
        return "booking"
    elif status in ("planning", "searching"):
        return "flight_tool"
    elif status == "confirm_selections":
        # Should have already been changed to generating_plan by orchestrator
        return "itinerary_tool"
    elif status == "generating_plan":
        return "itinerary_tool"
    elif status == "replan_flight":
        return "flight_tool"
    elif status == "replan_hotel":
        return "hotel_tool"
    elif status in ("replan_itinerary", "replan_budget"):
        return "itinerary_tool"
    elif status == "done":
        return "end"
    
    return "conversation"


def route_from_flight_tool(state: dict) -> str:
    """After flight_tool: if replanning flight, end; otherwise continue to hotel_tool"""
    status = state.get("status", "")
    # If we're now awaiting selection (replan_flight returns awaiting_selection), end
    if status == "awaiting_selection":
        return "end"
    # Otherwise continue to hotel search (initial planning)
    return "hotel_tool"


def route_from_hotel_tool(state: dict) -> str:
    """After hotel_tool: always end to pause and wait for user selections"""
    return "end"


def route_from_conversation(state: dict) -> str:
    """After conversation node — loop back if more processing needed"""
    status = state.get("status", "")
    
    if status in ("planning", "searching"):
        return "orchestrator"
    
    return "end"
