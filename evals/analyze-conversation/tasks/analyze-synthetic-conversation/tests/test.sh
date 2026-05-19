#!/bin/bash
# Deterministic structural verifier for analyze-synthetic-conversation.
# Locates the deliverable, branches on variant, delegates the structural checks
# to verify.ts (which reuses the baked canonical Zod schemas), then writes
# /logs/verifier/reward.txt (1 = all structural invariants hold, 0 = not).
#
# Semantic correctness (categorization quality, final-vs-alternative, summary
# quality) is NOT judged here — that is the LLM reviewer via assessment_criteria.md.

set -u
mkdir -p /logs/verifier
PLUGIN=/opt/noesis-plugin
VERIFY=/tests/verify.ts

echo "=================================================="
echo "analyze-synthetic-conversation — structural verify"
echo "=================================================="

fail() {
  echo "FAILURE: $1"
  echo 0 > /logs/verifier/reward.txt
  exit 1
}

# --- Infer the variant from the canonical artifact ---
# with-skill: merge_conversation persists the graph under /app/noesis/conversations/.
# vanilla:    no MCP/merge; the only deliverable is /app/output.json.
# verify.ts reads the persisted /app/noesis/ graph itself for with-skill (the
# skill's transient output.json under /opt/noesis-data is not the source of
# truth and is not Harbor-captured), so test.sh only needs to pick the mode.
if ls /app/noesis/conversations/*.json >/dev/null 2>&1; then
  MODE="with-skill"
  echo "Detected with-skill variant (merged graph present at /app/noesis/)."
elif [ -f /app/output.json ]; then
  MODE="vanilla"
  echo "Detected vanilla variant (/app/output.json present, no merged graph)."
else
  fail "no deliverable found (neither /app/noesis/conversations/*.json nor /app/output.json)"
fi

# --- Run the structural checker with the plugin's bun ---
if ! command -v bun >/dev/null 2>&1; then
  fail "bun not on PATH in the verifier environment"
fi

echo "--------------------------------------------------"
echo "Running structural checks (verify.ts, mode=$MODE)"
echo "--------------------------------------------------"
cd "$PLUGIN" || fail "cannot cd into $PLUGIN"

if bun run "$VERIFY" "$MODE"; then
  echo "--------------------------------------------------"
  echo "EVALUATION PASSED (all structural invariants hold)"
  echo "=================================================="
  echo 1 > /logs/verifier/reward.txt
  exit 0
else
  fail "structural checks did not pass (see VERIFY FAIL line above)"
fi
