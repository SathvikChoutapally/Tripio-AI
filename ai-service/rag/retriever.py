"""
TripioAI — RAG Retriever
Retrieves relevant knowledge chunks from pgvector using cosine similarity
"""

from rag.embedder import embed_query
from services.db import db_service


async def retrieve_knowledge(
    destination: str,
    query: str,
    top_k: int = 5,
    threshold: float = 0.5,
) -> list[dict]:
    """
    Retrieve relevant knowledge chunks for a destination + query.
    
    Steps:
    1. Embed the query using Gemini text-embedding-004
    2. Search knowledge_chunks via pgvector cosine similarity
    3. Return top-k chunks sorted by relevance
    
    Args:
        destination: Target destination (e.g., "Paris")
        query: Search query (e.g., "7 days culture food budget activities")
        top_k: Number of chunks to return
        threshold: Minimum cosine similarity score (0-1)
    
    Returns:
        List of knowledge chunk dicts with content, topic, similarity
    """
    # Build rich query combining destination + user context
    full_query = f"{destination}: {query}"
    
    # Generate embedding for the query
    query_embedding = await embed_query(full_query)
    
    # Search via pgvector
    chunks = await db_service.similarity_search(
        embedding=query_embedding,
        destination=destination,
        top_k=top_k,
        threshold=threshold,
    )
    
    return chunks


def format_chunks_as_context(chunks: list[dict]) -> str:
    """Format retrieved chunks into an LLM-ready context string"""
    if not chunks:
        return "No specific local knowledge available. Use general knowledge for this destination."
    
    parts = ["=== LOCAL KNOWLEDGE BASE ===\n"]
    
    for i, chunk in enumerate(chunks, 1):
        parts.append(
            f"[Source {i}: {chunk.get('destination', '')} — {chunk.get('topic', '')}]"
            f"\n{chunk.get('content', '')}\n"
        )
    
    parts.append("=== END KNOWLEDGE BASE ===")
    
    return "\n".join(parts)
