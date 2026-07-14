"""
TripioAI — LLM Helper
Unified factory: Groq (primary, free & fast) → Gemini (fallback).
Import `get_llm()` or `get_fast_llm()` in any node/tool.
"""

import asyncio
import os

# ── Constants ────────────────────────────────────────────────────────────────

GROQ_API_KEY  = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL    = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_FAST_MODEL = "llama-3.1-8b-instant"          # fast, cheap, for classification

GEMINI_MODEL  = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_FALLBACKS = ["gemini-2.5-flash", "gemini-2.0-flash-lite", "gemini-2.0-flash"]


# ── Factory helpers ──────────────────────────────────────────────────────────

def get_llm(temperature: float = 0.5, streaming: bool = False):
    """
    Return the best available chat LLM:
    1. Groq Llama-3.3-70B  (primary — very fast, very capable)
    2. Gemini 2.5 Flash     (fallback if Groq key missing)
    """
    if GROQ_API_KEY:
        from langchain_groq import ChatGroq
        return ChatGroq(
            api_key=GROQ_API_KEY,
            model=GROQ_MODEL,
            temperature=temperature,
            streaming=streaming,
        )
    from langchain_google_genai import ChatGoogleGenerativeAI
    return ChatGoogleGenerativeAI(model=GEMINI_MODEL, temperature=temperature, streaming=streaming)


def get_fast_llm(temperature: float = 0):
    """
    Return a fast, lightweight LLM for classification/routing tasks.
    1. Groq Llama-3-8B  (sub-100ms inference)
    2. Gemini 2.5 Flash fallback
    """
    if GROQ_API_KEY:
        from langchain_groq import ChatGroq
        return ChatGroq(
            api_key=GROQ_API_KEY,
            model=GROQ_FAST_MODEL,
            temperature=temperature,
        )
    from langchain_google_genai import ChatGoogleGenerativeAI
    return ChatGoogleGenerativeAI(model=GEMINI_MODEL, temperature=temperature)


# ── Retry wrapper ─────────────────────────────────────────────────────────────

async def invoke_with_retry(llm, messages, max_retries: int = 3, base_wait: float = 5.0):
    """
    Invoke LLM with exponential back-off retry on rate-limit errors.
    Returns (content: str, success: bool).
    """
    last_err = None
    for attempt in range(max_retries):
        try:
            response = await llm.ainvoke(messages)
            return response.content, True
        except Exception as e:
            last_err = e
            err_str = str(e)
            is_rate_limit = any(x in err_str for x in ["429", "RESOURCE_EXHAUSTED", "rate_limit_exceeded", "RateLimitError"])
            if is_rate_limit:
                wait = base_wait * (attempt + 1)
                print(f"[LLM] Rate limit (attempt {attempt+1}/{max_retries}), waiting {wait:.0f}s …")
                await asyncio.sleep(wait)
            else:
                print(f"[LLM] Non-retryable error: {e}")
                break
    return None, False


async def stream_with_retry(llm, messages, on_token, max_retries: int = 2, base_wait: float = 8.0):
    """
    Stream LLM tokens with retry on rate-limit errors.
    on_token(token: str) is called for each token.
    Returns (full_text: str, success: bool).
    """
    last_err = None
    for attempt in range(max_retries):
        try:
            full = ""
            async for chunk in llm.astream(messages):
                token = chunk.content
                if token:
                    full += token
                    await on_token(token)
            return full, True
        except Exception as e:
            last_err = e
            err_str = str(e)
            is_rate_limit = any(x in err_str for x in ["429", "RESOURCE_EXHAUSTED", "rate_limit_exceeded", "RateLimitError"])
            if is_rate_limit:
                wait = base_wait * (attempt + 1)
                print(f"[LLM] Stream rate limit (attempt {attempt+1}/{max_retries}), waiting {wait:.0f}s …")
                await asyncio.sleep(wait)
            else:
                print(f"[LLM] Stream non-retryable: {e}")
                break
    return None, False
