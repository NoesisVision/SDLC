"""Persistence of structured conversations to FalkorDB graph."""

import json
import logging
from pathlib import Path

from redislite.falkordb_client import Graph

from .models import CONVERSATION_ID_PATTERN, IdeaUnit, StructuredConversation, Topic, TopicStatement

logger = logging.getLogger(__name__)

def conversation_exists(graph: Graph, conversation_id: str) -> bool:
    """Check whether a conversation node already exists in the graph."""
    result = graph.query(
        "MATCH (c:Conversation {conversation_id: $cid}) RETURN c LIMIT 1",
        params={"cid": conversation_id},
    )
    return len(result.result_set) > 0


def store_conversation(graph: Graph, structured: StructuredConversation) -> None:
    """Persist a structured conversation as graph nodes and relationships.

    Idempotent: skips storage if conversation_id already exists in the graph.

    Args:
        graph: FalkorDB graph instance.
        structured: The structured conversation to persist.
    """
    if conversation_exists(graph, structured.conversation_id):
        logger.info(
            "Conversation %s already in graph, skipping", structured.conversation_id
        )
        return

    _create_conversation_node(graph, structured)

    for topic_order, topic in enumerate(structured.topics):
        _create_topic_subgraph(
            graph, structured.conversation_id, topic, topic_order
        )

    logger.info("Stored conversation %s in graph", structured.conversation_id)


def sync_conversations_from_disk(graph: Graph, project_root: Path) -> int:
    """Load structured conversation JSON files from disk and add missing ones to graph.

    Scans ``.noesis/conversations/`` for ``*_structured.json`` files and persists
    any conversations not yet in the graph database.

    Args:
        graph: FalkorDB graph instance.
        project_root: Project root directory containing ``.noesis/``.

    Returns:
        Number of conversations added.
    """
    conversations_dir = project_root / ".noesis" / "conversations"
    if not conversations_dir.exists():
        return 0

    added = 0
    for json_path in sorted(conversations_dir.glob("*_structured.json")):
        structured = _load_structured_conversation(json_path)
        if structured is None:
            continue
        if conversation_exists(graph, structured.conversation_id):
            continue
        store_conversation(graph, structured)
        added += 1

    if added:
        logger.info("Synced %d conversation(s) from disk to graph", added)
    return added


def _create_conversation_node(graph, structured: StructuredConversation) -> None:
    graph.query(
        "CREATE (:Conversation {conversation_id: $cid, title: $title, date: $date})",
        params={
            "cid": structured.conversation_id,
            "title": structured.title,
            "date": structured.date,
        },
    )


def _create_topic_subgraph(
    graph, conversation_id: str, topic: Topic, order: int
) -> None:
    graph.query(
        """
        MATCH (c:Conversation {conversation_id: $cid})
        CREATE (c)-[:HAS_TOPIC {order: $order}]->(t:Topic {name: $name, summary: $summary})
        """,
        params={
            "cid": conversation_id,
            "order": order,
            "name": topic.name,
            "summary": topic.summary,
        },
    )

    for stmt_order, statement in enumerate(topic.statements):
        _create_statement_subgraph(
            graph, conversation_id, order, statement, stmt_order
        )


def _create_statement_subgraph(
    graph,
    conversation_id: str,
    topic_order: int,
    statement: TopicStatement,
    order: int,
) -> None:
    graph.query(
        """
        MATCH (c:Conversation {conversation_id: $cid})-[:HAS_TOPIC {order: $torder}]->(t:Topic)
        CREATE (t)-[:HAS_STATEMENT {order: $order}]->(s:Statement {speaker: $speaker, time: $time})
        """,
        params={
            "cid": conversation_id,
            "torder": topic_order,
            "order": order,
            "speaker": statement.speaker,
            "time": statement.time,
        },
    )

    for iu_order, idea_unit in enumerate(statement.idea_units):
        _create_idea_unit_node(
            graph, conversation_id, topic_order, order, idea_unit, iu_order
        )


def _create_idea_unit_node(
    graph,
    conversation_id: str,
    topic_order: int,
    stmt_order: int,
    idea_unit: IdeaUnit,
    order: int,
) -> None:
    graph.query(
        """
        MATCH (c:Conversation {conversation_id: $cid})
              -[:HAS_TOPIC {order: $torder}]->(t:Topic)
              -[:HAS_STATEMENT {order: $sorder}]->(s:Statement)
        CREATE (s)-[:HAS_IDEA_UNIT {order: $order}]->(iu:IdeaUnit {sentences: $sentences, category: $category})
        """,
        params={
            "cid": conversation_id,
            "torder": topic_order,
            "sorder": stmt_order,
            "order": order,
            "sentences": idea_unit.sentences,
            "category": idea_unit.category.value,
        },
    )


def _load_structured_conversation(json_path: Path) -> StructuredConversation | None:
    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        logger.exception("Failed to read %s", json_path)
        return None

    conversation_id = _extract_conversation_id(json_path, data)
    if conversation_id is None:
        return None

    data["conversation_id"] = conversation_id

    try:
        return StructuredConversation.model_validate(data)
    except Exception:
        logger.exception("Failed to parse %s", json_path)
        return None


def _extract_conversation_id(json_path: Path, data: dict) -> str | None:
    if "conversation_id" in data:
        return data["conversation_id"]

    source_path = json_path.with_name(
        json_path.name.replace("_structured.json", ".md")
    )
    if not source_path.exists():
        logger.warning("Cannot determine conversation_id for %s", json_path)
        return None

    for line in source_path.open(encoding="utf-8"):
        match = CONVERSATION_ID_PATTERN.match(line)
        if match:
            return match.group(1)
        break

    logger.warning("No conversation_id found in source for %s", json_path)
    return None
