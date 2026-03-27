"""End-to-end tests for decision record storing MCP tool."""

import json
from pathlib import Path

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from mcp_servers.noesis_local.decision_records.loading import _cache, reset_cache
from mcp_servers.noesis_local.decision_records.models import (
    LoadedConversation,
    StoreDecisionRecordResponse,
)
from mcp_servers.noesis_local.server import noesis_server

CONVERSATION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


@pytest.fixture(autouse=True)
def _clean_cache():
    reset_cache()
    yield
    reset_cache()


@pytest.fixture()
def _preload_cache():
    _cache[CONVERSATION_ID] = LoadedConversation(
        title="Sprint Planning Meeting",
        source_stem="meeting",
        topics=[
            {
                "name": "Database Technology Choice",
                "summary": "Discussion about choosing between PostgreSQL and MongoDB.",
                "statements": [],
            },
            {
                "name": "Sprint Goals",
                "summary": "Setting goals for the upcoming sprint.",
                "statements": [],
            },
        ],
    )


async def _call_tool(tool_name: str, arguments: dict) -> str:
    async with create_connected_server_and_client_session(noesis_server, raise_exceptions=True) as client:
        result = await client.call_tool(tool_name, arguments)
        return result.content[0].text


async def _call_tool_expect_error(tool_name: str, arguments: dict) -> bool:
    async with create_connected_server_and_client_session(noesis_server, raise_exceptions=True) as client:
        result = await client.call_tool(tool_name, arguments)
        return result.isError


async def test_store_decision_record(tmp_path, monkeypatch, _preload_cache) -> None:
    monkeypatch.chdir(tmp_path)

    record = json.dumps({
        "context": "The team needed to choose a database technology.",
        "decision": {
            "description": "PostgreSQL was chosen as the database.",
            "rationale": "Better support for complex queries and strong ecosystem.",
            "consequences": "Team needs PostgreSQL expertise; migrations are relational.",
        },
        "alternative_options": [
            {
                "description": "MongoDB for document flexibility.",
                "rejection_rationale": "Lacks support for complex relational queries.",
            },
        ],
        "design_concerns": ["Technology", "QualityAttribute"],
    })

    raw = await _call_tool(
        "store_decision_record",
        {"conversation_id": CONVERSATION_ID, "topic_index": 0, "record": record},
    )
    result = StoreDecisionRecordResponse.model_validate_json(raw)

    assert result.status == "success"
    assert result.output_path is not None

    output_path = Path(result.output_path)
    assert output_path.exists()
    assert output_path.parent == tmp_path / ".noesis" / "decision_records" / "sprint-planning-meeting"
    assert output_path.name == "database-technology-choice.md"

    content = output_path.read_text(encoding="utf-8")
    assert content.startswith("# Database Technology Choice")
    assert "## Context" in content
    assert "## Design Concerns" in content
    assert "Technology, QualityAttribute" in content
    assert "## Options" in content
    assert "## Decision" in content
    assert "PostgreSQL was chosen" in content


async def test_store_decision_record_markdown_format(tmp_path, monkeypatch, _preload_cache) -> None:
    monkeypatch.chdir(tmp_path)

    record = json.dumps({
        "context": "Context text here.",
        "design_concerns": ["BusinessRule"],
        "alternative_options": [
            {
                "description": "Option B",
                "rejection_rationale": "Too expensive.",
            },
        ],
        "decision": {
            "description": "Option A was selected.",
            "rationale": "Best cost-to-value ratio.",
            "consequences": "Requires additional training.",
        },
    })

    raw = await _call_tool(
        "store_decision_record",
        {"conversation_id": CONVERSATION_ID, "topic_index": 1, "record": record},
    )
    result = StoreDecisionRecordResponse.model_validate_json(raw)
    content = Path(result.output_path).read_text(encoding="utf-8")

    expected = (
        "# Sprint Goals\n"
        "\n"
        "## Context\n\nContext text here.\n"
        "\n"
        "## Design Concerns\n\nBusinessRule\n"
        "\n"
        "## Options\n"
        "\n"
        "- **Option B** — Too expensive.\n"
        "\n"
        "## Decision\n"
        "\n"
        "Option A was selected.\n"
        "\n"
        "**Rationale:** Best cost-to-value ratio.\n"
        "\n"
        "**Consequences:** Requires additional training.\n"
    )
    assert content == expected


async def test_store_record_missing_keys_raises_error(tmp_path, monkeypatch, _preload_cache) -> None:
    monkeypatch.chdir(tmp_path)

    record = json.dumps({"context": "Some context."})

    assert await _call_tool_expect_error(
        "store_decision_record",
        {"conversation_id": CONVERSATION_ID, "topic_index": 0, "record": record},
    )


async def test_store_record_not_loaded_raises_error(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)

    record = json.dumps({
        "context": "c", "alternative_options": "o", "decision": "d",
    })

    assert await _call_tool_expect_error(
        "store_decision_record",
        {"conversation_id": "not-loaded", "topic_index": 0, "record": record},
    )


async def test_store_record_invalid_topic_index_raises_error(tmp_path, monkeypatch, _preload_cache) -> None:
    monkeypatch.chdir(tmp_path)

    record = json.dumps({
        "context": "c", "alternative_options": "o", "decision": "d",
    })

    assert await _call_tool_expect_error(
        "store_decision_record",
        {"conversation_id": CONVERSATION_ID, "topic_index": 99, "record": record},
    )
