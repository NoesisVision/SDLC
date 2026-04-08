"""End-to-end tests for topic restructuring tools."""

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from noesis_graph.analysis.models import (
    CreateTopicsResponse,
    GetTopicNodesResponse,
    MergeTopicsResponse,
    ReparentTopicResponse,
    ReorderTopicResponse,
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
We should use PostgreSQL for the main database.
**10:02**
Bob
I agree with that choice.
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


async def _create_topic(title: str, parent_id: str | None = None, sort_order: int = 0) -> str:
    topic_input: dict = {"title": title, "sort_order": sort_order}
    if parent_id is not None:
        topic_input["parent_topic_id"] = parent_id
    raw = await _call_tool("create_topics", {"topics": [topic_input]})
    return CreateTopicsResponse.model_validate_json(raw).topics[0].topic_id


# -- merge_topics tests --


async def test_merge_moves_idea_units(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    source_id = await _create_topic("DB Choice")
    target_id = await _create_topic("Database")

    await _call_tool(
        "store_idea_units",
        {
            "conversation_id": conversation_id,
            "idea_units": [
                {
                    "turn_order": 0,
                    "sequence_in_turn": 0,
                    "text": "Use PostgreSQL.",
                    "sentence_indices": [0],
                    "categories": ["Position"],
                    "topic_id": source_id,
                }
            ],
        },
    )

    raw = await _call_tool(
        "merge_topics",
        {"source_topic_id": source_id, "target_topic_id": target_id},
    )
    result = MergeTopicsResponse.model_validate_json(raw)

    assert result.moved_idea_units == 1

    nodes_raw = await _call_tool("get_topic_nodes", {})
    topics = GetTopicNodesResponse.model_validate_json(nodes_raw).topics
    titles = [t.title for t in topics]
    assert "Database" in titles
    assert "DB Choice" not in titles


async def test_merge_reparents_children() -> None:
    source_id = await _create_topic("Old Parent")
    target_id = await _create_topic("New Parent")
    child_id = await _create_topic("Child", parent_id=source_id)

    await _call_tool(
        "merge_topics",
        {"source_topic_id": source_id, "target_topic_id": target_id},
    )

    children_raw = await _call_tool("get_topic_nodes", {"parent_id": target_id})
    children = GetTopicNodesResponse.model_validate_json(children_raw).topics
    assert len(children) == 1
    assert children[0].topic_id == child_id


# -- reparent_topic tests --


async def test_reparent_topic() -> None:
    old_parent = await _create_topic("Old Parent")
    new_parent = await _create_topic("New Parent")
    child = await _create_topic("Child", parent_id=old_parent)

    raw = await _call_tool(
        "reparent_topic",
        {"topic_id": child, "new_parent_topic_id": new_parent},
    )
    result = ReparentTopicResponse.model_validate_json(raw)

    assert result.status == "success"

    old_children = await _call_tool("get_topic_nodes", {"parent_id": old_parent})
    assert GetTopicNodesResponse.model_validate_json(old_children).topics == []

    new_children = await _call_tool("get_topic_nodes", {"parent_id": new_parent})
    children = GetTopicNodesResponse.model_validate_json(new_children).topics
    assert len(children) == 1
    assert children[0].title == "Child"


# -- reorder_topic tests --


async def test_reorder_topic() -> None:
    parent_id = await _create_topic("Parent")
    await _create_topic("First", parent_id=parent_id, sort_order=0)
    second_id = await _create_topic("Second", parent_id=parent_id, sort_order=1)

    raw = await _call_tool(
        "reorder_topic",
        {"topic_id": second_id, "new_sort_order": -1},
    )
    result = ReorderTopicResponse.model_validate_json(raw)

    assert result.status == "success"

    children_raw = await _call_tool("get_topic_nodes", {"parent_id": parent_id})
    children = GetTopicNodesResponse.model_validate_json(children_raw).topics
    assert children[0].title == "Second"
