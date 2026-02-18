# Implementation guidelines

## Functions structure

- Create small MCP tools focussed on a single responsibility. These tools should be composable like commands in Linux console.
- If some capabilities are already implemented in other MCP tools resue them. DO NOT return control to MCP client if something can be done internally.

## Documentation

- Write inline docs for public functions.
- Names of private functions should be descriptive enough without comments. DO NOT write inline docs for private functions.
- DO NOT write obvious things. This documentation is for experienced developers and AI agents.