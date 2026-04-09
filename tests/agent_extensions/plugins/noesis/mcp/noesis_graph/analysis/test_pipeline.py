"""End-to-end tests for batch pipeline tools."""

import json

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from noesis_graph.analysis.models import (
    CreateTopicsResponse,
    FinalizeConversationResponse,
    GetBatchResultsResponse,
    GetLatestBatchStateResponse,
    ResolveAndStoreIdeaUnitsResponse,
    StoreBatchResultsResponse,
    StoreReviewerResultResponse,
)
from noesis_graph.conversations.models import RegisterConversationResponse
from noesis_graph.conversations.registry import reset_graph
from noesis_graph.server import noesis_graph_server

CONVERSATION = """\
# Design Review
2026-04-01
**10:00**
Alice
We should use PostgreSQL for the main database. It has strong ACID compliance.
**10:02**
Bob
I agree. PostgreSQL is the right choice for our transactional workloads.
**10:04**
Alice
Good morning everyone. Let's get started.
"""

BATCH_1_IDEA_UNITS = [
    {
        "turn_order": 0,
        "sequence_in_turn": 0,
        "text": "We should use PostgreSQL for the main database.",
        "sentence_indices": [0],
        "categories": ["Position"],
        "preliminary_topic": "Database Choice",
        "parent_topic_hint": "new",
    },
    {
        "turn_order": 0,
        "sequence_in_turn": 1,
        "text": "It has strong ACID compliance.",
        "sentence_indices": [1],
        "categories": ["Argument"],
        "preliminary_topic": "Database Choice",
        "parent_topic_hint": "new",
    },
]

BATCH_1_PRELIMINARY_TOPICS = [
    {
        "title": "Database Choice",
        "parent": "new",
        "summary_hint": "Discussion about main database technology",
    },
]

BATCH_2_IDEA_UNITS = [
    {
        "turn_order": 1,
        "sequence_in_turn": 0,
        "text": "I agree. PostgreSQL is the right choice.",
        "sentence_indices": [0],
        "categories": ["Position"],
        "preliminary_topic": "Database Choice",
        "parent_topic_hint": "new",
    },
]

BATCH_2_PRELIMINARY_TOPICS = [
    {
        "title": "Database Choice",
        "parent": "new",
        "summary_hint": "Continued database discussion",
    },
]


@pytest.fixture(autouse=True)
def _clean_graph():
    reset_graph()
    _clean_all_analysis_nodes()
    yield
    reset_graph()
    _clean_all_analysis_nodes()


def _clean_all_analysis_nodes():
    from noesis_graph.analysis.storage import _graph

    if _graph is not None:
        _graph.query(
            "MATCH (n) WHERE n:Topic OR n:IdeaUnit OR n:Decision"
            " OR n:BatchResult OR n:ReviewerResult DETACH DELETE n"
        )


async def _call_tool(tool_name: str, arguments: dict) -> str:
    async with create_connected_server_and_client_session(
        noesis_graph_server, raise_exceptions=True
    ) as client:
        result = await client.call_tool(tool_name, arguments)
        return result.content[0].text


async def _register(file_path) -> str:
    raw = await _call_tool("register_conversation", {"file_path": str(file_path)})
    return RegisterConversationResponse.model_validate_json(raw).conversation_id


# -- store_batch_results tests --


async def test_store_batch_results(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "store_batch_results",
        {
            "conversation_id": conversation_id,
            "batch_number": 1,
            "idea_units": BATCH_1_IDEA_UNITS,
            "preliminary_topics": BATCH_1_PRELIMINARY_TOPICS,
            "active_state_json": json.dumps({"open_threads": ["Database Choice"]}),
            "last_primary_turn_order": 0,
            "has_more": True,
        },
    )
    result = StoreBatchResultsResponse.model_validate_json(raw)

    assert result.batch_number == 1
    assert result.idea_unit_count == 2
    assert result.preliminary_topic_count == 1


# -- get_batch_results tests --


async def test_get_batch_results_aggregates_batches(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    await _call_tool(
        "store_batch_results",
        {
            "conversation_id": conversation_id,
            "batch_number": 1,
            "idea_units": BATCH_1_IDEA_UNITS,
            "preliminary_topics": BATCH_1_PRELIMINARY_TOPICS,
            "active_state_json": json.dumps({"open_threads": ["Database Choice"]}),
            "last_primary_turn_order": 0,
            "has_more": True,
        },
    )
    await _call_tool(
        "store_batch_results",
        {
            "conversation_id": conversation_id,
            "batch_number": 2,
            "idea_units": BATCH_2_IDEA_UNITS,
            "preliminary_topics": BATCH_2_PRELIMINARY_TOPICS,
            "active_state_json": json.dumps({"open_threads": []}),
            "last_primary_turn_order": 1,
            "has_more": False,
        },
    )

    raw = await _call_tool(
        "get_batch_results",
        {"conversation_id": conversation_id, "summary_only": False},
    )
    result = GetBatchResultsResponse.model_validate_json(raw)

    assert result.total_batches == 2
    assert len(result.preliminary_topics) == 1
    assert result.preliminary_topics[0].title == "Database Choice"
    assert result.last_primary_turn_order == 1
    assert result.has_more is False
    assert result.idea_units is not None
    assert len(result.idea_units) == 3


async def test_get_batch_results_summary_only(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    await _call_tool(
        "store_batch_results",
        {
            "conversation_id": conversation_id,
            "batch_number": 1,
            "idea_units": BATCH_1_IDEA_UNITS,
            "preliminary_topics": BATCH_1_PRELIMINARY_TOPICS,
            "active_state_json": "{}",
            "last_primary_turn_order": 0,
            "has_more": False,
        },
    )

    raw = await _call_tool(
        "get_batch_results",
        {"conversation_id": conversation_id, "summary_only": True},
    )
    result = GetBatchResultsResponse.model_validate_json(raw)

    assert result.idea_units is None
    assert len(result.preliminary_topics) == 1


# -- resolve_and_store_idea_units tests --


async def test_resolve_with_existing_topic_hint(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    topics_raw = await _call_tool(
        "create_topics", {"topics": [{"title": "Database Choice"}]}
    )
    topic_id = CreateTopicsResponse.model_validate_json(topics_raw).topics[0].topic_id

    idea_units_with_existing = [
        {
            "turn_order": 0,
            "sequence_in_turn": 0,
            "text": "We should use PostgreSQL.",
            "sentence_indices": [0],
            "categories": ["Position"],
            "preliminary_topic": "Database Choice",
            "parent_topic_hint": f"existing:{topic_id}",
        },
    ]

    await _call_tool(
        "store_batch_results",
        {
            "conversation_id": conversation_id,
            "batch_number": 1,
            "idea_units": idea_units_with_existing,
            "preliminary_topics": [],
            "active_state_json": "{}",
            "last_primary_turn_order": 0,
            "has_more": False,
        },
    )

    raw = await _call_tool(
        "resolve_and_store_idea_units",
        {"conversation_id": conversation_id, "topic_mapping": []},
    )
    result = ResolveAndStoreIdeaUnitsResponse.model_validate_json(raw)

    assert result.stored_count == 1
    assert result.unresolved_topics == []


async def test_resolve_with_topic_mapping(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    topics_raw = await _call_tool(
        "create_topics", {"topics": [{"title": "Database Choice"}]}
    )
    topic_id = CreateTopicsResponse.model_validate_json(topics_raw).topics[0].topic_id

    await _call_tool(
        "store_batch_results",
        {
            "conversation_id": conversation_id,
            "batch_number": 1,
            "idea_units": BATCH_1_IDEA_UNITS,
            "preliminary_topics": BATCH_1_PRELIMINARY_TOPICS,
            "active_state_json": "{}",
            "last_primary_turn_order": 0,
            "has_more": False,
        },
    )

    raw = await _call_tool(
        "resolve_and_store_idea_units",
        {
            "conversation_id": conversation_id,
            "topic_mapping": [
                {"preliminary_topic": "Database Choice", "topic_id": topic_id}
            ],
        },
    )
    result = ResolveAndStoreIdeaUnitsResponse.model_validate_json(raw)

    assert result.stored_count == 2
    assert result.unresolved_topics == []


async def test_resolve_cleans_up_batch_results(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    topics_raw = await _call_tool(
        "create_topics", {"topics": [{"title": "Database Choice"}]}
    )
    topic_id = CreateTopicsResponse.model_validate_json(topics_raw).topics[0].topic_id

    await _call_tool(
        "store_batch_results",
        {
            "conversation_id": conversation_id,
            "batch_number": 1,
            "idea_units": BATCH_1_IDEA_UNITS,
            "preliminary_topics": BATCH_1_PRELIMINARY_TOPICS,
            "active_state_json": "{}",
            "last_primary_turn_order": 0,
            "has_more": False,
        },
    )

    await _call_tool(
        "resolve_and_store_idea_units",
        {
            "conversation_id": conversation_id,
            "topic_mapping": [
                {"preliminary_topic": "Database Choice", "topic_id": topic_id}
            ],
        },
    )

    raw = await _call_tool(
        "get_batch_results",
        {"conversation_id": conversation_id, "summary_only": True},
    )
    result = GetBatchResultsResponse.model_validate_json(raw)

    assert result.total_batches == 0


async def test_resolve_reports_unresolved(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    await _call_tool(
        "store_batch_results",
        {
            "conversation_id": conversation_id,
            "batch_number": 1,
            "idea_units": BATCH_1_IDEA_UNITS,
            "preliminary_topics": BATCH_1_PRELIMINARY_TOPICS,
            "active_state_json": "{}",
            "last_primary_turn_order": 0,
            "has_more": False,
        },
    )

    raw = await _call_tool(
        "resolve_and_store_idea_units",
        {"conversation_id": conversation_id, "topic_mapping": []},
    )
    result = ResolveAndStoreIdeaUnitsResponse.model_validate_json(raw)

    assert result.stored_count == 0
    assert result.unresolved_topics == ["Database Choice"]


async def test_get_latest_batch_state_returns_most_recent(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    await _call_tool(
        "store_batch_results",
        {
            "conversation_id": conversation_id,
            "batch_number": 1,
            "idea_units": BATCH_1_IDEA_UNITS,
            "preliminary_topics": BATCH_1_PRELIMINARY_TOPICS,
            "active_state_json": json.dumps({"open_threads": ["Database Choice"]}),
            "last_primary_turn_order": 0,
            "has_more": True,
        },
    )
    await _call_tool(
        "store_batch_results",
        {
            "conversation_id": conversation_id,
            "batch_number": 2,
            "idea_units": BATCH_2_IDEA_UNITS,
            "preliminary_topics": BATCH_2_PRELIMINARY_TOPICS,
            "active_state_json": json.dumps({"open_threads": []}),
            "last_primary_turn_order": 1,
            "has_more": False,
        },
    )

    raw = await _call_tool(
        "get_latest_batch_state",
        {"conversation_id": conversation_id},
    )
    result = GetLatestBatchStateResponse.model_validate_json(raw)

    assert result.batch_number == 2
    assert result.last_primary_turn_order == 1
    assert result.has_more is False
    assert json.loads(result.active_state_json) == {"open_threads": []}


async def test_get_latest_batch_state_no_results_returns_error(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_latest_batch_state",
        {"conversation_id": conversation_id},
    )

    assert "No batch results found" in raw


async def test_resolve_filters_not_relevant(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    topics_raw = await _call_tool(
        "create_topics", {"topics": [{"title": "Database Choice"}]}
    )
    topic_id = CreateTopicsResponse.model_validate_json(topics_raw).topics[0].topic_id

    idea_units_mixed = [
        {
            "turn_order": 0,
            "sequence_in_turn": 0,
            "text": "We should use PostgreSQL.",
            "sentence_indices": [0],
            "categories": ["Position"],
            "preliminary_topic": "Database Choice",
            "parent_topic_hint": f"existing:{topic_id}",
        },
        {
            "turn_order": 2,
            "sequence_in_turn": 0,
            "text": "",
            "sentence_indices": [],
            "categories": ["NotRelevant"],
            "preliminary_topic": "",
            "parent_topic_hint": "new",
        },
    ]

    await _call_tool(
        "store_batch_results",
        {
            "conversation_id": conversation_id,
            "batch_number": 1,
            "idea_units": idea_units_mixed,
            "preliminary_topics": [],
            "active_state_json": "{}",
            "last_primary_turn_order": 2,
            "has_more": False,
        },
    )

    raw = await _call_tool(
        "resolve_and_store_idea_units",
        {"conversation_id": conversation_id, "topic_mapping": []},
    )
    result = ResolveAndStoreIdeaUnitsResponse.model_validate_json(raw)

    assert result.stored_count == 1
    assert result.skipped_not_relevant == 1
    assert result.unresolved_topics == []


# -- store_batch_results idempotency tests --


async def test_store_batch_results_is_idempotent(tmp_path) -> None:
    """Retrying store_batch_results with same batch_number overwrites, not duplicates."""
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    for _ in range(3):
        await _call_tool(
            "store_batch_results",
            {
                "conversation_id": conversation_id,
                "batch_number": 1,
                "idea_units": BATCH_1_IDEA_UNITS,
                "preliminary_topics": BATCH_1_PRELIMINARY_TOPICS,
                "active_state_json": "{}",
                "last_primary_turn_order": 0,
                "has_more": False,
            },
        )

    raw = await _call_tool(
        "get_batch_results",
        {"conversation_id": conversation_id, "summary_only": False},
    )
    result = GetBatchResultsResponse.model_validate_json(raw)

    assert result.total_batches == 1
    assert len(result.idea_units) == 2


# -- store_reviewer_result and finalization gate tests --


async def test_finalize_fails_without_reviewer(tmp_path) -> None:
    """finalize_conversation returns error when reviewer has not been executed."""
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "finalize_conversation",
        {"conversation_id": conversation_id},
    )
    result = FinalizeConversationResponse.model_validate_json(raw)

    assert result.status == "error"
    assert "reviewer" in result.reason.lower()


async def test_finalize_succeeds_with_reviewer(tmp_path) -> None:
    """finalize_conversation succeeds after store_reviewer_result is called."""
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "store_reviewer_result",
        {
            "conversation_id": conversation_id,
            "reviewed_topics_count": 3,
            "mismatches_count": 0,
        },
    )
    reviewer = StoreReviewerResultResponse.model_validate_json(raw)
    assert reviewer.status == "success"

    raw = await _call_tool(
        "finalize_conversation",
        {"conversation_id": conversation_id},
    )
    result = FinalizeConversationResponse.model_validate_json(raw)

    assert result.status == "success"


# -- structural warning tests --


STRUCTURAL_CONVERSATION = """\
# Big Topic Test
2026-04-01
""" + "\n".join(
    f"**10:{i:02d}**\nAlice\nTurn {i} about subtopic {i}."
    for i in range(10)
)


async def test_finalize_detects_structural_warnings(tmp_path) -> None:
    """finalize_conversation returns warnings for topics with >7 children."""
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(STRUCTURAL_CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    parent_raw = await _call_tool(
        "create_topics", {"topics": [{"title": "Big Parent"}]}
    )
    parent_id = CreateTopicsResponse.model_validate_json(parent_raw).topics[0].topic_id

    children = [
        {"title": f"Child {i}", "parent_topic_id": parent_id}
        for i in range(8)
    ]
    children_raw = await _call_tool("create_topics", {"topics": children})
    child_ids = [
        t.topic_id
        for t in CreateTopicsResponse.model_validate_json(children_raw).topics
    ]

    idea_units = [
        {
            "turn_order": i,
            "sequence_in_turn": 0,
            "text": f"Turn {i} about subtopic {i}.",
            "sentence_indices": [0],
            "categories": ["Information"],
            "preliminary_topic": f"Child {i}",
            "parent_topic_hint": f"existing:{child_ids[i]}",
        }
        for i in range(8)
    ]

    await _call_tool(
        "store_batch_results",
        {
            "conversation_id": conversation_id,
            "batch_number": 1,
            "idea_units": idea_units,
            "preliminary_topics": [],
            "active_state_json": "{}",
            "last_primary_turn_order": 7,
            "has_more": False,
        },
    )

    await _call_tool(
        "resolve_and_store_idea_units",
        {"conversation_id": conversation_id, "topic_mapping": []},
    )

    await _call_tool(
        "store_reviewer_result",
        {
            "conversation_id": conversation_id,
            "reviewed_topics_count": 8,
            "mismatches_count": 0,
        },
    )

    raw = await _call_tool(
        "finalize_conversation",
        {"conversation_id": conversation_id},
    )
    result = FinalizeConversationResponse.model_validate_json(raw)

    assert result.status == "success"
    assert len(result.structural_warnings) == 1
    assert result.structural_warnings[0].title == "Big Parent"
    assert result.structural_warnings[0].children_count == 8


# -- similarity group tests --


async def test_similarity_groups_detected(tmp_path) -> None:
    """Topics with >60% turn overlap are grouped as similar."""
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    overlapping_idea_units = [
        {
            "turn_order": 0,
            "sequence_in_turn": 0,
            "text": "PostgreSQL for main DB.",
            "sentence_indices": [0],
            "categories": ["Position"],
            "preliminary_topic": "Database Choice",
            "parent_topic_hint": "new",
        },
        {
            "turn_order": 0,
            "sequence_in_turn": 1,
            "text": "PostgreSQL decision.",
            "sentence_indices": [1],
            "categories": ["Decision"],
            "preliminary_topic": "DB Technology Decision",
            "parent_topic_hint": "new",
        },
        {
            "turn_order": 1,
            "sequence_in_turn": 0,
            "text": "I agree on PostgreSQL.",
            "sentence_indices": [0],
            "categories": ["Position"],
            "preliminary_topic": "Database Choice",
            "parent_topic_hint": "new",
        },
        {
            "turn_order": 1,
            "sequence_in_turn": 1,
            "text": "PostgreSQL confirmed.",
            "sentence_indices": [1],
            "categories": ["Decision"],
            "preliminary_topic": "DB Technology Decision",
            "parent_topic_hint": "new",
        },
    ]

    await _call_tool(
        "store_batch_results",
        {
            "conversation_id": conversation_id,
            "batch_number": 1,
            "idea_units": overlapping_idea_units,
            "preliminary_topics": [
                {"title": "Database Choice", "parent": "new", "summary_hint": "DB choice"},
                {"title": "DB Technology Decision", "parent": "new", "summary_hint": "DB tech"},
            ],
            "active_state_json": "{}",
            "last_primary_turn_order": 1,
            "has_more": False,
        },
    )

    raw = await _call_tool(
        "get_batch_results",
        {"conversation_id": conversation_id, "summary_only": True},
    )
    result = GetBatchResultsResponse.model_validate_json(raw)

    assert len(result.similarity_groups) == 1
    assert set(result.similarity_groups[0].titles) == {
        "Database Choice",
        "DB Technology Decision",
    }
