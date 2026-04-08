"""End-to-end tests for export_conversation_document tool."""

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from noesis_graph.analysis.models import (
    CreateTopicsResponse,
    ExportConversationDocumentResponse,
    StoreDecisionsResponse,
)
from noesis_graph.conversations.models import (
    RegisterConversationResponse,
)
from noesis_graph.conversations.registry import reset_graph
from noesis_graph.server import noesis_graph_server

CONVERSATION = """\
# Architecture Review
2026-04-01
**10:00**
Alice
We should use PostgreSQL for the main database. It has strong ACID compliance.
**10:02**
Bob
I agree. Let's also consider using Redis for caching. It would reduce latency.
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


async def _create_topic(title: str, parent_id: str | None = None) -> str:
    topic_input: dict = {"title": title}
    if parent_id is not None:
        topic_input["parent_topic_id"] = parent_id
    raw = await _call_tool("create_topics", {"topics": [topic_input]})
    return CreateTopicsResponse.model_validate_json(raw).topics[0].topic_id


async def _seed_graph(tmp_path):
    conv_file = tmp_path / "conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)

    infra_id = await _create_topic("Infrastructure")
    db_id = await _create_topic("Database Choice", parent_id=infra_id)
    cache_id = await _create_topic("Caching Strategy", parent_id=infra_id)

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
                    "topic_id": db_id,
                },
                {
                    "turn_order": 1,
                    "sequence_in_turn": 0,
                    "text": "Let's also consider using Redis for caching.",
                    "sentence_indices": [0],
                    "categories": ["Position"],
                    "topic_id": cache_id,
                },
            ],
        },
    )

    dec_raw = await _call_tool(
        "store_decisions",
        {
            "decisions": [
                {
                    "title": "Use PostgreSQL",
                    "context": "Need to choose a main database",
                    "decision": "Use PostgreSQL for all transactional workloads",
                    "rationale": "Strong ACID compliance and team expertise",
                    "consequences": "Team needs PostgreSQL expertise",
                    "alternatives": [
                        {
                            "option": "MySQL",
                            "rationale_against": "Weaker ACID guarantees",
                        }
                    ],
                    "status": "taken",
                    "topic_id": db_id,
                    "conversation_id": conversation_id,
                }
            ]
        },
    )
    decision_id = StoreDecisionsResponse.model_validate_json(dec_raw).decisions[0].decision_id

    await _call_tool(
        "set_summaries",
        {
            "topic_summaries": [
                {"topic_id": db_id, "summary": "PostgreSQL chosen for ACID compliance"},
                {"topic_id": cache_id, "summary": "Redis proposed for caching layer"},
            ],
            "conversation_summary": {
                "conversation_id": conversation_id,
                "summary": "Team reviewed architecture choices for database and caching.",
            },
        },
    )

    return conversation_id, infra_id, db_id, cache_id, decision_id


async def test_export_creates_file(tmp_path) -> None:
    conversation_id, *_ = await _seed_graph(tmp_path)
    output_file = tmp_path / "output" / "report.md"

    raw = await _call_tool(
        "export_conversation_document",
        {"conversation_id": conversation_id, "output_path": str(output_file)},
    )
    result = ExportConversationDocumentResponse.model_validate_json(raw)

    assert result.status == "success"
    assert result.topics_count == 2
    assert result.decisions_count == 1
    assert output_file.exists()


async def test_export_contains_topics_with_paths(tmp_path) -> None:
    conversation_id, *_ = await _seed_graph(tmp_path)
    output_file = tmp_path / "report.md"

    await _call_tool(
        "export_conversation_document",
        {"conversation_id": conversation_id, "output_path": str(output_file)},
    )
    content = output_file.read_text(encoding="utf-8")

    assert "Infrastructure - Database Choice" in content
    assert "Infrastructure - Caching Strategy" in content


async def test_export_contains_topic_summaries(tmp_path) -> None:
    conversation_id, *_ = await _seed_graph(tmp_path)
    output_file = tmp_path / "report.md"

    await _call_tool(
        "export_conversation_document",
        {"conversation_id": conversation_id, "output_path": str(output_file)},
    )
    content = output_file.read_text(encoding="utf-8")

    assert "PostgreSQL chosen for ACID compliance" in content
    assert "Redis proposed for caching layer" in content


async def test_export_contains_decision_data(tmp_path) -> None:
    conversation_id, *_ = await _seed_graph(tmp_path)
    output_file = tmp_path / "report.md"

    await _call_tool(
        "export_conversation_document",
        {"conversation_id": conversation_id, "output_path": str(output_file)},
    )
    content = output_file.read_text(encoding="utf-8")

    assert "Use PostgreSQL" in content
    assert "taken" in content
    assert "Need to choose a main database" in content
    assert "Strong ACID compliance and team expertise" in content
    assert "Team needs PostgreSQL expertise" in content
    assert "MySQL" in content
    assert "Weaker ACID guarantees" in content


async def test_export_contains_header(tmp_path) -> None:
    conversation_id, *_ = await _seed_graph(tmp_path)
    output_file = tmp_path / "report.md"

    await _call_tool(
        "export_conversation_document",
        {"conversation_id": conversation_id, "output_path": str(output_file)},
    )
    content = output_file.read_text(encoding="utf-8")

    assert content.startswith("# Architecture Review")
    assert "2026-04-01" in content


async def test_export_unknown_conversation() -> None:
    async with create_connected_server_and_client_session(
        noesis_graph_server, raise_exceptions=True
    ) as client:
        result = await client.call_tool(
            "export_conversation_document",
            {
                "conversation_id": "nonexistent-id",
                "output_path": "/tmp/should-not-exist.md",
            },
        )
        assert result.isError
        assert "Unknown conversation_id" in result.content[0].text


async def test_export_empty_conversation(tmp_path) -> None:
    conv_file = tmp_path / "empty_conv.md"
    conv_file.write_text(CONVERSATION, encoding="utf-8")
    conversation_id = await _register(conv_file)
    output_file = tmp_path / "empty_report.md"

    raw = await _call_tool(
        "export_conversation_document",
        {"conversation_id": conversation_id, "output_path": str(output_file)},
    )
    result = ExportConversationDocumentResponse.model_validate_json(raw)

    assert result.status == "success"
    assert result.topics_count == 0
    assert result.decisions_count == 0

    content = output_file.read_text(encoding="utf-8")
    assert "No topics found" in content
    assert "No decisions recorded" in content
