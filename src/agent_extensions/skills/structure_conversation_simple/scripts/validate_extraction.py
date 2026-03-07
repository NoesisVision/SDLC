"""Validate LLM extraction results against expected batch data."""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

_VALID_CATEGORIES = {"Issue", "Position", "Argument", "Decision", "Irrelevant"}


def validate_extraction(batch_path: Path, extraction_path: Path) -> dict:
    """Validate an extraction result against its source batch.

    Args:
        batch_path: Path to the batch JSON file with expected turns.
        extraction_path: Path to the LLM extraction result JSON file.

    Returns:
        Validation result dict with status and optional error details.
    """
    batch_data = json.loads(batch_path.read_text(encoding="utf-8"))
    expected_turns = batch_data["extraction_turns"]
    expected_count = batch_data["expected_turns_count"]

    raw_text = extraction_path.read_text(encoding="utf-8")
    parsed = _parse_extraction(raw_text)
    if isinstance(parsed, str):
        return {"status": "validation_failed", "error_details": parsed}

    if len(parsed) != expected_count:
        return {
            "status": "validation_failed",
            "error_details": (f"Turn count mismatch: expected {expected_count}, got {len(parsed)}"),
        }

    for turn_data, expected_turn in zip(parsed, expected_turns, strict=True):
        error = _validate_single_turn(turn_data, expected_turn)
        if error:
            return {"status": "validation_failed", "error_details": error}

    return {"status": "success"}


def _parse_extraction(raw: str) -> list[dict] | str:
    text = raw
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        return f"JSON parse error: {e}"

    if not isinstance(parsed, list):
        return f"Expected a JSON array at top level, got {type(parsed).__name__}"

    return parsed


def _validate_single_turn(turn_data: dict, expected_turn: dict) -> str | None:
    speaker = expected_turn.get("speaker", "unknown")
    time = expected_turn.get("time", "unknown")

    if not isinstance(turn_data, dict):
        return f"Invalid turn structure for {speaker} at {time}: " f"expected object, got {type(turn_data).__name__}"

    raw_idea_units = turn_data.get("idea_units")
    if not isinstance(raw_idea_units, list):
        return f"Invalid turn structure for {speaker} at {time}: " f"expected 'idea_units' list"

    for iu in raw_idea_units:
        error = _validate_idea_unit(iu, speaker, time)
        if error:
            return error

    output_sentences = [s for iu in raw_idea_units for s in iu.get("sentences", [])]
    expected_sentences = expected_turn.get("sentences", [])
    expected_counts = Counter(expected_sentences)
    output_counts = Counter(output_sentences)

    if expected_counts != output_counts:
        parts = []
        missing = sorted((expected_counts - output_counts).elements())
        extra = sorted((output_counts - expected_counts).elements())
        if missing:
            parts.append(f"missing sentences: {missing}")
        if extra:
            parts.append(f"extra sentences: {extra}")
        return f"Sentence mismatch for {speaker} at {time}: " + "; ".join(parts)

    return None


def _validate_idea_unit(iu: dict, speaker: str, time: str) -> str | None:
    if not isinstance(iu, dict):
        return f"Invalid idea unit for {speaker} at {time}: " f"expected object, got {type(iu).__name__}"

    sentences = iu.get("sentences")
    if not isinstance(sentences, list) or not all(isinstance(s, str) for s in sentences):
        return f"Invalid idea unit for {speaker} at {time}: " f"'sentences' must be a list of strings"

    category = iu.get("category")
    if category not in _VALID_CATEGORIES:
        return (
            f"Invalid category '{category}' for {speaker} at {time}. "
            f"Must be one of: {', '.join(sorted(_VALID_CATEGORIES))}"
        )

    topic = iu.get("topic")
    if category == "Irrelevant":
        if topic is not None:
            return f"Irrelevant idea unit for {speaker} at {time} must have topic as null, got '{topic}'"
    else:
        if not isinstance(topic, str) or not topic.strip():
            return (
                f"Non-Irrelevant idea unit for {speaker} at {time} must have "
                f"a non-empty string 'topic', got {topic!r}"
            )

    return None


def _fail(message: str) -> None:
    print(json.dumps({"status": "error", "error": message}))
    sys.exit(1)


def _main() -> None:
    parser = argparse.ArgumentParser(description="Validate extraction result")
    parser.add_argument("batch_file", type=Path, help="Path to batch JSON file")
    parser.add_argument("extraction_file", type=Path, help="Path to extraction result JSON file")
    args = parser.parse_args()

    if not args.batch_file.exists():
        _fail(f"Batch file not found: {args.batch_file}")
    if not args.extraction_file.exists():
        _fail(f"Extraction file not found: {args.extraction_file}")

    result = validate_extraction(args.batch_file, args.extraction_file)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    _main()
