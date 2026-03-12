# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Load topic summaries and optionally detailed descriptions from the structured output file."""

import argparse
import json
from pathlib import Path

from models import StructuredConversation


def load_topics(structured_path: Path, detail_ids: list[str] | None = None) -> dict:
    """Load topic summaries, with optional full descriptions for specific topics.

    Args:
        structured_path: Path to the structured output file.
        detail_ids: Optional list of topic IDs to include full descriptions for.

    Returns:
        Dict with topic summaries and optionally detailed topics.
    """
    if not structured_path.exists():
        raise Exception(f"Structured output file not found: {structured_path}")

    structured = StructuredConversation.model_validate_json(structured_path.read_text(encoding="utf-8"))

    summaries = [
        {
            "topic_id": topic.topic_id,
            "name": topic.name,
            "summary": topic.summary,
        }
        for topic in structured.topics
    ]

    details = []
    missing_detail_ids = []

    if detail_ids:
        topics_by_id = {topic.topic_id: topic for topic in structured.topics}
        for topic_id in detail_ids:
            topic = topics_by_id.get(topic_id)
            if topic:
                details.append(
                    {
                        "topic_id": topic.topic_id,
                        "name": topic.name,
                        "summary": topic.summary,
                        "description": topic.description,
                        "idea_unit_count": len(topic.idea_units),
                    }
                )
            else:
                missing_detail_ids.append(topic_id)

    result: dict = {
        "status": "success",
        "topic_count": len(summaries),
        "topics": summaries,
    }

    if details:
        result["detailed_topics"] = details
    if missing_detail_ids:
        result["missing_detail_ids"] = missing_detail_ids

    return result


def _main() -> None:
    parser = argparse.ArgumentParser(description="Load topic summaries and optional details")
    parser.add_argument("--structured-path", type=Path, required=True, help="Path to structured output file")
    parser.add_argument("--detail-ids", nargs="*", default=None, help="Topic IDs to load full details for")
    args = parser.parse_args()

    try:
        result = load_topics(args.structured_path, args.detail_ids)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))


if __name__ == "__main__":
    _main()
