"""RAG tool — vector search over knowledge base (stub until documents are ingested)."""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.tools import tool

logger = logging.getLogger(__name__)


@tool
async def search_knowledge_base(query: str, top_k: int = 5) -> dict[str, Any]:
    """Search the knowledge base for relevant product docs, compliance rules, or policies.

    Args:
        query: Natural language search query.
        top_k: Maximum number of results to return. Default 5.

    Returns:
        Dict with 'results' list (empty until knowledge base is populated).
    """
    logger.debug("search_knowledge_base called [query=%s, top_k=%d]", query, top_k)
    return {
        "results": [],
        "message": "Knowledge base not yet populated. Documents will be available after RAG ingestion is configured.",
    }
