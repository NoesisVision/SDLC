#!/bin/bash

# DDD Weather Discount Challenge - Benchmark Runner
# This script runs the Harbor benchmark using the local registry

set -e

# Configuration
AGENT="${1:-claude-code}"
MODEL="${2:-claude-sonnet-4-6}"

echo "=========================================="
echo "Harbor Benchmark Runner"
echo "Local Registry: local-registry"
echo "Agent: $AGENT"
echo "Model: $MODEL"
echo "=========================================="
echo ""

# Check if Harbor CLI is installed
if ! command -v harbor &> /dev/null; then
    echo "ERROR: Harbor CLI is not installed."
    echo ""
    echo "Please install Harbor first:"
    echo "  pip install harbor-cli"
    echo "  # or"
    echo "  cargo install harbor"
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

# Run Harbor with the local registry pointing to this directory
if [[ "$AGENT" == "oracle" ]]; then
    # Oracle agent doesn't need model specification
    harbor run \
      --registry-path ./local-registry.json \
      --dataset ddd-architectural-challenges \
      --task-name ddd-weather-discount \
      --agent "$AGENT"
else
    # Claude and other AI agents need model specification
    harbor run \
      --registry-path ./local-registry.json \
      --dataset ddd-architectural-challenges \
      --task-name ddd-weather-discount \
      --agent "$AGENT" \
      --model "$MODEL"
fi

echo ""
echo "=========================================="
echo "Benchmark execution completed"
echo "=========================================="
echo ""
echo "To view results, run:"
echo "  harbor view ."
echo ""
