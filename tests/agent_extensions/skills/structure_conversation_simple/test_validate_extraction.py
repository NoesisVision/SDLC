"""Tests for validate_extraction.py script."""

import json


def _write_batch(tmp_path, extraction_turns):
    """Write a batch file with the given extraction_turns."""
    batch = {
        "context_turns": None,
        "extraction_turns": extraction_turns,
        "expected_turns_count": len(extraction_turns),
    }
    batch_path = tmp_path / "batch.json"
    batch_path.write_text(json.dumps(batch), encoding="utf-8")
    return batch_path


def _write_extraction(tmp_path, data, filename="extraction.json"):
    """Write an extraction result file."""
    extraction_path = tmp_path / filename
    if isinstance(data, str):
        extraction_path.write_text(data, encoding="utf-8")
    else:
        extraction_path.write_text(json.dumps(data), encoding="utf-8")
    return extraction_path


def test_validate_success(tmp_path, scripts_dir, run_script):
    turns = [
        {"speaker": "Alice", "time": "10:00", "sentences": ["Hello.", "How are you?"]},
    ]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {
            "idea_units": [
                {"sentences": ["Hello.", "How are you?"], "category": "Irrelevant", "topic": None},
            ]
        }
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "success"


def test_validate_turn_count_mismatch(tmp_path, scripts_dir, run_script):
    turns = [
        {"speaker": "Alice", "time": "10:00", "sentences": ["Hello."]},
        {"speaker": "Bob", "time": "10:01", "sentences": ["Hi."]},
    ]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {"idea_units": [{"sentences": ["Hello."], "category": "Irrelevant", "topic": None}]}
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "Turn count mismatch" in result["error_details"]


def test_validate_invalid_category(tmp_path, scripts_dir, run_script):
    turns = [{"speaker": "Alice", "time": "10:00", "sentences": ["Hello."]}]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {"idea_units": [{"sentences": ["Hello."], "category": "InvalidCategory", "topic": "Greeting"}]}
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "Invalid category" in result["error_details"]


def test_validate_missing_sentences(tmp_path, scripts_dir, run_script):
    turns = [{"speaker": "Alice", "time": "10:00", "sentences": ["Hello.", "Goodbye."]}]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {"idea_units": [{"sentences": ["Hello."], "category": "Irrelevant", "topic": None}]}
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "missing sentences" in result["error_details"]


def test_validate_extra_sentences(tmp_path, scripts_dir, run_script):
    turns = [{"speaker": "Alice", "time": "10:00", "sentences": ["Hello."]}]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {"idea_units": [{"sentences": ["Hello.", "Extra."], "category": "Irrelevant", "topic": None}]}
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "extra sentences" in result["error_details"]


def test_validate_irrelevant_with_topic(tmp_path, scripts_dir, run_script):
    turns = [{"speaker": "Alice", "time": "10:00", "sentences": ["Hello."]}]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {"idea_units": [{"sentences": ["Hello."], "category": "Irrelevant", "topic": "Greeting"}]}
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "must have topic as null" in result["error_details"]


def test_validate_non_irrelevant_without_topic(tmp_path, scripts_dir, run_script):
    turns = [{"speaker": "Alice", "time": "10:00", "sentences": ["We should use Postgres."]}]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {"idea_units": [{"sentences": ["We should use Postgres."], "category": "Position", "topic": None}]}
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "topic" in result["error_details"].lower()


def test_validate_json_with_code_fence(tmp_path, scripts_dir, run_script):
    turns = [{"speaker": "Alice", "time": "10:00", "sentences": ["Hello."]}]
    batch_path = _write_batch(tmp_path, turns)

    extraction_text = '```json\n[{"idea_units": [{"sentences": ["Hello."], "category": "Irrelevant", "topic": null}]}]\n```'
    extraction_path = _write_extraction(tmp_path, extraction_text)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "success"


def test_validate_invalid_json(tmp_path, scripts_dir, run_script):
    turns = [{"speaker": "Alice", "time": "10:00", "sentences": ["Hello."]}]
    batch_path = _write_batch(tmp_path, turns)

    extraction_path = _write_extraction(tmp_path, "this is not json {{{")

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "JSON parse error" in result["error_details"]
