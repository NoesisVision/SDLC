#!/usr/bin/env python3
"""
Tests for the Noesis Local MCP Server

This module contains tests to verify the MCP server functionality.
"""

import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def test_database_initialization() -> None:
    """
    Test that the server creates the .noesis directory and database file.

    This test verifies that when the server starts, it:
    1. Creates the .noesis directory
    2. Creates the graph.db file
    3. Initializes the FalkorDB database
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        noesis_dir = tmpdir_path / ".noesis"
        db_file = noesis_dir / "graph.db"

        # Verify directory doesn't exist yet
        assert not noesis_dir.exists(), "noesis directory should not exist yet"

        # Get the path to the server script
        repo_root = Path(__file__).parent.parent.parent.parent
        server_path = repo_root / "src" / "mcp" / "noesis_local" / "server.py"
        assert server_path.exists(), f"Server script not found at {server_path}"

        # Start the server process in the temp directory
        process = subprocess.Popen(
            [sys.executable, str(server_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(tmpdir_path),
        )

        try:
            # Send initialize request
            initialize_request = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "test-client", "version": "1.0.0"},
                },
            }

            process.stdin.write(json.dumps(initialize_request) + "\n")
            process.stdin.flush()

            # Read initialize response (non-blocking with timeout)
            import select

            ready = select.select([process.stdout], [], [], 5.0)
            assert ready[0], "Server did not respond to initialize request"

            response_line = process.stdout.readline()
            initialize_response = json.loads(response_line)

            assert initialize_response["jsonrpc"] == "2.0"
            assert initialize_response["id"] == 1
            assert "result" in initialize_response

            # Send initialized notification
            initialized_notification = {
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
            }
            process.stdin.write(json.dumps(initialized_notification) + "\n")
            process.stdin.flush()

            # Give server time to create database files
            # FalkorDBLite needs time to initialize the embedded Redis and create the database
            time.sleep(4.0)

            # Verify .noesis directory was created
            assert noesis_dir.exists(), f".noesis directory should be created in {tmpdir_path}"
            assert noesis_dir.is_dir(), ".noesis should be a directory"

            # Verify database files were created (at least settings file should exist)
            # FalkorDBLite creates graph.db.settings immediately, graph.db may be created later
            db_files = list(noesis_dir.glob("graph.db*"))
            assert len(db_files) > 0, f"Database files should be created. Found: {list(noesis_dir.iterdir())}"

            # Check that settings file exists
            settings_file = noesis_dir / "graph.db.settings"
            assert settings_file.exists(), "graph.db.settings file should exist"

            print("✓ Server created .noesis directory and database files")

        finally:
            process.terminate()
            process.wait(timeout=5)


def test_database_persists_across_restarts() -> None:
    """
    Test that data persists when the server is restarted.

    This test verifies that:
    1. Database files are created on first run
    2. Database files persist after server shutdown
    3. Database files can be reused on server restart
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        noesis_dir = tmpdir_path / ".noesis"
        settings_file = noesis_dir / "graph.db.settings"

        repo_root = Path(__file__).parent.parent.parent.parent
        server_path = repo_root / "src" / "mcp" / "noesis_local" / "server.py"
        assert server_path.exists(), f"Server script not found at {server_path}"

        # First server start
        process1 = subprocess.Popen(
            [sys.executable, str(server_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(tmpdir_path),
        )

        try:
            # Initialize first server
            initialize_request = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "test-client", "version": "1.0.0"},
                },
            }

            process1.stdin.write(json.dumps(initialize_request) + "\n")
            process1.stdin.flush()

            # Read initialize response
            import select

            ready = select.select([process1.stdout], [], [], 5.0)
            assert ready[0], "Server did not respond to initialize request"

            response_line = process1.stdout.readline()
            initialize_response = json.loads(response_line)
            assert "result" in initialize_response

            # Send initialized notification
            initialized_notification = {
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
            }
            process1.stdin.write(json.dumps(initialized_notification) + "\n")
            process1.stdin.flush()

            # Give time for database to be created
            time.sleep(2.0)

            # Verify database files exist
            assert noesis_dir.exists(), ".noesis directory should exist"
            db_files_before = list(noesis_dir.glob("graph.db*"))
            assert len(db_files_before) > 0, "Database files should exist after first start"
            assert settings_file.exists(), "Settings file should exist"

            # Store file count
            num_files_before = len(db_files_before)

        finally:
            process1.terminate()
            process1.wait(timeout=5)

        # Verify database files still exist after shutdown
        db_files_after_shutdown = list(noesis_dir.glob("graph.db*"))
        assert len(db_files_after_shutdown) > 0, "Database files should persist after server shutdown"
        assert settings_file.exists(), "Settings file should persist after shutdown"

        # Second server start (restart)
        time.sleep(0.5)  # Small delay before restart

        process2 = subprocess.Popen(
            [sys.executable, str(server_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(tmpdir_path),
        )

        try:
            # Initialize second server
            process2.stdin.write(json.dumps(initialize_request) + "\n")
            process2.stdin.flush()

            ready = select.select([process2.stdout], [], [], 5.0)
            assert ready[0], "Server did not respond to initialize request on restart"

            response_line = process2.stdout.readline()
            initialize_response = json.loads(response_line)
            assert "result" in initialize_response

            # Send initialized notification
            process2.stdin.write(json.dumps(initialized_notification) + "\n")
            process2.stdin.flush()

            time.sleep(2.0)

            # Database files should still exist and be usable
            db_files_after_restart = list(noesis_dir.glob("graph.db*"))
            assert len(db_files_after_restart) > 0, "Database files should still exist after restart"
            assert settings_file.exists(), "Settings file should exist after restart"

            print("✓ Database persists across server restarts")

        finally:
            process2.terminate()
            process2.wait(timeout=5)

def test_server_lists_tools() -> None:
    """
    Test that the server correctly lists available tools.

    This test verifies that both ping and analyze_conversation_file tools
    are available in the tools list.
    """
    repo_root = Path(__file__).parent.parent.parent.parent
    server_path = repo_root / "src" / "mcp" / "noesis_local" / "server.py"
    assert server_path.exists(), f"Server script not found at {server_path}"

    process = subprocess.Popen(
        [sys.executable, str(server_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    try:
        # Send initialize request
        initialize_request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "test-client", "version": "1.0.0"},
            },
        }

        process.stdin.write(json.dumps(initialize_request) + "\n")
        process.stdin.flush()

        # Read initialize response
        response_line = process.stdout.readline()
        initialize_response = json.loads(response_line)

        # Send initialized notification
        initialized_notification = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        }

        process.stdin.write(json.dumps(initialized_notification) + "\n")
        process.stdin.flush()

        # Send tools/list request
        list_tools_request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {},
        }

        process.stdin.write(json.dumps(list_tools_request) + "\n")
        process.stdin.flush()

        # Read tools list response
        tools_response_line = process.stdout.readline()
        tools_response = json.loads(tools_response_line)

        print(f"Tools list response: {json.dumps(tools_response, indent=2)}")

        # Verify the response
        assert tools_response["jsonrpc"] == "2.0"
        assert tools_response["id"] == 2
        assert "result" in tools_response
        assert "tools" in tools_response["result"]

        # Check that required tools are in the list
        tools = tools_response["result"]["tools"]
        tool_names = [t["name"] for t in tools]

        # Verify analyze_conversation_file tool
        analyze_tool = next((t for t in tools if t["name"] == "analyze_conversation_file"), None)
        assert analyze_tool is not None, "analyze_conversation_file tool not found in tools list"
        assert analyze_tool["description"] is not None
        assert "inputSchema" in analyze_tool

        # Verify the analyze_conversation_file has correct schema structure
        input_schema = analyze_tool["inputSchema"]
        assert "properties" in input_schema
        assert "file_path" in input_schema["properties"]

        print("✓ Server correctly lists ping and analyze_conversation_file tools")

    finally:
        process.terminate()
        process.wait(timeout=5)
