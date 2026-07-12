#!/bin/bash
# TDD-style verifier for draft-to-design-doc. The test asserts the EXPECTED
# correct behaviour, not the current behaviour of the noesis plugin.
#
# At the time of writing, the noesis plugin's `save_design_doc` enforces a
# green-field ChangeSet shape (everything in `added`). That is a bug — the
# Design Doc should reflect the diff against the implemented codebase, where
# the `Sales` Bounded Context, `Sales.Pricing.Discounts` module and the
# `Discount` discriminated union ALREADY EXIST in the DDD-starter-dotnet repo
# (mounted at /app/repo). The correct shape is therefore:
#
#   - `Sales` BC in `boundedContexts.modified`
#   - `Sales.Pricing.Discounts` module in `modules.modified`
#   - `Discount` BB in `buildingBlocks.modified` (a new `Threshold` factory
#     behaviour is added, but the BB itself already exists)
#   - `ThresholdDiscount` BB in `buildingBlocks.added` (genuinely new)
#
# Until the plugin lifts the green-field constraint, ALL three variants will
# fail this test. That's the intended TDD signal — the test is the spec.

set -u

# Search for the design doc JSON in the two known canonical locations:
#   - /app/output/design-doc.json (vanilla / guided variants)
#   - /app/noesis/design-docs/*.json (noesis variant — name computed by the plugin)
OUT=""
if [ -f /app/output/design-doc.json ]; then
    OUT=/app/output/design-doc.json
elif compgen -G "/app/noesis/design-docs/*.json" > /dev/null; then
    # shellcheck disable=SC2012
    OUT=$(ls /app/noesis/design-docs/*.json 2>/dev/null | head -1)
fi

REWARD_DIR=/logs/verifier
mkdir -p "$REWARD_DIR" 2>/dev/null || true

fail() {
    echo "✗ FAILURE: $1"
    echo 0 > "$REWARD_DIR/reward.txt"
    exit 1
}

if [ -z "$OUT" ]; then
    fail "no design-doc JSON found (looked at /app/output/design-doc.json and /app/noesis/design-docs/*.json)"
fi

echo "Inspecting: $OUT"

if ! jq -e . "$OUT" > /dev/null 2>&1; then
    fail "$OUT is not valid JSON"
fi

# --- Top-level shape ---
jq -e '.name and .description and .boundedContexts' "$OUT" > /dev/null \
    || fail "missing top-level field: name, description, or boundedContexts"

# --- Sales BC must be in `boundedContexts.modified` (it already exists in /app/repo) ---
jq -e '
    (.boundedContexts.modified // []) | map(.name) | index("Sales")
' "$OUT" > /dev/null \
    || fail "Sales is not in boundedContexts.modified — it should be classified as modified, since it already exists in /app/repo/Sources/Sales/. Found instead: added=$(jq -r ".boundedContexts.added // [] | map(.name) | join(\",\")" "$OUT"), modified=$(jq -r ".boundedContexts.modified // [] | map(.name) | join(\",\")" "$OUT")"

# --- Sales.Pricing.Discounts module must be in modules.modified under Sales ---
jq -e '
    (.boundedContexts.modified // [])[] | select(.name == "Sales") |
    (.modules.modified // []) | map(.name) | index("Sales.Pricing.Discounts")
' "$OUT" > /dev/null \
    || fail "Sales.Pricing.Discounts is not in Sales.modules.modified — it should be modified, since it already exists in /app/repo/Sources/Sales/Sales.DeepModel/Pricing/Discounts/"

# --- ThresholdDiscount must be in buildingBlocks.added under that module (genuinely new) ---
jq -e '
    (.boundedContexts.modified // [])[] | select(.name == "Sales") |
    (.modules.modified // [])[] | select(.name == "Sales.Pricing.Discounts") |
    (.buildingBlocks.added // []) | map(.name) | index("ThresholdDiscount")
' "$OUT" > /dev/null \
    || fail "ThresholdDiscount is not in Sales.Pricing.Discounts.buildingBlocks.added — it is the genuinely new building block introduced by this draft"

# --- Discount must be in buildingBlocks.modified (already exists; gains a new factory behaviour) ---
jq -e '
    (.boundedContexts.modified // [])[] | select(.name == "Sales") |
    (.modules.modified // [])[] | select(.name == "Sales.Pricing.Discounts") |
    (.buildingBlocks.modified // []) | map(.name) | index("Discount")
' "$OUT" > /dev/null \
    || fail "Discount is not in Sales.Pricing.Discounts.buildingBlocks.modified — it already exists in /app/repo/Sources/Sales/Sales.DeepModel/Pricing/Discounts/Discount.cs and the draft adds a Threshold variant to it"

# All checks passed.
echo "✓ SUCCESS: design doc reflects the correct diff against the implemented codebase"
echo "  Path: $OUT"
echo "  Sales is modified, Sales.Pricing.Discounts is modified,"
echo "  ThresholdDiscount is added, Discount is modified."
echo 1 > "$REWARD_DIR/reward.txt"
exit 0
