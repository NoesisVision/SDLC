"""End-to-end tests for conversation MCP tools."""

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from agent_extensions.plugins.noesis.mcp.noesis_graph.conversations.models import (
    GetRawSpeakerTurnsResponse,
    RegisterConversationResponse,
    SetConversationMetadataResponse,
)
from agent_extensions.plugins.noesis.mcp.noesis_graph.conversations.registry import reset_graph
from agent_extensions.plugins.noesis.mcp.noesis_graph.server import noesis_graph_server

BASIC_CONVERSATION = """\
# Sprint Planning Meeting
2026-03-01
**10:00**
Jan Kowalski
We need to decide on the database technology. Should we use PostgreSQL or MongoDB?
**10:02**
Anna Nowak
I think PostgreSQL is better for our use case. It has strong ACID compliance.
**10:04**
Jan Kowalski
Good point. Let's go with PostgreSQL then.
"""

CONVERSATION_NO_TITLE = """\
2026-02-19
**14:00**
Speaker1
Hello world. This is a test.
"""

CONVERSATION_NO_DATE = """\
# Some Meeting
**08:30**
Speaker1
Good morning everyone.
"""

CONVERSATION_NO_METADATA = """\
**08:30**
Speaker1
Good morning everyone.
"""

CONVERSATION_WITH_HOURS = """\
# Architecture Workshop
2026-03-01
**59:30**
Jan Kowalski
This is the last turn before the hour mark.
**01:00:10**
Anna Nowak
This is the first turn after the hour mark. We should discuss deployment.
**01:02:15**
Jan Kowalski
Agreed. Let's plan the deployment pipeline for next sprint.
"""

EXISTING_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


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


async def _call_tool_expect_error(tool_name: str, arguments: dict) -> bool:
    async with create_connected_server_and_client_session(
        noesis_graph_server, raise_exceptions=True
    ) as client:
        result = await client.call_tool(tool_name, arguments)
        return result.isError


async def _register(file_path) -> str:
    raw = await _call_tool("register_conversation", {"file_path": str(file_path)})
    return RegisterConversationResponse.model_validate_json(raw).conversation_id


# -- register_conversation tests --


async def test_register_success(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    raw = await _call_tool("register_conversation", {"file_path": str(conv_file)})
    result = RegisterConversationResponse.model_validate_json(raw)

    assert result.status == "success"
    assert result.missing == []
    assert len(result.conversation_id) == 36


async def test_register_existing_id_reused(tmp_path) -> None:
    content = f"<!-- conversation_id: {EXISTING_ID} -->\n{BASIC_CONVERSATION}"
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(content, encoding="utf-8")

    raw = await _call_tool("register_conversation", {"file_path": str(conv_file)})
    result = RegisterConversationResponse.model_validate_json(raw)

    assert result.conversation_id == EXISTING_ID
    assert conv_file.read_text(encoding="utf-8") == content


async def test_register_new_id_persisted_to_file(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    raw = await _call_tool("register_conversation", {"file_path": str(conv_file)})
    result = RegisterConversationResponse.model_validate_json(raw)

    content = conv_file.read_text(encoding="utf-8")
    assert content.startswith(f"<!-- conversation_id: {result.conversation_id} -->")


async def test_register_missing_title(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION_NO_TITLE, encoding="utf-8")

    raw = await _call_tool("register_conversation", {"file_path": str(conv_file)})
    result = RegisterConversationResponse.model_validate_json(raw)

    assert result.status == "incomplete"
    assert "title" in result.missing


async def test_register_missing_date(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION_NO_DATE, encoding="utf-8")

    raw = await _call_tool("register_conversation", {"file_path": str(conv_file)})
    result = RegisterConversationResponse.model_validate_json(raw)

    assert result.status == "incomplete"
    assert "date" in result.missing


async def test_register_missing_both_metadata(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION_NO_METADATA, encoding="utf-8")

    raw = await _call_tool("register_conversation", {"file_path": str(conv_file)})
    result = RegisterConversationResponse.model_validate_json(raw)

    assert result.status == "incomplete"
    assert "title" in result.missing
    assert "date" in result.missing


async def test_register_title_argument_overrides_file(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    raw = await _call_tool(
        "register_conversation",
        {"file_path": str(conv_file), "title": "Custom Title"},
    )
    result = RegisterConversationResponse.model_validate_json(raw)

    assert result.status == "success"

    turns_raw = await _call_tool(
        "get_raw_speaker_turns", {"conversation_id": result.conversation_id}
    )
    turns = GetRawSpeakerTurnsResponse.model_validate_json(turns_raw)
    assert len(turns.turns) > 0


async def test_register_metadata_arguments_fill_missing(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION_NO_METADATA, encoding="utf-8")

    raw = await _call_tool(
        "register_conversation",
        {
            "file_path": str(conv_file),
            "title": "My Meeting",
            "date": "2026-01-01 09:00",
        },
    )
    result = RegisterConversationResponse.model_validate_json(raw)

    assert result.status == "success"
    assert result.missing == []


async def test_register_file_not_found() -> None:
    assert await _call_tool_expect_error(
        "register_conversation", {"file_path": "/nonexistent.md"}
    )


async def test_register_empty_file(tmp_path) -> None:
    conv_file = tmp_path / "empty.md"
    conv_file.write_text("", encoding="utf-8")
    assert await _call_tool_expect_error(
        "register_conversation", {"file_path": str(conv_file)}
    )


# -- register_conversation time format tests --


async def test_mmss_normalized_to_hhmmss(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_raw_speaker_turns", {"conversation_id": conversation_id}
    )
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert result.turns[0].time == "00:10:00"
    assert result.turns[1].time == "00:10:02"
    assert result.turns[2].time == "00:10:04"


async def test_hhmmss_preserved(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION_WITH_HOURS, encoding="utf-8")

    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_raw_speaker_turns", {"conversation_id": conversation_id}
    )
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert result.turns[0].time == "00:59:30"
    assert result.turns[1].time == "01:00:10"
    assert result.turns[2].time == "01:02:15"


# -- set_metadata tests --


async def test_set_metadata_success(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION_NO_TITLE, encoding="utf-8")

    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "set_conversation_metadata",
        {"conversation_id": conversation_id, "title": "Weekly Standup"},
    )
    result = SetConversationMetadataResponse.model_validate_json(raw)

    assert result.status == "success"


async def test_set_metadata_both_fields(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION_NO_METADATA, encoding="utf-8")

    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "set_conversation_metadata",
        {
            "conversation_id": conversation_id,
            "title": "Daily Standup",
            "date": "2026-04-01 09:00",
        },
    )
    result = SetConversationMetadataResponse.model_validate_json(raw)

    assert result.status == "success"


async def test_set_metadata_missing_required_title(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION_NO_METADATA, encoding="utf-8")

    conversation_id = await _register(conv_file)

    assert await _call_tool_expect_error(
        "set_conversation_metadata",
        {"conversation_id": conversation_id, "date": "2026-04-01 09:00"},
    )


async def test_set_metadata_unknown_conversation() -> None:
    assert await _call_tool_expect_error(
        "set_conversation_metadata",
        {"conversation_id": "nonexistent-id", "title": "Test"},
    )


# -- get_raw_speaker_turns tests --


async def test_get_all_turns(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_raw_speaker_turns", {"conversation_id": conversation_id}
    )
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert len(result.turns) == 3


async def test_filter_by_speakers(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_raw_speaker_turns",
        {"conversation_id": conversation_id, "speakers": ["Anna Nowak"]},
    )
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert len(result.turns) == 1
    assert result.turns[0].speaker == "Anna Nowak"


async def test_filter_by_speakers_case_insensitive(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_raw_speaker_turns",
        {"conversation_id": conversation_id, "speakers": ["anna nowak"]},
    )
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert len(result.turns) == 1


async def test_filter_by_from_time(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_raw_speaker_turns",
        {"conversation_id": conversation_id, "from_time": "00:10:02"},
    )
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert len(result.turns) == 2
    assert result.turns[0].time == "00:10:02"


async def test_filter_by_to_time(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_raw_speaker_turns",
        {"conversation_id": conversation_id, "to_time": "00:10:02"},
    )
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert len(result.turns) == 2
    assert result.turns[-1].time == "00:10:02"


async def test_filter_by_time_range(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_raw_speaker_turns",
        {
            "conversation_id": conversation_id,
            "from_time": "00:10:02",
            "to_time": "00:10:02",
        },
    )
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert len(result.turns) == 1
    assert result.turns[0].time == "00:10:02"


async def test_filter_combined_speakers_and_time(tmp_path) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    conversation_id = await _register(conv_file)

    raw = await _call_tool(
        "get_raw_speaker_turns",
        {
            "conversation_id": conversation_id,
            "speakers": ["Jan Kowalski"],
            "from_time": "00:10:04",
        },
    )
    result = GetRawSpeakerTurnsResponse.model_validate_json(raw)

    assert len(result.turns) == 1
    assert result.turns[0].speaker == "Jan Kowalski"
    assert result.turns[0].time == "00:10:04"


async def test_get_turns_unknown_conversation() -> None:
    assert await _call_tool_expect_error(
        "get_raw_speaker_turns", {"conversation_id": "nonexistent-id"}
    )
