# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Validate and prepare batch extraction results for merging."""

import argparse
import json
from collections import Counter
from pathlib import Path

from models import Batch, BatchResultsInput, IdeaUnit
from pydantic import ValidationError


def validate_batch_result(work_dir: Path, batch_index: int) -> dict:
    """Validate batch results against the source batch.

    Args:
        work_dir: Working directory containing batch and temporary result files.
        batch_index: Index of the batch to validate against.

    Returns:
        Status dict with validation result and any error details.
    """
    tmp_path = work_dir / "tmp_batch_results.json"
    if not tmp_path.exists():
        raise Exception(f"Temporary results file not found: {tmp_path}")

    batch_path = work_dir / "batches" / f"batch_{batch_index:03d}.json"
    if not batch_path.exists():
        raise Exception(f"Batch file not found: {batch_path}")

    try:
        batch_results = BatchResultsInput.model_validate_json(tmp_path.read_text(encoding="utf-8"))
    except ValidationError as e:
        raise Exception(f"Invalid batch results schema: {e}") from e

    batch = Batch.model_validate_json(batch_path.read_text(encoding="utf-8"))

    source_counts = _build_source_sentence_counts(batch)
    result_counts = _build_result_sentence_counts(batch_results)

    errors = _check_sentence_completeness(source_counts, result_counts)
    errors.extend(_check_no_fabricated_sentences(source_counts, result_counts))
    errors.extend(_check_metadata_fidelity(batch, batch_results))

    if errors:
        return {"status": "error", "error_details": errors}

    return {"status": "success"}


def _build_source_sentence_counts(batch: Batch) -> Counter[str]:
    counts: Counter[str] = Counter()
    for turn in batch.extraction_turns:
        counts.update(turn.sentences)
    return counts


def _build_result_sentence_counts(batch_results: BatchResultsInput) -> Counter[str]:
    counts: Counter[str] = Counter()
    for group in batch_results.idea_units:
        for unit in group.units:
            counts.update(unit.sentences)
    for unit in batch_results.discarded_units:
        counts.update(unit.sentences)
    return counts


def _check_sentence_completeness(source: Counter[str], result: Counter[str]) -> list[str]:
    """Check that every source sentence appears exactly once in results."""
    errors = []
    for sentence, expected_count in source.items():
        actual_count = result.get(sentence, 0)
        if actual_count < expected_count:
            missing = expected_count - actual_count
            errors.append(f"Missing sentence ({missing}x): '{sentence}'")
        elif actual_count > expected_count:
            extra = actual_count - expected_count
            errors.append(f"Duplicate sentence ({extra}x extra): '{sentence}'")
    return errors


def _check_no_fabricated_sentences(source: Counter[str], result: Counter[str]) -> list[str]:
    """Check that no result sentence is absent from the source."""
    errors = []
    for sentence in result:
        if sentence not in source:
            errors.append(f"Fabricated sentence not in source: '{sentence}'")
    return errors


def _check_metadata_fidelity(batch: Batch, batch_results: BatchResultsInput) -> list[str]:
    """Check that speaker and time match the source turn for each idea unit."""
    turns_by_id = {turn.turn_id: turn for turn in batch.extraction_turns}
    errors = []

    all_units: list[IdeaUnit] = []
    for group in batch_results.idea_units:
        all_units.extend(group.units)
    all_units.extend(batch_results.discarded_units)

    for unit in all_units:
        source_turn = turns_by_id.get(unit.turn_id)
        if not source_turn:
            errors.append(f"Idea unit references unknown turn_id: '{unit.turn_id}'")
            continue
        if unit.speaker != source_turn.speaker:
            errors.append(
                f"Turn {unit.turn_id}: speaker mismatch — expected '{source_turn.speaker}', got '{unit.speaker}'"
            )
        if unit.time != source_turn.time:
            errors.append(
                f"Turn {unit.turn_id}: time mismatch — expected '{source_turn.time}', got '{unit.time}'"
            )

    return errors


def _main() -> None:
    parser = argparse.ArgumentParser(description="Validate batch extraction results")
    parser.add_argument("--work-dir", type=Path, required=True, help="Working directory")
    parser.add_argument("--batch-index", type=int, required=True, help="Batch index to validate against")
    args = parser.parse_args()

    try:
        result = validate_batch_result(args.work_dir, args.batch_index)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))


if __name__ == "__main__":
    _main()
