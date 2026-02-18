"""Tests for the analyze_conversation_file MCP tool."""

import json
import subprocess
import sys
from pathlib import Path


def test_analyze_conversation_file_error_handling() -> None:
    """
    Test that analyze_conversation_file handles file errors correctly.

    This test verifies error handling for:
    1. Non-existent file
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

        response_line = process.stdout.readline()
        initialize_response = json.loads(response_line)
        assert "result" in initialize_response

        # Send initialized notification
        initialized_notification = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        }

        process.stdin.write(json.dumps(initialized_notification) + "\n")
        process.stdin.flush()

        # Test: Non-existent file
        analyze_request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "analyze_conversation_file",
                "arguments": {"file_path": "/tmp/nonexistent_conversation_file_12345.txt"},
            },
        }

        process.stdin.write(json.dumps(analyze_request) + "\n")
        process.stdin.flush()

        analyze_response_line = process.stdout.readline()
        analyze_response = json.loads(analyze_response_line)

        # Should return an error result
        assert analyze_response["jsonrpc"] == "2.0"
        assert analyze_response["id"] == 2
        assert "result" in analyze_response
        assert analyze_response["result"]["isError"] is True
        assert "File not found" in analyze_response["result"]["content"][0]["text"]

    finally:
        process.terminate()
        process.wait(timeout=5)
