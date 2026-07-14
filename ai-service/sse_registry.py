"""
TripioAI — SSE Queue Registry
Central module-level dict that stores asyncio.Queue instances keyed by trip_id.
This avoids passing the queue through LangGraph state (which cannot be serialized/checkpointed).
"""

import asyncio

# trip_id -> asyncio.Queue
_queues: dict[str, asyncio.Queue] = {}


def get_or_create(trip_id: str, maxsize: int = 500) -> asyncio.Queue:
    """Get existing queue or create a new one for a trip."""
    if trip_id not in _queues:
        _queues[trip_id] = asyncio.Queue(maxsize=maxsize)
    return _queues[trip_id]


def get(trip_id: str):
    """Get existing queue or None."""
    return _queues.get(trip_id)


def put_nowait(trip_id: str, event: dict):
    """Non-blocking put; silently ignores if queue doesn't exist or is full."""
    q = _queues.get(trip_id)
    if q:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


async def put(trip_id: str, event: dict):
    """Async put; silently ignores if queue doesn't exist."""
    q = _queues.get(trip_id)
    if q:
        try:
            await q.put(event)
        except Exception:
            pass
