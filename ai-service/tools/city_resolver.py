import os
import time
from typing import List, Optional
from pydantic import BaseModel, Field
from langchain_core.messages import SystemMessage, HumanMessage

from llm_helper import get_fast_llm
from services.duffel import duffel_service
from services.db import db_service
from collections import OrderedDict

# --- Country Mapping ---
COUNTRY_MAP = {
    "IN": "India",
    "US": "United States",
    "GB": "United Kingdom",
    "FR": "France",
    "DE": "Germany",
    "IT": "Italy",
    "ES": "Spain",
    "JP": "Japan",
    "SG": "Singapore",
    "AE": "United Arab Emirates",
    "TH": "Thailand",
    "MY": "Malaysia",
    "CN": "China",
    "KR": "South Korea",
    "AU": "Australia",
    "NZ": "New Zealand",
    "ZA": "South Africa",
    "KE": "Kenya",
    "EG": "Egypt",
    "TR": "Turkey",
    "CA": "Canada",
    "NL": "Netherlands",
    "CH": "Switzerland",
    "QA": "Qatar",
    "SA": "Saudi Arabia",
    "ID": "Indonesia",
    "VN": "Vietnam",
    "PH": "Philippines",
    "MV": "Maldives",
    "LK": "Sri Lanka",
    "NP": "Nepal",
    "AT": "Austria",
    "BE": "Belgium",
    "SE": "Sweden",
    "NO": "Norway",
    "DK": "Denmark",
    "FI": "Finland",
    "IE": "Ireland",
    "PT": "Portugal",
    "GR": "Greece",
    "RU": "Russia",
    "BR": "Brazil",
    "MX": "Mexico",
    "AR": "Argentina",
    "CO": "Colombia",
    "PE": "Peru",
    "CL": "Chile",
    "HK": "Hong Kong",
    "TW": "Taiwan",
    "MO": "Macau",
    "KH": "Cambodia",
    "LA": "Laos",
    "MM": "Myanmar",
    "BD": "Bangladesh",
    "PK": "Pakistan",
}

# --- Pydantic Schemas ---
class CleanedCity(BaseModel):
    city_name: str = Field(description="The cleaned, best-guess city name string, e.g., 'Bengaluru'")

class PlaceMatch(BaseModel):
    name: str
    iata_code: str
    iata_city_code: Optional[str] = None
    iata_country_code: str
    country_name: str
    type: str  # "city" or "airport"
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class CityResolutionResult(BaseModel):
    resolved: bool
    matches: List[PlaceMatch] = []
    needs_confirmation: bool = False
    error: Optional[str] = None

# --- In-Memory LRU Cache ---
class SimpleLRUCache:
    def __init__(self, maxsize=512):
        self.cache = OrderedDict()
        self.maxsize = maxsize

    def get(self, key: str):
        if key not in self.cache:
            return None
        self.cache.move_to_end(key)
        return self.cache[key]

    def set(self, key: str, value: CityResolutionResult):
        if key in self.cache:
            self.cache.move_to_end(key)
        self.cache[key] = value
        if len(self.cache) > self.maxsize:
            self.cache.popitem(last=False)

_resolver_cache = SimpleLRUCache()

# --- Main Resolver ---
async def resolve_city(raw_input: str) -> CityResolutionResult:
    """
    Two-step pipeline:
    1. LLM text normalization (fast path)
    2. Duffel Places Suggestions look-up
    """
    if not raw_input or not raw_input.strip():
        return CityResolutionResult(resolved=False, error="Empty input")

    query_key = raw_input.lower().strip()
    cached = _resolver_cache.get(query_key)
    if cached:
        print(f"[CityResolver] Cache hit for '{raw_input}': {len(cached.matches)} matches")
        return cached

    start_time = time.time()
    cleaned_city_name = raw_input.strip()

    # Step 1: LLM cleanup
    try:
        # Avoid running LLM on very short queries or pure IATA codes
        if len(raw_input.strip()) == 3 and raw_input.strip().isalpha():
            cleaned_city_name = raw_input.strip()
        else:
            prompt = [
                SystemMessage(content=(
                    "You are a travel assistant. Your job is to take a raw city string "
                    "(which might contain typos, prepositions like 'near', or colloquial/local names) "
                    "and clean it to output the corrected/clean city name.\n"
                    "You must respond ONLY with a JSON object matching this schema:\n"
                    "{\n"
                    "  \"city_name\": \"string\"\n"
                    "}\n\n"
                    "Do not output anything else. Do not output airport codes.\n"
                    "If the input is already a clear city name, leave it mostly unchanged.\n\n"
                    "Examples:\n"
                    "Input: blore -> {\"city_name\": \"Bengaluru\"}\n"
                    "Input: near bangalore -> {\"city_name\": \"Bengaluru\"}\n"
                    "Input: delih -> {\"city_name\": \"Delhi\"}\n"
                    "Input: new york city -> {\"city_name\": \"New York\"}\n"
                    "Input: London -> {\"city_name\": \"London\"}"
                )),
                HumanMessage(content=f"Input: {raw_input}")
            ]
            llm = get_fast_llm(temperature=0)
            
            # Support JSON mode if possible
            try:
                # Bind JSON mode response format if using ChatGroq or ChatGoogleGenerativeAI
                llm = llm.bind(response_format={"type": "json_object"})
            except Exception:
                pass
                
            resp = await llm.ainvoke(prompt)
            content = resp.content.strip()
            if content.startswith("```json"):
                content = content[7:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()
            
            import json
            data = json.loads(content)
            if "city_name" in data and data["city_name"]:
                cleaned_city_name = data["city_name"].strip()
    except Exception as e:
        print(f"[CityResolver] LLM normalization failed: {e}. Falling back to raw input.")
        cleaned_city_name = raw_input.strip()

    # Step 2: Duffel Places Suggestions query
    matches = []
    is_fallback = False
    duffel_error = None
    
    # A. Try Duffel with cleaned name
    try:
        raw_matches = await duffel_service.get_places_suggestions(cleaned_city_name)
        if raw_matches:
            for m in raw_matches:
                matches.append({
                    "name": m.get("name") or "",
                    "iata_code": m.get("iata_code") or "",
                    "iata_city_code": m.get("iata_city_code"),
                    "iata_country_code": m.get("iata_country_code") or "",
                    "type": m.get("type") or "city",
                    "latitude": m.get("latitude"),
                    "longitude": m.get("longitude")
                })
    except Exception as e:
        print(f"[CityResolver] Duffel suggestions failed for cleaned: {e}")
        duffel_error = str(e)
        is_fallback = True

    # B. If Duffel cleaned query failed or returned 0, try DB fallback with cleaned name
    if not matches:
        try:
            query_val = cleaned_city_name
            res = db_service.client.table("cities_cache").select(
                "city_name, country, country_code, iata_code, latitude, longitude, region, is_major"
            ).or_(
                f"city_name.ilike.%{query_val}%,iata_code.eq.{query_val.upper()}"
            ).order("is_major", desc=True).order("city_name").limit(5).execute()
            db_rows = res.data or []
            if db_rows:
                # Found it in local DB fallback!
                is_fallback = True
                for row in db_rows:
                    matches.append({
                        "name": row["city_name"],
                        "iata_code": row["iata_code"],
                        "iata_city_code": row["iata_code"],
                        "iata_country_code": row["country_code"] or "",
                        "type": "city" if row["is_major"] else "airport",
                        "latitude": row["latitude"],
                        "longitude": row["longitude"]
                    })
        except Exception as db_err:
            print(f"[CityResolver] Local DB query failed for cleaned: {db_err}")

    # C. If still no matches and Duffel was reachable, retry Duffel suggestions with original input
    if not matches and not is_fallback:
        try:
            raw_matches = await duffel_service.get_places_suggestions(raw_input)
            if raw_matches:
                for m in raw_matches:
                    matches.append({
                        "name": m.get("name") or "",
                        "iata_code": m.get("iata_code") or "",
                        "iata_city_code": m.get("iata_city_code"),
                        "iata_country_code": m.get("iata_country_code") or "",
                        "type": m.get("type") or "city",
                        "latitude": m.get("latitude"),
                        "longitude": m.get("longitude")
                    })
        except Exception as e:
            print(f"[CityResolver] Duffel suggestions failed for original: {e}")
            duffel_error = str(e)
            is_fallback = True

    # D. If still no matches, try DB fallback with original input
    if not matches:
        try:
            query_val = raw_input
            res = db_service.client.table("cities_cache").select(
                "city_name, country, country_code, iata_code, latitude, longitude, region, is_major"
            ).or_(
                f"city_name.ilike.%{query_val}%,iata_code.eq.{query_val.upper()}"
            ).order("is_major", desc=True).order("city_name").limit(5).execute()
            db_rows = res.data or []
            if db_rows:
                is_fallback = True
                for row in db_rows:
                    matches.append({
                        "name": row["city_name"],
                        "iata_code": row["iata_code"],
                        "iata_city_code": row["iata_code"],
                        "iata_country_code": row["country_code"] or "",
                        "type": "city" if row["is_major"] else "airport",
                        "latitude": row["latitude"],
                        "longitude": row["longitude"]
                    })
        except Exception as db_err:
            print(f"[CityResolver] Local DB fallback failed for original: {db_err}")

    # Process and map matches
    parsed_matches: List[PlaceMatch] = []
    for m in matches:
        cc = m.get("iata_country_code") or ""
        country_name = COUNTRY_MAP.get(cc.upper(), cc)
        parsed_matches.append(PlaceMatch(
            name=m.get("name") or "",
            iata_code=m.get("iata_code") or "",
            iata_city_code=m.get("iata_city_code"),
            iata_country_code=cc,
            country_name=country_name,
            type=m.get("type") or "city",
            latitude=m.get("latitude"),
            longitude=m.get("longitude")
        ))

    # Determine resolution outcome
    resolved = len(parsed_matches) > 0
    needs_confirmation = len(parsed_matches) > 1

    result = CityResolutionResult(
        resolved=resolved,
        matches=parsed_matches,
        needs_confirmation=needs_confirmation,
        error=duffel_error if is_fallback else None
    )

    if resolved:
        # Cache successful lookup
        _resolver_cache.set(query_key, result)

    print(f"[CityResolver] Input: '{raw_input}' -> Cleaned: '{cleaned_city_name}' -> Resolved: {resolved} ({len(parsed_matches)} matches, needs_conf: {needs_confirmation})")
    return result
