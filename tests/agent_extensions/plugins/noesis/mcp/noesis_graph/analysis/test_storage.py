"""End-to-end tests for analysis storage tools."""

import json

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from noesis_graph.analysis.models import (
    CreateCrossReferencesResponse,
    CreateTopicsResponse,
    SetSummariesResponse,
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


# -- create_topics tests --


async def test_create_root_topics() -> None:
    raw = await _call_tool(
        "create_topics",
        {"topics": [{"title": "Backend"}, {"title": "Frontend", "sort_order": 1}]},
    )
    result = CreateTopicsResponse.model_validate_json(raw)

    assert len(result.topics) == 2
    assert result.topics[0].title == "Backend"
    assert result.topics[1].title == "Frontend"
    assert len(result.topics[0].topic_id) == 36


async def test_create_subtopic() -> None:
    raw = await _call_tool("create_topics", {"topics": [{"title": "Backend"}]})
    parent = CreateTopicsResponse.model_validate_json(raw).topics[0]

    raw = await _call_tool(
        "create_topics",
        {"topics": [{"title": "Database", "parent_topic_id": parent.topic_id}]},
    )
    child = CreateTopicsResponse.model_validate_json(raw).topics[0]

    assert child.title == "Database"
    assert child.topic_id != parent.topic_id


# -- store_idea_units tests --


async def test_store_idea_units(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    topics_raw = await _call_tool(
        "create_topics", {"topics": [{"title": "Database Choice"}]}
    )
    topic_id = CreateTopicsResponse.model_validate_json(topics_raw).topics[0].topic_id

    raw = await _call_tool(
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
    result = StoreIdeaUnitsResponse.model_validate_json(raw)

    assert result.count == 2


# -- store_decisions tests --


async def test_store_decision(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    topics_raw = await _call_tool(
        "create_topics", {"topics": [{"title": "Database Choice"}]}
    )
    topic_id = CreateTopicsResponse.model_validate_json(topics_raw).topics[0].topic_id

    raw = await _call_tool(
        "store_decisions",
        {
            "decisions": [
                {
                    "title": "Use PostgreSQL",
                    "context": "Need to choose a main database",
                    "decision": "Use PostgreSQL for the main database",
                    "rationale": "Strong ACID compliance for transactional workloads",
                    "consequences": "Team needs PostgreSQL expertise",
                    "status": "taken",
                    "topic_id": topic_id,
                    "conversation_id": conversation_id,
                    "alternatives": [
                        {
                            "option": "MongoDB",
                            "rationale_against": "Weaker consistency guarantees",
                        }
                    ],
                }
            ]
        },
    )
    result = StoreDecisionsResponse.model_validate_json(raw)

    assert len(result.decisions) == 1
    assert len(result.decisions[0].decision_id) == 36


async def test_store_decision_with_supersedes(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    topics_raw = await _call_tool(
        "create_topics", {"topics": [{"title": "Database Choice"}]}
    )
    topic_id = CreateTopicsResponse.model_validate_json(topics_raw).topics[0].topic_id

    first_raw = await _call_tool(
        "store_decisions",
        {
            "decisions": [
                {
                    "title": "Use MongoDB",
                    "context": "Initial database choice",
                    "decision": "Use MongoDB",
                    "rationale": "Schema flexibility",
                    "consequences": "Eventual consistency model",
                    "status": "taken",
                    "topic_id": topic_id,
                    "conversation_id": conversation_id,
                }
            ]
        },
    )
    first_id = StoreDecisionsResponse.model_validate_json(first_raw).decisions[0].decision_id

    second_raw = await _call_tool(
        "store_decisions",
        {
            "decisions": [
                {
                    "title": "Switch to PostgreSQL",
                    "context": "Revisiting database choice",
                    "decision": "Switch to PostgreSQL",
                    "rationale": "Need ACID compliance",
                    "consequences": "Migration required",
                    "status": "taken",
                    "topic_id": topic_id,
                    "conversation_id": conversation_id,
                    "supersedes_decision_id": first_id,
                }
            ]
        },
    )
    result = StoreDecisionsResponse.model_validate_json(second_raw)

    assert len(result.decisions) == 1


# -- create_cross_references tests --


async def test_create_cross_references(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    topics_raw = await _call_tool(
        "create_topics",
        {"topics": [{"title": "Database"}, {"title": "API Design"}]},
    )
    topics = CreateTopicsResponse.model_validate_json(topics_raw).topics

    raw = await _call_tool(
        "create_cross_references",
        {
            "refs": [
                {
                    "from_topic_id": topics[0].topic_id,
                    "to_topic_id": topics[1].topic_id,
                    "type": "related_to",
                    "description": "API design depends on database schema",
                    "source_conversation_id": conversation_id,
                }
            ]
        },
    )
    result = CreateCrossReferencesResponse.model_validate_json(raw)

    assert result.count == 1


# -- set_summaries tests --


async def test_set_topic_summary() -> None:
    topics_raw = await _call_tool(
        "create_topics", {"topics": [{"title": "Database Choice"}]}
    )
    topic_id = CreateTopicsResponse.model_validate_json(topics_raw).topics[0].topic_id

    raw = await _call_tool(
        "set_summaries",
        {
            "topic_summaries": [
                {"topic_id": topic_id, "summary": "Discussion about database technology"}
            ]
        },
    )
    result = SetSummariesResponse.model_validate_json(raw)

    assert result.status == "success"


async def test_set_conversation_summary(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "set_summaries",
        {
            "topic_summaries": [],
            "conversation_summary": {
                "conversation_id": conversation_id,
                "summary": "Team decided to use PostgreSQL.",
            },
        },
    )
    result = SetSummariesResponse.model_validate_json(raw)

    assert result.status == "success"
