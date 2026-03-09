# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Initialize an empty structured output file next to the original conversation file."""

import argparse
import json
import sys
from pathlib import Path

from models import CleanedConversation, StructuredConversation


class ScriptError(Exception):
    pass


def init_topics(cleaned_path: Path, structured_path: Path, force: bool = False) -> dict:
    """Create a structured output file or resume from an existing one.

    If the structured file already exists with topics, returns it as-is
    (enabling crash recovery). Use force=True to overwrite.

    Args:
        cleaned_path: Path to the cleaned JSON file with parsed conversation data.
        structured_path: Path where the structured output file will be created.
        force: If True, overwrite existing structured file.

    Returns:
        Status dict indicating success and whether existing data was preserved.
    """
    if not force and structured_path.exists():
        existing = StructuredConversation.model_validate_json(structured_path.read_text(encoding="utf-8"))
        if existing.topics:
            return {
                "status": "success",
                "structured_path": str(structured_path),
                "resumed": True,
                "existing_topic_count": len(existing.topics),
            }

    if not cleaned_path.exists():
        raise ScriptError(f"Cleaned file not found: {cleaned_path}")

    cleaned = CleanedConversation.model_validate_json(cleaned_path.read_text(encoding="utf-8"))

    structured = StructuredConversation(
        conversation_id=cleaned.conversation_id,
        title=cleaned.title,
        date=cleaned.date,
        topics=[],
    )

    structured_path.write_text(json.dumps(structured.model_dump(), indent=2, ensure_ascii=False), encoding="utf-8")

    return {"status": "success", "structured_path": str(structured_path), "resumed": False}


def _main() -> None:
    parser = argparse.ArgumentParser(description="Initialize empty structured output file")
    parser.add_argument("--cleaned-path", type=Path, required=True, help="Path to cleaned JSON file")
    parser.add_argument("--structured-path", type=Path, required=True, help="Path for structured output file")
    parser.add_argument("--force", action="store_true", help="Overwrite existing structured file")
    args = parser.parse_args()

    try:
        if not args.cleaned_path.exists():
            raise ScriptError(f"Cleaned file not found: {args.cleaned_path}")
        result = init_topics(args.cleaned_path, args.structured_path, args.force)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    _main()
