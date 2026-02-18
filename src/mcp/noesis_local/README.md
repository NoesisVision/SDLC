# Noesis Local MCP Server

A Model Context Protocol (MCP) server for local Noesis operations, built with Python FastMCP.

## Overview

This MCP server provides tools for interacting with the local Noesis environment. Currently implements a simple ping-pong tool for testing connectivity.

## Features

- **ping**: A simple ping-pong tool to test server connectivity
- **stdio transport**: Uses standard input/output for communication
- **FastMCP**: Built on the FastMCP framework for easy development

## Installation

Install dependencies from the repository root:

```bash
# From repository root
pip install -e ".[dev]"
```

Or install just the runtime dependencies:

```bash
pip install -e .
```

## Usage

### Running the Server

The server uses stdio transport and can be run directly:

```bash
# From repository root
python3 src/mcp/noesis_local/server.py
```

Or make it executable and run:

```bash
chmod +x src/mcp/noesis_local/server.py
./src/mcp/noesis_local/server.py
```

### Using with Claude Desktop or other MCP clients

Add to your MCP client configuration (e.g., Claude Desktop config):

```json
{
  "mcpServers": {
    "noesis-local": {
      "command": "python3",
      "args": ["/absolute/path/to/src/mcp/noesis_local/server.py"]
    }
  }
}
```

## Available Tools

### ping

A simple ping-pong tool to test the MCP server connectivity.

**Parameters**: None

**Returns**: "pong"

**Example**:
```python
# Call the ping tool
response = await client.call_tool("ping", {})
# Returns: "pong"
```

## Testing

Run the test suite from the repository root:

```bash
# Run all tests
pytest

# Run only noesis_local tests
pytest tests/mcp/noesis_local/

# Run with verbose output
pytest -v tests/mcp/noesis_local/
```

The test suite includes:
- **test_server_lists_tools**: Verifies the server correctly lists available tools
- **test_server_responds_to_ping**: Verifies the ping tool returns "pong"

## Development

### Repository Structure

```
SDLC/
├── src/
│   └── mcp/
│       └── noesis_local/
│           ├── server.py           # Main MCP server implementation
│           └── README.md           # This file
├── tests/
│   └── mcp/
│       └── noesis_local/
│           └── test_server.py      # Test suite
├── pyproject.toml                  # Python dependencies and config
└── README.md
```

### Adding New Tools

To add new tools to the server, use the `@mcp.tool()` decorator:

```python
@mcp.tool()
def your_tool_name(param1: str, param2: int) -> str:
    """
    Tool description here.

    Args:
        param1: Description of param1
        param2: Description of param2

    Returns:
        Description of return value
    """
    # Your implementation here
    return "result"
```

## Requirements

- Python 3.8+
- mcp >= 1.0.0

Dependencies are managed in `pyproject.toml` at the repository root.

## License

Part of the Noesis SDLC project.
