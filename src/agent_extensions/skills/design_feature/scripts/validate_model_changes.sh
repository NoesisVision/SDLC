#!/usr/bin/env bash
# Validates model-changes.json against model_changes_schema.json
# Uses the best available validator with graceful fallback

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA_FILE="${SCRIPT_DIR}/model_changes_schema.json"
DATA_FILE="$1"

if [ -z "$DATA_FILE" ]; then
    echo "Usage: $0 <model-changes.json>"
    exit 1
fi

if [ ! -f "$DATA_FILE" ]; then
    echo "Error: File not found: $DATA_FILE"
    exit 1
fi

if [ ! -f "$SCHEMA_FILE" ]; then
    echo "Error: Schema file not found: $SCHEMA_FILE"
    exit 1
fi

# Try validators in order of preference

# 1. Try ajv-cli (if available)
if command -v ajv &> /dev/null; then
    echo "Validating with ajv-cli..."
    ajv validate -s "$SCHEMA_FILE" -d "$DATA_FILE"
    echo "✓ Validation passed (ajv-cli)"
    exit 0
fi

# 2. Try Python with jsonschema (most common)
if command -v python3 &> /dev/null; then
    if python3 -c "import jsonschema" 2>/dev/null; then
        echo "Validating with Python jsonschema..."
        python3 << EOF
import json
import sys
try:
    import jsonschema

    with open('$SCHEMA_FILE', 'r') as f:
        schema = json.load(f)

    with open('$DATA_FILE', 'r') as f:
        data = json.load(f)

    # Use Draft7Validator for better error reporting
    validator = jsonschema.Draft7Validator(schema)
    errors = list(validator.iter_errors(data))

    if not errors:
        print("✓ Validation passed (Python jsonschema)")
        sys.exit(0)

    # Report all validation errors
    print(f"✗ Validation failed with {len(errors)} error(s):", file=sys.stderr)
    for err in errors:
        path = ' -> '.join(str(p) for p in err.path) if err.path else 'root'
        print(f"\n  At: {path}", file=sys.stderr)
        print(f"  Error: {err.message}", file=sys.stderr)

        # Show context errors for oneOf/anyOf failures
        if err.context:
            print(f"  Possible issues:", file=sys.stderr)
            for ctx_err in err.context:
                # Filter out redundant messages
                if 'was expected' not in ctx_err.message:
                    print(f"    • {ctx_err.message}", file=sys.stderr)

    sys.exit(1)
except Exception as e:
    print(f"✗ Error: {e}", file=sys.stderr)
    sys.exit(1)
EOF
        exit $?
    fi
fi

# 3. Fallback: Basic JSON syntax validation only
echo "Warning: No JSON schema validator found (ajv-cli or Python jsonschema)"
echo "Performing basic JSON syntax validation only..."

if command -v python3 &> /dev/null; then
    if python3 -m json.tool "$DATA_FILE" > /dev/null 2>&1; then
        echo "✓ JSON syntax is valid (schema validation skipped)"
        echo ""
        echo "To enable full schema validation, install one of:"
        echo "  - npm install -g ajv-cli ajv-formats"
        echo "  - uv add jsonschema"
        exit 0
    else
        echo "✗ Invalid JSON syntax"
        exit 1
    fi
elif command -v node &> /dev/null; then
    if node -e "JSON.parse(require('fs').readFileSync('$DATA_FILE', 'utf8'))" 2>/dev/null; then
        echo "✓ JSON syntax is valid (schema validation skipped)"
        echo ""
        echo "To enable full schema validation, install one of:"
        echo "  - npm install -g ajv-cli ajv-formats"
        echo "  - uv add jsonschema"
        exit 0
    else
        echo "✗ Invalid JSON syntax"
        exit 1
    fi
else
    echo "Error: No JSON parser found (python3 or node required)"
    exit 1
fi
