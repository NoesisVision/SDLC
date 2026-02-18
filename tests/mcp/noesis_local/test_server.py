#!/usr/bin/env python3
"""
Tests for the Noesis Local MCP Server

This module contains tests to verify the MCP server functionality.
"""

import json
import select
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Generator


def _find_repo_root() -> Path:
    path = Path(__file__).resolve().parent
    while path != path.parent:
        if (path / "pyproject.toml").exists():
            return path
        path = path.parent
    raise FileNotFoundError("Could not find repo root (no pyproject.toml found)")


def _server_script_path() -> Path:
    path = _find_repo_root() / "src" / "mcp" / "noesis_local" / "server.py"
    assert path.exists(), f"Server script not found at {path}"
    return path


def _send_jsonrpc(process: subprocess.Popen, message: dict[str, Any]) -> None:
    process.stdin.write(json.dumps(message) + "\n")
    process.stdin.flush()


def _read_jsonrpc_response(process: subprocess.Popen, timeout_seconds: float = 5.0) -> dict[str, Any]:
    ready = select.select([process.stdout], [], [], timeout_seconds)
    assert ready[0], "Server did not respond within timeout"
    line = process.stdout.readline()
    return json.loads(line)


def _spawn_server(cwd: Path | None = None) -> subprocess.Popen:
    return subprocess.Popen(
        [sys.executable, str(_server_script_path())],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=str(cwd) if cwd else None,
    )


def _initialize_server(process: subprocess.Popen) -> dict[str, Any]:
    _send_jsonrpc(process, {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "test-client", "version": "1.0.0"},
        },
    })
    response = _read_jsonrpc_response(process)
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 1
    assert "result" in response

    _send_jsonrpc(process, {
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
    })
    return response


@contextmanager
def _running_server(cwd: Path | None = None,) -> Generator[subprocess.Popen, None, None]:
    process = _spawn_server(cwd)
    try:
        yield process
    finally:
        process.terminate()
        process.wait(timeout=5)


def _assert_analyze_conversation_file_tool(tools: list[dict[str, Any]]) -> None:
    analyze_tool = next(
        (t for t in tools if t["name"] == "analyze_conversation_file"), None
    )
    assert analyze_tool is not None, (
        "analyze_conversation_file tool not found in tools list"
    )
    assert analyze_tool["description"] is not None
    assert "inputSchema" in analyze_tool

    input_schema = analyze_tool["inputSchema"]
    assert "properties" in input_schema
    assert "file_path" in input_schema["properties"]


def test_database_initialization() -> None:
    """Test that the server creates the .noesis directory and database file."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        noesis_dir = tmpdir_path / ".noesis"

        assert not noesis_dir.exists(), "noesis directory should not exist yet"

        with _running_server(cwd=tmpdir_path) as process:
            _initialize_server(process)
            time.sleep(4.0)

            assert noesis_dir.exists(), f".noesis directory should be created in {tmpdir_path}"
            assert noesis_dir.is_dir(), ".noesis should be a directory"

            db_files = list(noesis_dir.glob("graph.db*"))
            assert len(db_files) > 0, (
                f"Database files should be created. Found: {list(noesis_dir.iterdir())}"
            )

            settings_file = noesis_dir / "graph.db.settings"
            assert settings_file.exists(), "graph.db.settings file should exist"


def test_database_persists_across_restarts() -> None:
    """Test that data persists when the server is restarted."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        noesis_dir = tmpdir_path / ".noesis"
        settings_file = noesis_dir / "graph.db.settings"

        with _running_server(cwd=tmpdir_path) as process:
            _initialize_server(process)
            time.sleep(2.0)

            assert noesis_dir.exists(), ".noesis directory should exist"
            db_files_before = list(noesis_dir.glob("graph.db*"))
            assert len(db_files_before) > 0, "Database files should exist after first start"
            assert settings_file.exists(), "Settings file should exist"

        db_files_after_shutdown = list(noesis_dir.glob("graph.db*"))
        assert len(db_files_after_shutdown) > 0, (
            "Database files should persist after server shutdown"
        )
        assert settings_file.exists(), "Settings file should persist after shutdown"

        time.sleep(0.5)

        with _running_server(cwd=tmpdir_path) as process:
            _initialize_server(process)
            time.sleep(2.0)

            db_files_after_restart = list(noesis_dir.glob("graph.db*"))
            assert len(db_files_after_restart) > 0, (
                "Database files should still exist after restart"
            )
            assert settings_file.exists(), "Settings file should exist after restart"


def test_server_lists_tools() -> None:
    """Test that the server correctly lists available tools."""
    with _running_server() as process:
        _initialize_server(process)

        _send_jsonrpc(process, {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {},
        })
        tools_response = _read_jsonrpc_response(process)

        assert tools_response["jsonrpc"] == "2.0"
        assert tools_response["id"] == 2
        assert "result" in tools_response
        assert "tools" in tools_response["result"]

        tools = tools_response["result"]["tools"]
        _assert_analyze_conversation_file_tool(tools)
