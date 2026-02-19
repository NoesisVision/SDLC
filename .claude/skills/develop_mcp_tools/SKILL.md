---
name: Develop MCP tools
description: Turn extension ideas for AI agents into MCP tools. Use it whenever a user asks for design or implementation of an MCP tool.
---

# Develop MCP tools

You are an experienced MCP developer with deep knowledge of AI agent architectures and expert-level Python.

## Project Conventions

Read these files before starting any work — they are authoritative:
- `src/mcp_servers/CLAUDE.md` — error handling, logging, function structure
- `tests/mcp_servers/CLAUDE.md` — test level and fake MCP client usage
- `CLAUDE.md` — Python style (type hints, Pydantic, dataclasses, uv, docstrings)

## Core Principles

- **Pydantic output**: Every tool returns a `pydantic.BaseModel` subclass with `Field(description="...")` on every field.
- **Tool naming**: Use snake_case verb-noun (e.g. `analyze_conversation_file`). The function docstring becomes the tool description visible to the AI client — make it informative and precise.
- **LLM access**: Inject `ctx: Context` from `mcp.server.fastmcp` only when the tool needs to call the LLM.
- **Questions**: Use AskUserQuestion tool for asking questions.
- **Code reuse**: Reuse existing functions and data structures when possible. Place code shared by multiple tools in a separate module with the appropriate name reflecting domain concept. 

## Workflow

### 0. Read the task file

If the request references the task file in `work_items` directory read this file first.
Check if status is `To do` and if is so change status to `In progress`. Otherwise, ask the user what to do.

### 1. Locate existing capabilities

Read `src/mcp_servers/<server_name>/` to understand what the server already does.
Identify functions or data structures the new tool can reuse.

### 2. Clarify intent

Analyze the request against existing capabilities.
If scope, inputs, or expected output are unclear, ask targeted clarification questions before designing.

### 3. Design the tool API

Propose the following for user acceptance before writing any code:
- **Tool name**: snake_case verb-noun
- **Docstring**: what the tool does, what it returns, and when to use it
- **Input parameters**: names, types, and a `description` for each
- **Output model**: a Pydantic `BaseModel` class with field names, types, and `Field(description=...)`
- **LLM access**: whether `ctx: Context` is needed

### 4. Implement the tool

File placement:
- New capability module: `src/mcp_servers/<server_name>/<capability>.py`
- Register in `server.py`: `server.tool()(function_name)`

### 5. Write end-to-end tests

Test file: `tests/mcp_servers/<server_name>/test_<capability>.py`

- Import: `from mcp.shared.memory import create_connected_server_and_client_session`
- Call tools through the MCP protocol (`client.call_tool(...)`) — not by calling implementation functions directly
- Run: `uv run pytest tests/mcp_servers/<server_name>/`