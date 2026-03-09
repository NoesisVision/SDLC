# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Save all batch extraction results (new topics, updated topics, idea units) in a single operation."""

import argparse
import json
import sys
from pathlib import Path

from models import (
    BatchResultsInput,
    IdeaUnitGroup,
    NewTopicInput,
    StructuredConversation,
    Topic,
    UpdatedTopicInput,
)
from pydantic import ValidationError


class ScriptError(Exception):
    pass


def save_batch_results(structured_path: Path, input_file: Path) -> dict:
    """Apply all batch extraction results to the structured file in one read-write cycle.

    Args:
        structured_path: Path to the structured output file.
        input_file: Path to JSON file with batch results.

    Returns:
        Status dict with created/updated topic IDs.
    """
    if not structured_path.exists():
        raise ScriptError(f"Structured output file not found: {structured_path}")
    if not input_file.exists():
        raise ScriptError(f"Input file not found: {input_file}")

    try:
        batch_input = BatchResultsInput.model_validate_json(input_file.read_text(encoding="utf-8"))
    except ValidationError as e:
        raise ScriptError(f"Invalid batch results: {e}") from e

    structured = StructuredConversation.model_validate_json(structured_path.read_text(encoding="utf-8"))

    created_ids = _apply_new_topics(structured, batch_input.new_topics)
    _apply_updated_topics(structured, batch_input.updated_topics)
    _apply_idea_units(structured, batch_input.idea_units, created_ids)

    structured_path.write_text(json.dumps(structured.model_dump(), indent=2, ensure_ascii=False), encoding="utf-8")

    return {
        "status": "success",
        "created_topic_ids": list(created_ids.values()),
        "updated_topic_count": len(batch_input.updated_topics),
        "idea_unit_groups": len(batch_input.idea_units),
    }


def _apply_idea_units(
    structured: StructuredConversation,
    idea_unit_groups: list[IdeaUnitGroup],
    created_ids: dict[str, str],
) -> None:
    topics_by_id = {t.topic_id: t for t in structured.topics}
    for group in idea_unit_groups:
        topic_id = _resolve_topic_id(group.topic_id, created_ids)
        topic = topics_by_id.get(topic_id)
        if not topic:
            raise ScriptError(f"Topic not found for idea units: {topic_id}")
        topic.idea_units.extend(group.units)


def _apply_new_topics(structured: StructuredConversation, new_topics: list[NewTopicInput]) -> dict[str, str]:
    created_ids: dict[str, str] = {}
    for new_topic in new_topics:
        next_index = len(structured.topics) + 1
        topic_id = f"topic_{next_index:03d}"
        structured.topics.append(
            Topic(
                topic_id=topic_id,
                name=new_topic.name,
                short_description=new_topic.short_description,
                long_description=new_topic.long_description,
                idea_units=[],
            )
        )
        placeholder = new_topic.placeholder_id or topic_id
        created_ids[placeholder] = topic_id
    return created_ids


def _apply_updated_topics(structured: StructuredConversation, updated_topics: list[UpdatedTopicInput]) -> None:
    topics_by_id = {t.topic_id: t for t in structured.topics}
    for update in updated_topics:
        topic = topics_by_id.get(update.topic_id)
        if not topic:
            raise ScriptError(f"Topic not found for update: {update.topic_id}")
        topic.name = update.name
        topic.short_description = update.short_description
        topic.long_description = update.long_description


def _resolve_topic_id(topic_id: str, created_ids: dict[str, str]) -> str:
    return created_ids.get(topic_id, topic_id)


def _main() -> None:
    parser = argparse.ArgumentParser(description="Save all batch extraction results atomically")
    parser.add_argument("--structured-path", type=Path, required=True, help="Path to structured output file")
    parser.add_argument("--input-file", type=Path, required=True, help="JSON file with batch results")
    args = parser.parse_args()

    try:
        result = save_batch_results(args.structured_path, args.input_file)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    _main()
