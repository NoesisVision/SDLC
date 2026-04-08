"""Shared FalkorDB instance for noesis_graph tests."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from redislite.falkordb_client import FalkorDB

from agent_extensions.plugins.noesis.mcp.noesis_graph.conversations.registry import init_graph
from agent_extensions.plugins.noesis.mcp.noesis_graph.server import (
    GRAPH_NAME,
    GraphContext,
    noesis_graph_server,
)


@pytest.fixture(scope="session")
def shared_graph_context(tmp_path_factory):
    """Start a single FalkorDB instance for the entire test session."""
    db_dir = tmp_path_factory.mktemp("shared_db")
    db_file = db_dir / "noesis_graph.db"

    db = FalkorDB(str(db_file))
    graph = db.select_graph(GRAPH_NAME)
    ctx = GraphContext(db=db, graph=graph, db_path=db_file)

    init_graph(graph)

    yield ctx

    db.close()


@pytest.fixture(autouse=True)
def use_shared_db(request, shared_graph_context, monkeypatch):
    """Replace the server lifespan with one that yields the shared GraphContext.

    Tests marked with ``real_db`` are skipped so they use the real lifecycle.
    """
    if request.node.get_closest_marker("real_db"):
        return

    @asynccontextmanager
    async def _noop_lifespan(_server) -> AsyncIterator[GraphContext]:
        yield shared_graph_context

    monkeypatch.setattr(noesis_graph_server._mcp_server, "lifespan", _noop_lifespan)
