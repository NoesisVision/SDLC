"""Tests for prepare_batches.py script."""

import json


def _create_parsed_json(work_dir, num_turns):
    """Create a parsed.json with the specified number of turns."""
    turns = [
        {
            "turn_id": f"turn_{i + 1:03d}",
            "speaker": f"Speaker{i % 2 + 1}",
            "time": f"10:{i:02d}",
            "sentences": [f"Sentence {i}."],
        }
        for i in range(num_turns)
    ]
    parsed = {
        "conversation_id": "test-id",
        "title": "Test",
        "date": "2025-01-01",
        "language": "en",
        "source_path": "/tmp/test.md",
        "source_stem": "test",
        "turns": turns,
    }
    work_dir.mkdir(parents=True, exist_ok=True)
    (work_dir / "parsed.json").write_text(json.dumps(parsed), encoding="utf-8")


def test_prepare_single_batch(tmp_path, scripts_dir, run_script):
    work_dir = tmp_path / "work"
    _create_parsed_json(work_dir, 5)

    code, result, _ = run_script(scripts_dir / "prepare_batches.py", [str(work_dir)])

    assert code == 0
    assert result["status"] == "success"
    assert result["batch_count"] == 1

    batch_0 = json.loads((work_dir / "batches" / "batch_000.json").read_text())
    assert batch_0["context_turns"] is None
    assert batch_0["expected_turns_count"] == 5

    for turn in batch_0["extraction_turns"]:
        assert "turn_id" in turn


def test_prepare_multiple_batches_with_overlap(tmp_path, scripts_dir, run_script):
    work_dir = tmp_path / "work"
    _create_parsed_json(work_dir, 60)

    code, result, _ = run_script(scripts_dir / "prepare_batches.py", [str(work_dir)])

    assert code == 0
    assert result["batch_count"] == 3

    batch_1 = json.loads((work_dir / "batches" / "batch_001.json").read_text())
    assert batch_1["context_turns"] is not None
    assert len(batch_1["context_turns"]) == 5

    for turn in batch_1["extraction_turns"]:
        assert "turn_id" in turn
    for turn in batch_1["context_turns"]:
        assert "turn_id" in turn


def test_prepare_exact_batch_size(tmp_path, scripts_dir, run_script):
    work_dir = tmp_path / "work"
    _create_parsed_json(work_dir, 25)

    code, result, _ = run_script(scripts_dir / "prepare_batches.py", [str(work_dir)])

    assert code == 0
    assert result["batch_count"] == 1

    batch_0 = json.loads((work_dir / "batches" / "batch_000.json").read_text())
    assert batch_0["expected_turns_count"] == 25


def test_prepare_missing_parsed_json(tmp_path, scripts_dir, run_script):
    work_dir = tmp_path / "work"
    work_dir.mkdir(parents=True)

    code, result, _ = run_script(scripts_dir / "prepare_batches.py", [str(work_dir)])

    assert code == 1
    assert result["status"] == "error"
