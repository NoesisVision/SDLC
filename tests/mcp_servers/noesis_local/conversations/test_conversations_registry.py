"""End-to-end tests for the add_conversation MCP tool."""

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from mcp_servers.noesis_local.conversations.models import AddConversationResponse
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
I think PostgreSQL is better for our use case.
"""

EXISTING_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


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


async def test_existing_id_returned_without_modifying_file(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    original_content = f"<!-- conversation_id: {EXISTING_ID} -->\n{BASIC_CONVERSATION}"
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(original_content, encoding="utf-8")

    raw = await _call_tool("add_conversation", {"file_path": str(conv_file)})
    result = AddConversationResponse.model_validate_json(raw)

    assert result.conversation_id == EXISTING_ID
    assert result.already_stored is False
    assert conv_file.read_text(encoding="utf-8") == original_content


async def test_new_id_generated_and_persisted(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(BASIC_CONVERSATION, encoding="utf-8")

    raw = await _call_tool("add_conversation", {"file_path": str(conv_file)})
    result = AddConversationResponse.model_validate_json(raw)

    assert result.conversation_id
    assert len(result.conversation_id) == 36
    assert result.already_stored is False

    content = conv_file.read_text(encoding="utf-8")
    assert content == f"<!-- conversation_id: {result.conversation_id} -->\n{BASIC_CONVERSATION}"


async def test_already_stored_conversation_returns_early(
    tmp_path, monkeypatch, shared_graph_context
) -> None:
    monkeypatch.chdir(tmp_path)
    graph = shared_graph_context.graph

    graph.query(
        "CREATE (:Conversation {conversation_id: $cid, title: $title, date: $date})",
        params={
            "cid": EXISTING_ID,
            "title": "Sprint Planning Meeting",
            "date": "2026-03-01 10:00",
        },
    )

    conv_file = tmp_path / "conv.md"
    conv_file.write_text(
        f"<!-- conversation_id: {EXISTING_ID} -->\n{BASIC_CONVERSATION}",
        encoding="utf-8",
    )

    raw = await _call_tool("add_conversation", {"file_path": str(conv_file)})
    result = AddConversationResponse.model_validate_json(raw)

    assert result.conversation_id == EXISTING_ID
    assert result.already_stored is True

    graph.query(
        "MATCH (c:Conversation {conversation_id: $cid}) DELETE c",
        params={"cid": EXISTING_ID},
    )


async def test_file_not_found_raises_error(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    assert await _call_tool_expect_error("add_conversation", {"file_path": "/nonexistent.md"})


async def test_missing_file_path_raises_error(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    assert await _call_tool_expect_error("add_conversation", {"file_path": ""})
