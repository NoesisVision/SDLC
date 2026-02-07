# Analyze conversation

You MUST use `noesis:analyze-conversation` MCP tool to analyze conversation in: $ARGUMENTS.  
If `noesis:analyze-conversation` MCP tool is not installed, ask the user to install it first.  

## CRITICAL: File Handling Rules

If ARGUMENTS do not contain a file path, ask the user to provide it.  
DO NOT open, read or inspect the file contents.
DO NOT pass the file path to any other tool.
IMMEDIATELY pass the path string to `noesis:analyze-conversation` MCP tool.