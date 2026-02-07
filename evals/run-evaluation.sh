#!/bin/bash
# Quick start script for running promptfoo evaluation
# Usage: ./run-evaluation.sh [--view-only]

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Promptfoo Coding Agent Evaluation${NC}"
echo -e "${GREEN}======================================${NC}\n"

# Check if promptfoo is installed
if ! command -v promptfoo &> /dev/null; then
    echo -e "${RED}Error: promptfoo is not installed${NC}"
    echo "Install it with: npm install -g promptfoo"
    exit 1
fi

# Check if coding agents are installed
echo -e "${YELLOW}Checking coding agent installations...${NC}"
MISSING_AGENTS=()

if ! command -v claude &> /dev/null; then
    MISSING_AGENTS+=("claude")
fi

if ! command -v gemini &> /dev/null; then
    MISSING_AGENTS+=("gemini")
fi

if ! command -v codex &> /dev/null; then
    MISSING_AGENTS+=("codex")
fi

if [ ${#MISSING_AGENTS[@]} -ne 0 ]; then
    echo -e "${YELLOW}Warning: The following agents are not installed:${NC}"
    for agent in "${MISSING_AGENTS[@]}"; do
        echo "  - $agent"
    done
    echo -e "${YELLOW}Evaluation will continue with available agents${NC}\n"
fi

# Check for Anthropic API key
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    echo -e "${RED}Error: ANTHROPIC_API_KEY environment variable is not set${NC}"
    echo "Set it with: export ANTHROPIC_API_KEY='your-api-key'"
    exit 1
fi

# Make wrapper scripts executable
chmod +x claude-wrapper.sh gemini-wrapper.sh codex-wrapper.sh 2>/dev/null || true

# Run evaluation or view results
if [ "${1:-}" == "--view-only" ]; then
    echo -e "${GREEN}Opening results viewer...${NC}"
    promptfoo view
else
    echo -e "${GREEN}Starting evaluation...${NC}"
    echo -e "${YELLOW}This may take several minutes as each agent processes the prompts${NC}"
    echo -e "${YELLOW}Watch for [Agent] logs below to track progress...${NC}\n"

    # Run the evaluation with table output
    if promptfoo eval -c promptfooconfig.yaml --table; then
        echo -e "\n${GREEN}✓ Evaluation completed successfully${NC}"
        echo -e "${GREEN}Results saved to: promptfoo-results.json${NC}\n"

        # Ask if user wants to view results
        read -p "View results in browser? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            promptfoo view
        else
            echo -e "${YELLOW}View results later with: ./run-evaluation.sh --view-only${NC}"
        fi
    else
        echo -e "\n${RED}✗ Evaluation failed${NC}"
        echo "Check the error messages above for details"
        exit 1
    fi
fi