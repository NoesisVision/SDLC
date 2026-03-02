"""End-to-end tests for idea extraction tools."""

import json

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from mcp_servers.noesis_local.conversations.models import (
    ConversationStatus,
    GetBatchResponse,
    PrepareBatchesResponse,
    SpeakerTurn,
    StoreBatchResultResponse,
)
from mcp_servers.noesis_local.conversations.registry import get_conversation, register_conversation, reset_store
from mcp_servers.noesis_local.server import noesis_server

IDEA_UNITS_DATA = [
    {
        "speaker": "Jan Kowalski",
        "time": "10:00",
        "idea_units": [
            {
                "sentences": [
                    "We need to decide on the database technology.",
                    "Should we use PostgreSQL or MongoDB?",
                ],
                "category": "Issue",
            }
        ],
    },
    {
        "speaker": "Anna Nowak",
        "time": "10:02",
        "idea_units": [
            {
                "sentences": [
                    "I think PostgreSQL is better for our use case.",
                    "It has strong ACID compliance and we need transactional guarantees.",
                ],
                "category": "Argument",
            }
        ],
    },
]


@pytest.fixture(autouse=True)
def _clean_store():
    reset_store()
    yield
    reset_store()


async def _call_tool(tool_name: str, arguments: dict) -> str:
    async with create_connected_server_and_client_session(noesis_server, raise_exceptions=True) as client:
        result = await client.call_tool(tool_name, arguments)
        return result.content[0].text


def _setup_state(conversation_id: str, tmp_path, title: str, date: str, turns: list[SpeakerTurn]) -> None:
    conv_file = tmp_path / "conv.md"
    conv_file.write_text("dummy", encoding="utf-8")
    state = register_conversation(conversation_id, conv_file.resolve())
    state.title = title
    state.date = date
    state.turns = turns
    state.status = ConversationStatus.METADATA_ASSIGNED


async def test_prepare_batches(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conversation_id = "test-prepare-batches-id"

    turns = [
        SpeakerTurn(speaker=f"Speaker{i}", time=f"10:{i:02d}", sentences=[f"Sentence {i}."])
        for i in range(12)
    ]
    _setup_state(conversation_id, tmp_path, "Test", "2026-01-01", turns)

    raw = await _call_tool("prepare_extraction_batches", {"conversation_id": conversation_id})
    result = PrepareBatchesResponse.model_validate_json(raw)

    assert result.status == "success"
    assert result.batch_count == 2


async def test_get_batch(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conversation_id = "test-get-batch-id"

    turns = [SpeakerTurn(speaker="Speaker0", time="10:00", sentences=["Hello."])]
    _setup_state(conversation_id, tmp_path, "Test", "2026-01-01", turns)

    await _call_tool("prepare_extraction_batches", {"conversation_id": conversation_id})
    raw = await _call_tool("get_extraction_batch", {"conversation_id": conversation_id, "batch_index": 0})
    result = GetBatchResponse.model_validate_json(raw)

    assert result.batch_index == 0
    assert len(result.turns) > 0


async def test_store_batch_result_success(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conversation_id = "test-store-result-id"

    turns = [
        SpeakerTurn(
            speaker="Jan Kowalski",
            time="10:00",
            sentences=[
                "We need to decide on the database technology.",
                "Should we use PostgreSQL or MongoDB?",
            ],
        ),
        SpeakerTurn(
            speaker="Anna Nowak",
            time="10:02",
            sentences=[
                "I think PostgreSQL is better for our use case.",
                "It has strong ACID compliance and we need transactional guarantees.",
            ],
        ),
    ]
    _setup_state(conversation_id, tmp_path, "Test", "2026-01-01", turns)

    await _call_tool("prepare_extraction_batches", {"conversation_id": conversation_id})

    llm_result = json.dumps(IDEA_UNITS_DATA)
    raw = await _call_tool(
        "store_extraction_result",
        {"conversation_id": conversation_id, "batch_index": 0, "result": llm_result},
    )
    result = StoreBatchResultResponse.model_validate_json(raw)

    assert result.status == "success"

    state = get_conversation(conversation_id)
    assert state.idea_units is not None
    assert len(state.idea_units) == 2


async def test_store_batch_result_partial(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conversation_id = "test-store-partial-id"

    turns = [
        SpeakerTurn(speaker=f"Speaker{i}", time=f"10:{i:02d}", sentences=[f"Sentence {i}."])
        for i in range(12)
    ]
    _setup_state(conversation_id, tmp_path, "Test", "2026-01-01", turns)

    await _call_tool("prepare_extraction_batches", {"conversation_id": conversation_id})

    first_batch_data = [
        {"speaker": f"Speaker{i}", "time": f"10:{i:02d}", "idea_units": [{"sentences": [f"Sentence {i}."], "category": "Issue"}]}
        for i in range(8)
    ]
    raw = await _call_tool(
        "store_extraction_result",
        {"conversation_id": conversation_id, "batch_index": 0, "result": json.dumps(first_batch_data)},
    )
    result = StoreBatchResultResponse.model_validate_json(raw)

    assert result.status == "success"

    state = get_conversation(conversation_id)
    assert state.idea_units is None


async def test_store_batch_result_invalid_json(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conversation_id = "test-store-invalid-json-id"

    turns = [SpeakerTurn(speaker="Speaker0", time="10:00", sentences=["Hello."])]
    _setup_state(conversation_id, tmp_path, "Test", "2026-01-01", turns)

    await _call_tool("prepare_extraction_batches", {"conversation_id": conversation_id})

    raw = await _call_tool(
        "store_extraction_result",
        {"conversation_id": conversation_id, "batch_index": 0, "result": "not json"},
    )
    result = StoreBatchResultResponse.model_validate_json(raw)

    assert result.status == "invalid_json"
    assert result.error_details is not None
    assert "JSON parse error" in result.error_details


async def test_store_batch_result_validation_failed(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    conversation_id = "test-store-validation-fail-id"

    turns = [SpeakerTurn(speaker="Speaker0", time="10:00", sentences=["Hello."])]
    _setup_state(conversation_id, tmp_path, "Test", "2026-01-01", turns)

    await _call_tool("prepare_extraction_batches", {"conversation_id": conversation_id})

    raw = await _call_tool(
        "store_extraction_result",
        {"conversation_id": conversation_id, "batch_index": 0, "result": '["wrong structure"]'},
    )
    result = StoreBatchResultResponse.model_validate_json(raw)

    assert result.status == "validation_failed"
    assert result.error_details is not None
    assert "Invalid turn structure" in result.error_details


