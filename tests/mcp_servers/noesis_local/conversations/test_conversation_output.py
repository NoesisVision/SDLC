"""End-to-end tests for conversation output tools."""

import json
from pathlib import Path

import pytest
from mcp.shared.memory import create_connected_server_and_client_session
from redislite.falkordb_client import FalkorDB

from mcp_servers.noesis_local.conversations.graph_storing import (
    conversation_exists,
    store_conversation,
    sync_conversations_from_disk,
)
from mcp_servers.noesis_local.conversations.models import (
    ConversationStatus,
    FinalizeResponse,
    IdeaUnit,
    IdeaUnitCategory,
    SpeakerTurn,
    StructuredConversation,
    Topic,
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


@pytest.fixture()
def graph(tmp_path):
    db_file = tmp_path / "test_graph.db"
    db = FalkorDB(str(db_file))
    g = db.select_graph("noesis")
    yield g
    db.close()


def _setup_conversation_state(tmp_path: Path, conversation_id: str) -> str:
    conv_file = tmp_path / "meeting.md"
    if not conv_file.exists():
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

    return json.dumps({
        "topics": [
            {
                "topic_id": "topic_001",
                "label": "Database Technology Choice",
                "summary": "Discussion about choosing between PostgreSQL and MongoDB.",
            }
        ]
    })


def _sample_structured() -> StructuredConversation:
    return StructuredConversation(
        conversation_id="conv-001",
        title="Sprint Planning Meeting",
        date="2026-03-01 10:00",
        topics=[
            Topic(
                name="Database Technology Choice",
                summary="Discussion about choosing between PostgreSQL and MongoDB.",
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
        ],
    )


async def test_finalize(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conversation_id = "test-finalize-id"
    topics_refined = _setup_conversation_state(tmp_path, conversation_id)

    async with create_connected_server_and_client_session(noesis_server, raise_exceptions=True) as client:
        raw = (await client.call_tool(
            "finalize_conversation",
            {"conversation_id": conversation_id, "topics_refined": topics_refined},
        )).content[0].text

    result = FinalizeResponse.model_validate_json(raw)

    assert result.title == "Sprint Planning Meeting"
    assert len(result.topics) == 1
    assert result.topics[0].name == "Database Technology Choice"

    output_path = Path(result.output_path)
    assert output_path.exists()
    assert output_path.parent == tmp_path / ".noesis" / "conversations"
    structured = json.loads(output_path.read_text(encoding="utf-8"))
    assert structured["title"] == "Sprint Planning Meeting"
    assert structured["conversation_id"] == conversation_id
    assert len(structured["topics"]) == 1

    with pytest.raises(KeyError):
        get_conversation(conversation_id)


def test_store_conversation_creates_graph(graph) -> None:
    structured = _sample_structured()
    store_conversation(graph, structured)

    conversations = graph.query(
        "MATCH (c:Conversation {conversation_id: $cid}) RETURN c.title, c.date",
        params={"cid": "conv-001"},
    ).result_set
    assert len(conversations) == 1
    assert conversations[0][0] == "Sprint Planning Meeting"
    assert conversations[0][1] == "2026-03-01 10:00"

    topics = graph.query(
        "MATCH (:Conversation {conversation_id: $cid})-[r:HAS_TOPIC]->(t:Topic) RETURN t.name, t.summary, r.order",
        params={"cid": "conv-001"},
    ).result_set
    assert len(topics) == 1
    assert topics[0][0] == "Database Technology Choice"
    assert topics[0][2] == 0

    statements = graph.query(
        "MATCH (:Conversation {conversation_id: $cid})-[:HAS_TOPIC]->()-[r:HAS_STATEMENT]->(s:Statement) RETURN s.speaker, s.time, r.order",
        params={"cid": "conv-001"},
    ).result_set
    assert len(statements) == 1
    assert statements[0][0] == "Jan Kowalski"
    assert statements[0][1] == "10:00"

    idea_units = graph.query(
        "MATCH (:Conversation {conversation_id: $cid})-[:HAS_TOPIC]->()-[:HAS_STATEMENT]->()-[r:HAS_IDEA_UNIT]->(iu:IdeaUnit) RETURN iu.sentences, iu.category, r.order",
        params={"cid": "conv-001"},
    ).result_set
    assert len(idea_units) == 1
    assert idea_units[0][1] == "Issue"
    assert idea_units[0][2] == 0


def test_store_conversation_is_idempotent(graph) -> None:
    structured = _sample_structured()

    store_conversation(graph, structured)
    store_conversation(graph, structured)

    conversations = graph.query(
        "MATCH (c:Conversation {conversation_id: $cid}) RETURN c.title",
        params={"cid": "conv-001"},
    ).result_set
    assert len(conversations) == 1


def test_sync_conversations_from_disk(tmp_path, monkeypatch, graph) -> None:
    monkeypatch.chdir(tmp_path)
    conversations_dir = tmp_path / ".noesis" / "conversations"
    conversations_dir.mkdir(parents=True, exist_ok=True)
    structured_data = {
        "conversation_id": "sync-test-001",
        "title": "Synced Meeting",
        "date": "2026-03-02 09:00",
        "topics": [
            {
                "name": "Planning",
                "summary": "Sprint planning discussion.",
                "statements": [
                    {
                        "speaker": "Anna",
                        "time": "09:00",
                        "idea_units": [
                            {
                                "sentences": ["Let's plan the sprint."],
                                "category": "Issue",
                            }
                        ],
                    }
                ],
            }
        ],
    }
    json_path = conversations_dir / "synced_meeting_structured.json"
    json_path.write_text(json.dumps(structured_data), encoding="utf-8")

    added = sync_conversations_from_disk(graph, tmp_path)

    assert added == 1
    assert conversation_exists(graph, "sync-test-001")

    conversations = graph.query(
        "MATCH (c:Conversation {conversation_id: 'sync-test-001'}) RETURN c.title",
    ).result_set
    assert conversations[0][0] == "Synced Meeting"

    added_again = sync_conversations_from_disk(graph, tmp_path)
    assert added_again == 0
