# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Load a single topic's full data including idea units from the structured output file."""

import argparse
import json
import sys
from pathlib import Path

from models import StructuredConversation


class ScriptError(Exception):
    pass


def load_topic_data(structured_path: Path, topic_id: str) -> dict:
    """Load complete topic data including idea units.

    Args:
        structured_path: Path to the structured output file.
        topic_id: ID of the topic to load.

    Returns:
        Dict with full topic information including idea_units.
    """
    if not structured_path.exists():
        raise ScriptError(f"Structured output file not found: {structured_path}")

    structured = StructuredConversation.model_validate_json(structured_path.read_text(encoding="utf-8"))

    for topic in structured.topics:
        if topic.topic_id == topic_id:
            return {
                "status": "success",
                "topic": topic.model_dump(),
            }

    raise ScriptError(f"Topic not found: {topic_id}")


def _main() -> None:
    parser = argparse.ArgumentParser(description="Load full topic data")
    parser.add_argument("--structured-path", type=Path, required=True, help="Path to structured output file")
    parser.add_argument("--topic-id", required=True, help="Topic ID to load")
    args = parser.parse_args()

    try:
        result = load_topic_data(args.structured_path, args.topic_id)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    _main()
