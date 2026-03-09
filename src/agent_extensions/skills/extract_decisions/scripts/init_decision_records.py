# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Create the decision records output directory and return topic IDs."""

import argparse
import json
import sys
from pathlib import Path

from models import StructuredConversation


class ScriptError(Exception):
    pass


def init_decision_records(structured_path: Path) -> dict:
    """Create the decisions output directory and extract topic IDs.

    Args:
        structured_path: Path to the structured output file.

    Returns:
        Dict with decisions_dir path and list of topic_ids.
    """
    if not structured_path.exists():
        raise ScriptError(f"Structured output file not found: {structured_path}")

    structured = StructuredConversation.model_validate_json(structured_path.read_text(encoding="utf-8"))
    topic_ids = [topic.topic_id for topic in structured.topics]

    decisions_dir = _derive_decisions_dir(structured_path)
    decisions_dir.mkdir(parents=True, exist_ok=True)

    return {
        "status": "success",
        "decisions_dir": str(decisions_dir),
        "topic_ids": topic_ids,
    }


def _derive_decisions_dir(structured_path: Path) -> Path:
    base_name = structured_path.stem.removesuffix("_structured")
    return structured_path.parent / f"{base_name}_decisions"


def _main() -> None:
    parser = argparse.ArgumentParser(description="Initialize decision records directory")
    parser.add_argument("--structured-path", type=Path, required=True, help="Path to structured output file")
    args = parser.parse_args()

    try:
        result = init_decision_records(args.structured_path)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    _main()
