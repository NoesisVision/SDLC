"""Tests for load_topic_data.py — loading full topic data including idea units."""

import pytest

from helpers import make_idea_unit, write_structured
from load_topic_data import load_topic_data


def test_loads_existing_topic(tmp_path):
    structured_path = tmp_path / "structured.json"
    idea_units = [
        make_idea_unit("turn_001", "Alice", "2025-03-01 14:00", ["We need Postgres."], "Decision"),
        make_idea_unit("turn_002", "Bob", "2025-03-01 14:02", ["I agree."], "Agreement"),
    ]
    write_structured(
        structured_path,
        [
            {
                "topic_id": "topic_001",
                "name": "Database",
                "summary": "DB choice",
                "description": "Choosing a database",
                "idea_units": idea_units,
            }
        ],
    )

    result = load_topic_data(structured_path, "topic_001")

    assert result["status"] == "success"
    assert result["topic"]["topic_id"] == "topic_001"
    assert result["topic"]["name"] == "Database"
    assert result["topic"]["summary"] == "DB choice"
    assert result["topic"]["description"] == "Choosing a database"
    assert len(result["topic"]["idea_units"]) == 2
    assert result["topic"]["idea_units"][0]["category"] == "Decision"


def test_topic_not_found(tmp_path):
    structured_path = tmp_path / "structured.json"
    write_structured(
        structured_path,
        [
            {
                "topic_id": "topic_001",
                "name": "Database",
                "summary": "DB choice",
                "description": "Choosing a database",
                "idea_units": [],
            }
        ],
    )

    with pytest.raises(Exception, match="Topic not found"):
        load_topic_data(structured_path, "topic_999")


def test_file_not_found(tmp_path):
    missing_path = tmp_path / "nonexistent.json"

    with pytest.raises(Exception, match="not found"):
        load_topic_data(missing_path, "topic_001")


def test_idea_units_included_in_output(tmp_path):
    structured_path = tmp_path / "structured.json"
    idea_units = [
        make_idea_unit("turn_001", "Alice", "2025-03-01 14:00", ["Use REST API."], "Position"),
        make_idea_unit("turn_002", "Bob", "2025-03-01 14:05", ["GraphQL is better."], "Position"),
        make_idea_unit("turn_003", "Alice", "2025-03-01 14:10", ["Let's go with REST."], "Decision"),
    ]
    write_structured(
        structured_path,
        [
            {
                "topic_id": "topic_002",
                "name": "API Design",
                "summary": "API approach",
                "description": "Choosing API design approach",
                "idea_units": idea_units,
            }
        ],
    )

    result = load_topic_data(structured_path, "topic_002")

    assert result["status"] == "success"
    assert len(result["topic"]["idea_units"]) == 3
    categories = [u["category"] for u in result["topic"]["idea_units"]]
    assert categories == ["Position", "Position", "Decision"]
