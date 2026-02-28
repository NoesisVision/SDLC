"""Tools for building final structured conversation output."""

import json
import logging
from pathlib import Path

from pydantic import BaseModel, Field

from .conversations_registry import get_conversation, remove_conversation
from .idea_units_extraction import IdeaUnit

logger = logging.getLogger(__name__)


class TopicStatement(BaseModel):
    """A speaker's contribution to a topic."""

    speaker: str = Field(description="Name of the speaker")
    time: str = Field(description="Time in HH:MM format")
    idea_units: list[IdeaUnit] = Field(description="Idea units from this speaker on this topic")


class Topic(BaseModel):
    """A discussion topic with summary and statements."""

    name: str = Field(description="Short topic name")
    summary: str = Field(description="1-3 sentence description")
    statements: list[TopicStatement] = Field(description="Speaker statements in this topic")


class StructuredConversation(BaseModel):
    """Full structured conversation output."""

    title: str = Field(description="Title of the conversation")
    date: str = Field(description="Date and time in YYYY-MM-DD HH:MM format")
    topics: list[Topic] = Field(description="Topics discussed")


class TopicSummary(BaseModel):
    """Lightweight topic summary."""

    name: str = Field(description="Short topic name")
    summary: str = Field(description="1-3 sentence description")


class FinalizeResponse(BaseModel):
    """Response from finalize_conversation."""

    title: str = Field(description="Title of the conversation")
    date: str = Field(description="Date and time in YYYY-MM-DD HH:MM format")
    topics: list[TopicSummary] = Field(description="Summary of each topic")
    output_path: str = Field(description="Path to the output JSON file")


async def finalize_conversation(conversation_id: str, topics_refined: str) -> FinalizeResponse:
    """Build the final structured conversation JSON.

    Merges cleaned conversation data, topic assignments, and refined topic
    labels/summaries into the final output file in ``.noesis/conversations``.

    Args:
        conversation_id: UUID identifying the conversation.
        topics_refined: JSON string with refined topic labels and summaries.

    Returns:
        Conversation summary with topic names/descriptions and output path.
    """
    state = get_conversation(conversation_id)

    if state.cleaned is None:
        raise ValueError(f"No cleaned data found for conversation {conversation_id}")
    if state.topics_draft is None:
        raise ValueError(f"No topics draft found for conversation {conversation_id}")

    refined = json.loads(topics_refined)
    structured = _build_structured_conversation(
        title=state.cleaned["title"],
        date=state.cleaned["date"],
        topics_draft=state.topics_draft,
        topics_refined=refined,
    )

    output_dir = Path.cwd() / ".noesis" / "conversations"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{state.source_path.stem}_structured.json"
    output_path.write_text(
        json.dumps(structured.model_dump(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    remove_conversation(conversation_id)

    topic_summaries = [TopicSummary(name=t.name, summary=t.summary) for t in structured.topics]
    return FinalizeResponse(
        title=structured.title,
        date=structured.date,
        topics=topic_summaries,
        output_path=str(output_path),
    )


def _build_structured_conversation(
    title: str,
    date: str,
    topics_draft: dict,
    topics_refined: dict,
) -> StructuredConversation:
    label_map = {t["topic_id"]: t for t in topics_refined["topics"]}

    topics = []
    for topic_data in topics_draft["topics"]:
        topic_id = topic_data["topic_id"]
        refined = label_map.get(topic_id, {})
        label = refined.get("label", topic_data.get("label", "Unknown"))
        summary = refined.get("summary", topic_data.get("summary", ""))

        statements = [
            TopicStatement(
                speaker=stmt["speaker"],
                time=stmt["time"],
                idea_units=[IdeaUnit(**iu) for iu in stmt["idea_units"]],
            )
            for stmt in topic_data["statements"]
        ]
        topics.append(Topic(name=label, summary=summary, statements=statements))

    return StructuredConversation(title=title, date=date, topics=topics)
