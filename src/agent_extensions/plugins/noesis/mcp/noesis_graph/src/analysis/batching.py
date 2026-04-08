"""Turn batching for sequential conversation analysis."""

import logging

from redislite.falkordb_client import Graph

from noesis_graph.analysis.models import BatchTurn, GetNextTurnBatchResponse, estimate_token_count

logger = logging.getLogger(__name__)

_DEFAULT_LOOKAHEAD = 10

_graph: Graph | None = None


def init_graph(graph: Graph) -> None:
    """Bind this module to a FalkorDB graph."""
    global _graph
    _graph = graph


async def get_next_turn_batch(
    conversation_id: str,
    max_tokens: int,
    last_turn_order: int | None = None,
    lookahead_turns: int | None = None,
) -> GetNextTurnBatchResponse:
    """Return the next batch of turns fitting within a token budget.

    Groups consecutive turns into a batch that fits within max_tokens,
    preferring to split at speaker changes. Includes lookahead turns
    as read-only context for resolving the Punchline Problem.

    Args:
        conversation_id: UUID of the registered conversation.
        max_tokens: Maximum token budget for primary turns.
        last_turn_order: Order of the last processed turn (None for first batch).
        lookahead_turns: Number of lookahead turns to include (default 10).

    Returns:
        Batch with primary turns, lookahead turns, and continuation flag.
    """
    graph = _require_graph()
    lookahead_count = lookahead_turns if lookahead_turns is not None else _DEFAULT_LOOKAHEAD

    all_turns = _fetch_turns_after(graph, conversation_id, last_turn_order)
    if not all_turns:
        return GetNextTurnBatchResponse(
            primary_turns=[], lookahead_turns=[], has_more=False
        )

    split_index = _find_batch_boundary(all_turns, max_tokens)
    primary = all_turns[:split_index]
    remaining = all_turns[split_index:]

    lookahead = remaining[:lookahead_count]
    has_more = len(remaining) > 0

    return GetNextTurnBatchResponse(
        primary_turns=primary, lookahead_turns=lookahead, has_more=has_more
    )


def _require_graph() -> Graph:
    if _graph is None:
        raise RuntimeError("Graph not initialized — call init_graph() first")
    return _graph


def _fetch_turns_after(
    graph: Graph, conversation_id: str, last_turn_order: int | None
) -> list[BatchTurn]:
    start_order = last_turn_order + 1 if last_turn_order is not None else 0
    result = graph.query(
        "MATCH (c:RawConversation {conversation_id: $cid})"
        "-[r:HAS_RAW_TURN]->(t:RawSpeakerTurn)"
        " WHERE r.order >= $start"
        " RETURN r.order, t.speaker, t.time, t.sentences"
        " ORDER BY r.order",
        params={"cid": conversation_id, "start": start_order},
    )
    return [
        BatchTurn(
            order=row[0],
            speaker=row[1],
            time=row[2],
            text=" ".join(row[3]),
        )
        for row in result.result_set
    ]


def _find_batch_boundary(turns: list[BatchTurn], max_tokens: int) -> int:
    """Find the split point that fits within max_tokens.

    Prefers splitting at speaker changes for natural batch boundaries.
    Always includes at least one turn.
    """
    token_sum = 0
    last_speaker_change = 1

    for i, turn in enumerate(turns):
        token_sum += estimate_token_count(turn.text)
        if token_sum > max_tokens and i > 0:
            return last_speaker_change if last_speaker_change <= i else i
        if i + 1 < len(turns) and turns[i + 1].speaker != turn.speaker:
            last_speaker_change = i + 1

    return len(turns)
