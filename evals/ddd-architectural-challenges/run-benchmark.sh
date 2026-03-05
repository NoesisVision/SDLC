#!/bin/bash

# DDD Architectural Challenges - Benchmark Runner
#
# Runs a named variant against the local Harbor registry.
# Each variant is a directory under variants/ containing:
#   - harbor_config.json  – agent import path + sandbox_files mapping
#   - CLAUDE.md           – agent instructions injected into /app/CLAUDE.md
#   - claude_config.json  – (optional) MCP servers injected into sandbox
#
# Authentication:
#   Uses CLAUDE_CODE_OAUTH_TOKEN from the environment. If not set, the script
#   sources export_oauth_token.sh to extract it from the macOS Keychain.
#   You can also set ANTHROPIC_API_KEY instead for API-key based auth.
#
# Usage:
#   ./evals/ddd-architectural-challenges/run-benchmark.sh [variant] [model] [timeout]
#   ./evals/ddd-architectural-challenges/run-benchmark.sh --with-opik with-mcp
#
# Examples:
#   ./evals/ddd-architectural-challenges/run-benchmark.sh with-mcp
#   ./evals/ddd-architectural-challenges/run-benchmark.sh baseline claude-sonnet-4-6 900
#   ./evals/ddd-architectural-challenges/run-benchmark.sh --with-opik with-mcp

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------

WITH_OPIK=false
VARIANT="with-mcp"
MODEL="claude-sonnet-4-6"
TIMEOUT_SEC="720"

while [[ $# -gt 0 ]]; do
    case $1 in
        --with-opik)
            WITH_OPIK=true
            shift
            ;;
        --model)
            MODEL="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT_SEC="$2"
            shift 2
            ;;
        *)
            VARIANT="${1:-$VARIANT}"
            shift
            ;;
    esac
done

VARIANT_DIR="${SCRIPT_DIR}/variants/${VARIANT}"

if [ ! -d "$VARIANT_DIR" ]; then
    echo "ERROR: Variant '${VARIANT}' not found."
    echo ""
    echo "Available variants:"
    ls -1 "${SCRIPT_DIR}/variants/" 2>/dev/null | sed 's/^/  /'
    echo ""
    exit 1
fi

if [ ! -f "${VARIANT_DIR}/harbor_config.json" ]; then
    echo "ERROR: ${VARIANT_DIR}/harbor_config.json not found."
    exit 1
fi

echo "=========================================="
echo "Harbor Benchmark Runner"
echo "Variant: $VARIANT"
echo "Model: $MODEL"
echo "Agent timeout: ${TIMEOUT_SEC}s"
[ "$WITH_OPIK" = true ] && echo "Opik: enabled"
echo "=========================================="
echo ""

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------

if ! command -v harbor &> /dev/null; then
    echo "ERROR: Harbor CLI is not installed."
    echo "  pip install harbor-ai"
    exit 1
fi

# Ensure authentication — prefer existing env vars, fall back to Keychain
if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
    echo "No ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN found, trying Keychain..."
    # shellcheck disable=SC1091
    source "${SCRIPT_DIR}/../export_oauth_token.sh"
fi

echo ""
echo "Running benchmark..."
echo ""

# ---------------------------------------------------------------------------
# Build merged config: variant harbor_config.json + dataset/jobs metadata
# ---------------------------------------------------------------------------

CONFIG_FILE=$(mktemp /tmp/harbor-run-XXXXXX.json)
trap 'rm -f "$CONFIG_FILE"' EXIT

# Merge variant's agent config with the dataset/jobs boilerplate using python
python3 - "$VARIANT_DIR/harbor_config.json" "$CONFIG_FILE" "$SCRIPT_DIR" "$MODEL" "$TIMEOUT_SEC" << 'PYEOF'
import json
import sys

variant_config_path = sys.argv[1]
output_path = sys.argv[2]
script_dir = sys.argv[3]
model = sys.argv[4]
timeout_sec = float(sys.argv[5])

with open(variant_config_path) as f:
    variant = json.load(f)

for agent in variant.get("agents", []):
    agent.setdefault("model_name", model)
    agent.setdefault("override_timeout_sec", timeout_sec)

config = {
    "jobs_dir": f"{script_dir}/jobs",
    "n_attempts": 1,
    "agents": variant["agents"],
    "datasets": [
        {
            "name": "ddd-architectural-challenges",
            "registry": {"path": f"{script_dir}/local-registry.json"},
        }
    ],
}

with open(output_path, "w") as f:
    json.dump(config, f, indent=2)
PYEOF

if [ "$WITH_OPIK" = true ]; then
    echo "Opik tracking enabled"
    echo ""
    opik harbor run --config "$CONFIG_FILE"
else
    harbor run --config "$CONFIG_FILE"
fi

echo ""
echo "=========================================="
echo "Benchmark execution completed"
echo "=========================================="
echo ""
echo "To view results, run:"
echo "  harbor view ${SCRIPT_DIR}/jobs/<job-name>"
echo ""
