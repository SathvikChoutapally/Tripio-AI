"""
TripioAI — Seed knowledge base for RAG
Embeds destination guides into knowledge_chunks table using Gemini embeddings

Usage:
  pip install -r requirements.txt
  python seed_knowledge.py
"""

import os
import asyncio
import time
from dotenv import load_dotenv
from supabase import create_client, Client
import google.generativeai as genai

load_dotenv()
# Also load from ai-service/.env (contains GOOGLE_API_KEY) when running from supabase/ dir
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "ai-service", ".env"))


SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
GOOGLE_API_KEY = os.environ["GOOGLE_API_KEY"]
EMBEDDING_MODEL = os.environ.get("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")
EMBEDDING_DIMENSIONS = int(os.environ.get("GEMINI_EMBEDDING_DIMENSIONS", "768"))  # keep vector(768) column, no schema migration needed

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
genai.configure(api_key=GOOGLE_API_KEY)


# ── Knowledge base content ─────────────────────────────────────
# Each entry: destination, topic, content (max ~500 tokens)
KNOWLEDGE_BASE = [
    # PARIS
    {
        "destination": "Paris",
        "country": "France",
        "topic": "attractions",
        "content": "Paris, the City of Light, is home to world-class attractions. The Eiffel Tower offers panoramic views from its three levels; buy tickets online to avoid queues. The Louvre Museum houses over 35,000 artworks including the Mona Lisa — arrive early or late afternoon. Notre-Dame Cathedral is undergoing restoration after the 2019 fire; the exterior is still spectacular. Musée d'Orsay is best for Impressionist art (Monet, Renoir, Van Gogh). Montmartre's Sacré-Cœur basilica provides a stunning hilltop view. The Palace of Versailles (30 min by RER C) requires a full day. Centre Pompidou offers modern art plus a rooftop terrace.",
        "source_url": "https://www.parisinfo.com",
    },
    {
        "destination": "Paris",
        "country": "France",
        "topic": "food",
        "content": "Paris food culture: Start each morning with a café crème and croissant or pain au chocolat at a neighbourhood boulangerie — avoid tourist cafés near major sights. Lunch (déjeuner) is the main meal; many restaurants offer a 'formule' (set menu) for €12–20 with entrée, plat, and dessert. For dinner, book bistros in Le Marais, Montparnasse, or the 11th arrondissement. Must-try dishes: steak-frites, croque monsieur, boeuf bourguignon, crème brûlée, French onion soup. Food markets at Marché d'Aligre (weekday mornings) and Marché Bastille (Thursday/Sunday) offer fresh produce. Avoid restaurants with menus displayed in multiple languages and photos — seek chalkboard menus in French.",
        "source_url": "https://www.timeout.com/paris/restaurants",
    },
    {
        "destination": "Paris",
        "country": "France",
        "topic": "transport",
        "content": "Paris transport: The Metro (RER) is the fastest way to get around — buy a carnet of 10 tickets or a Navigo weekly/monthly pass for unlimited travel. T+ tickets work on Metro, buses, RER within zones 1-5. CDG Airport to city: RER B (35 min, €11) is cheapest; taxis fixed rate €50–55. Uber and Bolt work well. Vélib' bike-sharing stations city-wide (€3/day). Walking is often fastest within central arrondissements — the city centre is compact. Avoid taxis from the airport taxi rank unless you see a licensed cab. Night buses (Noctilien) run midnight–5:30am.",
        "source_url": "https://www.ratp.fr",
    },
    {
        "destination": "Paris",
        "country": "France",
        "topic": "visa",
        "content": "Paris visa requirements: India passport holders require a Schengen visa to enter France. Apply at the French Embassy or via a VFS Global centre. Required documents: valid passport (6+ months validity), 2 recent passport photos, flight/hotel bookings, bank statements (3 months, minimum €50/day), travel insurance (€30,000 medical coverage), employment/leave letter. Processing: 2–15 working days. Fee: ~€80. Paris is in the Schengen zone — a single French Schengen visa permits travel to all 27 Schengen countries. Stay limit: 90 days in any 180-day period. Apply 3–6 weeks before travel.",
        "source_url": "https://in.ambafrance.org",
    },
    {
        "destination": "Paris",
        "country": "France",
        "topic": "budget",
        "content": "Paris budget tips: Budget accommodation in hostels from €25–40/night; mid-range hotels €100–200/night; luxury from €300/night. Meals: bakery breakfast €5, neighbourhood bistro lunch formule €15, dinner €25–40 per person without wine. Wine at supermarkets from €4/bottle. Free attractions: Musée Carnavalet, Musée de la Vie Romantique, strolling the Seine banks, Père Lachaise cemetery, Palais-Royal gardens. Paris Museum Pass (2/4/6 days: €52/66/78) covers Louvre, Versailles, and 50+ museums with skip-the-line entry. Metro day pass (Navigo Jour): €8.65. Average daily budget: backpacker €70–100, mid-range €150–250, luxury €400+.",
        "source_url": "https://www.budgetyourtrip.com/france/paris",
    },
    # TOKYO
    {
        "destination": "Tokyo",
        "country": "Japan",
        "topic": "attractions",
        "content": "Tokyo top attractions: Shibuya Crossing — the world's busiest pedestrian crossing, best viewed from the Shibuya Sky or Starbucks rooftop. Senso-ji temple in Asakusa is Tokyo's oldest temple; visit early morning to avoid crowds. Tokyo Skytree (634m) offers the highest views in Japan. Shinjuku Gyoen National Garden is perfect for cherry blossom (late March–early April) or autumn foliage. Harajuku's Takeshita Street showcases Tokyo's quirky youth fashion. teamLab Borderless (Odaiba) is an immersive digital art experience (book weeks ahead). Tsukiji Outer Market offers the freshest sushi breakfast. Akihabara is the electronics and anime district.",
        "source_url": "https://www.gotokyo.org",
    },
    {
        "destination": "Tokyo",
        "country": "Japan",
        "topic": "food",
        "content": "Tokyo food guide: Tokyo has more Michelin stars than any other city. Ramen: try Ichiran (solo dining booth system) or Fuunji for tsukemen (dipping ramen). Sushi: conveyor belt sushi (kaitenzushi) at Sushiro or Hamazushi is affordable (¥100–200/plate); omakase counter from ¥15,000. Yakitori: grilled chicken skewers under Yurakucho tracks from ¥150/skewer. Tempura: Tsunahachi in Shinjuku. Convenience store food (7-Eleven, FamilyMart) is genuinely excellent — try onigiri, egg salad sandwiches, and hot foods. Izakayas (Japanese gastropubs) are ideal for budget dinner — order edamame, karaage, and yakitori with beer. Breakfast: most hotels include Japanese breakfast sets.",
        "source_url": "https://www.timeout.com/tokyo",
    },
    {
        "destination": "Tokyo",
        "country": "Japan",
        "topic": "transport",
        "content": "Tokyo transport: Get a Suica or Pasmo IC card at any station (¥500 deposit, refundable) — works on all trains, subways, and buses, and for convenience store payments. Narita Airport to Shinjuku: N'EX train (55 min, ¥3,070) or Limousine Bus (90 min, ¥3,100). Haneda Airport to Shibuya: Keikyu Line (25 min, ¥310). JR Pass is worthwhile if doing day trips (Kyoto, Nara, Nikko). IC card covers most Tokyo transit. Tokyo Metro 24/48/72-hour passes (¥800/1,200/1,500) for unlimited subway. Taxis are expensive — metered, starting at ¥730. Google Maps or Hyperdia app for transit navigation.",
        "source_url": "https://www.tokyometro.jp",
    },
    {
        "destination": "Tokyo",
        "country": "Japan",
        "topic": "visa",
        "content": "Tokyo visa for Indian passport holders: Japan requires a visa for Indian citizens. Apply at the Embassy of Japan in Delhi/Mumbai/Chennai/Kolkata or through an authorized travel agent. Required: passport, application form, photo, flight/hotel bookings, bank statements (3 months, min ¥30,000 per day), employment letter, income tax returns. Processing: 4–7 working days. Fee: ¥3,000 (~₹1,700). Single-entry tourist visa valid 90 days from issue, stay up to 15 days. Multiple-entry visas available for frequent travellers. Japan requires proof of sufficient funds for the duration of stay.",
        "source_url": "https://www.in.emb-japan.go.jp",
    },
    {
        "destination": "Tokyo",
        "country": "Japan",
        "topic": "budget",
        "content": "Tokyo budget guide: Accommodation — budget hostels from ¥2,500/night, capsule hotels ¥3,000–5,000, business hotels ¥8,000–15,000, luxury from ¥30,000. Meals: convenience store meal ¥500–800, ramen ¥800–1,200, izakaya dinner with drinks ¥2,000–4,000, sushi counter ¥5,000+. Day trip to Kyoto (Shinkansen, 2h15m) ¥7,000 each way. Free attractions: Meiji Shrine, Senso-ji (free entry), Imperial Palace East Gardens, teamLab Planets from ¥3,200. Average daily budget: budget ¥5,000–8,000, mid-range ¥15,000–25,000, luxury ¥50,000+.",
        "source_url": "https://www.budgetyourtrip.com/japan/tokyo",
    },
    # DUBAI
    {
        "destination": "Dubai",
        "country": "United Arab Emirates",
        "topic": "attractions",
        "content": "Dubai top attractions: Burj Khalifa (828m) — book At the Top (level 124/125) online; sunset/night slots sell out weeks ahead. The Dubai Mall is the world's largest — includes Dubai Aquarium, ice rink, and VR Park. Dubai Frame bridges old and new Dubai with a glass floor at 150m. Palm Jumeirah's Atlantis Aquaventure Waterpark (book online). Gold and Spice Souks in Deira — take an abra (water taxi) across the creek for ₹70. Desert Safari: 4WD dune bashing, camel ride, and BBQ dinner in the desert (book through hotel or reputable operator). Expo City (Blue Line Metro) has permanent pavilions. Dubai Creek Heritage Village for old-town ambiance.",
        "source_url": "https://www.visitdubai.com",
    },
    {
        "destination": "Dubai",
        "country": "United Arab Emirates",
        "topic": "food",
        "content": "Dubai food scene: Dubai is a melting pot with cuisines from 200 nationalities. Must-try: shawarma from street stalls (AED 5–10), Emirati Al Harees (slow-cooked meat and wheat), and fresh seafood at the Dubai Fish Market. Brunch culture: lavish Friday brunches at hotels from AED 200–600 include unlimited food and drinks. Budget: IKEA restaurant for cheap meals, Ravi Restaurant (Pakistani, Satwa area) for AED 15–30 meals. Global Villlage (Oct–April) has pavilions from 90 countries with street food. Alcohol: only served at licensed hotel restaurants and bars. Indian restaurants: large community means excellent options in Bur Dubai.",
        "source_url": "https://www.timeout.com/dubai/restaurants",
    },
    {
        "destination": "Dubai",
        "country": "United Arab Emirates",
        "topic": "visa",
        "content": "Dubai visa for Indian passport: UAE offers visa-on-arrival for Indian passport holders (holding a valid US/UK/EU Schengen visa or Green Card). Without qualifying visa: apply for UAE Tourist Visa online via Emirates, Air Arabia, or GDRFA Dubai portal. 30-day single entry: ~AED 250 (~₹5,700). 60-day multiple entry: ~AED 650. Processing: 3–5 working days. Required: passport scan, photo, return ticket, hotel booking. Visa valid from date of issue. Overstay fine: AED 200/day. No alcohol in public; cultural dress code in malls, souks, and mosques. Ramadan: eat/drink only in private during daylight hours.",
        "source_url": "https://gdrfad.gov.ae",
    },
    {
        "destination": "Dubai",
        "country": "United Arab Emirates",
        "topic": "budget",
        "content": "Dubai budget: Accommodation — budget hotels/apartments from AED 150/night (~₹3,500), mid-range AED 350–700, luxury AED 1,000+. Meals: street shawarma AED 8, restaurant meal AED 40–80, hotel brunch AED 250+. Metro and bus are cheap: NOL card, fares AED 1.8–7.5. Taxis: metered, starting AED 12, to/from airport AED 50–100. Water taxi (Abra) AED 1 across the creek. Free: Dubai Fountain show (daily 6pm and 8pm), beach access at JBR/Jumeirah. Desert Safari: AED 150–250. Best time to visit: Nov–March (weather 20–28°C). Avoid summer (Jun–Sep) when temperatures exceed 45°C.",
        "source_url": "https://www.budgetyourtrip.com/uae/dubai",
    },
    # SINGAPORE
    {
        "destination": "Singapore",
        "country": "Singapore",
        "topic": "attractions",
        "content": "Singapore top attractions: Marina Bay Sands' infinity pool (hotel guests only) — view from the top is stunning; the Skypark Observation Deck is open to non-guests for SGD 35. Gardens by the Bay — Supertree Grove light show free nightly at 7:45pm and 8:45pm; Cloud Forest and Flower Dome entry SGD 28 each. Sentosa Island: Universal Studios (SGD 81 adult), S.E.A. Aquarium (SGD 42), beach access free. Chinatown: Sri Mariamman Temple, Buddha Tooth Relic Temple, and excellent hawker food. Little India: vibrant Mustafa Centre open 24h. Haw Par Villa free quirky theme park. Night Safari at Singapore Zoo (SGD 55) — world's first nocturnal zoo.",
        "source_url": "https://www.visitsingapore.com",
    },
    {
        "destination": "Singapore",
        "country": "Singapore",
        "topic": "food",
        "content": "Singapore hawker culture: UNESCO-recognized hawker centres are the heart of Singapore food. Maxwell Food Centre (near Chinatown) — Tian Tian chicken rice is legendary (arrive before noon). Lau Pa Sat (Raffles area) — satay stalls open evenings. Newton Food Centre near Orchard. Dish prices: char kway teow SGD 4–5, chicken rice SGD 3.50–5, laksa SGD 4–6, Hainanese chicken rice SGD 3.50, chilli crab (splurge) SGD 60–80 for whole crab. Drink: kopi (local coffee) SGD 1.20, teh tarik SGD 1.50. Budget alert: food courts in malls are slightly pricier than hawker centres. Avoid tourist restaurant traps at Boat Quay.",
        "source_url": "https://www.makansutra.com",
    },
    {
        "destination": "Singapore",
        "country": "Singapore",
        "topic": "visa",
        "content": "Singapore visa for Indian passport: Indian citizens can enter Singapore visa-free for up to 30 days for tourism since 2024 (officially from Feb 2024 under the visa-free arrangement). No prior visa application required. On arrival, immigration officer may ask for: return flight ticket, hotel booking, sufficient funds (SGD 100–150 per day suggested), and travel purpose confirmation. Passport must be valid for 6+ months. Extension possible at ICA (SGD 40). Note: those with poor immigration history elsewhere may face scrutiny. Work pass and LTVP are separate from tourist entry.",
        "source_url": "https://www.ica.gov.sg",
    },
    {
        "destination": "Singapore",
        "country": "Singapore",
        "topic": "budget",
        "content": "Singapore budget: Accommodation — capsule hotels from SGD 30/night, guesthouses SGD 50–80, mid-range SGD 150–250, luxury SGD 400+. MRT (train) fares SGD 1–2.80, buses SGD 0.75–2.25; get an EZ-Link card. Hawker meal SGD 4–7, restaurant SGD 15–30, fine dining SGD 100+. Attractions: many free (Gardens by the Bay exterior, Chinatown, Little India, Marina Bay waterfront). Budget daily spend: SGD 80–120 (budget), SGD 200–350 (mid), SGD 500+ (luxury). Singapore is expensive compared to Southeast Asian neighbours but hawker centres and public transport keep costs manageable. Best time: Feb–April (drier, less humid).",
        "source_url": "https://www.budgetyourtrip.com/singapore",
    },
    # LONDON
    {
        "destination": "London",
        "country": "United Kingdom",
        "topic": "attractions",
        "content": "London top attractions: The British Museum — free entry, holds the Rosetta Stone and Elgin Marbles; arrive at opening to beat crowds. The Tower of London holds the Crown Jewels (£34 adult). Buckingham Palace: State Rooms open Aug–Sep (£32). Tate Modern — free entry for permanent collection, modern art on the South Bank. Natural History Museum — free, dinosaur gallery is spectacular. Westminster Abbey (£29) and St Paul's Cathedral (£27). Hyde Park and Regent's Park are free and beautiful. The Shard observation deck (£32) has panoramic views. Greenwich: Royal Observatory (£18) — straddle the Prime Meridian.",
        "source_url": "https://www.visitlondon.com",
    },
    {
        "destination": "London",
        "country": "United Kingdom",
        "topic": "visa",
        "content": "UK visa for Indian passport: Indian passport holders require a Standard Visitor Visa (£115, up to 6 months). Apply online via UKVI at least 3 weeks before travel. Required: online form, biometric appointment (VFS Global), passport, 6 months' bank statements, payslips/employment letter, accommodation proof, flight bookings, detailed itinerary, and ties to home country (family, employment). Biometric appointment fee ~₹2,000 at VFS. Decision in 3 weeks (standard) or 5 days (priority, +£500). Electronic Travel Authorisation (ETA) is separate — for visa-exempt nationals only, not applicable to India. Valid UK visa also allows visits to Ireland.",
        "source_url": "https://www.gov.uk/standard-visitor-visa",
    },
    {
        "destination": "London",
        "country": "United Kingdom",
        "topic": "transport",
        "content": "London transport: Get an Oyster card or link a contactless bank card to pay as you go on Tube, buses, DLR, Elizabeth line, and National Rail (within zones). Daily fare cap zones 1-2: £8.10 (peak), £7.70 (off-peak). Travelcard for unlimited travel from £14.90/day. Heathrow to Paddington: Elizabeth line (35 min, £13.50) or Heathrow Express (15 min, £25). Gatwick to Victoria: Gatwick Express (30 min, £21.50). Black cabs: metered from £4.20 flag fall; Uber cheaper but surge-priced. Santander Cycles (Boris Bikes): £1.65 for 1-hour dock-to-dock. Night Tube (Fri/Sat) on select lines.",
        "source_url": "https://tfl.gov.uk",
    },
    # NEW YORK
    {
        "destination": "New York",
        "country": "United States",
        "topic": "attractions",
        "content": "New York top attractions: Central Park (843 acres, free) — rent a bike from Citi Bike to explore; Bethesda Fountain, the Reservoir, and Strawberry Fields are highlights. The Metropolitan Museum of Art: pay-what-you-wish for NY state residents; $30 for out-of-state visitors. Empire State Building (102nd floor, $62+) vs Top of the Rock (30 Rock, $40+, better Empire State view). Brooklyn Bridge: walk across for free, great views both ways. Statue of Liberty: ferry from Battery Park ($24.30 includes Ellis Island). Times Square is free but touristy — visit at night for the lights. MoMA ($25) and the High Line (free elevated park). Broadway shows: TKTS booth in Times Square for same-day discounts.",
        "source_url": "https://www.nycgo.com",
    },
    {
        "destination": "New York",
        "country": "United States",
        "topic": "food",
        "content": "New York food: NY-style pizza by the slice from $3 at Di Fara (Brooklyn), Joe's Pizza (Greenwich Village). New York bagel with lox and cream cheese from Russ & Daughters (~$20). Pastrami sandwich from Katz's Delicatessen ($23). Chelsea Market for artisan food halls. Smorgasburg (Brooklyn, weekends) for food vendor stalls. Budget dinner: Korean BBQ in Koreatown (32nd St), Indian food on Lexington Ave (Curry Hill), Chinese in Flushing (Queens). Food trucks: Halal cart chicken and rice ($7–10) is iconic. Brunch culture strong — reserve OpenTable for popular spots. Drink: NY-style iced coffee, NYC tap water is world-class.",
        "source_url": "https://www.timeout.com/newyork",
    },
    {
        "destination": "New York",
        "country": "United States",
        "topic": "visa",
        "content": "New York / USA visa for Indian passport: Indian citizens require a B1/B2 tourist visa (no ESTA available). Apply at the US Embassy or Consulate in India. Process: complete DS-160 form online, pay MRV fee ($185), schedule visa interview at Embassy in Delhi/Mumbai/Chennai/Kolkata/Hyderabad. Wait times for interview slots: 400–700 days at peak (check for emergency appointments). Required at interview: DS-160 confirmation, appointment letter, passport, photo, financial documents, ties to India, travel itinerary. Visa if granted: usually valid 10 years, multiple entry, up to 6 months per stay. ESTA not available for Indian passport.",
        "source_url": "https://in.usembassy.gov/visas",
    },
]


def chunk_content(content, max_tokens=450):
    """Simple token-approximate chunker (1 token ≈ 4 chars)"""
    max_chars = max_tokens * 4
    if len(content) <= max_chars:
        return [content]
    
    # Split by sentence
    sentences = content.split('. ')
    chunks = []
    current_chunk = ""
    
    for sentence in sentences:
        if len(current_chunk) + len(sentence) + 2 <= max_chars:
            current_chunk += sentence + ". "
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = sentence + ". "
    
    if current_chunk:
        chunks.append(current_chunk.strip())
    
    return chunks or [content[:max_chars]]


def embed_text(text):
    """Generate embedding using Gemini gemini-embedding-001 (768-dim output to match vector(768) column)"""
    model_name = EMBEDDING_MODEL
    if not model_name.startswith("models/"):
        model_name = f"models/{model_name}"
    result = genai.embed_content(
        model=model_name,
        content=text,
        task_type="retrieval_document",
        output_dimensionality=EMBEDDING_DIMENSIONS,  # downsample 3072->768, no schema migration needed
    )
    return result["embedding"]


def seed_knowledge():
    print("=== TripioAI Knowledge Base Seeder ===\n")
    print(f"Embedding model: {EMBEDDING_MODEL}")
    print(f"Total chunks to embed: {len(KNOWLEDGE_BASE)}\n")
    
    # Clean existing chunks to prevent duplicates/conflicts
    try:
        print("Clearing existing knowledge chunks...")
        supabase.table("knowledge_chunks").delete().neq("destination", "EMPTY_DUMMY_VALUE").execute()
        print("Table cleared successfully.")
    except Exception as clear_err:
        print(f"Warning: could not clear knowledge chunks table: {clear_err}")

    inserted = 0
    errors = 0
    
    for i, item in enumerate(KNOWLEDGE_BASE):
        try:
            print(f"[{i+1}/{len(KNOWLEDGE_BASE)}] Embedding: {item['destination']} / {item['topic']}...")
            
            # Generate embedding
            embedding = embed_text(item["content"])
            
            # Prepare record
            record = {
                "destination": item["destination"],
                "country": item.get("country"),
                "topic": item["topic"],
                "content": item["content"],
                "source_url": item.get("source_url"),
                "embedding": embedding,
                "metadata": {
                    "word_count": len(item["content"].split()),
                    "char_count": len(item["content"]),
                }
            }
            
            # Insert into Supabase
            result = supabase.table("knowledge_chunks").insert(record).execute()
            inserted += 1
            print(f"   [OK] Inserted chunk (embedding dim: {len(embedding)})")
            
            # Rate limit: Gemini free tier ~60 requests/min
            if (i + 1) % 10 == 0:
                print("   Pausing 5s for rate limit...")
                time.sleep(5)
            else:
                time.sleep(0.5)
                
        except Exception as e:
            print(f"   [ERROR] Error: {e}")
            errors += 1
    
    print(f"\n=== Seeding Complete ===")
    print(f"Success Inserted: {inserted}")
    print(f"Failed Errors: {errors}")
    print(f"\nYour RAG knowledge base is ready!")


if __name__ == "__main__":
    seed_knowledge()
