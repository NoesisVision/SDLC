"""Tools for building final structured conversation output."""

import json
import logging
from pathlib import Path

from mcp.server.fastmcp import Context

from .graph_storing import store_conversation
from .models import (
    FinalizeResponse,
    StructuredConversation,
    Topic,
    TopicStatement,
    TopicSummary,
    TopicsDraft,
)
from .registry import get_conversation, remove_conversation

logger = logging.getLogger(__name__)


async def finalize_conversation(
    conversation_id: str, topics_refined: str, ctx: Context
) -> FinalizeResponse:
    """Build the final structured conversation JSON.

    Merges cleaned conversation data, topic assignments, and refined topic
    labels/summaries into the final output file in ``.noesis/conversations``.
    Persists the result to the graph database.

    Args:
        conversation_id: UUID identifying the conversation.
        topics_refined: JSON string with refined topic labels and summaries.
        ctx: MCP context providing access to the graph database.

    Returns:
        Conversation summary with topic names/descriptions and output path.
    """
    state = get_conversation(conversation_id)

    if state.turns is None:
        raise ValueError(f"No cleaned data found for conversation {conversation_id}")
    if state.topics_draft is None:
        raise ValueError(f"No topics draft found for conversation {conversation_id}")

    date = state.date
    refined = json.loads(topics_refined)
    structured = _build_structured_conversation(
        conversation_id=conversation_id,
        title=state.title,
        date=date,
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

    graph = ctx.request_context.lifespan_context.graph
    store_conversation(graph, structured)

    remove_conversation(conversation_id)

    topic_summaries = [TopicSummary(name=t.name, summary=t.summary) for t in structured.topics]
    return FinalizeResponse(
        title=structured.title,
        date=structured.date,
        topics=topic_summaries,
        output_path=str(output_path),
    )


def _build_structured_conversation(
    conversation_id: str,
    title: str,
    date: str,
    topics_draft: TopicsDraft,
    topics_refined: dict,
) -> StructuredConversation:
    label_map = {t["topic_id"]: t for t in topics_refined["topics"]}

    topics = []
    for entry in topics_draft.topics:
        refined = label_map.get(entry.topic_id, {})
        label = refined.get("label", entry.label or "Unknown")
        summary = refined.get("summary", entry.summary or "")

        statements = [
            TopicStatement(
                speaker=stmt.speaker,
                time=stmt.time,
                idea_units=stmt.idea_units,
            )
            for stmt in entry.statements
        ]
        topics.append(Topic(name=label, summary=summary, statements=statements))

    return StructuredConversation(
        conversation_id=conversation_id, title=title, date=date, topics=topics
    )
