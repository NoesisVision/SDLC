"""Tests for collect_topic_groups.py script."""

import json


def _setup_work_dir(tmp_path, turns, extraction_batches):
    """Set up work_dir with parsed.json and extraction files."""
    work_dir = tmp_path / "work"
    work_dir.mkdir()

    parsed = {
        "conversation_id": "test-id",
        "title": "Test",
        "date": "2025-01-01",
        "language": "en",
        "source_path": "/tmp/test.md",
        "source_stem": "test",
        "turns": turns,
    }
    (work_dir / "parsed.json").write_text(json.dumps(parsed), encoding="utf-8")

    extractions_dir = work_dir / "extractions"
    extractions_dir.mkdir()
    for i, batch in enumerate(extraction_batches):
        (extractions_dir / f"batch_{i}.json").write_text(json.dumps(batch), encoding="utf-8")

    return work_dir


def test_collect_groups_by_topic(tmp_path, scripts_dir, run_script):
    turns = [
        {"speaker": "Alice", "time": "10:00", "sentences": ["We should use Postgres."]},
        {"speaker": "Bob", "time": "10:01", "sentences": ["I agree with Postgres."]},
    ]
    extraction_batches = [
        [
            {"idea_units": [{"sentences": ["We should use Postgres."], "category": "Position", "topic": "Database Choice"}]},
            {"idea_units": [{"sentences": ["I agree with Postgres."], "category": "Argument", "topic": "Database Choice"}]},
        ]
    ]
    work_dir = _setup_work_dir(tmp_path, turns, extraction_batches)

    code, result, _ = run_script(scripts_dir / "collect_topic_groups.py", [str(work_dir)])

    assert code == 0
    assert result["status"] == "success"
    assert result["topic_group_count"] == 1

    topic_groups = json.loads((work_dir / "topic_groups.json").read_text())
    group = topic_groups["topic_groups"][0]
    assert group["label"] == "Database Choice"
    assert group["count"] == 2


def test_collect_ignores_irrelevant(tmp_path, scripts_dir, run_script):
    turns = [
        {"speaker": "Alice", "time": "10:00", "sentences": ["Hello.", "We should use Postgres."]},
    ]
    extraction_batches = [
        [
            {
                "idea_units": [
                    {"sentences": ["Hello."], "category": "Irrelevant", "topic": None},
                    {"sentences": ["We should use Postgres."], "category": "Position", "topic": "Database Choice"},
                ]
            }
        ]
    ]
    work_dir = _setup_work_dir(tmp_path, turns, extraction_batches)

    code, result, _ = run_script(scripts_dir / "collect_topic_groups.py", [str(work_dir)])

    assert code == 0
    assert result["topic_group_count"] == 1

    topic_groups = json.loads((work_dir / "topic_groups.json").read_text())
    assert len(topic_groups["topic_groups"]) == 1
    assert topic_groups["topic_groups"][0]["label"] == "Database Choice"


def test_collect_multiple_topics(tmp_path, scripts_dir, run_script):
    turns = [
        {"speaker": "Alice", "time": "10:00", "sentences": ["Use Postgres."]},
        {"speaker": "Bob", "time": "10:01", "sentences": ["Use Docker."]},
    ]
    extraction_batches = [
        [
            {"idea_units": [{"sentences": ["Use Postgres."], "category": "Position", "topic": "Database Choice"}]},
            {"idea_units": [{"sentences": ["Use Docker."], "category": "Position", "topic": "Deployment"}]},
        ]
    ]
    work_dir = _setup_work_dir(tmp_path, turns, extraction_batches)

    code, result, _ = run_script(scripts_dir / "collect_topic_groups.py", [str(work_dir)])

    assert code == 0
    assert result["topic_group_count"] == 2

    topic_groups = json.loads((work_dir / "topic_groups.json").read_text())
    labels = {g["label"] for g in topic_groups["topic_groups"]}
    assert labels == {"Database Choice", "Deployment"}


def test_collect_representative_texts_capped(tmp_path, scripts_dir, run_script):
    turns = [
        {"speaker": f"Speaker{i}", "time": f"10:{i:02d}", "sentences": [f"Statement {i}."]}
        for i in range(10)
    ]
    extraction_batches = [
        [
            {"idea_units": [{"sentences": [f"Statement {i}."], "category": "Position", "topic": "Same Topic"}]}
            for i in range(10)
        ]
    ]
    work_dir = _setup_work_dir(tmp_path, turns, extraction_batches)

    code, result, _ = run_script(scripts_dir / "collect_topic_groups.py", [str(work_dir)])

    assert code == 0
    topic_groups = json.loads((work_dir / "topic_groups.json").read_text())
    group = topic_groups["topic_groups"][0]
    assert group["count"] == 10
    assert len(group["representative_texts"]) == 5


def test_collect_no_extractions(tmp_path, scripts_dir, run_script):
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    parsed = {
        "conversation_id": "test-id",
        "title": "Test",
        "date": "2025-01-01",
        "language": "en",
        "source_path": "/tmp/test.md",
        "source_stem": "test",
        "turns": [{"speaker": "Alice", "time": "10:00", "sentences": ["Hello."]}],
    }
    (work_dir / "parsed.json").write_text(json.dumps(parsed), encoding="utf-8")
    (work_dir / "extractions").mkdir()

    code, result, _ = run_script(scripts_dir / "collect_topic_groups.py", [str(work_dir)])

    assert code == 1
    assert result["status"] == "error"
