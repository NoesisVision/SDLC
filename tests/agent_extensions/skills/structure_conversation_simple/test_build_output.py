"""Tests for build_output.py script."""

import json
from pathlib import Path


def _setup_work_dir(tmp_path, turns, extraction_batches, merged_topics):
    """Set up work_dir with parsed.json, extractions, and merged_topics.json."""
    work_dir = tmp_path / "conversations" / "test-id"
    work_dir.mkdir(parents=True)

    parsed = {
        "conversation_id": "test-id",
        "title": "Test Meeting",
        "date": "2025-01-01 10:00",
        "language": "en",
        "source_path": "/tmp/test.md",
        "source_stem": "test",
        "turns": turns,
    }
    (work_dir / "parsed.json").write_text(json.dumps(parsed), encoding="utf-8")
    (work_dir / "merged_topics.json").write_text(json.dumps(merged_topics), encoding="utf-8")

    extractions_dir = work_dir / "extractions"
    extractions_dir.mkdir()
    for i, batch in enumerate(extraction_batches):
        (extractions_dir / f"batch_{i}.json").write_text(json.dumps(batch), encoding="utf-8")

    return work_dir


def test_build_basic_output(tmp_path, scripts_dir, run_script):
    turns = [
        {"speaker": "Alice", "time": "10:00", "sentences": ["Use Postgres."]},
    ]
    extraction_batches = [
        [{"idea_units": [{"sentences": ["Use Postgres."], "category": "Position", "topic": "Database"}]}]
    ]
    merged_topics = {
        "topics": [{"label": "Database", "summary": "Discussion about DB choice", "source_labels": ["Database"]}]
    }
    work_dir = _setup_work_dir(tmp_path, turns, extraction_batches, merged_topics)

    code, result, _ = run_script(scripts_dir / "build_output.py", [str(work_dir)])

    assert code == 0
    assert result["status"] == "success"

    output = json.loads(open(result["output_path"]).read())
    assert output["conversation_id"] == "test-id"
    assert output["title"] == "Test Meeting"
    assert output["date"] == "2025-01-01 10:00"
    assert len(output["topics"]) == 1
    assert output["topics"][0]["name"] == "Database"


def test_build_with_topic_merging(tmp_path, scripts_dir, run_script):
    turns = [
        {"speaker": "Alice", "time": "10:00", "sentences": ["Use Postgres."]},
        {"speaker": "Bob", "time": "10:01", "sentences": ["PostgreSQL is great."]},
    ]
    extraction_batches = [
        [
            {"idea_units": [{"sentences": ["Use Postgres."], "category": "Position", "topic": "DB Choice"}]},
            {"idea_units": [{"sentences": ["PostgreSQL is great."], "category": "Argument", "topic": "SQL Databases"}]},
        ]
    ]
    merged_topics = {
        "topics": [
            {
                "label": "Database Technology",
                "summary": "Discussion about database selection",
                "source_labels": ["DB Choice", "SQL Databases"],
            }
        ]
    }
    work_dir = _setup_work_dir(tmp_path, turns, extraction_batches, merged_topics)

    code, result, _ = run_script(scripts_dir / "build_output.py", [str(work_dir)])

    assert code == 0
    output = json.loads(open(result["output_path"]).read())
    assert len(output["topics"]) == 1
    assert output["topics"][0]["name"] == "Database Technology"
    assert len(output["topics"][0]["statements"]) == 2


def test_build_groups_by_speaker_time(tmp_path, scripts_dir, run_script):
    turns = [
        {"speaker": "Alice", "time": "10:00", "sentences": ["Use Postgres.", "It has ACID."]},
    ]
    extraction_batches = [
        [
            {
                "idea_units": [
                    {"sentences": ["Use Postgres."], "category": "Position", "topic": "Database"},
                    {"sentences": ["It has ACID."], "category": "Argument", "topic": "Database"},
                ]
            }
        ]
    ]
    merged_topics = {
        "topics": [{"label": "Database", "summary": "DB discussion", "source_labels": ["Database"]}]
    }
    work_dir = _setup_work_dir(tmp_path, turns, extraction_batches, merged_topics)

    code, result, _ = run_script(scripts_dir / "build_output.py", [str(work_dir)])

    assert code == 0
    output = json.loads(open(result["output_path"]).read())
    topic = output["topics"][0]
    assert len(topic["statements"]) == 1
    assert topic["statements"][0]["speaker"] == "Alice"
    assert topic["statements"][0]["time"] == "10:00"
    assert len(topic["statements"][0]["idea_units"]) == 2


def test_build_output_file_location(tmp_path, scripts_dir, run_script):
    turns = [
        {"speaker": "Alice", "time": "10:00", "sentences": ["Hello."]},
    ]
    extraction_batches = [
        [{"idea_units": [{"sentences": ["Hello."], "category": "Position", "topic": "Greeting"}]}]
    ]
    merged_topics = {
        "topics": [{"label": "Greeting", "summary": "Greetings", "source_labels": ["Greeting"]}]
    }
    work_dir = _setup_work_dir(tmp_path, turns, extraction_batches, merged_topics)

    code, result, _ = run_script(scripts_dir / "build_output.py", [str(work_dir)])

    assert code == 0
    output_path = Path(result["output_path"])
    assert output_path.exists()
    assert output_path.name == "test_structured.json"


def test_build_missing_merged_topics(tmp_path, scripts_dir, run_script):
    work_dir = tmp_path / "conversations" / "test-id"
    work_dir.mkdir(parents=True)

    parsed = {
        "conversation_id": "test-id",
        "title": "Test",
        "date": "2025-01-01 10:00",
        "language": "en",
        "source_path": "/tmp/test.md",
        "source_stem": "test",
        "turns": [{"speaker": "Alice", "time": "10:00", "sentences": ["Hello."]}],
    }
    (work_dir / "parsed.json").write_text(json.dumps(parsed), encoding="utf-8")

    extractions_dir = work_dir / "extractions"
    extractions_dir.mkdir()
    (extractions_dir / "batch_0.json").write_text(
        json.dumps([{"idea_units": [{"sentences": ["Hello."], "category": "Irrelevant", "topic": None}]}]),
        encoding="utf-8",
    )

    code, result, _ = run_script(scripts_dir / "build_output.py", [str(work_dir)])

    assert code == 1
    assert result["status"] == "error"
