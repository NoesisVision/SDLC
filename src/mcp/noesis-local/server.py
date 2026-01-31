#!/usr/bin/env python3
"""
Noesis Local MCP Server

A Model Context Protocol server for local Noesis operations.
This server provides tools for interacting with the local Noesis environment.
"""

from mcp.server.fastmcp import FastMCP

# Initialize FastMCP server
mcp = FastMCP("noesis-local")


@mcp.tool()
def ping() -> str:
    """
    A simple ping-pong tool to test the MCP server connectivity.

    Returns:
        str: Returns "pong" to confirm the server is responding.
    """
    return "pong"


if __name__ == "__main__":
    # Run the server using stdio transport
    mcp.run(transport="stdio")
