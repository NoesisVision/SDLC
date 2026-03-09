"""Tests for init_decision_records.py — directory creation and topic ID extraction."""

import json
import sys
from pathlib import Path

import pytest

_SCRIPTS_DIR = (
    Path(__file__).resolve().parents[4] / "src" / "agent_extensions" / "skills" / "extract_decisions" / "scripts"
)
sys.path.insert(0, str(_SCRIPTS_DIR))

from init_decision_records import ScriptError, init_decision_records  # noqa: E402
from models import StructuredConversation, Topic  # noqa: E402


def _write_structured(path, topics):
    structured = StructuredConversation(
        conversation_id="test-conv-id",
        title="Test Conversation",
        date="2025-03-01 14:00",
        topics=[Topic(**t) for t in topics],
    )
    path.write_text(json.dumps(structured.model_dump()), encoding="utf-8")


def test_creates_directory_and_returns_topic_ids(tmp_path):
    structured_path = tmp_path / "meeting_structured.json"
    _write_structured(
        structured_path,
        [
            {"topic_id": "topic_001", "name": "A", "short_description": "", "long_description": "", "idea_units": []},
            {"topic_id": "topic_002", "name": "B", "short_description": "", "long_description": "", "idea_units": []},
        ],
    )

    result = init_decision_records(structured_path)

    assert result["status"] == "success"
    assert result["topic_ids"] == ["topic_001", "topic_002"]
    decisions_dir = Path(result["decisions_dir"])
    assert decisions_dir.exists()
    assert decisions_dir.is_dir()


def test_directory_name_derived_from_structured_path(tmp_path):
    structured_path = tmp_path / "sprint_review_structured.json"
    _write_structured(structured_path, [])

    result = init_decision_records(structured_path)

    decisions_dir = Path(result["decisions_dir"])
    assert decisions_dir.name == "sprint_review_decisions"
    assert decisions_dir.parent == tmp_path


def test_idempotent_directory_creation(tmp_path):
    structured_path = tmp_path / "meeting_structured.json"
    _write_structured(
        structured_path,
        [
            {"topic_id": "topic_001", "name": "A", "short_description": "", "long_description": "", "idea_units": []},
        ],
    )

    result1 = init_decision_records(structured_path)
    result2 = init_decision_records(structured_path)

    assert result1["decisions_dir"] == result2["decisions_dir"]
    assert Path(result2["decisions_dir"]).exists()


def test_file_not_found(tmp_path):
    missing_path = tmp_path / "nonexistent_structured.json"

    with pytest.raises(ScriptError, match="not found"):
        init_decision_records(missing_path)


def test_empty_topics_returns_empty_list(tmp_path):
    structured_path = tmp_path / "empty_structured.json"
    _write_structured(structured_path, [])

    result = init_decision_records(structured_path)

    assert result["status"] == "success"
    assert result["topic_ids"] == []
