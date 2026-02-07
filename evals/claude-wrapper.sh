#!/bin/bash
# Wrapper script for Claude Code in non-interactive mode
# Ensures the agent completes work without requiring user interaction

set -euo pipefail

PROMPT="$1"
TIMEOUT="${2:-300}"  # Default 5 minutes timeout

# Create a temporary file for the prompt
TEMP_FILE=$(mktemp)
echo "$PROMPT" > "$TEMP_FILE"

# Try different invocation methods for Claude Code
{
    # Method 1: Using stdin with non-interactive flag
    timeout "$TIMEOUT" claude code --non-interactive --no-confirm < "$TEMP_FILE" 2>&1
} || {
    # Method 2: Using direct prompt argument
    timeout "$TIMEOUT" claude code --prompt "$PROMPT" --non-interactive 2>&1
} || {
    # Method 3: Fallback to basic claude
    timeout "$TIMEOUT" claude --non-interactive <<< "$PROMPT" 2>&1
} || {
    echo "Error: All Claude invocation methods failed" >&2
    exit 1
}

# Cleanup
rm -f "$TEMP_FILE"