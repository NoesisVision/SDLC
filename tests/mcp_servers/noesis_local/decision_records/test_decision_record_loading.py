"""End-to-end tests for decision record loading MCP tools."""

import json

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from mcp_servers.noesis_local.decision_records.loading import reset_cache
from mcp_servers.noesis_local.decision_records.models import (
    GetConversationTopicsResponse,
    GetTopicDataResponse,
)
from mcp_servers.noesis_local.server import noesis_server

CONVERSATION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

STRUCTURED_DATA = {
    "title": "Sprint Planning Meeting",
    "date": "2026-03-01 10:00",
    "topics": [
        {
            "name": "Database Technology Choice",
            "summary": "Discussion about choosing between PostgreSQL and MongoDB.",
            "statements": [
                {
                    "speaker": "Jan Kowalski",
                    "time": "10:00",
                    "idea_units": [
                        {
                            "sentences": ["We need to decide on the database technology."],
                            "category": "Issue",
                        }
                    ],
                },
                {
                    "speaker": "Anna Nowak",
                    "time": "10:02",
                    "idea_units": [
                        {
                            "sentences": ["I think PostgreSQL is better for our use case."],
                            "category": "Position",
                        }
                    ],
                },
            ],
        },
        {
            "name": "Sprint Goals",
            "summary": "Setting goals for the upcoming sprint.",
            "statements": [
                {
                    "speaker": "Jan Kowalski",
                    "time": "10:10",
                    "idea_units": [
                        {
                            "sentences": ["Let's aim to complete the API migration."],
                            "category": "Decision",
                        }
                    ],
                },
            ],
        },
    ],
}


@pytest.fixture(autouse=True)
def _clean_cache():
    reset_cache()
    yield
    reset_cache()


def _setup_conversation_files(tmp_path):
    conv_file = tmp_path / "meeting.md"
    conv_file.write_text(
        f"<!-- conversation_id: {CONVERSATION_ID} -->\n# Sprint Planning Meeting\n",
        encoding="utf-8",
    )

    structured_dir = tmp_path / ".noesis" / "conversations"
    structured_dir.mkdir(parents=True)
    structured_file = structured_dir / "meeting_structured.json"
    structured_file.write_text(
        json.dumps(STRUCTURED_DATA, ensure_ascii=False), encoding="utf-8"
    )


async def _call_tool(tool_name: str, arguments: dict) -> str:
    async with create_connected_server_and_client_session(noesis_server, raise_exceptions=True) as client:
        result = await client.call_tool(tool_name, arguments)
        return result.content[0].text


async def _call_tool_expect_error(tool_name: str, arguments: dict) -> bool:
    async with create_connected_server_and_client_session(noesis_server, raise_exceptions=True) as client:
        result = await client.call_tool(tool_name, arguments)
        return result.isError


async def test_get_conversation_topics(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    _setup_conversation_files(tmp_path)

    raw = await _call_tool(
        "get_conversation_topics", {"conversation_id": CONVERSATION_ID}
    )
    result = GetConversationTopicsResponse.model_validate_json(raw)

    assert result.conversation_title == "Sprint Planning Meeting"
    assert result.topic_count == 2
    assert len(result.topics) == 2
    assert result.topics[0].index == 0
    assert result.topics[0].name == "Database Technology Choice"
    assert result.topics[1].index == 1
    assert result.topics[1].name == "Sprint Goals"


async def test_get_topic_data(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    _setup_conversation_files(tmp_path)

    await _call_tool("get_conversation_topics", {"conversation_id": CONVERSATION_ID})

    raw = await _call_tool(
        "get_topic_data", {"conversation_id": CONVERSATION_ID, "topic_index": 0}
    )
    result = GetTopicDataResponse.model_validate_json(raw)

    assert result.topic_name == "Database Technology Choice"
    assert result.topic_summary == "Discussion about choosing between PostgreSQL and MongoDB."

    statements = json.loads(result.statements)
    assert len(statements) == 2
    assert statements[0]["speaker"] == "Jan Kowalski"
    assert statements[1]["idea_units"][0]["category"] == "Position"


async def test_get_topic_data_second_topic(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    _setup_conversation_files(tmp_path)

    await _call_tool("get_conversation_topics", {"conversation_id": CONVERSATION_ID})

    raw = await _call_tool(
        "get_topic_data", {"conversation_id": CONVERSATION_ID, "topic_index": 1}
    )
    result = GetTopicDataResponse.model_validate_json(raw)

    assert result.topic_name == "Sprint Goals"


async def test_unknown_conversation_id_raises_error(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    assert await _call_tool_expect_error(
        "get_conversation_topics", {"conversation_id": "nonexistent-id"}
    )


async def test_missing_structured_file_raises_error(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conv_file = tmp_path / "meeting.md"
    conv_file.write_text(
        f"<!-- conversation_id: {CONVERSATION_ID} -->\n# Meeting\n",
        encoding="utf-8",
    )

    assert await _call_tool_expect_error(
        "get_conversation_topics", {"conversation_id": CONVERSATION_ID}
    )


async def test_invalid_topic_index_raises_error(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    _setup_conversation_files(tmp_path)

    await _call_tool("get_conversation_topics", {"conversation_id": CONVERSATION_ID})

    assert await _call_tool_expect_error(
        "get_topic_data", {"conversation_id": CONVERSATION_ID, "topic_index": 99}
    )


async def test_get_topic_data_without_loading_raises_error(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    assert await _call_tool_expect_error(
        "get_topic_data", {"conversation_id": "not-loaded-id", "topic_index": 0}
    )
