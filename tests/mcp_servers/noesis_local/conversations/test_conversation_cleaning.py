"""End-to-end tests for conversation cleaning tools."""

import json
from pathlib import Path

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from mcp_servers.noesis_local.conversations.models import (
    AddConversationResponse,
    CleanResponse,
    GetBatchResponse,
    PrepareBatchesResponse,
    SetMetadataResponse,
)
from mcp_servers.noesis_local.conversations.registry import reset_store
from mcp_servers.noesis_local.server import noesis_server

BASIC_CONVERSATION = """\
# Sprint Planning Meeting
2026-03-01
**10:00**
Jan Kowalski
We need to decide on the database technology. Should we use PostgreSQL or MongoDB?
**10:02**
Anna Nowak
I think PostgreSQL is better for our use case. It has strong ACID compliance and we need transactional guarantees.
**10:04**
Jan Kowalski
Good point. Let's go with PostgreSQL then. I will set up the development instance by Friday.
**10:06**
Anna Nowak
We also need to discuss the deployment pipeline. Are we using Docker or Kubernetes?
"""

CONVERSATION_NO_TITLE = """\
2026-02-19
**14:00**
Speaker1
Hello world.
"""

CONVERSATION_NO_DATE = """\
# Some Meeting
**08:30**
Speaker1
Good morning everyone.
"""


@pytest.fixture(autouse=True)
def _clean_store():
    reset_store()
    yield
    reset_store()


async def _call_tool(tool_name: str, arguments: dict) -> str:
    async with create_connected_server_and_client_session(noesis_server, raise_exceptions=True) as client:
        result = await client.call_tool(tool_name, arguments)
        return result.content[0].text


async def _call_tool_expect_error(tool_name: str, arguments: dict) -> bool:
    async with create_connected_server_and_client_session(noesis_server, raise_exceptions=True) as client:
        result = await client.call_tool(tool_name, arguments)
        return result.isError


async def _add_conversation(file_path: Path) -> str:
    raw = await _call_tool("add_conversation", {"file_path": str(file_path)})
    return AddConversationResponse.model_validate_json(raw).conversation_id


async def test_clean_success(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    conversation_id = await _add_conversation(conv_file)
    raw = await _call_tool("clean_conversation", {"conversation_id": conversation_id})
    result = CleanResponse.model_validate_json(raw)

    assert result.status == "success"
    assert result.missing == []


async def test_clean_missing_title(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION_NO_TITLE, encoding="utf-8")

    conversation_id = await _add_conversation(conv_file)
    raw = await _call_tool("clean_conversation", {"conversation_id": conversation_id})
    result = CleanResponse.model_validate_json(raw)

    assert result.status == "incomplete"
    assert "title" in result.missing


async def test_clean_missing_date(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION_NO_DATE, encoding="utf-8")

    conversation_id = await _add_conversation(conv_file)
    raw = await _call_tool("clean_conversation", {"conversation_id": conversation_id})
    result = CleanResponse.model_validate_json(raw)

    assert result.status == "incomplete"
    assert "date" in result.missing


async def test_clean_empty_file(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "empty.md"
    conv_file.write_text("", encoding="utf-8")

    conversation_id = await _add_conversation(conv_file)
    assert await _call_tool_expect_error("clean_conversation", {"conversation_id": conversation_id})


async def test_set_metadata(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION_NO_TITLE, encoding="utf-8")

    conversation_id = await _add_conversation(conv_file)
    await _call_tool("clean_conversation", {"conversation_id": conversation_id})

    raw = await _call_tool(
        "set_conversation_metadata",
        {"conversation_id": conversation_id, "title": "Weekly Standup", "date": "2026-02-19"},
    )
    result = SetMetadataResponse.model_validate_json(raw)

    assert result.status == "success"


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


async def test_clean_parses_hour_timestamps(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION_WITH_HOURS, encoding="utf-8")

    conversation_id = await _add_conversation(conv_file)
    raw = await _call_tool("clean_conversation", {"conversation_id": conversation_id})
    result = CleanResponse.model_validate_json(raw)

    assert result.status == "success"

    raw = await _call_tool("prepare_extraction_batches", {"conversation_id": conversation_id})
    batches = PrepareBatchesResponse.model_validate_json(raw)

    assert batches.batch_count == 1

    raw = await _call_tool(
        "get_extraction_batch", {"conversation_id": conversation_id, "batch_index": 0}
    )
    batch = GetBatchResponse.model_validate_json(raw)
    turns = json.loads(batch.extraction_turns)

    assert len(turns) == 3
    assert turns[0]["time"] == "59:30"
    assert turns[1]["time"] == "01:00:10"
    assert turns[2]["time"] == "01:02:15"
