# Noesis Local MCP Server

A Model Context Protocol (MCP) server for local Noesis operations, built with Python FastMCP.

## Installation

Install dependencies from the repository root:

```bash
uv sync
```

For development dependencies:

```bash
uv sync --extra dev
```

## Usage

### Running the Server

```bash
uv run src/mcp/noesis_local/server.py
```

### Using with MCP clients

Add to your MCP client configuration (e.g., Claude Code / Gemini CLI config):

```json
{
  "mcpServers": {
    "noesis": {
      "command": "uv",
      "args": ["run", "/absolute/path/to/src/mcp/noesis_local/server.py"]
    }
  }
}
```
