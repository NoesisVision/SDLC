#!/bin/bash
# Stage the noesis plugin sources into ./_plugin-staging/ so the Dockerfile
# can COPY them. Run this once (or whenever plugin sources change) BEFORE
# `nasde run --variant noesis -C evals/draft-to-design-doc`.
#
# The staging dir is git-ignored.
#
# Usage (from anywhere):
#   bash evals/draft-to-design-doc/tasks/threshold-discount-extraction-noesis/environment/prepare-context.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
STAGING="$HERE/_plugin-staging"
PLUGIN_SRC="$(cd "$HERE/../../../../../src/agent_extensions/plugins/noesis" && pwd)"

echo "[prepare-context] plugin source: $PLUGIN_SRC"
echo "[prepare-context] staging dir:    $STAGING"

# Use rsync to mirror only what we need. Excludes match the .dockerignore so the
# Docker build context stays small.
mkdir -p "$STAGING"
rsync -a --delete \
  --exclude=node_modules \
  --exclude=.serena \
  --exclude=noesis \
  --exclude=.git \
  --exclude=__pycache__ \
  --exclude=.DS_Store \
  "$PLUGIN_SRC/" "$STAGING/"

echo "[prepare-context] staged $(du -sh "$STAGING" | cut -f1) into _plugin-staging/"
