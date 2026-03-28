"""Tests for init_decision_records.py — directory creation and topic ID extraction."""

from pathlib import Path

import pytest

from helpers import write_structured
from init_decision_records import init_decision_records


def test_creates_directory_and_returns_topic_ids(tmp_path):
    structured_path = tmp_path / "meeting_structured.json"
    write_structured(
        structured_path,
        [
            {"topic_id": "topic_001", "name": "A", "summary": "", "description": "", "idea_units": []},
            {"topic_id": "topic_002", "name": "B", "summary": "", "description": "", "idea_units": []},
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
    write_structured(structured_path, [])

    result = init_decision_records(structured_path)

    decisions_dir = Path(result["decisions_dir"])
    assert decisions_dir.name == "sprint_review_decisions"
    assert decisions_dir.parent == tmp_path


def test_idempotent_directory_creation(tmp_path):
    structured_path = tmp_path / "meeting_structured.json"
    write_structured(
        structured_path,
        [
            {"topic_id": "topic_001", "name": "A", "summary": "", "description": "", "idea_units": []},
        ],
    )

    result1 = init_decision_records(structured_path)
    result2 = init_decision_records(structured_path)

    assert result1["decisions_dir"] == result2["decisions_dir"]
    assert Path(result2["decisions_dir"]).exists()


def test_file_not_found(tmp_path):
    missing_path = tmp_path / "nonexistent_structured.json"

    with pytest.raises(Exception, match="not found"):
        init_decision_records(missing_path)


def test_empty_topics_returns_empty_list(tmp_path):
    structured_path = tmp_path / "empty_structured.json"
    write_structured(structured_path, [])

    result = init_decision_records(structured_path)

    assert result["status"] == "success"
    assert result["topic_ids"] == []
