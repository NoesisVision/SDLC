"""End-to-end tests for get_next_turn_batch."""

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from noesis_graph.analysis.models import (
    GetNextTurnBatchResponse,
)
from noesis_graph.conversations.models import (
    RegisterConversationResponse,
)
from noesis_graph.conversations.registry import reset_graph
from noesis_graph.server import noesis_graph_server

CONVERSATION = """\
# Architecture Review
2026-03-15
**10:00**
Alice
We need to decide on the API versioning strategy. There are several options we should consider.
**10:02**
Bob
I think URL-based versioning is the simplest approach. It is easy to understand and implement.
**10:04**
Alice
That is a valid point. However, header-based versioning keeps URLs clean and is more RESTful.
**10:06**
Bob
Good argument. But URL versioning is more discoverable for consumers. They can see the version directly.
**10:08**
Alice
Let us also consider content negotiation. It is the most flexible approach.
**10:10**
Bob
Content negotiation adds complexity. I think we should keep it simple for now.
**10:12**
Alice
Agreed. Let us go with URL-based versioning for the initial release.
"""


@pytest.fixture(autouse=True)
def _clean_graph():
    reset_graph()
    yield
    reset_graph()


async def _call_tool(tool_name: str, arguments: dict) -> str:
    async with create_connected_server_and_client_session(
        noesis_graph_server, raise_exceptions=True
    ) as client:
        result = await client.call_tool(tool_name, arguments)
        return result.content[0].text


async def _register(file_path) -> str:
    raw = await _call_tool("register_conversation", {"file_path": str(file_path)})
    return RegisterConversationResponse.model_validate_json(raw).conversation_id


async def test_first_batch_returns_all_turns_when_budget_large(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_next_turn_batch",
        {"conversation_id": conversation_id, "max_tokens": 100000},
    )
    result = GetNextTurnBatchResponse.model_validate_json(raw)

    assert len(result.primary_turns) == 7
    assert result.lookahead_turns == []
    assert result.has_more is False


async def test_batch_respects_token_budget(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_next_turn_batch",
        {"conversation_id": conversation_id, "max_tokens": 50},
    )
    result = GetNextTurnBatchResponse.model_validate_json(raw)

    assert len(result.primary_turns) < 7
    assert len(result.primary_turns) >= 1
    assert result.has_more is True


async def test_batch_continuation_with_last_turn_order(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    raw1 = await _call_tool(
        "get_next_turn_batch",
        {"conversation_id": conversation_id, "max_tokens": 50},
    )
    batch1 = GetNextTurnBatchResponse.model_validate_json(raw1)
    last_order = batch1.primary_turns[-1].order

    raw2 = await _call_tool(
        "get_next_turn_batch",
        {
            "conversation_id": conversation_id,
            "max_tokens": 100000,
            "last_turn_order": last_order,
        },
    )
    batch2 = GetNextTurnBatchResponse.model_validate_json(raw2)

    all_orders = [t.order for t in batch1.primary_turns] + [
        t.order for t in batch2.primary_turns
    ]
    assert all_orders == sorted(set(all_orders))
    assert batch2.has_more is False


async def test_batch_includes_lookahead_turns(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_next_turn_batch",
        {
            "conversation_id": conversation_id,
            "max_tokens": 50,
            "lookahead_turns": 2,
        },
    )
    result = GetNextTurnBatchResponse.model_validate_json(raw)

    assert result.has_more is True
    assert len(result.lookahead_turns) <= 2
    assert len(result.lookahead_turns) > 0


async def test_batch_turns_have_correct_fields(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_next_turn_batch",
        {"conversation_id": conversation_id, "max_tokens": 100000},
    )
    result = GetNextTurnBatchResponse.model_validate_json(raw)

    first_turn = result.primary_turns[0]
    assert first_turn.speaker == "Alice"
    assert first_turn.time == "00:10:00"
    assert "API versioning" in first_turn.text
    assert first_turn.order == 0


async def test_empty_batch_after_last_turn(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_next_turn_batch",
        {
            "conversation_id": conversation_id,
            "max_tokens": 100000,
            "last_turn_order": 999,
        },
    )
    result = GetNextTurnBatchResponse.model_validate_json(raw)

    assert result.primary_turns == []
    assert result.lookahead_turns == []
    assert result.has_more is False
