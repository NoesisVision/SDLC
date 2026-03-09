#!/bin/bash

# Apply local patches to opik package in the project venv.
#
# Why:  opik 1.10.26 Harbor integration creates step spans during Step.__init__,
#       but Harbor's claude_code agent assigns metrics AFTER construction.
#       Result: all spans have usage=None.  This patch defers span creation
#       until metrics are assigned via __setattr__.
#
# When to re-apply:  after `uv pip install opik` or `uv sync`.
# When to remove:    when opik fixes this upstream (check changelog for
#                    "harbor" + "metrics" or "token usage" mentions).
#
# Usage:
#   ./evals/eval-platforms/patches/apply_opik_patches.sh
#   ./evals/eval-platforms/patches/apply_opik_patches.sh --check   # dry-run

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

SITE_PACKAGES="${REPO_ROOT}/.venv/lib/python3.14/site-packages"
TARGET="${SITE_PACKAGES}/opik/integrations/harbor/opik_tracker.py"
PATCH="${SCRIPT_DIR}/opik_harbor_deferred_metrics.patch"

if [ ! -f "$TARGET" ]; then
    echo "ERROR: Target file not found: $TARGET"
    echo "  Is opik installed?  uv pip install opik"
    exit 1
fi

if [ ! -f "$PATCH" ]; then
    echo "ERROR: Patch file not found: $PATCH"
    exit 1
fi

# Check if already patched
if grep -q "_create_span_for_step" "$TARGET" 2>/dev/null; then
    echo "Patch already applied."
    exit 0
fi

if [ "$1" = "--check" ]; then
    echo "Patch NOT applied. Run without --check to apply."
    exit 1
fi

cd "$(dirname "$TARGET")" && patch -p1 < "$PATCH"
echo "Patch applied successfully to opik_tracker.py"
echo ""
echo "Verify with:  uv run python -c \"from opik.integrations.harbor.opik_tracker import _create_span_for_step; print('OK')\""
