"""Conversation finalization tool.

Recomputes token counts for topics touched by a conversation
and marks the conversation as complete.
"""

import logging

from redislite.falkordb_client import Graph

from noesis_graph.analysis.models import (
    FinalizeConversationResponse,
    StructuralWarning,
)

logger = logging.getLogger(__name__)

_graph: Graph | None = None


def init_graph(graph: Graph) -> None:
    """Bind this module to a FalkorDB graph."""
    global _graph
    _graph = graph


async def finalize_conversation(conversation_id: str) -> FinalizeConversationResponse:
    """Finalize a conversation after analysis is complete.

    Checks that the topic reviewer has been executed, recomputes
    aggregated token counts for all topics that received idea units
    from this conversation, detects structural warnings, cleans up
    the reviewer result, and sets conversation status to 'complete'.

    Args:
        conversation_id: UUID of the conversation to finalize.

    Returns:
        Status, count of topics updated, and structural warnings.
    """
    graph = _require_graph()

    if not _reviewer_result_exists(graph, conversation_id):
        return FinalizeConversationResponse(
            status="error",
            reason="Topic reviewer not executed. Launch topic_reviewer before finalizing.",
        )

    topics_updated = _recompute_topic_token_counts(graph, conversation_id)
    structural_warnings = _detect_structural_warnings(graph, conversation_id)
    _delete_reviewer_result(graph, conversation_id)
    _set_conversation_status(graph, conversation_id, "complete")

    return FinalizeConversationResponse(
        status="success",
        topics_updated=topics_updated,
        structural_warnings=structural_warnings,
    )


def _require_graph() -> Graph:
    if _graph is None:
        raise RuntimeError("Graph not initialized — call init_graph() first")
    return _graph


def _recompute_topic_token_counts(graph: Graph, conversation_id: str) -> int:
    result = graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        "-[:HAS_RAW_TURN]->(turn:RawSpeakerTurn)"
        "-[:CONTAINS]->(iu:IdeaUnit)"
        "-[:BELONGS_TO]->(t:Topic)"
        " RETURN DISTINCT t.topic_id",
        params={"cid": conversation_id},
    )
    topic_ids = [row[0] for row in result.result_set]

    for topic_id in topic_ids:
        graph.query(
            "MATCH (iu:IdeaUnit)-[:BELONGS_TO]->(t:Topic {topic_id: $tid})"
            " WITH t, sum(iu.token_count) AS total"
            " SET t.token_count = total",
            params={"tid": topic_id},
        )

    return len(topic_ids)


def _reviewer_result_exists(graph: Graph, conversation_id: str) -> bool:
    result = graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        "-[:HAS_REVIEWER_RESULT]->(rr:ReviewerResult)"
        " RETURN count(rr)",
        params={"cid": conversation_id},
    )
    return result.result_set[0][0] > 0


def _detect_structural_warnings(
    graph: Graph, conversation_id: str
) -> list[StructuralWarning]:
    result = graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        "-[:HAS_RAW_TURN]->(:RawSpeakerTurn)"
        "-[:CONTAINS]->(:IdeaUnit)"
        "-[:BELONGS_TO]->(t:Topic)"
        " WITH DISTINCT t"
        " OPTIONAL MATCH (t)-[:SUBTOPIC_OF]->(parent:Topic)"
        " WITH COLLECT(DISTINCT t) + COLLECT(DISTINCT parent) AS candidates"
        " UNWIND candidates AS candidate"
        " WITH DISTINCT candidate"
        " WHERE candidate IS NOT NULL"
        " MATCH (child:Topic)-[:SUBTOPIC_OF]->(candidate)"
        " WITH candidate, count(child) AS child_count"
        " WHERE child_count > 7"
        " RETURN candidate.topic_id, candidate.title, child_count",
        params={"cid": conversation_id},
    )
    return [
        StructuralWarning(
            topic_id=row[0], title=row[1], children_count=row[2]
        )
        for row in result.result_set
    ]


def _delete_reviewer_result(graph: Graph, conversation_id: str) -> None:
    graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        "-[:HAS_REVIEWER_RESULT]->(rr:ReviewerResult)"
        " DETACH DELETE rr",
        params={"cid": conversation_id},
    )


def _set_conversation_status(
    graph: Graph, conversation_id: str, status: str
) -> None:
    graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid}) SET c.status = $status",
        params={"cid": conversation_id, "status": status},
    )
