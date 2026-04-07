"""In-memory registry for raw conversations."""

import logging
import uuid
from pathlib import Path

from .cleaning import parse_transcript, strip_conversation_id_line
from .models import (
    CONVERSATION_ID_PATTERN,
    RawConversationMetadata,
    GetRawSpeakerTurnsResponse,
    RawConversation,
    RegisterConversationResponse,
    SetConversationMetadataResponse,
)

logger = logging.getLogger(__name__)

_store: dict[str, RawConversation] = {}


async def register_conversation(
    file_path: str, title: str | None = None, date: str | None = None
) -> RegisterConversationResponse:
    """Parse and register conversation.

    Reads the file, assigns or reuses a conversation_id, parses speaker turns,
    and stores the result in memory. Metadata precedence: arguments > file data.

    Args:
        file_path: Absolute path to the conversation markdown file.
        title: Optional title override.
        date: Optional date override (YYYY-MM-DD HH:MM format).

    Returns:
        Registration result with conversation_id and metadata status.
    """
    resolved = Path(file_path).resolve()
    if not resolved.exists():
        raise FileNotFoundError(f"File not found: {resolved}")
    if not resolved.is_file():
        raise ValueError(f"Path is not a file: {resolved}")

    content = resolved.read_text(encoding="utf-8")
    if not content.strip():
        raise ValueError(f"File is empty: {resolved}")

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

    raw_text = strip_conversation_id_line(content)
    file_metadata, turns = parse_transcript(raw_text)

    metadata = RawConversationMetadata(
        title=title if title is not None else file_metadata.title,
        date=date if date is not None else file_metadata.date,
    )

    conversation = RawConversation(
        conversation_id=conversation_id,
        metadata=metadata,
        turns=turns,
    )
    _store[conversation_id] = conversation

    missing = []
    if not metadata.title:
        missing.append("title")
    if not metadata.date:
        missing.append("date")

    if missing:
        return RegisterConversationResponse(
            conversation_id=conversation_id, status="incomplete", missing=missing
        )

    return RegisterConversationResponse(conversation_id=conversation_id, status="success")


async def set_conversation_metadata(
    conversation_id: str, title: str | None = None, date: str | None = None
) -> SetConversationMetadataResponse:
    """Set missing metadata on an already-registered conversation.

    Args:
        conversation_id: UUID identifying the conversation.
        title: Conversation title (uses existing value if empty).
        date: Conversation date in YYYY-MM-DD HH:MM format (uses existing value if empty).

    Returns:
        Status indicating success.
    """
    conversation = _get_raw_conversation(conversation_id)
    metadata = conversation.metadata

    resolved_title = title if title is not None else metadata.title
    if not resolved_title:
        raise ValueError("Title is required but not provided")
    metadata.title = resolved_title

    resolved_date = date if date is not None else metadata.date
    if not resolved_date:
        raise ValueError("Date is required but not provided")
    metadata.date = resolved_date

    return SetConversationMetadataResponse(status="success")


async def get_raw_speaker_turns(
    conversation_id: str,
    speakers: list[str] | None = None,
    from_time: str | None = None,
    to_time: str | None = None,
) -> GetRawSpeakerTurnsResponse:
    """Retrieve speaker turns with optional filtering.

    Args:
        conversation_id: UUID identifying the conversation.
        speakers: Filter by speaker names (case-insensitive).
        from_time: Include turns at or after this time (HH:MM:SS).
        to_time: Include turns at or before this time (HH:MM:SS).

    Returns:
        Filtered list of speaker turns.
    """
    conversation = _get_raw_conversation(conversation_id)
    turns = conversation.turns

    if speakers:
        lower_speakers = {s.lower() for s in speakers}
        turns = [t for t in turns if t.speaker.lower() in lower_speakers]

    if from_time:
        turns = [t for t in turns if t.time >= from_time]

    if to_time:
        turns = [t for t in turns if t.time <= to_time]

    return GetRawSpeakerTurnsResponse(turns=turns)


def reset_store() -> None:
    """Clear all conversation state. Intended for tests."""
    _store.clear()


def _get_raw_conversation(conversation_id: str) -> RawConversation:
    if conversation_id not in _store:
        raise KeyError(f"Unknown conversation_id: {conversation_id}")
    return _store[conversation_id]
