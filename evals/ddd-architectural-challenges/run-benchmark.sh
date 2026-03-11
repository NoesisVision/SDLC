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
#   ./evals/ddd-architectural-challenges/run-benchmark.sh --with-opik --with-arch-eval with-mcp
#   ./evals/ddd-architectural-challenges/run-benchmark.sh --tasks ddd-weather-discount with-mcp
#
# Examples:
#   ./evals/ddd-architectural-challenges/run-benchmark.sh with-mcp
#   ./evals/ddd-architectural-challenges/run-benchmark.sh baseline claude-sonnet-4-6 900
#   ./evals/ddd-architectural-challenges/run-benchmark.sh --with-opik --with-arch-eval with-mcp
#   ./evals/ddd-architectural-challenges/run-benchmark.sh --tasks ddd-threshold-discount,ddd-weather-discount with-mcp

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------

WITH_OPIK=false
WITH_ARCH_EVAL=false
TASKS_FILTER=""
VARIANT="with-mcp"
MODEL="claude-sonnet-4-6"
TIMEOUT_SEC="720"

while [[ $# -gt 0 ]]; do
    case $1 in
        --with-opik)
            WITH_OPIK=true
            shift
            ;;
        --with-arch-eval)
            WITH_ARCH_EVAL=true
            shift
            ;;
        --tasks)
            TASKS_FILTER="$2"
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
[ -n "$TASKS_FILTER" ] && echo "Tasks: $TASKS_FILTER"
[ "$WITH_OPIK" = true ] && echo "Opik: enabled"
[ "$WITH_ARCH_EVAL" = true ] && echo "Arch eval: enabled"
echo "=========================================="
echo ""

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------

if ! uv run python -c "import harbor" &> /dev/null; then
    echo "ERROR: Harbor is not installed in the project venv."
    echo "  uv pip install harbor-ai"
    exit 1
fi

# Load eval-platforms .env if present (OPIK_API_KEY, OPIK_WORKSPACE, etc.)
ENV_FILE="${SCRIPT_DIR}/../eval-platforms/.env"
if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
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
# Build merged config: variant har bor_config.json + dataset/jobs metadata
# ---------------------------------------------------------------------------

CONFIG_FILE=$(mktemp /tmp/harbor-run-XXXXXX.json)
trap 'rm -f "$CONFIG_FILE" /tmp/harbor-registry-*.json' EXIT

# Merge variant's agent config with the dataset/jobs boilerplate using python
python3 - "$VARIANT_DIR/harbor_config.json" "$CONFIG_FILE" "$SCRIPT_DIR" "$MODEL" "$TIMEOUT_SEC" "$TASKS_FILTER" << 'PYEOF'
import json
import sys
import tempfile

variant_config_path = sys.argv[1]
output_path = sys.argv[2]
script_dir = sys.argv[3]
model = sys.argv[4]
timeout_sec = float(sys.argv[5])
tasks_filter = sys.argv[6]

with open(variant_config_path) as f:
    variant = json.load(f)

for agent in variant.get("agents", []):
    agent.setdefault("model_name", model)
    agent.setdefault("override_timeout_sec", timeout_sec)

registry_path = f"{script_dir}/local-registry.json"

if tasks_filter:
    allowed_tasks = {t.strip() for t in tasks_filter.split(",")}
    with open(registry_path) as f:
        registry = json.load(f)
    for dataset in registry:
        dataset["tasks"] = [
            t for t in dataset.get("tasks", []) if t["name"] in allowed_tasks
        ]
    fd, filtered_path = tempfile.mkstemp(suffix=".json", prefix="harbor-registry-")
    with open(fd, "w") as f:
        json.dump(registry, f, indent=2)
    registry_path = filtered_path

config = {
    "jobs_dir": f"{script_dir}/jobs",
    "n_attempts": 1,
    "agents": variant["agents"],
    "datasets": [
        {
            "name": "ddd-architectural-challenges",
            "registry": {"path": registry_path},
        }
    ],
    "artifacts": [{"source": "/app/Sources", "destination": "workspace"}],
}

with open(output_path, "w") as f:
    json.dump(config, f, indent=2)
PYEOF

if [ "$WITH_OPIK" = true ]; then
    echo "Opik tracking enabled"
    echo ""
    uv run opik harbor run --config "$CONFIG_FILE"
else
    uv run harbor run --config "$CONFIG_FILE"
fi

echo ""
echo "=========================================="
echo "Benchmark execution completed"
echo "=========================================="
echo ""

# ---------------------------------------------------------------------------
# Post-hoc architecture evaluation
# ---------------------------------------------------------------------------

if [ "$WITH_ARCH_EVAL" = true ]; then
    echo "Running architecture evaluation..."
    echo ""
    LATEST_JOB=$(ls -td "${SCRIPT_DIR}/jobs/"* 2>/dev/null | head -1)
    if [ -n "$LATEST_JOB" ]; then
        OPIK_FLAG=""
        [ "$WITH_OPIK" = true ] && OPIK_FLAG="--with-opik"
        # Unset CLAUDECODE to allow Claude Code SDK to launch a new session
        unset CLAUDECODE
        uv run python evals/eval-platforms/evaluate_architecture.py \
            --job-dir "$LATEST_JOB" $OPIK_FLAG
    else
        echo "WARN: No job directory found for architecture evaluation"
    fi
    echo ""
fi

echo "To view results, run:"
echo "  harbor view ${SCRIPT_DIR}/jobs/<job-name>"
echo ""
