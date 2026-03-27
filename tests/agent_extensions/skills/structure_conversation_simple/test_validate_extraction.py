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
        {"turn_id": "turn_001", "speaker": "Alice", "time": "10:00", "sentences": ["Hello.", "How are you?"]},
    ]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {
            "turn_id": "turn_001",
            "idea_units": [
                {"sentences": ["Hello.", "How are you?"], "category": "Irrelevant", "topic": None},
            ],
        }
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "success"


def test_validate_missing_turn_id(tmp_path, scripts_dir, run_script):
    turns = [
        {"turn_id": "turn_001", "speaker": "Alice", "time": "10:00", "sentences": ["Hello."]},
        {"turn_id": "turn_002", "speaker": "Bob", "time": "10:01", "sentences": ["Hi."]},
    ]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {"turn_id": "turn_001", "idea_units": [{"sentences": ["Hello."], "category": "Irrelevant", "topic": None}]},
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "Missing output for turn_ids" in result["error_details"]
    assert "turn_002" in result["error_details"]


def test_validate_extra_turn_id(tmp_path, scripts_dir, run_script):
    turns = [
        {"turn_id": "turn_001", "speaker": "Alice", "time": "10:00", "sentences": ["Hello."]},
    ]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {"turn_id": "turn_001", "idea_units": [{"sentences": ["Hello."], "category": "Irrelevant", "topic": None}]},
        {"turn_id": "turn_099", "idea_units": [{"sentences": ["Fake."], "category": "Irrelevant", "topic": None}]},
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "Unexpected turn_ids" in result["error_details"]
    assert "turn_099" in result["error_details"]


def test_validate_duplicate_turn_id(tmp_path, scripts_dir, run_script):
    turns = [
        {"turn_id": "turn_001", "speaker": "Alice", "time": "10:00", "sentences": ["Hello."]},
        {"turn_id": "turn_002", "speaker": "Bob", "time": "10:01", "sentences": ["Hi."]},
    ]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {"turn_id": "turn_001", "idea_units": [{"sentences": ["Hello."], "category": "Irrelevant", "topic": None}]},
        {"turn_id": "turn_001", "idea_units": [{"sentences": ["Hi."], "category": "Irrelevant", "topic": None}]},
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "Duplicate turn_id" in result["error_details"]
    assert "turn_001" in result["error_details"]


def test_validate_no_turn_id_in_output(tmp_path, scripts_dir, run_script):
    turns = [
        {"turn_id": "turn_001", "speaker": "Alice", "time": "10:00", "sentences": ["Hello."]},
    ]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {"idea_units": [{"sentences": ["Hello."], "category": "Irrelevant", "topic": None}]},
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "must include a 'turn_id' field" in result["error_details"]


def test_validate_invalid_category(tmp_path, scripts_dir, run_script):
    turns = [{"turn_id": "turn_001", "speaker": "Alice", "time": "10:00", "sentences": ["Hello."]}]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {"turn_id": "turn_001", "idea_units": [{"sentences": ["Hello."], "category": "InvalidCategory", "topic": "Greeting"}]}
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "Invalid category" in result["error_details"]


def test_validate_sentence_mismatch(tmp_path, scripts_dir, run_script):
    turns = [{"turn_id": "turn_001", "speaker": "Alice", "time": "10:00", "sentences": ["Hello.", "Goodbye."]}]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {"turn_id": "turn_001", "idea_units": [{"sentences": ["Hello."], "category": "Irrelevant", "topic": None}]}
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "Validation Failed in turn_id 'turn_001'" in result["error_details"]
    assert "do not exactly match" in result["error_details"].lower()


def test_validate_irrelevant_with_topic(tmp_path, scripts_dir, run_script):
    turns = [{"turn_id": "turn_001", "speaker": "Alice", "time": "10:00", "sentences": ["Hello."]}]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {"turn_id": "turn_001", "idea_units": [{"sentences": ["Hello."], "category": "Irrelevant", "topic": "Greeting"}]}
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "must have topic as null" in result["error_details"]


def test_validate_non_irrelevant_without_topic(tmp_path, scripts_dir, run_script):
    turns = [{"turn_id": "turn_001", "speaker": "Alice", "time": "10:00", "sentences": ["We should use Postgres."]}]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {"turn_id": "turn_001", "idea_units": [{"sentences": ["We should use Postgres."], "category": "Position", "topic": None}]}
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "topic" in result["error_details"].lower()


def test_validate_json_with_code_fence(tmp_path, scripts_dir, run_script):
    turns = [{"turn_id": "turn_001", "speaker": "Alice", "time": "10:00", "sentences": ["Hello."]}]
    batch_path = _write_batch(tmp_path, turns)

    extraction_text = '```json\n[{"turn_id": "turn_001", "idea_units": [{"sentences": ["Hello."], "category": "Irrelevant", "topic": null}]}]\n```'
    extraction_path = _write_extraction(tmp_path, extraction_text)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "success"


def test_validate_invalid_json(tmp_path, scripts_dir, run_script):
    turns = [{"turn_id": "turn_001", "speaker": "Alice", "time": "10:00", "sentences": ["Hello."]}]
    batch_path = _write_batch(tmp_path, turns)

    extraction_path = _write_extraction(tmp_path, "this is not json {{{")

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "validation_failed"
    assert "JSON parse error" in result["error_details"]


def test_validate_information_category(tmp_path, scripts_dir, run_script):
    turns = [{"turn_id": "turn_001", "speaker": "Alice", "time": "10:00", "sentences": ["The system currently uses MySQL."]}]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {
            "turn_id": "turn_001",
            "idea_units": [
                {"sentences": ["The system currently uses MySQL."], "category": "Information", "topic": "Current Stack"},
            ],
        }
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "success"


def test_validate_agreement_category(tmp_path, scripts_dir, run_script):
    turns = [{"turn_id": "turn_001", "speaker": "Bob", "time": "10:01", "sentences": ["Yes, I agree completely."]}]
    batch_path = _write_batch(tmp_path, turns)

    extraction = [
        {
            "turn_id": "turn_001",
            "idea_units": [
                {"sentences": ["Yes, I agree completely."], "category": "Agreement", "topic": "Database Choice"},
            ],
        }
    ]
    extraction_path = _write_extraction(tmp_path, extraction)

    code, result, _ = run_script(
        scripts_dir / "validate_extraction.py", [str(batch_path), str(extraction_path)]
    )

    assert code == 0
    assert result["status"] == "success"
