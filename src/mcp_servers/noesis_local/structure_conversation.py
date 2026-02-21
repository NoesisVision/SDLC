"""MCP tool for structuring conversations into topics with classified idea units."""

import json
import logging
from pathlib import Path

from mcp.server.fastmcp import Context
from pydantic import BaseModel, Field

from .clean_conversation import clean_conversation_file
from .idea_unit import IdeaUnit, TurnIdeaUnits, extract_idea_units
from .topic_registry import TopicEntry, TopicRegistry

logger = logging.getLogger(__name__)


class TopicStatement(BaseModel):
    """A speaker's contribution to a topic, broken into classified idea units."""

    speaker: str = Field(description="Name of the speaker")
    time: str = Field(description="Time relative to conversation start in HH:MM format")
    idea_units: list[IdeaUnit] = Field(description="Idea units from this speaker on this topic")


class Topic(BaseModel):
    """A discussion topic with its summary and all contributing statements."""

    name: str = Field(description="Short topic name describing its essence")
    summary: str = Field(description="1-3 sentence description of what was discussed")
    statements: list[TopicStatement] = Field(description="Speaker statements belonging to this topic")


class StructuredConversation(BaseModel):
    """Full structured representation of a conversation, saved as JSON artifact."""

    title: str = Field(description="Title of the conversation")
    date: str = Field(description="Date and time of the first statement in YYYY-MM-DD HH:MM format")
    topics: list[Topic] = Field(description="Topics discussed in the conversation")


class TopicSummary(BaseModel):
    """Lightweight topic representation for the tool's return value."""

    name: str = Field(description="Short topic name describing its essence")
    summary: str = Field(description="1-3 sentence description of what was discussed")


class ConversationSummary(BaseModel):
    """Summary returned by the structure_conversation tool."""

    title: str = Field(description="Title of the conversation")
    date: str = Field(description="Date and time of the first statement in YYYY-MM-DD HH:MM format")
    topics: list[TopicSummary] = Field(description="Summary of each topic discussed")


async def structure_conversation(file_path: str, ctx: Context) -> ConversationSummary:
    """Structure a conversation by extracting idea units and mapping them to topics.

    Processes a conversation transcript through three phases:
    1. Cleans and parses the raw markdown into speaker turns
    2. Extracts idea units from turns and classifies them (Issue, Position,
       Argument, Decision, Irrelevant) using batched LLM calls
    3. Maps idea units to dynamically discovered topics using embedding
       similarity with LLM arbitration for ambiguous cases

    Saves a detailed StructuredConversation JSON file alongside the input
    (same name with _structured suffix). Returns a lightweight summary.

    Args:
        file_path: Path to the conversation markdown file.
        ctx: MCP context for LLM access.

    Returns:
        Summary with title, date, and topic names/descriptions.

    Raises:
        FileNotFoundError: If the file doesn't exist.
        ValueError: If the file is empty, has no speaker turns, or LLM extraction fails.
    """
    conversation = await clean_conversation_file(file_path, ctx)
    turn_idea_units = await extract_idea_units(conversation.turns, ctx)

    registry = TopicRegistry(ctx)
    embeddings = registry.encode_all_idea_units(turn_idea_units)
    await registry.assign_idea_units(turn_idea_units, embeddings)

    structured = _build_structured_conversation(conversation.title, conversation.date, registry)
    _save_structured_json(file_path, structured)

    return _build_summary(structured)


def _build_structured_conversation(
    title: str,
    date: str,
    registry: TopicRegistry,
) -> StructuredConversation:
    topics = [_topic_entry_to_topic(entry) for entry in registry.topics.values()]
    return StructuredConversation(title=title, date=date, topics=topics)


def _topic_entry_to_topic(entry: TopicEntry) -> Topic:
    statements = [
        TopicStatement(speaker=speaker, time=time, idea_units=idea_units)
        for (speaker, time), idea_units in entry.statements.items()
    ]
    return Topic(name=entry.label, summary=entry.summary, statements=statements)


def _save_structured_json(input_file_path: str, structured: StructuredConversation) -> None:
    input_path = Path(input_file_path)
    output_path = input_path.parent / f"{input_path.stem}_structured.json"
    output_path.write_text(
        json.dumps(structured.model_dump(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    logger.info("Saved structured conversation to %s", output_path)


def _build_summary(structured: StructuredConversation) -> ConversationSummary:
    return ConversationSummary(
        title=structured.title,
        date=structured.date,
        topics=[
            TopicSummary(name=topic.name, summary=topic.summary)
            for topic in structured.topics
        ],
    )
