"""Shared FalkorDB instance for noesis_local tests."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from redislite.falkordb_client import FalkorDB

from mcp_servers.noesis_local.server import GraphContext, NOESIS_GRAPH, noesis_server


@pytest.fixture(scope="session")
def shared_graph_context(tmp_path_factory):
    """Start a single FalkorDB instance for the entire test session."""
    db_dir = tmp_path_factory.mktemp("shared_db")
    db_file = db_dir / "graph.db"

    db = FalkorDB(str(db_file))
    graph = db.select_graph(NOESIS_GRAPH)
    ctx = GraphContext(db=db, graph=graph, db_path=db_file, graph_name=NOESIS_GRAPH)

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

    monkeypatch.setattr(noesis_server._mcp_server, "lifespan", _noop_lifespan)
