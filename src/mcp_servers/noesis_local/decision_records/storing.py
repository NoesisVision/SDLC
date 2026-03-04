"""MCP tool for storing decision records as markdown files."""

import json
import logging
import re
from pathlib import Path

from .loading import _cache
from .models import StoreDecisionRecordResponse

logger = logging.getLogger(__name__)

_REQUIRED_KEYS = {"context", "options", "decision"}


async def store_decision_record(
    conversation_id: str, topic_index: int, record: str
) -> StoreDecisionRecordResponse:
    """Validate and store a decision record as a markdown file.

    Parses the record JSON, validates required keys, and writes the decision
    record to ``.noesis/decision/records/<slugified_title>/<slugified_topic>.md``.

    Args:
        conversation_id: UUID identifying the conversation.
        topic_index: Zero-based index of the topic.
        record: JSON string with ``context``, ``options``, and ``decision`` keys.

    Returns:
        Status and output path of the written file.
    """
    if conversation_id not in _cache:
        raise KeyError(
            f"Conversation {conversation_id} not loaded. "
            "Call get_conversation_topics first."
        )

    loaded = _cache[conversation_id]

    if topic_index < 0 or topic_index >= len(loaded.topics):
        raise IndexError(
            f"Topic index {topic_index} out of range. "
            f"Conversation has {len(loaded.topics)} topics (0-{len(loaded.topics) - 1})."
        )

    parsed = json.loads(record)
    _validate_record_keys(parsed)

    topic_name = loaded.topics[topic_index]["name"]
    output_path = _write_record_file(loaded.title, topic_name, parsed)

    return StoreDecisionRecordResponse(status="success", output_path=str(output_path))


def _validate_record_keys(parsed: dict) -> None:
    missing = _REQUIRED_KEYS - parsed.keys()
    if missing:
        raise ValueError(f"Record JSON missing required keys: {', '.join(sorted(missing))}")


def _write_record_file(title: str, topic_name: str, parsed: dict) -> Path:
    title_slug = _slugify(title)
    topic_slug = _slugify(topic_name)

    output_dir = Path.cwd() / ".noesis" / "decision_records" / title_slug
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{topic_slug}.md"

    content = (
        f"# {topic_name}\n\n"
        f"## Context\n\n{parsed['context']}\n\n"
        f"## Options\n\n{parsed['options']}\n\n"
        f"## Decision\n\n{parsed['decision']}\n"
    )
    output_path.write_text(content, encoding="utf-8")

    return output_path


def _slugify(text: str) -> str:
    slug = text.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug
