"""
TripioAI — RAG Embedder
Generates embeddings using Gemini gemini-embedding-001 via langchain_google_genai.
The google.generativeai package is deprecated; using langchain_google_genai instead,
which is async-capable and actively maintained.

NOTE: gemini-embedding-001 defaults to 3072 dims. We pass output_dimensionality=768
to match the existing vector(768) Supabase column (avoids schema migration).
text-embedding-004 was retired January 14, 2026.
"""

import asyncio
import os
from langchain_google_genai import GoogleGenerativeAIEmbeddings

EMBEDDING_MODEL = os.environ.get("GEMINI_EMBEDDING_MODEL", "models/gemini-embedding-001")
EMBEDDING_DIMENSIONS = int(os.environ.get("GEMINI_EMBEDDING_DIMENSIONS", "768"))

# Singleton embedder instance (lazy-initialized)
_embedder: GoogleGenerativeAIEmbeddings | None = None


def _get_embedder() -> GoogleGenerativeAIEmbeddings:
    global _embedder
    if _embedder is None:
        _embedder = GoogleGenerativeAIEmbeddings(
            model=EMBEDDING_MODEL,
            google_api_key=os.environ.get("GOOGLE_API_KEY", ""),
            task_type="retrieval_document",
            dimensions=EMBEDDING_DIMENSIONS,  # downsample to 768 to match existing vector(768) column
        )
    return _embedder


async def embed_query(text: str) -> list[float]:
    """
    Generate embedding for a query text.
    Uses task_type="retrieval_query" for query embeddings.
    """
    embedder = _get_embedder()
    # aembed_query is the async method in langchain_google_genai
    result = await embedder.aembed_query(text)
    return result


async def embed_document(text: str) -> list[float]:
    """
    Generate embedding for a document chunk.
    Uses task_type="retrieval_document" for document embeddings.
    """
    embedder = _get_embedder()
    result = await embedder.aembed_documents([text])
    return result[0]
