"""End-to-end tests for conversation output tools."""

import json
from pathlib import Path

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from mcp_servers.noesis_local.conversations.models import (
    ConversationStatus,
    FinalizeResponse,
    IdeaUnit,
    IdeaUnitCategory,
    SpeakerTurn,
    TopicDraftEntry,
    TopicStatement,
    TopicsDraft,
)
from mcp_servers.noesis_local.conversations.registry import get_conversation, register_conversation, reset_store
from mcp_servers.noesis_local.server import noesis_server


@pytest.fixture(autouse=True)
def _clean_store():
    reset_store()
    yield
    reset_store()


async def _call_tool(tool_name: str, arguments: dict) -> str:
    async with create_connected_server_and_client_session(noesis_server, raise_exceptions=True) as client:
        result = await client.call_tool(tool_name, arguments)
        return result.content[0].text


async def test_finalize(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conversation_id = "test-finalize-id"
    conv_file = tmp_path / "meeting.md"
    conv_file.write_text("dummy", encoding="utf-8")

    state = register_conversation(conversation_id, conv_file.resolve())
    state.title = "Sprint Planning Meeting"
    state.date = "2026-03-01"
    state.turns = [SpeakerTurn(speaker="Jan Kowalski", time="10:00", sentences=["We need to decide on the database technology."])]
    state.status = ConversationStatus.METADATA_ASSIGNED
    state.topics_draft = TopicsDraft(topics=[
        TopicDraftEntry(
            topic_id="topic_001",
            label="Topic topic_001",
            summary="",
            representative_texts=["database technology"],
            categories=["Issue"],
            statements=[
                TopicStatement(
                    speaker="Jan Kowalski",
                    time="10:00",
                    idea_units=[
                        IdeaUnit(
                            sentences=["We need to decide on the database technology."],
                            category=IdeaUnitCategory.Issue,
                        )
                    ],
                )
            ],
        )
    ])

    topics_refined = json.dumps({
        "topics": [
            {
                "topic_id": "topic_001",
                "label": "Database Technology Choice",
                "summary": "Discussion about choosing between PostgreSQL and MongoDB.",
            }
        ]
    })

    raw = await _call_tool(
        "finalize_conversation",
        {"conversation_id": conversation_id, "topics_refined": topics_refined},
    )
    result = FinalizeResponse.model_validate_json(raw)

    assert result.title == "Sprint Planning Meeting"
    assert len(result.topics) == 1
    assert result.topics[0].name == "Database Technology Choice"

    output_path = Path(result.output_path)
    assert output_path.exists()
    assert output_path.parent == tmp_path / ".noesis" / "conversations"
    structured = json.loads(output_path.read_text(encoding="utf-8"))
    assert structured["title"] == "Sprint Planning Meeting"
    assert len(structured["topics"]) == 1

    with pytest.raises(KeyError):
        get_conversation(conversation_id)
