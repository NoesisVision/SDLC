# Implementation guidelines

## Test levels

- You MUST write ONLY end-to-end tests for MCP tools. DO NOT write test for each separate function.
- Use fake MCP client for end-to-end tests.
- In fake MCP client simulate LLM responses for calls to LLM from MCP server tool.