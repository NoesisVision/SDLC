"""Context retrieval tools for navigating the knowledge graph.

Provides scoped queries for progressive hierarchical traversal of topics,
idea unit retrieval with turn context, and decision querying.
"""

import json
import logging

from redislite.falkordb_client import Graph

from noesis_graph.analysis.models import (
    AlternativeInput,
    DecisionDetail,
    GetDecisionsResponse,
    GetTopicIdeaUnitsResponse,
    GetTopicNodesResponse,
    IdeaUnitDetail,
    TopicNode,
)

logger = logging.getLogger(__name__)

_graph: Graph | None = None


def init_graph(graph: Graph) -> None:
    """Bind this module to a FalkorDB graph."""
    global _graph
    _graph = graph


async def get_topic_nodes(
    parent_id: str | None = None,
) -> GetTopicNodesResponse:
    """Return direct children of a topic, or root-level topics.

    Designed for progressive hierarchical traversal. Returns only one level
    at a time, keeping context usage at O(branching_factor).

    Args:
        parent_id: Parent topic UUID. If None, returns root-level topics.

    Returns:
        Topic nodes at the requested level with children counts.
    """
    graph = _require_graph()
    if parent_id is None:
        topics = _fetch_root_topics(graph)
    else:
        topics = _fetch_child_topics(graph, parent_id)
    return GetTopicNodesResponse(topics=topics)


async def get_topic_idea_units(
    topic_id: str,
    categories: list[str] | None = None,
) -> GetTopicIdeaUnitsResponse:
    """Return idea units for a topic with turn context.

    Args:
        topic_id: UUID of the topic.
        categories: Optional filter by idea unit categories.

    Returns:
        Idea units with speaker, time, and turn order from source turns.
    """
    graph = _require_graph()
    idea_units = _fetch_topic_idea_units(graph, topic_id, categories)
    return GetTopicIdeaUnitsResponse(idea_units=idea_units)


async def get_decisions(
    topic_id: str | None = None,
) -> GetDecisionsResponse:
    """Return decisions, optionally filtered by topic.

    Args:
        topic_id: Optional topic UUID to filter by.

    Returns:
        Decisions with topic and conversation context.
    """
    graph = _require_graph()
    decisions = _fetch_decisions(graph, topic_id)
    return GetDecisionsResponse(decisions=decisions)


def _require_graph() -> Graph:
    if _graph is None:
        raise RuntimeError("Graph not initialized — call init_graph() first")
    return _graph


def _fetch_root_topics(graph: Graph) -> list[TopicNode]:
    result = graph.query(
        "MATCH (t:Topic)"
        " WHERE NOT (t)-[:SUBTOPIC_OF]->()"
        " OPTIONAL MATCH (child:Topic)-[:SUBTOPIC_OF]->(t)"
        " RETURN t.topic_id, t.title, t.summary, count(child), t.sort_order"
        " ORDER BY t.sort_order"
    )
    return [
        TopicNode(
            topic_id=row[0],
            title=row[1],
            summary=row[2],
            children_count=row[3],
            sort_order=row[4],
        )
        for row in result.result_set
    ]


def _fetch_child_topics(graph: Graph, parent_id: str) -> list[TopicNode]:
    result = graph.query(
        "MATCH (t:Topic)-[:SUBTOPIC_OF]->(parent:Topic {topic_id: $pid})"
        " OPTIONAL MATCH (child:Topic)-[:SUBTOPIC_OF]->(t)"
        " RETURN t.topic_id, t.title, t.summary, count(child), t.sort_order"
        " ORDER BY t.sort_order",
        params={"pid": parent_id},
    )
    return [
        TopicNode(
            topic_id=row[0],
            title=row[1],
            summary=row[2],
            children_count=row[3],
            sort_order=row[4],
        )
        for row in result.result_set
    ]


def _fetch_topic_idea_units(
    graph: Graph, topic_id: str, categories: list[str] | None
) -> list[IdeaUnitDetail]:
    query = (
        "MATCH (turn:RawSpeakerTurn)-[:CONTAINS]->(iu:IdeaUnit)"
        "-[:BELONGS_TO]->(t:Topic {topic_id: $tid})"
    )
    params: dict = {"tid": topic_id}

    if categories:
        query += " WHERE any(cat IN iu.categories WHERE cat IN $cats)"
        params["cats"] = categories

    query += (
        " RETURN iu.idea_unit_id, iu.text, iu.categories,"
        " turn.speaker, turn.time, iu.sequence_in_turn"
        " ORDER BY iu.sequence_in_turn"
    )

    result = graph.query(query, params=params)
    return [
        IdeaUnitDetail(
            idea_unit_id=row[0],
            text=row[1],
            categories=row[2],
            speaker=row[3],
            time=row[4],
            turn_order=row[5],
        )
        for row in result.result_set
    ]


def _fetch_decisions(graph: Graph, topic_id: str | None) -> list[DecisionDetail]:
    if topic_id is not None:
        query = (
            "MATCH (d:Decision)-[:ABOUT]->(t:Topic {topic_id: $tid}),"
            " (d)-[:MADE_IN]->(c:RawConversation)"
            " RETURN d.decision_id, d.title, d.context, d.decision,"
            " d.rationale, d.consequences, d.alternatives, d.status,"
            " t.title, c.title"
        )
        params: dict = {"tid": topic_id}
    else:
        query = (
            "MATCH (d:Decision)-[:ABOUT]->(t:Topic),"
            " (d)-[:MADE_IN]->(c:RawConversation)"
            " RETURN d.decision_id, d.title, d.context, d.decision,"
            " d.rationale, d.consequences, d.alternatives, d.status,"
            " t.title, c.title"
        )
        params = {}

    result = graph.query(query, params=params)
    return [_row_to_decision_detail(row) for row in result.result_set]


def _row_to_decision_detail(row: list) -> DecisionDetail:
    alternatives_raw = row[6]
    if isinstance(alternatives_raw, str):
        alternatives = [
            AlternativeInput(**alt) for alt in json.loads(alternatives_raw)
        ]
    else:
        alternatives = []

    return DecisionDetail(
        decision_id=row[0],
        title=row[1],
        context=row[2],
        decision=row[3],
        rationale=row[4],
        consequences=row[5],
        alternatives=alternatives,
        status=row[7],
        topic_title=row[8],
        conversation_title=row[9],
    )
