"""End-to-end tests for context retrieval tools."""

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from noesis_graph.analysis.models import (
    CreateTopicsResponse,
    GetDecisionsResponse,
    GetTopicIdeaUnitsResponse,
    GetTopicNodesResponse,
    GetTopicsWithCategoriesResponse,
    StoreDecisionsResponse,
    StoreIdeaUnitsResponse,
)
from noesis_graph.conversations.models import (
    RegisterConversationResponse,
)
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
"""


@pytest.fixture(autouse=True)
def _clean_graph():
    reset_graph()
    _clean_analysis_nodes()
    yield
    reset_graph()
    _clean_analysis_nodes()


def _clean_analysis_nodes():
    from noesis_graph.analysis.storage import _graph

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


async def _create_topic(title: str, parent_id: str | None = None) -> str:
    topic_input: dict = {"title": title}
    if parent_id is not None:
        topic_input["parent_topic_id"] = parent_id
    raw = await _call_tool("create_topics", {"topics": [topic_input]})
    return CreateTopicsResponse.model_validate_json(raw).topics[0].topic_id


# -- get_topic_nodes tests --


async def test_get_root_topics() -> None:
    await _create_topic("Backend")
    await _create_topic("Frontend")

    raw = await _call_tool("get_topic_nodes", {})
    result = GetTopicNodesResponse.model_validate_json(raw)

    titles = [t.title for t in result.topics]
    assert "Backend" in titles
    assert "Frontend" in titles


async def test_get_root_topics_excludes_subtopics() -> None:
    parent_id = await _create_topic("Backend")
    await _create_topic("Database", parent_id)

    raw = await _call_tool("get_topic_nodes", {})
    result = GetTopicNodesResponse.model_validate_json(raw)

    titles = [t.title for t in result.topics]
    assert "Backend" in titles
    assert "Database" not in titles


async def test_get_child_topics() -> None:
    parent_id = await _create_topic("Backend")
    await _create_topic("Database", parent_id)
    await _create_topic("API", parent_id)

    raw = await _call_tool("get_topic_nodes", {"parent_id": parent_id})
    result = GetTopicNodesResponse.model_validate_json(raw)

    assert len(result.topics) == 2
    titles = [t.title for t in result.topics]
    assert "Database" in titles
    assert "API" in titles


async def test_get_topic_nodes_includes_children_count() -> None:
    parent_id = await _create_topic("Backend")
    await _create_topic("Database", parent_id)
    await _create_topic("API", parent_id)

    raw = await _call_tool("get_topic_nodes", {})
    result = GetTopicNodesResponse.model_validate_json(raw)

    backend = next(t for t in result.topics if t.title == "Backend")
    assert backend.children_count == 2


async def test_get_topic_nodes_empty_tree() -> None:
    raw = await _call_tool("get_topic_nodes", {})
    result = GetTopicNodesResponse.model_validate_json(raw)

    assert result.topics == []


# -- get_topic_idea_units tests --


async def test_get_topic_idea_units(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)
    topic_id = await _create_topic("Database Choice")

    await _call_tool(
        "store_idea_units",
        {
            "conversation_id": conversation_id,
            "idea_units": [
                {
                    "turn_order": 0,
                    "sequence_in_turn": 0,
                    "text": "We should use PostgreSQL.",
                    "sentence_indices": [0],
                    "categories": ["Position"],
                    "topic_id": topic_id,
                },
                {
                    "turn_order": 1,
                    "sequence_in_turn": 0,
                    "text": "I agree. PostgreSQL is right.",
                    "sentence_indices": [0],
                    "categories": ["Position", "Argument"],
                    "topic_id": topic_id,
                },
            ],
        },
    )

    raw = await _call_tool("get_topic_idea_units", {"topic_id": topic_id})
    result = GetTopicIdeaUnitsResponse.model_validate_json(raw)

    assert len(result.idea_units) == 2
    speakers = {iu.speaker for iu in result.idea_units}
    assert speakers == {"Alice", "Bob"}


async def test_get_topic_idea_units_filtered_by_category(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)
    topic_id = await _create_topic("Database Choice")

    await _call_tool(
        "store_idea_units",
        {
            "conversation_id": conversation_id,
            "idea_units": [
                {
                    "turn_order": 0,
                    "sequence_in_turn": 0,
                    "text": "We should use PostgreSQL.",
                    "sentence_indices": [0],
                    "categories": ["Position"],
                    "topic_id": topic_id,
                },
                {
                    "turn_order": 0,
                    "sequence_in_turn": 1,
                    "text": "It has strong ACID compliance.",
                    "sentence_indices": [1],
                    "categories": ["Argument"],
                    "topic_id": topic_id,
                },
            ],
        },
    )

    raw = await _call_tool(
        "get_topic_idea_units",
        {"topic_id": topic_id, "categories": ["Position"]},
    )
    result = GetTopicIdeaUnitsResponse.model_validate_json(raw)

    assert len(result.idea_units) == 1
    assert result.idea_units[0].categories == ["Position"]


# -- get_decisions tests --


async def test_get_decisions_by_topic(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)
    topic_id = await _create_topic("Database Choice")

    await _call_tool(
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
                    "topic_id": topic_id,
                    "conversation_id": conversation_id,
                }
            ]
        },
    )

    raw = await _call_tool("get_decisions", {"topic_id": topic_id})
    result = GetDecisionsResponse.model_validate_json(raw)

    assert len(result.decisions) == 1
    assert result.decisions[0].title == "Use PostgreSQL"
    assert result.decisions[0].topic_title == "Database Choice"
    assert result.decisions[0].conversation_title == "Design Review"


async def test_get_all_decisions(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    topic1 = await _create_topic("Database")
    topic2 = await _create_topic("API")

    for topic_id, title in [(topic1, "Use PostgreSQL"), (topic2, "REST API")]:
        await _call_tool(
            "store_decisions",
            {
                "decisions": [
                    {
                        "title": title,
                        "context": "Context",
                        "decision": title,
                        "rationale": "Rationale",
                        "consequences": "Consequences",
                        "status": "taken",
                        "topic_id": topic_id,
                        "conversation_id": conversation_id,
                    }
                ]
            },
        )

    raw = await _call_tool("get_decisions", {})
    result = GetDecisionsResponse.model_validate_json(raw)

    assert len(result.decisions) == 2


# -- get_topics_with_categories tests --


async def test_get_topics_with_categories(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    topic_db = await _create_topic("Database Choice")
    topic_api = await _create_topic("API Design")

    await _call_tool(
        "store_idea_units",
        {
            "conversation_id": conversation_id,
            "idea_units": [
                {
                    "turn_order": 0,
                    "sequence_in_turn": 0,
                    "text": "We should use PostgreSQL.",
                    "sentence_indices": [0],
                    "categories": ["Position", "Decision"],
                    "topic_id": topic_db,
                },
                {
                    "turn_order": 1,
                    "sequence_in_turn": 0,
                    "text": "The API should be RESTful.",
                    "sentence_indices": [0],
                    "categories": ["Information"],
                    "topic_id": topic_api,
                },
            ],
        },
    )

    raw = await _call_tool(
        "get_topics_with_categories",
        {
            "conversation_id": conversation_id,
            "categories": ["Decision", "Position"],
        },
    )
    result = GetTopicsWithCategoriesResponse.model_validate_json(raw)

    assert len(result.topics) == 1
    assert result.topics[0].topic_id == topic_db
    assert result.topics[0].title == "Database Choice"


async def test_get_topics_with_categories_empty(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_topics_with_categories",
        {
            "conversation_id": conversation_id,
            "categories": ["Decision"],
        },
    )
    result = GetTopicsWithCategoriesResponse.model_validate_json(raw)

    assert result.topics == []
