# /// script
# dependencies = [
#     "mcp>=1.0.0",
#     "falkordblite>=0.4.0",
#     "pysbd>=0.3.4",
#     "langdetect>=1.0.9",
# ]
# ///
"""Noesis Graph MCP Server.

Provides graph database tools for storing and querying knowledge in FalkorDB.
"""

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

from mcp.server.fastmcp import FastMCP
from redislite.falkordb_client import FalkorDB, Graph

from .conversations.registry import get_raw_speaker_turns, register_conversation, set_conversation_metadata

logger = logging.getLogger(__name__)

GRAPH_NAME = "noesis"


@dataclass
class GraphContext:
    """Type-safe context for shared graph database resources."""

    db: FalkorDB
    graph: Graph
    db_path: Path


def _resolve_data_dir() -> Path:
    plugin_data = os.environ.get("CLAUDE_PLUGIN_DATA")
    if not plugin_data:
        raise EnvironmentError("CLAUDE_PLUGIN_DATA environment variable is not set")
    return Path(plugin_data)


def _initialize_graph_db(data_dir: Path) -> GraphContext:
    db_file = data_dir / "noesis_graph.db"

    try:
        data_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        logger.exception("Failed to create data directory at %s", data_dir)
        raise

    try:
        db = FalkorDB(str(db_file))
        graph = db.select_graph(GRAPH_NAME)
        logger.info("FalkorDB initialized at %s", db_file)
        return GraphContext(db=db, graph=graph, db_path=db_file)
    except Exception:
        logger.exception("Failed to initialize FalkorDB at %s", db_file)
        raise


@asynccontextmanager
async def app_lifespan(server: FastMCP) -> AsyncIterator[GraphContext]:
    """Manage FalkorDB lifecycle for the MCP server."""

    data_dir = _resolve_data_dir()
    ctx = _initialize_graph_db(data_dir)

    try:
        yield ctx
    finally:
        if ctx.db is not None:
            ctx.db.close()
            logger.info("FalkorDB shut down")


noesis_graph_server = FastMCP("noesis-graph", lifespan=app_lifespan)

noesis_graph_server.tool()(register_conversation)
noesis_graph_server.tool()(set_conversation_metadata)
noesis_graph_server.tool()(get_raw_speaker_turns)

if __name__ == "__main__":
    noesis_graph_server.run(transport="stdio")
