"""
TripioAI — FX Currency Conversion Service (Python)
Converts foreign currency amounts to INR using ExchangeRate API
"""

import asyncio
import os
import time
import httpx

FX_API_KEY = os.environ.get("FX_API_KEY", "")
FX_API_URL = os.environ.get("FX_API_URL", "https://v6.exchangerate-api.com/v6")
CACHE_TTL = 6 * 3600  # 6 hours

# Module-level cache
_rates_cache: dict = {}
_cache_timestamp: float = 0

# Fallback rates (1 foreign currency = X INR)
FALLBACK_RATES = {
    "USD": 83.5,
    "EUR": 90.2,
    "GBP": 105.8,
    "JPY": 0.55,
    "AED": 22.7,
    "SGD": 62.1,
    "AUD": 54.3,
    "CAD": 61.5,
    "CHF": 93.8,
    "THB": 2.35,
    "MYR": 17.8,
    "HKD": 10.7,
    "INR": 1.0,
}


async def get_rates() -> dict:
    global _rates_cache, _cache_timestamp
    
    now = time.time()
    if _rates_cache and (now - _cache_timestamp) < CACHE_TTL:
        return _rates_cache
    
    try:
        if not FX_API_KEY:
            return FALLBACK_RATES
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{FX_API_URL}/{FX_API_KEY}/latest/INR")
            if resp.is_success:
                data = resp.json()
                if data.get("result") == "success":
                    conv = data.get("conversion_rates", {})
                    inr_per_foreign = {}
                    for currency, rate in conv.items():
                        if rate and rate > 0:
                            inr_per_foreign[currency] = round(1 / rate, 6)
                    inr_per_foreign["INR"] = 1.0
                    _rates_cache = inr_per_foreign
                    _cache_timestamp = now
                    return _rates_cache
    except Exception as e:
        print(f"[FX] Error fetching rates: {e}")
    
    # Use stale cache or fallback
    if _rates_cache:
        return _rates_cache
    return FALLBACK_RATES


async def convert_to_inr(amount: float, from_currency: str) -> tuple[float, float]:
    """
    Convert amount from foreign currency to INR.
    Returns (amount_inr, fx_rate)
    """
    if from_currency.upper() == "INR":
        return round(amount, 2), 1.0
    
    rates = await get_rates()
    rate = rates.get(from_currency.upper(), 1.0)
    amount_inr = round(amount * rate, 2)
    return amount_inr, rate
