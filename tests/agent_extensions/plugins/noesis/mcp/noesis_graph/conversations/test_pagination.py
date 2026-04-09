"""Tests for get_raw_speaker_turns pagination (Problem #2)."""

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from noesis_graph.conversations.models import (
    GetRawSpeakerTurnsResponse,
    RegisterConversationResponse,
)
from noesis_graph.conversations.registry import reset_graph
from noesis_graph.server import noesis_graph_server

CONVERSATION = """\
# Pagination Test
2026-04-01
**10:00**
Alice
Turn zero.
**10:02**
Bob
Turn one.
**10:04**
Alice
Turn two.
**10:06**
Bob
Turn three.
**10:08**
Alice
Turn four.
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


async def test_limit_restricts_result_count(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    cid = await _register(conv_file)

    raw = await _call_tool(
        "get_raw_speaker_turns", {"conversation_id": cid, "limit": 2}
    )
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert len(result.turns) == 2


async def test_offset_skips_turns(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    cid = await _register(conv_file)

    raw = await _call_tool(
        "get_raw_speaker_turns", {"conversation_id": cid, "offset": 3}
    )
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert len(result.turns) == 2
    assert "Turn three" in result.turns[0].sentences[0]


async def test_offset_and_limit_combined(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    cid = await _register(conv_file)

    raw = await _call_tool(
        "get_raw_speaker_turns",
        {"conversation_id": cid, "offset": 1, "limit": 2},
    )
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert len(result.turns) == 2
    assert "Turn one" in result.turns[0].sentences[0]
    assert "Turn two" in result.turns[1].sentences[0]


async def test_pagination_covers_all_turns(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    cid = await _register(conv_file)

    all_turns = []
    page_size = 2
    offset = 0

    while True:
        raw = await _call_tool(
            "get_raw_speaker_turns",
            {"conversation_id": cid, "offset": offset, "limit": page_size},
        )
        page = GetRawSpeakerTurnsResponse.model_validate_json(raw)
        if not page.turns:
            break
        all_turns.extend(page.turns)
        offset += page_size

    assert len(all_turns) == 5


async def test_no_pagination_returns_all(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    cid = await _register(conv_file)

    raw = await _call_tool(
        "get_raw_speaker_turns", {"conversation_id": cid}
    )
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert len(result.turns) == 5


async def test_offset_beyond_total_returns_empty(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    cid = await _register(conv_file)

    raw = await _call_tool(
        "get_raw_speaker_turns", {"conversation_id": cid, "offset": 100}
    )
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert len(result.turns) == 0


async def test_limit_larger_than_total_returns_all(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    cid = await _register(conv_file)

    raw = await _call_tool(
        "get_raw_speaker_turns", {"conversation_id": cid, "limit": 100}
    )
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert len(result.turns) == 5
