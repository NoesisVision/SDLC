#!/bin/bash
# Wrapper script for Gemini CLI in non-interactive mode
# Ensures the agent completes work without requiring user interaction

set -euo pipefail

PROMPT="$1"
TIMEOUT="${2:-300}"  # Default 5 minutes timeout

# Create a temporary file for the prompt
TEMP_FILE=$(mktemp)
echo "$PROMPT" > "$TEMP_FILE"

# Try different invocation methods for Gemini CLI
{
    # Method 1: Using stdin with non-interactive flag
    timeout "$TIMEOUT" gemini --non-interactive --batch < "$TEMP_FILE" 2>&1
} || {
    # Method 2: Using direct prompt argument
    timeout "$TIMEOUT" gemini --prompt "$PROMPT" --batch 2>&1
} || {
    # Method 3: Fallback to basic gemini with stdin
    timeout "$TIMEOUT" gemini < "$TEMP_FILE" 2>&1
} || {
    echo "Error: All Gemini invocation methods failed" >&2
    exit 1
}

# Cleanup
rm -f "$TEMP_FILE"