"""Conversation finalization tool.

Recomputes token counts for topics touched by a conversation
and marks the conversation as complete.
"""

import logging

from redislite.falkordb_client import Graph

from .models import FinalizeConversationResponse

logger = logging.getLogger(__name__)

_graph: Graph | None = None


def init_graph(graph: Graph) -> None:
    """Bind this module to a FalkorDB graph."""
    global _graph
    _graph = graph


async def finalize_conversation(conversation_id: str) -> FinalizeConversationResponse:
    """Finalize a conversation after analysis is complete.

    Recomputes aggregated token counts for all topics that received
    idea units from this conversation, then sets conversation status
    to 'complete'.

    Args:
        conversation_id: UUID of the conversation to finalize.

    Returns:
        Status and count of topics updated.
    """
    graph = _require_graph()
    topics_updated = _recompute_topic_token_counts(graph, conversation_id)
    _set_conversation_status(graph, conversation_id, "complete")
    return FinalizeConversationResponse(
        status="success", topics_updated=topics_updated
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


def _set_conversation_status(
    graph: Graph, conversation_id: str, status: str
) -> None:
    graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid}) SET c.status = $status",
        params={"cid": conversation_id, "status": status},
    )
