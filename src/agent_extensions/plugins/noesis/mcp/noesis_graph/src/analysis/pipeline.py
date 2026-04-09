"""Batch pipeline tools for server-side data flow.

Provides tools for storing batch analysis results, retrieving them
for topic reconciliation, and resolving idea units to final topics
without passing data through LLM context.
"""

import json
import logging
import uuid

from redislite.falkordb_client import Graph

from collections import defaultdict

from noesis_graph.analysis.models import (
    BatchIdeaUnit,
    GetBatchResultsResponse,
    GetLatestBatchStateResponse,
    IdeaUnitInput,
    PreliminaryTopic,
    ResolveAndStoreIdeaUnitsResponse,
    SimilarityGroup,
    StoreBatchResultsResponse,
    StoreReviewerResultResponse,
    TopicMappingEntry,
    estimate_token_count,
)
from noesis_graph.analysis.storage import create_idea_unit_with_edges

logger = logging.getLogger(__name__)

_graph: Graph | None = None


def init_graph(graph: Graph) -> None:
    """Bind this module to a FalkorDB graph."""
    global _graph
    _graph = graph


async def store_batch_results(
    conversation_id: str,
    batch_number: int,
    idea_units: list[BatchIdeaUnit],
    preliminary_topics: list[PreliminaryTopic],
    active_state_json: str,
    last_primary_turn_order: int,
    has_more: bool,
) -> StoreBatchResultsResponse:
    """Store batch analysis results server-side.

    Called by batch_analyzer subagent to persist results directly in the
    graph database, avoiding large JSON output that must be parsed by the
    main agent.

    Args:
        conversation_id: UUID of the conversation being analyzed.
        batch_number: Sequential batch number (1-based).
        idea_units: Idea units extracted from this batch.
        preliminary_topics: Topics identified in this batch.
        active_state_json: Rolling context state as JSON string.
        last_primary_turn_order: Order of the last primary turn in this batch.
        has_more: Whether more turns remain after this batch.

    Returns:
        Summary counts for the stored batch.
    """
    graph = _require_graph()
    idea_units_json = json.dumps([iu.model_dump() for iu in idea_units])
    topics_json = json.dumps([pt.model_dump() for pt in preliminary_topics])

    _delete_batch_result_if_exists(graph, conversation_id, batch_number)

    graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        " CREATE (c)-[:HAS_BATCH_RESULT {batch_number: $bn}]->"
        "(br:BatchResult {"
        " conversation_id: $cid, batch_number: $bn,"
        " idea_units: $iu_json, preliminary_topics: $pt_json,"
        " active_state: $as_json,"
        " last_primary_turn_order: $lpto, has_more: $hm"
        "})",
        params={
            "cid": conversation_id,
            "bn": batch_number,
            "iu_json": idea_units_json,
            "pt_json": topics_json,
            "as_json": active_state_json,
            "lpto": last_primary_turn_order,
            "hm": has_more,
        },
    )

    return StoreBatchResultsResponse(
        batch_number=batch_number,
        idea_unit_count=len(idea_units),
        preliminary_topic_count=len(preliminary_topics),
    )


async def get_batch_results(
    conversation_id: str,
    summary_only: bool = True,
) -> GetBatchResultsResponse:
    """Retrieve aggregated batch results for a conversation.

    When summary_only is True (default), returns only preliminary topics
    and metadata for topic reconciliation. When False, also includes the
    full idea units list for server-side processing.

    Args:
        conversation_id: UUID of the conversation.
        summary_only: If True, omit idea_units from the response.

    Returns:
        Aggregated batch results with deduplicated preliminary topics.
    """
    graph = _require_graph()
    rows = _fetch_batch_result_rows(graph, conversation_id)

    all_idea_units: list[BatchIdeaUnit] = []
    seen_topic_titles: set[str] = set()
    all_preliminary_topics: list[PreliminaryTopic] = []
    topic_turn_sets: dict[str, set[int]] = defaultdict(set)
    last_active_state_json = "{}"
    last_primary_turn_order = 0
    last_has_more = False

    for row in rows:
        idea_units_raw = json.loads(row[0])
        topics_raw = json.loads(row[1])
        active_state_json = row[2]
        turn_order = row[3]
        has_more = row[4]

        for iu_data in idea_units_raw:
            iu = BatchIdeaUnit.model_validate(iu_data)
            topic_turn_sets[iu.preliminary_topic].add(iu.turn_order)
            if not summary_only:
                all_idea_units.append(iu)

        for pt_data in topics_raw:
            pt = PreliminaryTopic.model_validate(pt_data)
            if pt.title not in seen_topic_titles:
                seen_topic_titles.add(pt.title)
                all_preliminary_topics.append(pt)

        last_active_state_json = active_state_json
        last_primary_turn_order = turn_order
        last_has_more = has_more

    similarity_groups = _compute_similarity_groups(topic_turn_sets)

    return GetBatchResultsResponse(
        preliminary_topics=all_preliminary_topics,
        similarity_groups=similarity_groups,
        active_state_json=last_active_state_json,
        last_primary_turn_order=last_primary_turn_order,
        has_more=last_has_more,
        total_batches=len(rows),
        idea_units=all_idea_units if not summary_only else None,
    )


async def get_latest_batch_state(
    conversation_id: str,
) -> GetLatestBatchStateResponse:
    """Retrieve the active state from the most recent batch.

    Returns the rolling context state, last processed turn order, and
    continuation flag from the highest-numbered batch. Used by the main
    agent to avoid parsing active_state from subagent text output.

    Args:
        conversation_id: UUID of the conversation being analyzed.

    Returns:
        State from the most recent batch result.
    """
    graph = _require_graph()
    result = graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        "-[:HAS_BATCH_RESULT]->(br:BatchResult)"
        " RETURN br.batch_number, br.active_state,"
        " br.last_primary_turn_order, br.has_more"
        " ORDER BY br.batch_number DESC LIMIT 1",
        params={"cid": conversation_id},
    )
    if not result.result_set:
        raise KeyError(
            f"No batch results found for conversation {conversation_id}"
        )
    row = result.result_set[0]
    return GetLatestBatchStateResponse(
        batch_number=row[0],
        active_state_json=row[1],
        last_primary_turn_order=row[2],
        has_more=row[3],
    )


async def resolve_and_store_idea_units(
    conversation_id: str,
    topic_mapping: list[TopicMappingEntry],
) -> ResolveAndStoreIdeaUnitsResponse:
    """Resolve batch idea units to final topics and store them.

    Reads stored batch results server-side, resolves each idea unit's
    topic using parent_topic_hint or the provided mapping, creates
    IdeaUnit nodes, and cleans up BatchResult nodes.

    Args:
        conversation_id: UUID of the conversation.
        topic_mapping: Maps preliminary topic titles to resolved topic UUIDs.
            Only needed for NEW topics (existing topics resolved via
            parent_topic_hint automatically).

    Returns:
        Counts of stored, skipped, and unresolved idea units.
    """
    graph = _require_graph()
    rows = _fetch_batch_result_rows(graph, conversation_id)

    mapping_dict = {entry.preliminary_topic: entry.topic_id for entry in topic_mapping}
    all_idea_units = _parse_all_idea_units(rows)

    stored_count = 0
    skipped_not_relevant = 0
    unresolved_topics: set[str] = set()

    for iu in all_idea_units:
        if _is_not_relevant_only(iu):
            skipped_not_relevant += 1
            continue

        topic_id = _resolve_topic_id(iu, mapping_dict)
        if topic_id is None:
            unresolved_topics.add(iu.preliminary_topic)
            continue

        idea_unit_id = str(uuid.uuid4())
        token_count = estimate_token_count(iu.text)
        iu_input = IdeaUnitInput(
            turn_order=iu.turn_order,
            sequence_in_turn=iu.sequence_in_turn,
            text=iu.text,
            sentence_indices=iu.sentence_indices,
            categories=iu.categories,
            topic_id=topic_id,
        )
        create_idea_unit_with_edges(graph, conversation_id, idea_unit_id, iu_input, token_count)
        stored_count += 1

    _delete_batch_results(graph, conversation_id)

    return ResolveAndStoreIdeaUnitsResponse(
        stored_count=stored_count,
        skipped_not_relevant=skipped_not_relevant,
        unresolved_topics=sorted(unresolved_topics),
    )


def _compute_similarity_groups(
    topic_turn_sets: dict[str, set[int]],
) -> list[SimilarityGroup]:
    """Detect preliminary topics that likely refer to the same subject.

    Groups topics where >60% of the smaller topic's turns overlap with
    the larger topic's turns. Uses a union-find approach to merge
    transitive overlaps into single groups.
    """
    titles = list(topic_turn_sets.keys())
    parent: dict[str, str] = {t: t for t in titles}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i, t1 in enumerate(titles):
        turns1 = topic_turn_sets[t1]
        for t2 in titles[i + 1:]:
            turns2 = topic_turn_sets[t2]
            shared = len(turns1 & turns2)
            smaller_size = min(len(turns1), len(turns2))
            if smaller_size > 0 and shared / smaller_size > 0.6:
                union(t1, t2)

    groups: dict[str, list[str]] = defaultdict(list)
    for title in titles:
        root = find(title)
        groups[root].append(title)

    result: list[SimilarityGroup] = []
    for root, group_titles in groups.items():
        if len(group_titles) < 2:
            continue
        all_turns = set()
        for t in group_titles:
            all_turns |= topic_turn_sets[t]
        shared = len(set.intersection(*(topic_turn_sets[t] for t in group_titles)))
        result.append(SimilarityGroup(titles=group_titles, shared_turn_count=shared))

    return result


async def store_reviewer_result(
    conversation_id: str,
    reviewed_topics_count: int,
    mismatches_count: int,
) -> StoreReviewerResultResponse:
    """Store topic reviewer execution result as a quality gate.

    Creates a ReviewerResult node linked to the conversation. The
    finalize_conversation tool checks for this node and refuses to
    complete without it.

    Args:
        conversation_id: UUID of the conversation.
        reviewed_topics_count: Number of topics reviewed.
        mismatches_count: Number of mismatched idea units found.

    Returns:
        Success status.
    """
    graph = _require_graph()

    graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        "-[:HAS_REVIEWER_RESULT]->(rr:ReviewerResult)"
        " DETACH DELETE rr",
        params={"cid": conversation_id},
    )

    graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        " CREATE (c)-[:HAS_REVIEWER_RESULT]->"
        "(rr:ReviewerResult {"
        " conversation_id: $cid,"
        " reviewed_topics_count: $rtc,"
        " mismatches_count: $mc"
        "})",
        params={
            "cid": conversation_id,
            "rtc": reviewed_topics_count,
            "mc": mismatches_count,
        },
    )

    return StoreReviewerResultResponse(status="success")


def _require_graph() -> Graph:
    if _graph is None:
        raise RuntimeError("Graph not initialized — call init_graph() first")
    return _graph


def _fetch_batch_result_rows(graph: Graph, conversation_id: str) -> list[list]:
    """Fetch all BatchResult rows for a conversation ordered by batch_number."""
    result = graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        "-[:HAS_BATCH_RESULT]->(br:BatchResult)"
        " RETURN br.idea_units, br.preliminary_topics,"
        " br.active_state, br.last_primary_turn_order, br.has_more"
        " ORDER BY br.batch_number",
        params={"cid": conversation_id},
    )
    return result.result_set


def _parse_all_idea_units(rows: list[list]) -> list[BatchIdeaUnit]:
    all_units: list[BatchIdeaUnit] = []
    for row in rows:
        idea_units_raw = json.loads(row[0])
        all_units.extend(BatchIdeaUnit.model_validate(iu) for iu in idea_units_raw)
    return all_units


def _is_not_relevant_only(iu: BatchIdeaUnit) -> bool:
    return all(cat == "NotRelevant" for cat in iu.categories)


def _resolve_topic_id(iu: BatchIdeaUnit, mapping_dict: dict[str, str]) -> str | None:
    if iu.parent_topic_hint.startswith("existing:"):
        return iu.parent_topic_hint.removeprefix("existing:")
    return mapping_dict.get(iu.preliminary_topic)


def _delete_batch_result_if_exists(
    graph: Graph, conversation_id: str, batch_number: int
) -> None:
    """Delete a BatchResult for a specific batch number if it exists.

    Makes store_batch_results idempotent — retries overwrite rather than
    creating duplicates.
    """
    graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        "-[:HAS_BATCH_RESULT]->(br:BatchResult {batch_number: $bn})"
        " DETACH DELETE br",
        params={"cid": conversation_id, "bn": batch_number},
    )


def _delete_batch_results(graph: Graph, conversation_id: str) -> None:
    graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        "-[:HAS_BATCH_RESULT]->(br:BatchResult)"
        " DETACH DELETE br",
        params={"cid": conversation_id},
    )
