#!/usr/bin/env python3
"""
Tests for the Noesis Local MCP Server

This module contains tests to verify the MCP server functionality.
"""

import json
import subprocess
import sys
from pathlib import Path


def test_server_responds_to_ping() -> None:
    """
    Test that the server responds to a ping tool call.

    This test:
    1. Starts the MCP server as a subprocess
    2. Sends an initialize request
    3. Sends a tools/call request for the ping tool
    4. Verifies the response is "pong"
    """
    # Get the path to the server script (should be in src/mcp/noesis-local/)
    repo_root = Path(__file__).parent.parent.parent.parent
    server_path = repo_root / "src" / "mcp" / "noesis-local" / "server.py"

    if not server_path.exists():
        # Fallback for transition period when tools/ still exists
        server_path = repo_root / "tools" / "mcp" / "noesis-local" / "server.py"

    assert server_path.exists(), f"Server script not found at {server_path}"

    # Start the server process
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

        print(f"Initialize response: {json.dumps(initialize_response, indent=2)}")

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

        # Send tools/call request for ping
        ping_request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "ping", "arguments": {}},
        }

        process.stdin.write(json.dumps(ping_request) + "\n")
        process.stdin.flush()

        # Read ping response
        ping_response_line = process.stdout.readline()
        ping_response = json.loads(ping_response_line)

        print(f"Ping response: {json.dumps(ping_response, indent=2)}")

        # Verify the response
        assert ping_response["jsonrpc"] == "2.0"
        assert ping_response["id"] == 2
        assert "result" in ping_response
        assert ping_response["result"]["content"][0]["text"] == "pong"

        print("✓ Server responds correctly to ping tool call")

    finally:
        # Clean up the process
        process.terminate()
        process.wait(timeout=5)


def test_server_lists_tools() -> None:
    """
    Test that the server correctly lists available tools.

    This test verifies that the ping tool is available in the tools list.
    """
    repo_root = Path(__file__).parent.parent.parent.parent
    server_path = repo_root / "src" / "mcp" / "noesis-local" / "server.py"

    if not server_path.exists():
        # Fallback for transition period when tools/ still exists
        server_path = repo_root / "tools" / "mcp" / "noesis-local" / "server.py"

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

        # Check that ping tool is in the list
        tools = tools_response["result"]["tools"]
        ping_tool = next((t for t in tools if t["name"] == "ping"), None)

        assert ping_tool is not None, "ping tool not found in tools list"
        assert ping_tool["description"] is not None

        print("✓ Server correctly lists the ping tool")

    finally:
        process.terminate()
        process.wait(timeout=5)


if __name__ == "__main__":
    print("Running MCP Server Tests...\n")

    try:
        test_server_lists_tools()
        print()
        test_server_responds_to_ping()
        print("\n✓ All tests passed!")
    except AssertionError as e:
        print(f"\n✗ Test failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
