"""Topic restructuring tools for the analysis layer.

Provides atomic operations for merging, reparenting, and reordering
topics in the knowledge graph.
"""

import logging

from redislite.falkordb_client import Graph

from noesis_graph.analysis.models import MergeTopicsResponse, ReparentTopicResponse, ReorderTopicResponse

logger = logging.getLogger(__name__)

_graph: Graph | None = None


def init_graph(graph: Graph) -> None:
    """Bind this module to a FalkorDB graph."""
    global _graph
    _graph = graph


async def merge_topics(
    source_topic_id: str, target_topic_id: str
) -> MergeTopicsResponse:
    """Merge source topic into target topic.

    Reassigns all edges from source to target: BELONGS_TO (idea units),
    ABOUT (decisions), CROSS_REF, and SUBTOPIC_OF (children).
    Then deletes the source node.

    Args:
        source_topic_id: UUID of the topic to merge away.
        target_topic_id: UUID of the topic to merge into.

    Returns:
        Counts of moved entities.
    """
    graph = _require_graph()

    moved_iu = _reassign_idea_units(graph, source_topic_id, target_topic_id)
    moved_dec = _reassign_decisions(graph, source_topic_id, target_topic_id)
    moved_refs = _reassign_cross_refs(graph, source_topic_id, target_topic_id)
    _reparent_children(graph, source_topic_id, target_topic_id)
    _delete_topic_node(graph, source_topic_id)

    return MergeTopicsResponse(
        moved_idea_units=moved_iu,
        moved_decisions=moved_dec,
        moved_cross_refs=moved_refs,
    )


async def reparent_topic(
    topic_id: str, new_parent_topic_id: str, sort_order: int | None = None
) -> ReparentTopicResponse:
    """Move a topic under a new parent.

    Removes any existing SUBTOPIC_OF edge and creates a new one.

    Args:
        topic_id: UUID of the topic to reparent.
        new_parent_topic_id: UUID of the new parent topic.
        sort_order: Optional new sort order among siblings.

    Returns:
        Status indicating success.
    """
    graph = _require_graph()

    graph.query(
        "MATCH (t:Topic {topic_id: $tid})-[r:SUBTOPIC_OF]->() DELETE r",
        params={"tid": topic_id},
    )

    order = sort_order if sort_order is not None else 0
    graph.query(
        "MATCH (t:Topic {topic_id: $tid}),"
        " (p:Topic {topic_id: $pid})"
        " CREATE (t)-[:SUBTOPIC_OF {sort_order: $order}]->(p)",
        params={"tid": topic_id, "pid": new_parent_topic_id, "order": order},
    )

    if sort_order is not None:
        graph.query(
            "MATCH (t:Topic {topic_id: $tid}) SET t.sort_order = $order",
            params={"tid": topic_id, "order": sort_order},
        )

    return ReparentTopicResponse(status="success")


async def reorder_topic(topic_id: str, new_sort_order: int) -> ReorderTopicResponse:
    """Change a topic's sort order among its siblings.

    Args:
        topic_id: UUID of the topic to reorder.
        new_sort_order: New sort order value.

    Returns:
        Status indicating success.
    """
    graph = _require_graph()

    graph.query(
        "MATCH (t:Topic {topic_id: $tid}) SET t.sort_order = $order",
        params={"tid": topic_id, "order": new_sort_order},
    )

    result = graph.query(
        "MATCH (t:Topic {topic_id: $tid})-[r:SUBTOPIC_OF]->() RETURN r LIMIT 1",
        params={"tid": topic_id},
    )
    if result.result_set:
        graph.query(
            "MATCH (t:Topic {topic_id: $tid})-[r:SUBTOPIC_OF]->()"
            " SET r.sort_order = $order",
            params={"tid": topic_id, "order": new_sort_order},
        )

    return ReorderTopicResponse(status="success")


def _require_graph() -> Graph:
    if _graph is None:
        raise RuntimeError("Graph not initialized — call init_graph() first")
    return _graph


def _reassign_idea_units(graph: Graph, source_id: str, target_id: str) -> int:
    result = graph.query(
        "MATCH (iu:IdeaUnit)-[r:BELONGS_TO]->(s:Topic {topic_id: $sid}),"
        " (target:Topic {topic_id: $tid})"
        " DELETE r"
        " CREATE (iu)-[:BELONGS_TO]->(target)"
        " RETURN count(iu)",
        params={"sid": source_id, "tid": target_id},
    )
    return result.result_set[0][0] if result.result_set else 0


def _reassign_decisions(graph: Graph, source_id: str, target_id: str) -> int:
    result = graph.query(
        "MATCH (d:Decision)-[r:ABOUT]->(s:Topic {topic_id: $sid}),"
        " (target:Topic {topic_id: $tid})"
        " DELETE r"
        " CREATE (d)-[:ABOUT]->(target)"
        " RETURN count(d)",
        params={"sid": source_id, "tid": target_id},
    )
    return result.result_set[0][0] if result.result_set else 0


def _reassign_cross_refs(graph: Graph, source_id: str, target_id: str) -> int:
    outgoing = graph.query(
        "MATCH (s:Topic {topic_id: $sid})-[r:CROSS_REF]->(other:Topic),"
        " (target:Topic {topic_id: $tid})"
        " DELETE r"
        " CREATE (target)-[:CROSS_REF {type: r.type, description: r.description,"
        " source_conversation_id: r.source_conversation_id}]->(other)"
        " RETURN count(r)",
        params={"sid": source_id, "tid": target_id},
    )
    incoming = graph.query(
        "MATCH (other:Topic)-[r:CROSS_REF]->(s:Topic {topic_id: $sid}),"
        " (target:Topic {topic_id: $tid})"
        " DELETE r"
        " CREATE (other)-[:CROSS_REF {type: r.type, description: r.description,"
        " source_conversation_id: r.source_conversation_id}]->(target)"
        " RETURN count(r)",
        params={"sid": source_id, "tid": target_id},
    )
    out_count = outgoing.result_set[0][0] if outgoing.result_set else 0
    in_count = incoming.result_set[0][0] if incoming.result_set else 0
    return out_count + in_count


def _reparent_children(graph: Graph, source_id: str, target_id: str) -> None:
    graph.query(
        "MATCH (child:Topic)-[r:SUBTOPIC_OF]->(s:Topic {topic_id: $sid}),"
        " (target:Topic {topic_id: $tid})"
        " DELETE r"
        " CREATE (child)-[:SUBTOPIC_OF {sort_order: child.sort_order}]->(target)",
        params={"sid": source_id, "tid": target_id},
    )


def _delete_topic_node(graph: Graph, topic_id: str) -> None:
    graph.query(
        "MATCH (t:Topic {topic_id: $tid}) DETACH DELETE t",
        params={"tid": topic_id},
    )
