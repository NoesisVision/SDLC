# /// script
# dependencies = [
#     "jsonschema",
# ]
# ///
"""Validate a DesignDoc JSON file against the project's JSON schema."""

import json
import subprocess
import sys
from pathlib import Path

from jsonschema import Draft202012Validator


def find_schema_path() -> Path | None:
    # 1. Look in skill's own references/ directory (portable)
    script_dir = Path(__file__).resolve().parent
    skill_schema = script_dir.parent / "references" / "design-doc-diff-schema.json"
    if skill_schema.exists():
        return skill_schema

    # 2. Fall back to repository contracts/ directory
    try:
        git_root = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], text=True
        ).strip()
        schema_path = Path(git_root) / "contracts" / "design-doc-diff-schema.json"
        if schema_path.exists():
            return schema_path
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    current = Path.cwd()
    for parent in [current, *current.parents]:
        candidate = parent / "contracts" / "design-doc-diff-schema.json"
        if candidate.exists():
            return candidate
    return None


def validate(doc_path: str, schema_path: str | None = None) -> dict:
    doc_file = Path(doc_path)
    if not doc_file.exists():
        return {"status": "error", "message": f"File not found: {doc_path}"}

    try:
        doc = json.loads(doc_file.read_text())
    except json.JSONDecodeError as e:
        return {"status": "error", "message": f"Invalid JSON: {e}"}

    if schema_path:
        schema_file = Path(schema_path)
    else:
        schema_file = find_schema_path()

    if not schema_file or not schema_file.exists():
        return {
            "status": "error",
            "message": "Schema file not found. Provide --schema path or run from within the repository.",
        }

    schema = json.loads(schema_file.read_text())
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(doc), key=lambda e: list(e.absolute_path))

    if not errors:
        return {"status": "valid", "schema": str(schema_file)}

    error_list = []
    for err in errors:
        path = ".".join(str(p) for p in err.absolute_path) or "$"
        error_list.append({"path": path, "message": err.message})

    return {
        "status": "invalid",
        "error_count": len(error_list),
        "errors": error_list[:20],
        "schema": str(schema_file),
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "Usage: validate_design_doc.py <json_file> [--schema <schema_file>]"}))
        sys.exit(1)

    doc = sys.argv[1]
    schema = None
    if "--schema" in sys.argv:
        idx = sys.argv.index("--schema")
        if idx + 1 < len(sys.argv):
            schema = sys.argv[idx + 1]

    result = validate(doc, schema)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["status"] == "valid" else 1)
