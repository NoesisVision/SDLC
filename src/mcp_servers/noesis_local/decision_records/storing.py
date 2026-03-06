"""MCP tool for storing decision records as markdown files."""

import json
import logging
import re
from pathlib import Path

from .loading import _cache
from .models import DecisionRecord, StoreDecisionRecordResponse

logger = logging.getLogger(__name__)


async def store_decision_record(
    conversation_id: str, topic_index: int, record: str
) -> StoreDecisionRecordResponse:
    """Validate and store a decision record as a markdown file.

    Parses the record JSON, validates it against the DecisionRecord schema,
    and writes to ``.noesis/decision_records/<slugified_title>/<slugified_topic>.md``.

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
    decision_record = DecisionRecord.model_validate(parsed)

    topic_name = loaded.topics[topic_index]["name"]
    output_path = _write_record_file(loaded.title, topic_name, decision_record)

    return StoreDecisionRecordResponse(status="success", output_path=str(output_path))


def _write_record_file(
    title: str, topic_name: str, record: DecisionRecord
) -> Path:
    title_slug = _slugify(title)
    topic_slug = _slugify(topic_name)

    output_dir = Path.cwd() / ".noesis" / "decision_records" / title_slug
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{topic_slug}.md"

    output_path.write_text(
        _render_markdown(topic_name, record), encoding="utf-8"
    )
    return output_path


def _render_markdown(topic_name: str, record: DecisionRecord) -> str:
    sections = [f"# {topic_name}\n", f"## Context\n\n{record.context}\n"]

    concerns_str = ", ".join(c.value for c in record.design_concerns)
    sections.append(f"## Design Concerns\n\n{concerns_str}\n")

    if record.alternative_options:
        options_lines = ["## Options\n"]
        for option in record.alternative_options:
            options_lines.append(
                f"- **{option.description}** — {option.rejection_rationale}"
            )
        sections.append("\n".join(options_lines) + "\n")

    sections.append(
        f"## Decision\n\n{record.decision.description}\n\n"
        f"**Rationale:** {record.decision.rationale}\n\n"
        f"**Consequences:** {record.decision.consequences}\n"
    )
    return "\n".join(sections)


def _slugify(text: str) -> str:
    slug = text.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug
