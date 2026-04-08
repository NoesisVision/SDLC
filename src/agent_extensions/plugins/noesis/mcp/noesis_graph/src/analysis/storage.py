"""Storage tools for the analysis layer.

Provides tools for creating topics, storing idea units, decisions,
cross-references, and summaries in the knowledge graph.
"""

import json
import logging
import uuid

from redislite.falkordb_client import Graph

from noesis_graph.analysis.models import (
    ConversationSummaryInput,
    CreateCrossReferencesResponse,
    CreateTopicsResponse,
    CrossReferenceInput,
    DecisionCreated,
    DecisionInput,
    IdeaUnitInput,
    SetSummariesResponse,
    StoreDecisionsResponse,
    StoreIdeaUnitsResponse,
    TopicCreated,
    TopicInput,
    TopicSummaryInput,
    estimate_token_count,
)

logger = logging.getLogger(__name__)

_graph: Graph | None = None


def init_graph(graph: Graph) -> None:
    """Bind this module to a FalkorDB graph."""
    global _graph
    _graph = graph


async def create_topics(topics: list[TopicInput]) -> CreateTopicsResponse:
    """Create topic nodes in the knowledge graph.

    Each topic gets a generated UUID. If parent_topic_id is provided,
    a SUBTOPIC_OF edge is created to link the child to its parent.

    Args:
        topics: List of topics to create with optional parent references.

    Returns:
        List of created topics with their generated UUIDs.
    """
    graph = _require_graph()
    created = []
    for topic in topics:
        topic_id = str(uuid.uuid4())
        _create_topic_node(graph, topic_id, topic.title, topic.sort_order)
        if topic.parent_topic_id is not None:
            _create_subtopic_edge(graph, topic_id, topic.parent_topic_id, topic.sort_order)
        created.append(TopicCreated(topic_id=topic_id, title=topic.title))
    return CreateTopicsResponse(topics=created)


async def store_idea_units(
    conversation_id: str, idea_units: list[IdeaUnitInput]
) -> StoreIdeaUnitsResponse:
    """Store idea units and link them to source turns and topics.

    Each idea unit gets a generated UUID and is connected to its source
    RawSpeakerTurn via CONTAINS edge and to its assigned Topic via BELONGS_TO edge.

    Args:
        conversation_id: UUID of the conversation containing the source turns.
        idea_units: List of idea units with turn references and topic assignments.

    Returns:
        Count of stored idea units.
    """
    graph = _require_graph()
    for iu in idea_units:
        idea_unit_id = str(uuid.uuid4())
        token_count = estimate_token_count(iu.text)
        _create_idea_unit_with_edges(
            graph, conversation_id, idea_unit_id, iu, token_count
        )
    return StoreIdeaUnitsResponse(count=len(idea_units))


async def store_decisions(decisions: list[DecisionInput]) -> StoreDecisionsResponse:
    """Store decisions and link them to topics, conversations, and idea units.

    Each decision gets a generated UUID and is connected via ABOUT, MADE_IN,
    and optionally SUPERSEDES, SUPPORTED_BY, and OPPOSED_BY edges.

    Args:
        decisions: List of decisions with all ADR fields and references.

    Returns:
        List of created decisions with their generated UUIDs.
    """
    graph = _require_graph()
    created = []
    for dec in decisions:
        decision_id = str(uuid.uuid4())
        _create_decision_node(graph, decision_id, dec)
        _create_decision_edges(graph, decision_id, dec)
        created.append(DecisionCreated(decision_id=decision_id))
    return StoreDecisionsResponse(decisions=created)


async def create_cross_references(
    refs: list[CrossReferenceInput],
) -> CreateCrossReferencesResponse:
    """Create cross-reference edges between topics.

    Args:
        refs: List of cross-references with type and description.

    Returns:
        Count of created cross-references.
    """
    graph = _require_graph()
    for ref in refs:
        graph.query(
            "MATCH (from:Topic {topic_id: $from_id}), (to:Topic {topic_id: $to_id})"
            " CREATE (from)-[:CROSS_REF {type: $type, description: $desc,"
            " source_conversation_id: $cid}]->(to)",
            params={
                "from_id": ref.from_topic_id,
                "to_id": ref.to_topic_id,
                "type": ref.type,
                "desc": ref.description,
                "cid": ref.source_conversation_id,
            },
        )
    return CreateCrossReferencesResponse(count=len(refs))


async def set_summaries(
    topic_summaries: list[TopicSummaryInput],
    conversation_summary: ConversationSummaryInput | None = None,
) -> SetSummariesResponse:
    """Update topic summaries and optionally set a conversation summary.

    Args:
        topic_summaries: List of topic summaries to update.
        conversation_summary: Optional conversation summary to set.

    Returns:
        Status indicating success.
    """
    graph = _require_graph()
    for ts in topic_summaries:
        graph.query(
            "MATCH (t:Topic {topic_id: $tid}) SET t.summary = $summary",
            params={"tid": ts.topic_id, "summary": ts.summary},
        )
    if conversation_summary is not None:
        graph.query(
            "MATCH (c:RawConversation {conversation_id: $cid})"
            " SET c.summary = $summary",
            params={
                "cid": conversation_summary.conversation_id,
                "summary": conversation_summary.summary,
            },
        )
    return SetSummariesResponse(status="success")


def _require_graph() -> Graph:
    if _graph is None:
        raise RuntimeError("Graph not initialized — call init_graph() first")
    return _graph


def _create_topic_node(
    graph: Graph, topic_id: str, title: str, sort_order: int
) -> None:
    graph.query(
        "CREATE (:Topic {topic_id: $tid, title: $title, sort_order: $order})",
        params={"tid": topic_id, "title": title, "order": sort_order},
    )


def _create_subtopic_edge(
    graph: Graph, child_id: str, parent_id: str, sort_order: int
) -> None:
    graph.query(
        "MATCH (child:Topic {topic_id: $child_id}),"
        " (parent:Topic {topic_id: $parent_id})"
        " CREATE (child)-[:SUBTOPIC_OF {sort_order: $order}]->(parent)",
        params={"child_id": child_id, "parent_id": parent_id, "order": sort_order},
    )


def _create_idea_unit_with_edges(
    graph: Graph,
    conversation_id: str,
    idea_unit_id: str,
    iu: IdeaUnitInput,
    token_count: int,
) -> None:
    graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        "-[r:HAS_RAW_TURN {order: $turn_order}]->(turn:RawSpeakerTurn),"
        " (topic:Topic {topic_id: $topic_id})"
        " CREATE (turn)-[:CONTAINS {sequence: $seq}]->"
        "(iu:IdeaUnit {"
        " idea_unit_id: $iu_id, text: $text,"
        " sentence_indices: $indices, categories: $cats,"
        " token_count: $tokens, sequence_in_turn: $seq"
        "})-[:BELONGS_TO]->(topic)",
        params={
            "cid": conversation_id,
            "turn_order": iu.turn_order,
            "topic_id": iu.topic_id,
            "iu_id": idea_unit_id,
            "text": iu.text,
            "indices": iu.sentence_indices,
            "cats": iu.categories,
            "tokens": token_count,
            "seq": iu.sequence_in_turn,
        },
    )


def _create_decision_node(graph: Graph, decision_id: str, dec: DecisionInput) -> None:
    alternatives_json = json.dumps(
        [alt.model_dump() for alt in dec.alternatives]
    )
    graph.query(
        "CREATE (:Decision {"
        " decision_id: $did, title: $title, context: $context,"
        " decision: $decision, rationale: $rationale,"
        " consequences: $consequences, alternatives: $alternatives,"
        " status: $status"
        "})",
        params={
            "did": decision_id,
            "title": dec.title,
            "context": dec.context,
            "decision": dec.decision,
            "rationale": dec.rationale,
            "consequences": dec.consequences,
            "alternatives": alternatives_json,
            "status": dec.status,
        },
    )


def _create_decision_edges(graph: Graph, decision_id: str, dec: DecisionInput) -> None:
    graph.query(
        "MATCH (d:Decision {decision_id: $did}),"
        " (t:Topic {topic_id: $tid})"
        " CREATE (d)-[:ABOUT]->(t)",
        params={"did": decision_id, "tid": dec.topic_id},
    )
    graph.query(
        "MATCH (d:Decision {decision_id: $did}),"
        " (c:RawConversation {conversation_id: $cid})"
        " CREATE (d)-[:MADE_IN]->(c)",
        params={"did": decision_id, "cid": dec.conversation_id},
    )
    if dec.supersedes_decision_id is not None:
        graph.query(
            "MATCH (d:Decision {decision_id: $did}),"
            " (prev:Decision {decision_id: $prev_id})"
            " CREATE (d)-[:SUPERSEDES]->(prev)",
            params={"did": decision_id, "prev_id": dec.supersedes_decision_id},
        )
    for iu_id in dec.supporting_idea_unit_ids:
        graph.query(
            "MATCH (d:Decision {decision_id: $did}),"
            " (iu:IdeaUnit {idea_unit_id: $iu_id})"
            " CREATE (d)-[:SUPPORTED_BY]->(iu)",
            params={"did": decision_id, "iu_id": iu_id},
        )
    for iu_id in dec.opposing_idea_unit_ids:
        graph.query(
            "MATCH (d:Decision {decision_id: $did}),"
            " (iu:IdeaUnit {idea_unit_id: $iu_id})"
            " CREATE (d)-[:OPPOSED_BY]->(iu)",
            params={"did": decision_id, "iu_id": iu_id},
        )
