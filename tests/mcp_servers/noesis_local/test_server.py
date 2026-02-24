"""Tests for the Noesis Local MCP Server."""

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from mcp_servers.noesis_local.server import noesis_server


@pytest.mark.real_db
async def test_database_initialization(tmp_path, monkeypatch) -> None:
    """Test that the server creates the .noesis directory and database file."""
    monkeypatch.chdir(tmp_path)
    noesis_dir = tmp_path / ".noesis"

    assert not noesis_dir.exists()

    async with create_connected_server_and_client_session(noesis_server):
        assert noesis_dir.exists()
        assert noesis_dir.is_dir()

        db_files = list(noesis_dir.glob("graph.db*"))
        assert len(db_files) > 0, f"Database files should be created. Found: {list(noesis_dir.iterdir())}"

        settings_file = noesis_dir / "graph.db.settings"
        assert settings_file.exists()


@pytest.mark.real_db
async def test_database_persists_across_restarts(tmp_path, monkeypatch) -> None:
    """Test that data persists when the server is restarted."""
    monkeypatch.chdir(tmp_path)
    noesis_dir = tmp_path / ".noesis"

    async with create_connected_server_and_client_session(noesis_server):
        assert noesis_dir.exists()
        db_files_before = list(noesis_dir.glob("graph.db*"))
        assert len(db_files_before) > 0

    db_files_after_shutdown = list(noesis_dir.glob("graph.db*"))
    assert len(db_files_after_shutdown) > 0

    async with create_connected_server_and_client_session(noesis_server):
        db_files_after_restart = list(noesis_dir.glob("graph.db*"))
        assert len(db_files_after_restart) > 0
