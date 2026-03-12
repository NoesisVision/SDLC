#!/bin/bash

# Decision Extraction - Structural Verification
# Verifies that the agent produced valid decision output files.

echo "=========================================="
echo "Decision Extraction - Evaluation"
echo "=========================================="
echo ""

cd /app

PASS=true

echo "Step 1: Verifying decision files exist..."
echo "--------------------------------------"
DECISION_COUNT=$(find /app/output/decisions -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
if [ "$DECISION_COUNT" -ge 1 ]; then
    echo "SUCCESS: Found $DECISION_COUNT decision file(s)"
    echo ""
else
    echo "FAILURE: No JSON files found in /app/output/decisions/"
    echo 0 > /logs/verifier/reward.txt
    exit 1
fi

echo "Step 2: Validating decision file structure..."
echo "--------------------------------------"
VALID=true
for f in /app/output/decisions/*.json; do
    python3 -c "
import json, sys
with open('$f') as fh:
    d = json.load(fh)
required = ['topic_id', 'topic_name', 'context', 'decision']
for key in required:
    if key not in d:
        print(f'FAILURE: {\"$f\"} missing required field: {key}')
        sys.exit(1)
dec = d['decision']
for key in ['description', 'rationale', 'consequences']:
    if key not in dec:
        print(f'FAILURE: {\"$f\"} decision missing field: {key}')
        sys.exit(1)
print(f'OK: {\"$f\"}')
" || { VALID=false; break; }
done

if [ "$VALID" = true ]; then
    echo "SUCCESS: All decision files have valid structure"
    echo ""
else
    echo "FAILURE: One or more decision files have invalid structure"
    echo 0 > /logs/verifier/reward.txt
    exit 1
fi

echo "Step 3: Verifying structured.json exists..."
echo "--------------------------------------"
if [ -f /app/output/structured.json ]; then
    python3 -c "
import json, sys
with open('/app/output/structured.json') as f:
    d = json.load(f)
if 'topics' not in d or not isinstance(d['topics'], list):
    print('FAILURE: structured.json missing topics array')
    sys.exit(1)
print(f'OK: structured.json has {len(d[\"topics\"])} topic(s)')
" || {
        echo "FAILURE: structured.json is invalid"
        echo 0 > /logs/verifier/reward.txt
        exit 1
    }
    echo "SUCCESS: structured.json is valid"
    echo ""
else
    echo "FAILURE: /app/output/structured.json not found"
    echo 0 > /logs/verifier/reward.txt
    exit 1
fi

echo "Step 4: Verifying minimum decision count..."
echo "--------------------------------------"
if [ "$DECISION_COUNT" -ge 2 ]; then
    echo "SUCCESS: At least 2 decisions extracted ($DECISION_COUNT total)"
    echo ""
else
    echo "FAILURE: Expected at least 2 decisions, found $DECISION_COUNT"
    echo 0 > /logs/verifier/reward.txt
    exit 1
fi

echo "=========================================="
echo "EVALUATION PASSED"
echo "=========================================="
echo ""
echo "Summary:"
echo "  - $DECISION_COUNT decision file(s) with valid structure"
echo "  - structured.json present and valid"
echo ""

echo 1 > /logs/verifier/reward.txt
exit 0
