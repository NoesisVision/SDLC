# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Validate that a batch was fully processed by checking the result manifest against the structured output."""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from models import (
    Batch,
    BatchResultManifest,
    IdeaUnit,
    ProcessedTurnStatus,
    SpeakerTurn,
    StructuredConversation,
)


class ScriptError(Exception):
    pass


def validate_batch(work_dir: Path, structured_path: Path, batch_index: int) -> dict:
    """Validate that all turns in a batch were processed.

    Args:
        work_dir: Path to the working directory containing batch and result files.
        structured_path: Path to the structured output file.
        batch_index: Index of the batch to validate.

    Returns:
        Status dict with validation result and any error details.
    """
    batch_path = work_dir / "batches" / f"batch_{batch_index:03d}.json"
    if not batch_path.exists():
        raise ScriptError(f"Batch file not found: {batch_path}")

    result_path = work_dir / "results" / f"batch_{batch_index:03d}.json"
    if not result_path.exists():
        raise ScriptError(f"Batch result manifest not found: {result_path}")

    if not structured_path.exists():
        raise ScriptError(f"Structured output file not found: {structured_path}")

    batch = Batch.model_validate_json(batch_path.read_text(encoding="utf-8"))
    manifest = BatchResultManifest.model_validate_json(result_path.read_text(encoding="utf-8"))
    structured = StructuredConversation.model_validate_json(structured_path.read_text(encoding="utf-8"))

    errors = _check_all_turns_covered(batch, manifest)
    errors.extend(_check_assigned_turns_in_topics(manifest, structured))
    errors.extend(_check_sentence_fidelity(batch, structured))

    if errors:
        return {"status": "error", "error_details": errors}

    return {"status": "success", "batch_index": batch_index}


def _check_all_turns_covered(batch: Batch, manifest: BatchResultManifest) -> list[str]:
    expected_ids = {turn.turn_id for turn in batch.extraction_turns}
    processed_ids = {turn.turn_id for turn in manifest.processed_turns}

    missing = expected_ids - processed_ids
    extra = processed_ids - expected_ids

    errors = []
    if missing:
        errors.append(f"Turns missing from result manifest: {sorted(missing)}")
    if extra:
        errors.append(f"Unexpected turns in result manifest: {sorted(extra)}")

    return errors


def _check_assigned_turns_in_topics(manifest: BatchResultManifest, structured: StructuredConversation) -> list[str]:
    all_topic_turn_ids = _collect_topic_turn_ids(structured)
    errors = []

    for processed_turn in manifest.processed_turns:
        if processed_turn.status == ProcessedTurnStatus.assigned:
            if processed_turn.turn_id not in all_topic_turn_ids:
                errors.append(
                    f"Turn {processed_turn.turn_id} marked as assigned " f"but not found in any topic's idea_units"
                )
        elif processed_turn.status == ProcessedTurnStatus.fully_irrelevant:
            pass
        else:
            errors.append(f"Turn {processed_turn.turn_id} has invalid status: {processed_turn.status}")

    return errors


def _check_sentence_fidelity(batch: Batch, structured: StructuredConversation) -> list[str]:
    source_turns = {t.turn_id: t for t in batch.extraction_turns}
    errors = []

    for turn_id, source_turn in source_turns.items():
        saved_idea_units = _collect_saved_idea_units_for_turn(turn_id, structured)
        if not saved_idea_units:
            continue

        error = _check_idea_units_against_source(turn_id, source_turn, saved_idea_units)
        if error:
            errors.append(error)

    return errors


def _check_idea_units_against_source(
    turn_id: str,
    source_turn: SpeakerTurn,
    saved_idea_units: list[IdeaUnit],
) -> str | None:
    source_counts = Counter(source_turn.sentences)
    saved_counts: Counter[str] = Counter()
    for iu in saved_idea_units:
        saved_counts.update(iu.sentences)

    for sentence, count in saved_counts.items():
        if sentence not in source_counts:
            return f"Turn {turn_id}: fabricated sentence not in source — " f"'{sentence}'"
        if count > source_counts[sentence]:
            return (
                f"Turn {turn_id}: sentence appears {count} time(s) in output "
                f"but only {source_counts[sentence]} in source — '{sentence}'"
            )

    for iu in saved_idea_units:
        if iu.speaker != source_turn.speaker:
            return f"Turn {turn_id}: speaker mismatch — " f"expected '{source_turn.speaker}', got '{iu.speaker}'"
        if iu.time != source_turn.time:
            return f"Turn {turn_id}: time mismatch — " f"expected '{source_turn.time}', got '{iu.time}'"

    return None


def _collect_saved_idea_units_for_turn(turn_id: str, structured: StructuredConversation) -> list[IdeaUnit]:
    idea_units = []
    for topic in structured.topics:
        for iu in topic.idea_units:
            if iu.turn_id == turn_id:
                idea_units.append(iu)
    return idea_units


def _collect_topic_turn_ids(structured: StructuredConversation) -> set[str]:
    turn_ids = set()
    for topic in structured.topics:
        for idea_unit in topic.idea_units:
            turn_ids.add(idea_unit.turn_id)
    return turn_ids


def _main() -> None:
    parser = argparse.ArgumentParser(description="Validate batch processing completeness")
    parser.add_argument("work_dir", type=Path, help="Working directory with batch/result files")
    parser.add_argument("--structured-path", type=Path, required=True, help="Path to structured output file")
    parser.add_argument("--batch-index", type=int, required=True, help="Batch index to validate")
    args = parser.parse_args()

    try:
        if not args.work_dir.exists():
            raise ScriptError(f"Working directory not found: {args.work_dir}")
        result = validate_batch(args.work_dir, args.structured_path, args.batch_index)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    _main()
