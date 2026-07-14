import asyncio
import os
from dotenv import load_dotenv
load_dotenv()

from services.db import db_service

async def main():
    await db_service.init()
    res = db_service.client.table("hotel_offers").select("*").limit(5).execute()
    for row in res.data:
        print("HOTEL:", row.get("hotel_name"), "SEGMENT_ORDER:", row.get("segment_order"))

asyncio.run(main())
