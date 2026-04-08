"""End-to-end tests for finalize_conversation."""

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from noesis_graph.analysis.models import (
    CreateTopicsResponse,
    FinalizeConversationResponse,
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


async def test_finalize_sets_status_and_updates_topics(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    topics_raw = await _call_tool(
        "create_topics", {"topics": [{"title": "Database Choice"}]}
    )
    topic_id = CreateTopicsResponse.model_validate_json(topics_raw).topics[0].topic_id

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
                    "topic_id": topic_id,
                }
            ],
        },
    )

    raw = await _call_tool(
        "finalize_conversation", {"conversation_id": conversation_id}
    )
    result = FinalizeConversationResponse.model_validate_json(raw)

    assert result.status == "success"
    assert result.topics_updated == 1


async def test_finalize_conversation_without_idea_units(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "finalize_conversation", {"conversation_id": conversation_id}
    )
    result = FinalizeConversationResponse.model_validate_json(raw)

    assert result.status == "success"
    assert result.topics_updated == 0
