"""Tests for save_decision_record.py — validation and file saving."""

import json
import sys
from pathlib import Path

import pytest

_SCRIPTS_DIR = (
    Path(__file__).resolve().parents[4] / "src" / "agent_extensions" / "skills" / "extract_decisions" / "scripts"
)
sys.path.insert(0, str(_SCRIPTS_DIR))

from save_decision_record import save_decision_record  # noqa: E402


def _valid_record():
    return {
        "topic_id": "topic_001",
        "topic_name": "Database Choice",
        "context": "Team needed to choose a database for the new service.",
        "decision": {
            "description": "Use PostgreSQL as the primary database",
            "rationale": "Strong ACID compliance and JSON support",
            "consequences": "Requires PostgreSQL expertise on the team",
        },
        "alternative_options": [
            {
                "description": "Use MongoDB for flexible schema",
                "rejection_rationale": "Lack of ACID guarantees for transactions",
            }
        ],
        "design_concerns": ["Technology"],
    }


def _write_input(tmp_path, record, filename="record.json"):
    input_file = tmp_path / filename
    input_file.write_text(json.dumps(record), encoding="utf-8")
    return input_file


def test_saves_valid_record(tmp_path):
    output_dir = tmp_path / "decisions"
    output_dir.mkdir()
    input_file = _write_input(tmp_path, _valid_record())

    result = save_decision_record(output_dir, "topic_001", input_file)

    assert result["status"] == "success"
    assert result["decision_index"] == 1
    saved_path = Path(result["file_path"])
    assert saved_path.exists()
    assert saved_path.name == "topic_001_decision_001.json"

    saved_data = json.loads(saved_path.read_text(encoding="utf-8"))
    assert saved_data["topic_id"] == "topic_001"
    assert saved_data["decision"]["description"] == "Use PostgreSQL as the primary database"


def test_sequential_numbering(tmp_path):
    output_dir = tmp_path / "decisions"
    output_dir.mkdir()

    for i in range(3):
        record = _valid_record()
        record["decision"]["description"] = f"Decision {i + 1}"
        input_file = _write_input(tmp_path, record, f"record_{i}.json")
        result = save_decision_record(output_dir, "topic_001", input_file)
        assert result["decision_index"] == i + 1

    assert (output_dir / "topic_001_decision_001.json").exists()
    assert (output_dir / "topic_001_decision_002.json").exists()
    assert (output_dir / "topic_001_decision_003.json").exists()


def test_missing_required_field(tmp_path):
    output_dir = tmp_path / "decisions"
    output_dir.mkdir()

    record = _valid_record()
    del record["context"]
    input_file = _write_input(tmp_path, record)

    with pytest.raises(Exception):
        save_decision_record(output_dir, "topic_001", input_file)


def test_invalid_design_concern(tmp_path):
    output_dir = tmp_path / "decisions"
    output_dir.mkdir()

    record = _valid_record()
    record["design_concerns"] = ["Technology", "InvalidConcern"]
    input_file = _write_input(tmp_path, record)

    with pytest.raises(Exception):
        save_decision_record(output_dir, "topic_001", input_file)


def test_empty_alternatives_ok(tmp_path):
    output_dir = tmp_path / "decisions"
    output_dir.mkdir()

    record = _valid_record()
    record["alternative_options"] = []
    input_file = _write_input(tmp_path, record)

    result = save_decision_record(output_dir, "topic_001", input_file)
    assert result["status"] == "success"


def test_missing_decision_field(tmp_path):
    output_dir = tmp_path / "decisions"
    output_dir.mkdir()

    record = _valid_record()
    del record["decision"]["rationale"]
    input_file = _write_input(tmp_path, record)

    with pytest.raises(Exception):
        save_decision_record(output_dir, "topic_001", input_file)


def test_separate_numbering_per_topic(tmp_path):
    output_dir = tmp_path / "decisions"
    output_dir.mkdir()

    record_a = _valid_record()
    record_a["topic_id"] = "topic_001"
    input_a = _write_input(tmp_path, record_a, "a.json")
    result_a = save_decision_record(output_dir, "topic_001", input_a)

    record_b = _valid_record()
    record_b["topic_id"] = "topic_002"
    input_b = _write_input(tmp_path, record_b, "b.json")
    result_b = save_decision_record(output_dir, "topic_002", input_b)

    assert result_a["decision_index"] == 1
    assert result_b["decision_index"] == 1
    assert (output_dir / "topic_001_decision_001.json").exists()
    assert (output_dir / "topic_002_decision_001.json").exists()
