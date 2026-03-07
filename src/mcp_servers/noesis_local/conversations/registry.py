"""Registry for conversation files and their in-memory processing state."""

import logging
import re
import uuid
from pathlib import Path

from mcp.server.fastmcp import Context

from .models import AddConversationResponse, ConversationState
from .graph_storing import conversation_exists

logger = logging.getLogger(__name__)

CONVERSATION_ID_PATTERN = re.compile(r"^<!--\s*conversation_id:\s*([\w-]+)\s*-->")

_store: dict[str, ConversationState] = {}


async def add_conversation(file_path: str, ctx: Context) -> AddConversationResponse:
    """Register a conversation file and assign a persistent conversation ID.

    If the file already contains a ``<!-- conversation_id: UUID -->`` comment
    on its first line, that ID is reused. Otherwise a new UUID4 is generated
    and prepended to the file.

    When the conversation already exists in the graph database, returns
    immediately with ``already_stored=True`` so the calling agent can skip
    further processing.

    Args:
        file_path: Absolute path to the conversation markdown file.
        ctx: MCP context providing access to the graph database.

    Returns:
        The conversation_id and whether it was already stored in the graph.
    """
    resolved = Path(file_path).resolve()

    if not resolved.exists():
        raise FileNotFoundError(f"File not found: {resolved}")
    if not resolved.is_file():
        raise ValueError(f"Path is not a file: {resolved}")

    content = resolved.read_text(encoding="utf-8")
    first_line = content.split("\n", 1)[0]
    match = CONVERSATION_ID_PATTERN.match(first_line)

    if match:
        conversation_id = match.group(1)
    else:
        conversation_id = str(uuid.uuid4())
        resolved.write_text(
            f"<!-- conversation_id: {conversation_id} -->\n{content}",
            encoding="utf-8",
        )

    graph = ctx.request_context.lifespan_context.graph
    if conversation_exists(graph, conversation_id):
        logger.info("Conversation %s already in graph, skipping", conversation_id)
        return AddConversationResponse(
            conversation_id=conversation_id, already_stored=True
        )

    register_conversation(conversation_id, resolved)
    return AddConversationResponse(conversation_id=conversation_id)


def get_conversation(conversation_id: str) -> ConversationState:
    """Retrieve state for a registered conversation.

    Args:
        conversation_id: UUID identifying the conversation.

    Returns:
        The conversation's processing state.

    Raises:
        KeyError: If the conversation has not been registered.
    """
    if conversation_id not in _store:
        raise KeyError(f"Unknown conversation_id: {conversation_id}")
    return _store[conversation_id]


def register_conversation(conversation_id: str, source_path: Path) -> ConversationState:
    """Register a conversation and initialise its in-memory state.

    Args:
        conversation_id: UUID identifying the conversation.
        source_path: Absolute path to the original conversation markdown file.

    Returns:
        The newly created conversation state.
    """
    state = ConversationState(source_path=source_path)
    _store[conversation_id] = state
    return state


def remove_conversation(conversation_id: str) -> None:
    """Remove a conversation from the in-memory store.

    Args:
        conversation_id: UUID identifying the conversation.
    """
    if conversation_id in _store:
        del _store[conversation_id]


def reset_store() -> None:
    """Clear all conversation state. Intended for tests."""
    _store.clear()
