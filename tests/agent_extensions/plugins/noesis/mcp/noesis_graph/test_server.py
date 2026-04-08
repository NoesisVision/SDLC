"""End-to-end tests for the Noesis Graph MCP Server."""

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from noesis_graph.server import noesis_graph_server


@pytest.mark.real_db
async def test_database_initialization(tmp_path, monkeypatch) -> None:
    """Test that the server creates the data directory and database file."""
    data_dir = tmp_path / "plugin_data"
    monkeypatch.setenv("CLAUDE_PLUGIN_DATA", str(data_dir))

    assert not data_dir.exists()

    async with create_connected_server_and_client_session(noesis_graph_server):
        assert data_dir.exists()
        assert data_dir.is_dir()

        db_files = list(data_dir.glob("noesis_graph.db*"))
        assert len(db_files) > 0

        settings_file = data_dir / "noesis_graph.db.settings"
        assert settings_file.exists()


@pytest.mark.real_db
async def test_database_persists_across_restarts(tmp_path, monkeypatch) -> None:
    """Test that data persists when the server is restarted."""
    data_dir = tmp_path / "plugin_data"
    monkeypatch.setenv("CLAUDE_PLUGIN_DATA", str(data_dir))

    async with create_connected_server_and_client_session(noesis_graph_server):
        assert data_dir.exists()
        db_files_before = list(data_dir.glob("noesis_graph.db*"))
        assert len(db_files_before) > 0

    db_files_after_shutdown = list(data_dir.glob("noesis_graph.db*"))
    assert len(db_files_after_shutdown) > 0

    async with create_connected_server_and_client_session(noesis_graph_server):
        db_files_after_restart = list(data_dir.glob("noesis_graph.db*"))
        assert len(db_files_after_restart) > 0


@pytest.mark.real_db
async def test_missing_env_var_raises_error(monkeypatch) -> None:
    """Test that the server fails when CLAUDE_PLUGIN_DATA is not set."""
    monkeypatch.delenv("CLAUDE_PLUGIN_DATA", raising=False)

    with pytest.raises(ExceptionGroup) as exc_info:
        async with create_connected_server_and_client_session(
            noesis_graph_server, raise_exceptions=True
        ):
            pass

    causes = exc_info.value.exceptions
    assert any("CLAUDE_PLUGIN_DATA" in str(e) for e in causes)


async def test_server_exposes_conversation_tools() -> None:
    """Test that the server starts and exposes conversation tools."""
    async with create_connected_server_and_client_session(noesis_graph_server) as client:
        result = await client.list_tools()
        tool_names = {t.name for t in result.tools}
        assert "register_conversation" in tool_names
        assert "set_conversation_metadata" in tool_names
        assert "get_raw_speaker_turns" in tool_names
