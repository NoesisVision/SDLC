#!/bin/bash

# DDD Architectural Challenges - Benchmark Runner
# This script runs the Harbor benchmark using the local registry

set -e

# Always run from the directory containing this script so that relative paths
# in the config (jobs_dir, registry path) resolve correctly regardless of CWD.
cd "$(dirname "$0")"

# Parse named arguments
WITH_OPIK=false
AGENT="claude-code"
MODEL="claude-sonnet-4-6"
TIMEOUT_SEC="720"

while [[ $# -gt 0 ]]; do
    case $1 in
        --with-opik)
            WITH_OPIK=true
            shift
            ;;
        --agent)
            AGENT="$2"
            shift 2
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
            AGENT="${1:-$AGENT}"
            shift
            ;;
    esac
done

echo "=========================================="
echo "Harbor Benchmark Runner"
echo "Local Registry: local-registry"
echo "Agent: $AGENT"
echo "Model: $MODEL"
echo "Agent timeout: ${TIMEOUT_SEC}s"
echo "=========================================="
echo ""

# Check if Harbor CLI is installed
if ! command -v harbor &> /dev/null; then
    echo "ERROR: Harbor CLI is not installed."
    echo ""
    echo "Please install Harbor first:"
    echo "  pip install harbor-cli"
    echo ""
    exit 1
fi

# Check for Anthropic API key if using Claude agent
if [[ "$AGENT" == "claude-code" ]]; then
    if [ -z "$ANTHROPIC_API_KEY" ]; then
        echo "ERROR: ANTHROPIC_API_KEY environment variable is not set."
        echo ""
        echo "Please set your Anthropic API key:"
        echo "  export ANTHROPIC_API_KEY='your-api-key-here'"
        echo ""
        echo "Or get your API key from: https://console.anthropic.com/"
        echo ""
        exit 1
    fi
    echo "✓ Anthropic API key found"
    echo ""
fi

echo "Running benchmark with local registry..."
echo ""

# Build config JSON inline to set agent timeout
CONFIG_FILE=$(mktemp /tmp/harbor-run-XXXXXX.json)
trap 'rm -f "$CONFIG_FILE"' EXIT

cat > "$CONFIG_FILE" << EOF
{
  "jobs_dir": "jobs",
  "n_attempts": 1,
  "agents": [
    {
      "name": "$AGENT",
      "model_name": "$MODEL",
      "override_timeout_sec": $TIMEOUT_SEC
    }
  ],
  "datasets": [
    {
      "name": "ddd-architectural-challenges",
      "registry": {
        "path": "local-registry.json"
      }
    }
  ]
}
EOF

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
echo "  harbor view jobs/<job-name>"
echo ""
