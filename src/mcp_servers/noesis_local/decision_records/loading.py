"""MCP tools for loading structured conversation data."""

import json
import logging
import re
from pathlib import Path

from mcp_servers.noesis_local.conversations.registry import CONVERSATION_ID_PATTERN

from .models import (
    GetConversationTopicsResponse,
    GetTopicDataResponse,
    LoadedConversation,
    TopicOverview,
)

logger = logging.getLogger(__name__)

_cache: dict[str, LoadedConversation] = {}


async def get_conversation_topics(conversation_id: str) -> GetConversationTopicsResponse:
    """Load a structured conversation and return an overview of its topics.

    Searches markdown files in the current working directory for a file
    containing the conversation ID, then loads the corresponding structured
    JSON from ``.noesis/conversations/<stem>_structured.json``.

    Args:
        conversation_id: UUID identifying the conversation.

    Returns:
        Conversation title and list of topic overviews.
    """
    if conversation_id in _cache:
        loaded = _cache[conversation_id]
    else:
        loaded = _load_conversation(conversation_id)
        _cache[conversation_id] = loaded

    topics = [
        TopicOverview(index=i, name=t["name"], summary=t["summary"])
        for i, t in enumerate(loaded.topics)
    ]

    return GetConversationTopicsResponse(
        conversation_title=loaded.title,
        topic_count=len(loaded.topics),
        topics=topics,
    )


async def get_topic_data(conversation_id: str, topic_index: int) -> GetTopicDataResponse:
    """Return full data for a single topic from a previously loaded conversation.

    Args:
        conversation_id: UUID identifying the conversation.
        topic_index: Zero-based index of the topic.

    Returns:
        Topic name, summary, and statements as a JSON string.
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

    topic = loaded.topics[topic_index]
    statements_json = json.dumps(topic["statements"], ensure_ascii=False)

    return GetTopicDataResponse(
        topic_name=topic["name"],
        topic_summary=topic["summary"],
        statements=statements_json,
    )


def reset_cache() -> None:
    """Clear the conversation cache. Intended for tests."""
    _cache.clear()


def _load_conversation(conversation_id: str) -> LoadedConversation:
    source_path = _find_source_file(conversation_id)
    structured_path = _derive_structured_path(source_path)
    data = json.loads(structured_path.read_text(encoding="utf-8"))

    return LoadedConversation(
        title=data["title"],
        source_stem=source_path.stem,
        topics=data["topics"],
    )


def _find_source_file(conversation_id: str) -> Path:
    cwd = Path.cwd()
    for md_file in cwd.glob("*.md"):
        if md_file.parts and md_file.parts[-2] == ".noesis":
            continue
        first_line = md_file.read_text(encoding="utf-8").split("\n", 1)[0]
        match = CONVERSATION_ID_PATTERN.match(first_line)
        if match and match.group(1) == conversation_id:
            return md_file

    raise FileNotFoundError(
        f"No markdown file found with conversation_id: {conversation_id}"
    )


def _derive_structured_path(source_path: Path) -> Path:
    structured_path = (
        Path.cwd() / ".noesis" / "conversations" / f"{source_path.stem}_structured.json"
    )
    if not structured_path.exists():
        raise FileNotFoundError(
            f"Structured conversation file not found: {structured_path}"
        )
    return structured_path
