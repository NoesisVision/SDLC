"""Tests for conversation registration uniqueness enforcement."""

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from noesis_graph.analysis.models import GetNextTurnBatchResponse
from noesis_graph.conversations.models import (
    GetRawSpeakerTurnsResponse,
    RegisterConversationResponse,
)
from noesis_graph.conversations.registry import reset_graph
from noesis_graph.server import noesis_graph_server

CONVERSATION = """\
# Idempotency Test
2026-04-01
**10:00**
Alice
First turn content.
**10:02**
Bob
Second turn content.
**10:04**
Alice
Third turn content.
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


async def test_first_registration_succeeds(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")

    cid = await _register(conv_file)

    raw = await _call_tool("get_raw_speaker_turns", {"conversation_id": cid})
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert len(result.turns) == 3


async def test_duplicate_registration_raises_error(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")

    await _register(conv_file)

    with pytest.raises(Exception, match="already registered|validation error"):
        await _register(conv_file)


async def test_triple_registration_raises_error(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")

    await _register(conv_file)

    with pytest.raises(Exception, match="already registered|validation error"):
        await _register(conv_file)


async def test_batching_returns_correct_turns(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")

    cid = await _register(conv_file)

    raw = await _call_tool(
        "get_next_turn_batch",
        {"conversation_id": cid, "max_tokens": 100000},
    )
    result = GetNextTurnBatchResponse.model_validate_json(raw)

    assert len(result.primary_turns) == 3
    orders = [t.order for t in result.primary_turns]
    assert orders == sorted(set(orders))
