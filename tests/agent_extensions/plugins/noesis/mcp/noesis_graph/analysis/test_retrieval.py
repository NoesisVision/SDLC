"""End-to-end tests for retrieval tools."""

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from agent_extensions.plugins.noesis.mcp.noesis_graph.analysis.models import (
    ConversationSummaryResponse,
    CreateTopicsResponse,
    GetDecisionChainResponse,
    GetTopicHistoryResponse,
    GetTopicTreeResponse,
    SearchResponse,
    StoreDecisionsResponse,
    TopicDetailResponse,
)
from agent_extensions.plugins.noesis.mcp.noesis_graph.conversations.models import (
    RegisterConversationResponse,
)
from agent_extensions.plugins.noesis.mcp.noesis_graph.conversations.registry import reset_graph
from agent_extensions.plugins.noesis.mcp.noesis_graph.server import noesis_graph_server

CONVERSATION = """\
# Design Review
2026-04-01
**10:00**
Alice
We should use PostgreSQL for the main database. It has strong ACID compliance.
**10:02**
Bob
I agree. PostgreSQL is the right choice for our transactional workloads.
"""


@pytest.fixture(autouse=True)
def _clean_graph():
    reset_graph()
    _clean_analysis_nodes()
    yield
    reset_graph()
    _clean_analysis_nodes()


def _clean_analysis_nodes():
    from agent_extensions.plugins.noesis.mcp.noesis_graph.analysis.storage import _graph

    if _graph is not None:
        _graph.query(
            "MATCH (n) WHERE n:Topic OR n:IdeaUnit OR n:Decision DETACH DELETE n"
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


async def _create_topic(title: str, parent_id: str | None = None, sort_order: int = 0) -> str:
    topic_input: dict = {"title": title, "sort_order": sort_order}
    if parent_id is not None:
        topic_input["parent_topic_id"] = parent_id
    raw = await _call_tool("create_topics", {"topics": [topic_input]})
    return CreateTopicsResponse.model_validate_json(raw).topics[0].topic_id


async def _seed_graph(tmp_path):
    """Seed graph with a conversation, topics, idea units, and a decision."""
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    backend_id = await _create_topic("Backend")
    db_id = await _create_topic("Database Choice", parent_id=backend_id)

    await _call_tool(
        "store_idea_units",
        {
            "conversation_id": conversation_id,
            "idea_units": [
                {
                    "turn_order": 0,
                    "sequence_in_turn": 0,
                    "text": "We should use PostgreSQL for the main database.",
                    "sentence_indices": [0],
                    "categories": ["Position"],
                    "topic_id": db_id,
                },
                {
                    "turn_order": 0,
                    "sequence_in_turn": 1,
                    "text": "It has strong ACID compliance.",
                    "sentence_indices": [1],
                    "categories": ["Argument"],
                    "topic_id": db_id,
                },
            ],
        },
    )

    dec_raw = await _call_tool(
        "store_decisions",
        {
            "decisions": [
                {
                    "title": "Use PostgreSQL",
                    "context": "Need to choose a database",
                    "decision": "Use PostgreSQL",
                    "rationale": "ACID compliance",
                    "consequences": "Team needs PostgreSQL expertise",
                    "status": "taken",
                    "topic_id": db_id,
                    "conversation_id": conversation_id,
                }
            ]
        },
    )
    decision_id = StoreDecisionsResponse.model_validate_json(dec_raw).decisions[0].decision_id

    await _call_tool(
        "set_summaries",
        {
            "topic_summaries": [
                {"topic_id": db_id, "summary": "PostgreSQL chosen for ACID compliance"}
            ],
            "conversation_summary": {
                "conversation_id": conversation_id,
                "summary": "Team decided to use PostgreSQL.",
            },
        },
    )

    return conversation_id, backend_id, db_id, decision_id


# -- get_topic_tree tests --


async def test_get_topic_tree(tmp_path) -> None:
    await _seed_graph(tmp_path)

    raw = await _call_tool("get_topic_tree", {})
    result = GetTopicTreeResponse.model_validate_json(raw)

    assert len(result.topics) == 1
    assert result.topics[0].title == "Backend"
    assert len(result.topics[0].children) == 1
    assert result.topics[0].children[0].title == "Database Choice"


async def test_get_topic_tree_with_depth_limit(tmp_path) -> None:
    await _seed_graph(tmp_path)

    raw = await _call_tool("get_topic_tree", {"max_depth": 1})
    result = GetTopicTreeResponse.model_validate_json(raw)

    assert len(result.topics) == 1
    assert result.topics[0].children == []


async def test_get_topic_tree_empty() -> None:
    raw = await _call_tool("get_topic_tree", {})
    result = GetTopicTreeResponse.model_validate_json(raw)
    assert result.topics == []


# -- get_topic_detail tests --


async def test_get_topic_detail(tmp_path) -> None:
    _, _, db_id, _ = await _seed_graph(tmp_path)

    raw = await _call_tool("get_topic_detail", {"topic_id": db_id})
    result = TopicDetailResponse.model_validate_json(raw)

    assert result.title == "Database Choice"
    assert result.summary == "PostgreSQL chosen for ACID compliance"
    assert result.idea_unit_counts_by_category["Position"] >= 1
    assert len(result.decisions) == 1
    assert "Design Review" in result.conversations


# -- get_topic_history tests --


async def test_get_topic_history(tmp_path) -> None:
    conversation_id, _, db_id, _ = await _seed_graph(tmp_path)

    raw = await _call_tool("get_topic_history", {"topic_id": db_id})
    result = GetTopicHistoryResponse.model_validate_json(raw)

    assert len(result.entries) == 1
    assert result.entries[0].conversation_id == conversation_id
    assert result.entries[0].idea_unit_count == 2


# -- get_decision_chain tests --


async def test_get_decision_chain_single(tmp_path) -> None:
    _, _, db_id, decision_id = await _seed_graph(tmp_path)

    raw = await _call_tool("get_decision_chain", {"decision_id": decision_id})
    result = GetDecisionChainResponse.model_validate_json(raw)

    assert len(result.chain) == 1
    assert result.chain[0].title == "Use PostgreSQL"


async def test_get_decision_chain_with_supersedes(tmp_path) -> None:
    conversation_id, _, db_id, first_id = await _seed_graph(tmp_path)

    second_raw = await _call_tool(
        "store_decisions",
        {
            "decisions": [
                {
                    "title": "Switch to CockroachDB",
                    "context": "Scaling requirements changed",
                    "decision": "Switch to CockroachDB",
                    "rationale": "Better horizontal scaling",
                    "consequences": "Migration effort",
                    "status": "taken",
                    "topic_id": db_id,
                    "conversation_id": conversation_id,
                    "supersedes_decision_id": first_id,
                }
            ]
        },
    )
    second_id = StoreDecisionsResponse.model_validate_json(second_raw).decisions[0].decision_id

    raw = await _call_tool("get_decision_chain", {"decision_id": second_id})
    result = GetDecisionChainResponse.model_validate_json(raw)

    assert len(result.chain) == 2
    assert result.chain[0].title == "Switch to CockroachDB"
    assert result.chain[1].title == "Use PostgreSQL"


# -- search tests --


async def test_search_finds_matching_idea_units(tmp_path) -> None:
    await _seed_graph(tmp_path)

    raw = await _call_tool("search", {"query": "PostgreSQL"})
    result = SearchResponse.model_validate_json(raw)

    assert len(result.results) >= 1
    assert any("PostgreSQL" in r.text for r in result.results)


async def test_search_case_insensitive(tmp_path) -> None:
    await _seed_graph(tmp_path)

    raw = await _call_tool("search", {"query": "postgresql"})
    result = SearchResponse.model_validate_json(raw)

    assert len(result.results) >= 1


async def test_search_no_results(tmp_path) -> None:
    await _seed_graph(tmp_path)

    raw = await _call_tool("search", {"query": "nonexistent-xyz"})
    result = SearchResponse.model_validate_json(raw)

    assert result.results == []


# -- get_conversation_summary tests --


async def test_get_conversation_summary(tmp_path) -> None:
    conversation_id, _, _, _ = await _seed_graph(tmp_path)

    raw = await _call_tool(
        "get_conversation_summary", {"conversation_id": conversation_id}
    )
    result = ConversationSummaryResponse.model_validate_json(raw)

    assert result.conversation_id == conversation_id
    assert result.title == "Design Review"
    assert result.summary == "Team decided to use PostgreSQL."
    assert "Database Choice" in result.topics_touched
