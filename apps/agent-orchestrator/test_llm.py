import asyncio
from src.config.llm_config import get_llm_client

async def main():
    client = get_llm_client()
    print("base_url:", client.base_url)

asyncio.run(main())
