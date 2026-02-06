#!/bin/bash
# Wrapper script for Codex in non-interactive mode
# Ensures the agent completes work without requiring user interaction

set -euo pipefail

PROMPT="$1"
TIMEOUT="${2:-300}"  # Default 5 minutes timeout

# Create a temporary file for the prompt
TEMP_FILE=$(mktemp)
echo "$PROMPT" > "$TEMP_FILE"

# Try different invocation methods for Codex
{
    # Method 1: Using stdin with non-interactive flag
    timeout "$TIMEOUT" codex --non-interactive --batch < "$TEMP_FILE" 2>&1
} || {
    # Method 2: Using direct prompt argument
    timeout "$TIMEOUT" codex --prompt "$PROMPT" --batch 2>&1
} || {
    # Method 3: Fallback to basic codex with stdin
    timeout "$TIMEOUT" codex < "$TEMP_FILE" 2>&1
} || {
    echo "Error: All Codex invocation methods failed" >&2
    exit 1
}

# Cleanup
rm -f "$TEMP_FILE"