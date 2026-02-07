#!/usr/bin/env python3
"""
Conversation Analysis MCP Server

A Model Context Protocol server that transforms meeting transcripts into
structured knowledge graphs using a 5-phase NLP pipeline.
"""

import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict

import spacy
from mcp.server.fastmcp import Context, FastMCP
from redislite.falkordb_client import FalkorDB
from sentence_transformers import SentenceTransformer

from .capabilities.segmentation.embedder import SentenceEmbedder
from .pipeline import ConversationPipeline
from .types import (
    AnalyzeConversationRequest,
    AnalyzeConversationResponse,
    QueryConversationRequest,
    QueryConversationResponse,
)


@asynccontextmanager
async def app_lifespan(server: FastMCP) -> AsyncIterator[Dict[str, Any]]:
    """
    Manage resources for the conversation analysis MCP server.

    Initializes NLP models and database on startup, provides cleanup on shutdown.
    """
    # Database setup
    cwd = Path(os.getcwd())
    noesis_dir = cwd / ".noesis"
    db_file = noesis_dir / "conversations.db"

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
        # Create database connection with persistence
        db = FalkorDB(str(db_file))

        # Select/create the "conversations" graph
        graph = db.select_graph("conversations")

        print(f"FalkorDB initialized at {db_file}", file=sys.stderr)

    except FileNotFoundError as e:
        print(f"Error: Cannot access database path: {e}", file=sys.stderr)
        raise RuntimeError(f"Cannot access database path: {db_file}")
    except PermissionError as e:
        print(f"Error: Permission denied for database: {e}", file=sys.stderr)
        raise RuntimeError(f"Permission denied for database: {db_file}")
    except Exception as e:
        print(f"Error: Failed to initialize FalkorDB: {e}", file=sys.stderr)
        raise RuntimeError(f"Failed to initialize FalkorDB: {e}")

    # Load NLP models
    print("Loading spacy model...", file=sys.stderr)
    try:
        nlp = spacy.load("en_core_web_sm")
    except OSError:
        print("Error: Spacy model 'en_core_web_sm' not found.", file=sys.stderr)
        print("Please install it using: python -m spacy download en_core_web_sm", file=sys.stderr)
        raise RuntimeError("Spacy model 'en_core_web_sm' not found")

    print("Loading sentence-transformers model...", file=sys.stderr)
    try:
        embedder = SentenceEmbedder(model_name="sentence-transformers/all-MiniLM-L6-v2")
    except Exception as e:
        print(f"Error: Failed to load sentence-transformers model: {e}", file=sys.stderr)
        raise RuntimeError(f"Failed to load sentence-transformers model: {e}")

    print("Conversation Analysis MCP Server initialized successfully", file=sys.stderr)

    # Yield resources
    yield {
        "db": db,
        "graph": graph,
        "nlp": nlp,
        "embedder": embedder,
        "state_cache": {},  # In-memory state storage for incremental processing
    }

    # Cleanup
    print("Conversation Analysis MCP Server shutting down", file=sys.stderr)


# Initialize FastMCP server with lifespan
mcp = FastMCP("conversation-analysis", lifespan=app_lifespan)


@mcp.tool()
async def analyze_conversation(
    request: AnalyzeConversationRequest,
    ctx: Context,
) -> AnalyzeConversationResponse:
    """
    Analyze a complete conversation transcript.

    Runs all 5 phases:
    1. Ingestion: Parse and split transcript
    2. Segmentation: Detect topic boundaries
    3. Classification: IBIS categorization and term extraction
    4. Refinement: Standardize terms and merge topics
    5. Graph Construction: Build knowledge graph

    Args:
        request: Analysis request with transcript and conversation ID
        ctx: MCP context

    Returns:
        Analysis response with statistics
    """
    # Get resources from context
    resources = ctx.request_context.server_context

    # Create pipeline
    pipeline = ConversationPipeline(
        nlp=resources["nlp"],
        embedder=resources["embedder"],
        graph=resources["graph"],
        ctx=ctx,
    )

    # Run analysis
    response = await pipeline.analyze(
        transcript=request.transcript,
        conversation_id=request.conversation_id,
        confidence_threshold=request.confidence_threshold,
    )

    return response


@mcp.tool()
async def query_conversation_graph(
    request: QueryConversationRequest,
    ctx: Context,
) -> QueryConversationResponse:
    """
    Execute a Cypher query against the conversation graph.

    Args:
        request: Query request with conversation ID and Cypher query
        ctx: MCP context

    Returns:
        Query results
    """
    # Get resources from context
    resources = ctx.request_context.server_context
    graph = resources["graph"]

    try:
        # Execute query
        result = graph.query(request.cypher_query)

        # Convert results to list of dicts
        results = []
        if result.result_set:
            for row in result.result_set:
                # Convert row to dict
                # (FalkorDB result rows are lists, we'll convert to simple format)
                results.append({"data": str(row)})

        return QueryConversationResponse(
            conversation_id=request.conversation_id,
            results=results,
            row_count=len(results),
        )

    except Exception as e:
        raise RuntimeError(f"Query execution failed: {str(e)}")


if __name__ == "__main__":
    # Run the server using stdio transport
    mcp.run(transport="stdio")
