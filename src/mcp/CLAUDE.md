# Implementation guidelines

## Functions structure

- Create small MCP tools focussed on a single responsibility. These tools should be composable like commands in Linux console.
- If some capabilities are already implemented in other MCP tools, resue them. DO NOT return control to the MCP client if something can be done internally.

## Error handling

- Use bare `raise` to propagate original exceptions — preserve the original type and traceback.
- DO NOT wrap exceptions in `RuntimeError` — callers (including the MCP framework) rely on specific exception types.
- Use `logger.exception()` before `raise` when the error context (e.g. file path, config value) would otherwise be lost.

## Logging

- Use `logging` module, never `print()`. Stdout is the MCP protocol channel — any `print()` to stdout corrupts the JSON-RPC stream.
- Create a module-level logger: `logger = logging.getLogger(__name__)`.
- Use `logger.exception()` in `except` blocks (auto-includes traceback).
- Use `logger.warning()` for recoverable issues and `logger.info()` for lifecycle events.

## Documentation

- Write inline docs for public functions.
- Names of private functions should be descriptive enough without comments. DO NOT write inline docs for private functions.
- DO NOT write obvious things. This documentation is for experienced developers and AI agents.