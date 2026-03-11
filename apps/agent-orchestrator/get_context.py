import asyncio
from motor.motor_asyncio import AsyncIOMotorClient

async def main():
    try:
        uri = "mongodb://m1b.dev.pr.com:27017/RM_Buddy"
        client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=2000)
        await client.admin.command('ping')
        print("Connected to MongoDB!")
        
        db = client.RM_Buddy
        collections = await db.list_collection_names()
        print(f"Collections: {collections}")
    except Exception as e:
        print(f"MongoDB connection failed: {e}")

asyncio.run(main())
