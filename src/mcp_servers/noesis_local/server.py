#!/usr/bin/env python3
"""
Noesis Local MCP Server

A Model Context Protocol server for local Noesis operations.
This server provides tools for interacting with the local Noesis environment.
"""

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP
from redislite.falkordb_client import FalkorDB

from mcp_servers.noesis_local.conversations.cleaning import clean_conversation, set_conversation_metadata
from mcp_servers.noesis_local.conversations.registry import add_conversation
from mcp_servers.noesis_local.conversations.finalizing import finalize_conversation
from mcp_servers.noesis_local.conversations.idea_units_extracting import (
    get_extraction_batch,
    prepare_extraction_batches,
    store_extraction_result,
)
from mcp_servers.noesis_local.conversations.topics_assigning import apply_topic_arbitration, assign_topics, embed_idea_units
from mcp_servers.noesis_local.decision_records.loading import get_conversation_topics, get_topic_data
from mcp_servers.noesis_local.decision_records.storing import store_decision_record

logger = logging.getLogger(__name__)

NOESIS_GRAPH = "noesis"


@dataclass
class GraphContext:
    """Type-safe context for shared graph database resources."""

    db: FalkorDB
    graph: Any  # FalkorDB graph object
    db_path: Path
    graph_name: str = "noesis"


def _initialize_graph_db() -> GraphContext:
    """Initialize FalkorDB and return a GraphContext."""
    working_directory = Path(os.getcwd())
    noesis_dir = working_directory / ".noesis"
    db_file = noesis_dir / "graph.db"

    try:
        noesis_dir.mkdir(exist_ok=True)
    except Exception:
        logger.exception("Failed to create .noesis directory at %s", noesis_dir)
        raise

    try:
        db = FalkorDB(str(db_file))
        graph = db.select_graph(NOESIS_GRAPH)
        logger.info("FalkorDB initialized at %s", db_file)
        return GraphContext(db=db, graph=graph, db_path=db_file, graph_name=NOESIS_GRAPH)
    except Exception:
        logger.exception("Failed to initialize FalkorDB at %s", db_file)
        raise


@asynccontextmanager
async def app_lifespan(server: FastMCP) -> AsyncIterator[GraphContext]:
    """Manage FalkorDB lifecycle for the MCP server.

    Initializes the database on startup and ensures proper cleanup on shutdown.
    The database file is created in the working directory inherited from the
    parent process (Claude/Gemini CLI).
    """

    ctx = _initialize_graph_db()

    try:
        yield ctx
    finally:
        if ctx.db is not None:
            ctx.db.close()
            logger.info("FalkorDB shut down")


noesis_server = FastMCP("noesis-local", lifespan=app_lifespan)

noesis_server.tool()(add_conversation)
noesis_server.tool()(apply_topic_arbitration)
noesis_server.tool()(assign_topics)
noesis_server.tool()(clean_conversation)
noesis_server.tool()(embed_idea_units)
noesis_server.tool()(finalize_conversation)
noesis_server.tool()(get_conversation_topics)
noesis_server.tool()(get_extraction_batch)
noesis_server.tool()(get_topic_data)
noesis_server.tool()(prepare_extraction_batches)
noesis_server.tool()(set_conversation_metadata)
noesis_server.tool()(store_decision_record)
noesis_server.tool()(store_extraction_result)

if __name__ == "__main__":
    # Run the server using stdio transport
    noesis_server.run(transport="stdio")
