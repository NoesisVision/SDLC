"""Retrieval tools for consuming agents.

Provides read-only tools for exploring the knowledge graph: topic tree,
topic details, history, decision chains, search, and conversation summaries.
"""

import json
import logging

from redislite.falkordb_client import Graph

from .models import (
    AlternativeInput,
    ConversationSummaryResponse,
    DecisionChainEntry,
    DecisionDetail,
    GetDecisionChainResponse,
    GetTopicHistoryResponse,
    GetTopicTreeResponse,
    SearchResponse,
    SearchResultItem,
    TopicDetailResponse,
    TopicHistoryEntry,
    TopicTreeNode,
)

logger = logging.getLogger(__name__)

_graph: Graph | None = None


def init_graph(graph: Graph) -> None:
    """Bind this module to a FalkorDB graph."""
    global _graph
    _graph = graph


async def get_topic_tree(max_depth: int | None = None) -> GetTopicTreeResponse:
    """Return the full topic tree with summaries.

    Builds the tree recursively from root topics down to max_depth.

    Args:
        max_depth: Maximum depth to traverse (None for unlimited).

    Returns:
        Root-level topics with nested children.
    """
    graph = _require_graph()
    roots = _fetch_topics_at_level(graph, parent_id=None)
    depth_limit = max_depth if max_depth is not None else 50
    tree = [_build_subtree(graph, root, depth_limit, 1) for root in roots]
    return GetTopicTreeResponse(topics=tree)


async def get_topic_detail(topic_id: str) -> TopicDetailResponse:
    """Return detailed information about a single topic.

    Includes idea unit counts by category, decisions, cross-references,
    and contributing conversations.

    Args:
        topic_id: UUID of the topic.

    Returns:
        Full topic detail.
    """
    graph = _require_graph()
    topic = _fetch_topic(graph, topic_id)
    counts = _count_idea_units_by_category(graph, topic_id)
    decisions = _fetch_topic_decisions(graph, topic_id)
    cross_refs = _fetch_topic_cross_refs(graph, topic_id)
    conversations = _fetch_topic_conversations(graph, topic_id)

    return TopicDetailResponse(
        topic_id=topic["topic_id"],
        title=topic["title"],
        summary=topic["summary"],
        idea_unit_counts_by_category=counts,
        decisions=decisions,
        cross_references=cross_refs,
        conversations=conversations,
    )


async def get_topic_history(topic_id: str) -> GetTopicHistoryResponse:
    """Return conversations that contributed to a topic.

    Args:
        topic_id: UUID of the topic.

    Returns:
        List of conversations with idea unit counts.
    """
    graph = _require_graph()
    entries = _fetch_topic_history(graph, topic_id)
    return GetTopicHistoryResponse(entries=entries)


async def get_decision_chain(decision_id: str) -> GetDecisionChainResponse:
    """Follow the SUPERSEDES chain for a decision.

    Returns the chain ordered newest-first, starting from the given decision
    and following SUPERSEDES edges backward.

    Args:
        decision_id: UUID of any decision in the chain.

    Returns:
        Ordered supersession chain.
    """
    graph = _require_graph()
    chain = _follow_supersedes_chain(graph, decision_id)
    return GetDecisionChainResponse(chain=chain)


async def search(query: str) -> SearchResponse:
    """Search idea units by text substring.

    Simple substring match on idea unit text for MVP.

    Args:
        query: Text to search for (case-insensitive).

    Returns:
        Matching idea units with context.
    """
    graph = _require_graph()
    results = _search_idea_units(graph, query)
    return SearchResponse(results=results)


async def get_conversation_summary(
    conversation_id: str,
) -> ConversationSummaryResponse:
    """Return a conversation's metadata, summary, and topics touched.

    Args:
        conversation_id: UUID of the conversation.

    Returns:
        Conversation summary with topics.
    """
    graph = _require_graph()
    return _fetch_conversation_summary(graph, conversation_id)


def _require_graph() -> Graph:
    if _graph is None:
        raise RuntimeError("Graph not initialized — call init_graph() first")
    return _graph


def _fetch_topics_at_level(
    graph: Graph, parent_id: str | None
) -> list[dict]:
    if parent_id is None:
        result = graph.query(
            "MATCH (t:Topic)"
            " WHERE NOT (t)-[:SUBTOPIC_OF]->()"
            " RETURN t.topic_id, t.title, t.summary, t.sort_order"
            " ORDER BY t.sort_order"
        )
    else:
        result = graph.query(
            "MATCH (t:Topic)-[:SUBTOPIC_OF]->(p:Topic {topic_id: $pid})"
            " RETURN t.topic_id, t.title, t.summary, t.sort_order"
            " ORDER BY t.sort_order",
            params={"pid": parent_id},
        )
    return [
        {
            "topic_id": row[0],
            "title": row[1],
            "summary": row[2],
            "sort_order": row[3],
        }
        for row in result.result_set
    ]


def _build_subtree(
    graph: Graph, topic: dict, max_depth: int, current_depth: int
) -> TopicTreeNode:
    children = []
    if current_depth < max_depth:
        child_topics = _fetch_topics_at_level(graph, topic["topic_id"])
        children = [
            _build_subtree(graph, child, max_depth, current_depth + 1)
            for child in child_topics
        ]
    return TopicTreeNode(
        topic_id=topic["topic_id"],
        title=topic["title"],
        summary=topic["summary"],
        sort_order=topic["sort_order"],
        children=children,
    )


def _fetch_topic(graph: Graph, topic_id: str) -> dict:
    result = graph.query(
        "MATCH (t:Topic {topic_id: $tid})"
        " RETURN t.topic_id, t.title, t.summary",
        params={"tid": topic_id},
    )
    if not result.result_set:
        raise KeyError(f"Unknown topic_id: {topic_id}")
    row = result.result_set[0]
    return {"topic_id": row[0], "title": row[1], "summary": row[2]}


def _count_idea_units_by_category(graph: Graph, topic_id: str) -> dict[str, int]:
    result = graph.query(
        "MATCH (iu:IdeaUnit)-[:BELONGS_TO]->(t:Topic {topic_id: $tid})"
        " UNWIND iu.categories AS cat"
        " RETURN cat, count(iu)",
        params={"tid": topic_id},
    )
    return {row[0]: row[1] for row in result.result_set}


def _fetch_topic_decisions(graph: Graph, topic_id: str) -> list[DecisionDetail]:
    result = graph.query(
        "MATCH (d:Decision)-[:ABOUT]->(t:Topic {topic_id: $tid}),"
        " (d)-[:MADE_IN]->(c:RawConversation)"
        " RETURN d.decision_id, d.title, d.context, d.decision,"
        " d.rationale, d.consequences, d.alternatives, d.status,"
        " t.title, c.title",
        params={"tid": topic_id},
    )
    return [_row_to_decision_detail(row) for row in result.result_set]


def _fetch_topic_cross_refs(graph: Graph, topic_id: str) -> list[dict]:
    result = graph.query(
        "MATCH (t:Topic {topic_id: $tid})-[r:CROSS_REF]->(other:Topic)"
        " RETURN t.topic_id, other.topic_id, r.type, r.description,"
        " r.source_conversation_id",
        params={"tid": topic_id},
    )
    incoming = graph.query(
        "MATCH (other:Topic)-[r:CROSS_REF]->(t:Topic {topic_id: $tid})"
        " RETURN other.topic_id, t.topic_id, r.type, r.description,"
        " r.source_conversation_id",
        params={"tid": topic_id},
    )
    refs = []
    for row in list(result.result_set) + list(incoming.result_set):
        refs.append({
            "from_topic_id": row[0],
            "to_topic_id": row[1],
            "type": row[2],
            "description": row[3],
            "source_conversation_id": row[4],
        })
    return refs


def _fetch_topic_conversations(graph: Graph, topic_id: str) -> list[str]:
    result = graph.query(
        "MATCH (c:RawConversation)-[:HAS_RAW_TURN]->(turn:RawSpeakerTurn)"
        "-[:CONTAINS]->(iu:IdeaUnit)-[:BELONGS_TO]->(t:Topic {topic_id: $tid})"
        " RETURN DISTINCT c.title",
        params={"tid": topic_id},
    )
    return [row[0] for row in result.result_set]


def _fetch_topic_history(graph: Graph, topic_id: str) -> list[TopicHistoryEntry]:
    result = graph.query(
        "MATCH (c:RawConversation)-[:HAS_RAW_TURN]->(turn:RawSpeakerTurn)"
        "-[:CONTAINS]->(iu:IdeaUnit)-[:BELONGS_TO]->(t:Topic {topic_id: $tid})"
        " RETURN c.conversation_id, c.title, c.date, count(iu)"
        " ORDER BY c.date",
        params={"tid": topic_id},
    )
    return [
        TopicHistoryEntry(
            conversation_id=row[0],
            title=row[1],
            date=row[2],
            idea_unit_count=row[3],
        )
        for row in result.result_set
    ]


def _follow_supersedes_chain(
    graph: Graph, decision_id: str
) -> list[DecisionChainEntry]:
    chain = []
    current_id = decision_id

    while current_id is not None:
        result = graph.query(
            "MATCH (d:Decision {decision_id: $did})-[:MADE_IN]->(c:RawConversation)"
            " RETURN d.decision_id, d.title, d.decision, d.status, c.title",
            params={"did": current_id},
        )
        if not result.result_set:
            break

        row = result.result_set[0]
        chain.append(
            DecisionChainEntry(
                decision_id=row[0],
                title=row[1],
                decision=row[2],
                status=row[3],
                conversation_title=row[4],
            )
        )

        next_result = graph.query(
            "MATCH (d:Decision {decision_id: $did})-[:SUPERSEDES]->(prev:Decision)"
            " RETURN prev.decision_id",
            params={"did": current_id},
        )
        current_id = (
            next_result.result_set[0][0] if next_result.result_set else None
        )

    return chain


def _search_idea_units(graph: Graph, query: str) -> list[SearchResultItem]:
    result = graph.query(
        "MATCH (turn:RawSpeakerTurn)-[:CONTAINS]->(iu:IdeaUnit)"
        "-[:BELONGS_TO]->(t:Topic),"
        " (c:RawConversation)-[:HAS_RAW_TURN]->(turn)"
        " WHERE toLower(iu.text) CONTAINS toLower($query)"
        " RETURN iu.idea_unit_id, iu.text, iu.categories,"
        " t.title, turn.speaker, turn.time, c.title"
        " LIMIT 50",
        params={"query": query},
    )
    return [
        SearchResultItem(
            idea_unit_id=row[0],
            text=row[1],
            categories=row[2],
            topic_title=row[3],
            speaker=row[4],
            time=row[5],
            conversation_title=row[6],
        )
        for row in result.result_set
    ]


def _fetch_conversation_summary(
    graph: Graph, conversation_id: str
) -> ConversationSummaryResponse:
    result = graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        " RETURN c.conversation_id, c.title, c.date, c.summary",
        params={"cid": conversation_id},
    )
    if not result.result_set:
        raise KeyError(f"Unknown conversation_id: {conversation_id}")

    row = result.result_set[0]

    topics_result = graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        "-[:HAS_RAW_TURN]->(turn:RawSpeakerTurn)"
        "-[:CONTAINS]->(iu:IdeaUnit)-[:BELONGS_TO]->(t:Topic)"
        " RETURN DISTINCT t.title",
        params={"cid": conversation_id},
    )

    return ConversationSummaryResponse(
        conversation_id=row[0],
        title=row[1],
        date=row[2],
        summary=row[3],
        topics_touched=[r[0] for r in topics_result.result_set],
    )


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
