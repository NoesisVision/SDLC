"""Tests for validate_batch.py — sentence, speaker, and time fidelity checks."""

import json
import sys
from pathlib import Path

_SCRIPTS_DIR = (
    Path(__file__).resolve().parents[4] / "src" / "agent_extensions" / "skills" / "extract_decisions" / "scripts"
)
sys.path.insert(0, str(_SCRIPTS_DIR))

from models import (  # noqa: E402
    Batch,
    BatchResultManifest,
    IdeaUnit,
    ProcessedTurn,
    SpeakerTurn,
    StructuredConversation,
    Topic,
)
from validate_batch import validate_batch  # noqa: E402


def _write_batch(work_dir, batch_index, extraction_turns, previous_turn=None):
    batch = Batch(
        previous_turn=previous_turn,
        extraction_turns=[SpeakerTurn(**t) for t in extraction_turns],
        expected_turn_count=len(extraction_turns),
    )
    path = work_dir / "batches" / f"batch_{batch_index:03d}.json"
    path.write_text(json.dumps(batch.model_dump()), encoding="utf-8")


def _write_result_manifest(work_dir, batch_index, processed_turns):
    manifest = BatchResultManifest(
        batch_index=batch_index,
        processed_turns=[ProcessedTurn(**t) for t in processed_turns],
    )
    path = work_dir / "results" / f"batch_{batch_index:03d}.json"
    path.write_text(json.dumps(manifest.model_dump()), encoding="utf-8")


def _write_structured(path, topics):
    structured = StructuredConversation(
        conversation_id="test-conv-id",
        title="Test Conversation",
        date="2025-03-01 14:00",
        topics=[Topic(**t) for t in _prepare_topics(topics)],
    )
    path.write_text(json.dumps(structured.model_dump()), encoding="utf-8")


def _prepare_topics(topics):
    prepared = []
    for t in topics:
        topic = dict(t)
        if "idea_units" in topic:
            topic["idea_units"] = [IdeaUnit(**iu) for iu in topic["idea_units"]]
        prepared.append(topic)
    return prepared


def _make_idea_unit(turn_id, speaker, time, sentences, category="Position"):
    return {
        "turn_id": turn_id,
        "speaker": speaker,
        "time": time,
        "sentences": sentences,
        "category": category,
    }


def test_success_all_turns_assigned(work_dir, tmp_path):
    structured_path = tmp_path / "structured.json"

    _write_batch(
        work_dir,
        0,
        [
            {
                "turn_id": "turn_001",
                "speaker": "Alice",
                "time": "2025-03-01 14:00",
                "sentences": ["We need Postgres.", "It has ACID."],
            },
            {"turn_id": "turn_002", "speaker": "Bob", "time": "2025-03-01 14:02", "sentences": ["I agree."]},
        ],
    )
    _write_result_manifest(
        work_dir,
        0,
        [
            {"turn_id": "turn_001", "status": "assigned", "topic_ids": ["topic_001"]},
            {"turn_id": "turn_002", "status": "assigned", "topic_ids": ["topic_001"]},
        ],
    )
    _write_structured(
        structured_path,
        [
            {
                "topic_id": "topic_001",
                "name": "Database",
                "short_description": "DB choice",
                "long_description": "Choosing a database",
                "idea_units": [
                    _make_idea_unit("turn_001", "Alice", "2025-03-01 14:00", ["We need Postgres.", "It has ACID."]),
                    _make_idea_unit("turn_002", "Bob", "2025-03-01 14:02", ["I agree."], "Agreement"),
                ],
            }
        ],
    )

    result = validate_batch(work_dir, structured_path, 0)
    assert result["status"] == "success"


def test_fabricated_sentence_detected(work_dir, tmp_path):
    structured_path = tmp_path / "structured.json"

    _write_batch(
        work_dir,
        0,
        [
            {"turn_id": "turn_001", "speaker": "Alice", "time": "2025-03-01 14:00", "sentences": ["We need Postgres."]},
        ],
    )
    _write_result_manifest(
        work_dir,
        0,
        [
            {"turn_id": "turn_001", "status": "assigned", "topic_ids": ["topic_001"]},
        ],
    )
    _write_structured(
        structured_path,
        [
            {
                "topic_id": "topic_001",
                "name": "Database",
                "short_description": "DB choice",
                "long_description": "Choosing a database",
                "idea_units": [
                    _make_idea_unit("turn_001", "Alice", "2025-03-01 14:00", ["We need MySQL."]),
                ],
            }
        ],
    )

    result = validate_batch(work_dir, structured_path, 0)
    assert result["status"] == "error"
    assert any("fabricated sentence" in e for e in result["error_details"])


def test_speaker_mismatch_detected(work_dir, tmp_path):
    structured_path = tmp_path / "structured.json"

    _write_batch(
        work_dir,
        0,
        [
            {"turn_id": "turn_001", "speaker": "Alice", "time": "2025-03-01 14:00", "sentences": ["We need Postgres."]},
        ],
    )
    _write_result_manifest(
        work_dir,
        0,
        [
            {"turn_id": "turn_001", "status": "assigned", "topic_ids": ["topic_001"]},
        ],
    )
    _write_structured(
        structured_path,
        [
            {
                "topic_id": "topic_001",
                "name": "Database",
                "short_description": "DB choice",
                "long_description": "Choosing a database",
                "idea_units": [
                    _make_idea_unit("turn_001", "Bob", "2025-03-01 14:00", ["We need Postgres."]),
                ],
            }
        ],
    )

    result = validate_batch(work_dir, structured_path, 0)
    assert result["status"] == "error"
    assert any("speaker mismatch" in e for e in result["error_details"])


def test_time_mismatch_detected(work_dir, tmp_path):
    structured_path = tmp_path / "structured.json"

    _write_batch(
        work_dir,
        0,
        [
            {"turn_id": "turn_001", "speaker": "Alice", "time": "2025-03-01 14:00", "sentences": ["We need Postgres."]},
        ],
    )
    _write_result_manifest(
        work_dir,
        0,
        [
            {"turn_id": "turn_001", "status": "assigned", "topic_ids": ["topic_001"]},
        ],
    )
    _write_structured(
        structured_path,
        [
            {
                "topic_id": "topic_001",
                "name": "Database",
                "short_description": "DB choice",
                "long_description": "Choosing a database",
                "idea_units": [
                    _make_idea_unit("turn_001", "Alice", "2025-03-01 15:00", ["We need Postgres."]),
                ],
            }
        ],
    )

    result = validate_batch(work_dir, structured_path, 0)
    assert result["status"] == "error"
    assert any("time mismatch" in e for e in result["error_details"])


def test_subset_ok_irrelevant_sentences_discarded(work_dir, tmp_path):
    structured_path = tmp_path / "structured.json"

    _write_batch(
        work_dir,
        0,
        [
            {
                "turn_id": "turn_001",
                "speaker": "Alice",
                "time": "2025-03-01 14:00",
                "sentences": ["OK.", "We need Postgres.", "It has ACID."],
            },
        ],
    )
    _write_result_manifest(
        work_dir,
        0,
        [
            {"turn_id": "turn_001", "status": "assigned", "topic_ids": ["topic_001"]},
        ],
    )
    _write_structured(
        structured_path,
        [
            {
                "topic_id": "topic_001",
                "name": "Database",
                "short_description": "DB choice",
                "long_description": "Choosing a database",
                "idea_units": [
                    _make_idea_unit("turn_001", "Alice", "2025-03-01 14:00", ["We need Postgres.", "It has ACID."]),
                ],
            }
        ],
    )

    result = validate_batch(work_dir, structured_path, 0)
    assert result["status"] == "success"


def test_duplicate_sentence_exceeding_source_count(work_dir, tmp_path):
    structured_path = tmp_path / "structured.json"

    _write_batch(
        work_dir,
        0,
        [
            {"turn_id": "turn_001", "speaker": "Alice", "time": "2025-03-01 14:00", "sentences": ["We need Postgres."]},
        ],
    )
    _write_result_manifest(
        work_dir,
        0,
        [
            {"turn_id": "turn_001", "status": "assigned", "topic_ids": ["topic_001", "topic_002"]},
        ],
    )
    _write_structured(
        structured_path,
        [
            {
                "topic_id": "topic_001",
                "name": "Database",
                "short_description": "DB choice",
                "long_description": "Choosing a database",
                "idea_units": [
                    _make_idea_unit("turn_001", "Alice", "2025-03-01 14:00", ["We need Postgres."]),
                ],
            },
            {
                "topic_id": "topic_002",
                "name": "Infrastructure",
                "short_description": "Infra",
                "long_description": "Infrastructure setup",
                "idea_units": [
                    _make_idea_unit("turn_001", "Alice", "2025-03-01 14:00", ["We need Postgres."]),
                ],
            },
        ],
    )

    result = validate_batch(work_dir, structured_path, 0)
    assert result["status"] == "error"
    assert any("appears 2 time(s) in output but only 1 in source" in e for e in result["error_details"])


def test_fully_irrelevant_turn_no_sentences_in_output(work_dir, tmp_path):
    structured_path = tmp_path / "structured.json"

    _write_batch(
        work_dir,
        0,
        [
            {"turn_id": "turn_001", "speaker": "Alice", "time": "2025-03-01 14:00", "sentences": ["OK.", "Sure."]},
        ],
    )
    _write_result_manifest(
        work_dir,
        0,
        [
            {"turn_id": "turn_001", "status": "fully_irrelevant"},
        ],
    )
    _write_structured(structured_path, [])

    result = validate_batch(work_dir, structured_path, 0)
    assert result["status"] == "success"
