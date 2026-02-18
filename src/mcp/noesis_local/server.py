#!/usr/bin/env python3
"""
Noesis Local MCP Server

A Model Context Protocol server for local Noesis operations.
This server provides tools for interacting with the local Noesis environment.
"""

import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP
from redislite.falkordb_client import FalkorDB

from analyze_conversation import analyze_conversation_file

NOESIS_GRAPH = "noesis"


@dataclass
class GraphContext:
    """Type-safe context for shared graph database resources."""

    db: FalkorDB
    graph: Any  # FalkorDB graph object
    db_path: Path
    graph_name: str = "noesis"


@asynccontextmanager
async def app_lifespan(server: FastMCP) -> AsyncIterator[GraphContext]:
    """
    Manage FalkorDB lifecycle for the MCP server.

    Initializes the database on startup and ensures proper cleanup on shutdown.
    The database file is created in the working directory inherited from the
    parent process (Claude/Gemini CLI).
    """
    # Determine database location
    cwd = Path(os.getcwd())
    noesis_dir = cwd / ".noesis"
    db_file = noesis_dir / "graph.db"

    # Ensure .noesis directory exists
    try:
        noesis_dir.mkdir(exist_ok=True)
    except PermissionError as e:
        print(f"Error: Cannot create .noesis directory: {e}", file=sys.stderr)
        raise RuntimeError(f"Permission denied for creating .noesis directory: {e}")
    except Exception as e:
        print(f"Error: Failed to create .noesis directory: {e}", file=sys.stderr)
        raise RuntimeError(f"Failed to create .noesis directory: {e}")

    # Initialize FalkorDB
    db = None
    graph = None
    try:
        db = FalkorDB(str(db_file))
        graph = db.select_graph(NOESIS_GRAPH)
        print(f"FalkorDB initialized at {db_file}", file=sys.stderr)

        # Yield the context to make it available to tools
        yield GraphContext(db=db, graph=graph, db_path=db_file, graph_name=NOESIS_GRAPH)

    except FileNotFoundError as e:
        print(f"Error: Cannot access database path: {e}", file=sys.stderr)
        raise RuntimeError(f"Cannot access database path: {db_file}")
    except PermissionError as e:
        print(f"Error: Permission denied for database: {e}", file=sys.stderr)
        raise RuntimeError(f"Permission denied for database: {db_file}")
    except Exception as e:
        print(f"Error: Failed to initialize FalkorDB: {e}", file=sys.stderr)
        raise RuntimeError(f"Failed to initialize FalkorDB: {e}")
    finally:
        # Cleanup: FalkorDB connections are managed by redislite.
        # The connection will close automatically when db goes out of scope.
        # The database file persists on disk.
        if db is not None:
            print("FalkorDB shutting down", file=sys.stderr)


# Initialize FastMCP server with lifespan
mcp = FastMCP("noesis-local", lifespan=app_lifespan)

mcp.tool()(analyze_conversation_file)


if __name__ == "__main__":
    # Run the server using stdio transport
    mcp.run(transport="stdio")
