"""Graph-backed registry for raw conversations."""

import logging
import uuid
from pathlib import Path

from redislite.falkordb_client import Graph

from noesis_graph.conversations.cleaning import parse_transcript, strip_conversation_id_line
from noesis_graph.conversations.models import (
    CONVERSATION_ID_PATTERN,
    GetRawSpeakerTurnsResponse,
    RawConversationMetadata,
    RawSpeakerTurn,
    RegisterConversationResponse,
    SetConversationMetadataResponse,
)

logger = logging.getLogger(__name__)

_graph: Graph | None = None


def init_graph(graph: Graph) -> None:
    """Bind the module to a FalkorDB graph and create indexes."""
    global _graph
    _graph = graph
    try:
        _graph.query("CREATE INDEX FOR (c:RawConversation) ON (c.conversation_id)")
    except Exception:
        logger.debug("Index on RawConversation.conversation_id already exists")


def reset_graph() -> None:
    """Delete all raw conversation data. Intended for tests."""
    if _graph is not None:
        _graph.query(
            "MATCH (n) WHERE n:RawConversation OR n:RawSpeakerTurn DETACH DELETE n"
        )


async def register_conversation(
    file_path: str, title: str | None = None, date: str | None = None
) -> RegisterConversationResponse:
    """Parse and register conversation.

    Reads the file, assigns or reuses a conversation_id, parses speaker turns,
    and stores the result in the graph. Metadata precedence: arguments > file data.

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

    conversation_id = _extract_or_generate_id(resolved, content)
    raw_text = strip_conversation_id_line(content)
    file_metadata, turns = parse_transcript(raw_text)

    metadata = RawConversationMetadata(
        title=title if title is not None else file_metadata.title,
        date=date if date is not None else file_metadata.date,
    )

    _store_conversation(conversation_id, metadata, turns)

    missing = _find_missing_metadata(metadata)
    if missing:
        return RegisterConversationResponse(
            conversation_id=conversation_id, status="incomplete", missing=missing
        )

    return RegisterConversationResponse(
        conversation_id=conversation_id, status="success"
    )


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
    existing = _get_conversation_metadata(conversation_id)

    resolved_title = title if title is not None else existing.title
    if not resolved_title:
        raise ValueError("Title is required but not provided")

    resolved_date = date if date is not None else existing.date
    if not resolved_date:
        raise ValueError("Date is required but not provided")

    graph = _require_graph()
    graph.query(
        """
        MATCH (c:RawConversation {conversation_id: $cid})
        SET c.title = $title, c.date = $date
        """,
        params={"cid": conversation_id, "title": resolved_title, "date": resolved_date},
    )

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
    _assert_conversation_exists(conversation_id)

    query, params = _build_turns_query(conversation_id, speakers, from_time, to_time)
    graph = _require_graph()
    result = graph.query(query, params=params)

    turns = [
        RawSpeakerTurn(speaker=row[0], time=row[1], sentences=row[2])
        for row in result.result_set
    ]

    return GetRawSpeakerTurnsResponse(turns=turns)


def _require_graph() -> Graph:
    if _graph is None:
        raise RuntimeError("Graph not initialized — call init_graph() first")
    return _graph


def _extract_or_generate_id(resolved: Path, content: str) -> str:
    first_line = content.split("\n", 1)[0]
    match = CONVERSATION_ID_PATTERN.match(first_line)
    if match:
        return match.group(1)

    conversation_id = str(uuid.uuid4())
    resolved.write_text(
        f"<!-- conversation_id: {conversation_id} -->\n{content}",
        encoding="utf-8",
    )
    return conversation_id


def _store_conversation(
    conversation_id: str,
    metadata: RawConversationMetadata,
    turns: list[RawSpeakerTurn],
) -> None:
    graph = _require_graph()
    graph.query(
        "CREATE (:RawConversation {conversation_id: $cid, title: $title, date: $date})",
        params={
            "cid": conversation_id,
            "title": metadata.title or "",
            "date": metadata.date or "",
        },
    )

    for order, turn in enumerate(turns):
        _store_turn(graph, conversation_id, turn, order)


def _store_turn(graph: Graph, conversation_id: str, turn: RawSpeakerTurn, order: int) -> None:
    graph.query(
        """
        MATCH (c:RawConversation {conversation_id: $cid})
        CREATE (c)-[:HAS_RAW_TURN {order: $order}]->(t:RawSpeakerTurn {
            speaker: $speaker, time: $time, sentences: $sentences
        })
        """,
        params={
            "cid": conversation_id,
            "order": order,
            "speaker": turn.speaker,
            "time": turn.time,
            "sentences": turn.sentences,
        },
    )


def _find_missing_metadata(metadata: RawConversationMetadata) -> list[str]:
    missing = []
    if not metadata.title:
        missing.append("title")
    if not metadata.date:
        missing.append("date")
    return missing


def _get_conversation_metadata(conversation_id: str) -> RawConversationMetadata:
    graph = _require_graph()
    result = graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid}) RETURN c.title, c.date",
        params={"cid": conversation_id},
    )
    if not result.result_set:
        raise KeyError(f"Unknown conversation_id: {conversation_id}")
    row = result.result_set[0]
    return RawConversationMetadata(title=row[0] or None, date=row[1] or None)


def _assert_conversation_exists(conversation_id: str) -> None:
    graph = _require_graph()
    result = graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid}) RETURN c LIMIT 1",
        params={"cid": conversation_id},
    )
    if not result.result_set:
        raise KeyError(f"Unknown conversation_id: {conversation_id}")


def _build_turns_query(
    conversation_id: str,
    speakers: list[str] | None,
    from_time: str | None,
    to_time: str | None,
) -> tuple[str, dict]:
    params: dict = {"cid": conversation_id}
    where_clauses: list[str] = []

    if speakers:
        where_clauses.append("toLower(t.speaker) IN $speakers")
        params["speakers"] = [s.lower() for s in speakers]

    if from_time:
        where_clauses.append("t.time >= $from_time")
        params["from_time"] = from_time

    if to_time:
        where_clauses.append("t.time <= $to_time")
        params["to_time"] = to_time

    query = (
        "MATCH (c:RawConversation {conversation_id: $cid})"
        "-[r:HAS_RAW_TURN]->(t:RawSpeakerTurn)"
    )
    if where_clauses:
        query += " WHERE " + " AND ".join(where_clauses)
    query += " RETURN t.speaker, t.time, t.sentences ORDER BY r.order"

    return query, params
