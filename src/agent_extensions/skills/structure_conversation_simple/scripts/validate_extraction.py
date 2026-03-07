"""Validate LLM extraction results against expected batch data."""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

_VALID_CATEGORIES = {"Issue", "Position", "Argument", "Information", "Agreement", "Decision", "Irrelevant"}


def validate_extraction(batch_path: Path, extraction_path: Path) -> dict:
    """Validate an extraction result against its source batch.

    Args:
        batch_path: Path to the batch JSON file with expected turns.
        extraction_path: Path to the LLM extraction result JSON file.

    Returns:
        Validation result dict with status and optional error details.
    """
    batch_data = json.loads(batch_path.read_text(encoding="utf-8"))
    expected_map = {t["turn_id"]: t for t in batch_data["extraction_turns"]}

    raw_text = extraction_path.read_text(encoding="utf-8")
    parsed = _parse_extraction(raw_text)
    if isinstance(parsed, str):
        return {"status": "validation_failed", "error_details": parsed}

    error = _validate_turn_ids(parsed, expected_map)
    if error:
        return {"status": "validation_failed", "error_details": error}

    for turn_data in parsed:
        turn_id = turn_data["turn_id"]
        error = _validate_single_turn(turn_data, expected_map[turn_id])
        if error:
            return {"status": "validation_failed", "error_details": error}

    return {"status": "success"}


def _validate_turn_ids(parsed: list[dict], expected_map: dict) -> str | None:
    output_ids = []
    for element in parsed:
        turn_id = element.get("turn_id")
        if turn_id is None:
            return "Validation Failed: Each output element must include a 'turn_id' field."
        output_ids.append(turn_id)

    if len(output_ids) != len(set(output_ids)):
        seen = set()
        for tid in output_ids:
            if tid in seen:
                return f"Validation Failed: Duplicate turn_id '{tid}'."
            seen.add(tid)

    expected_ids = set(expected_map.keys())
    output_id_set = set(output_ids)
    missing = sorted(expected_ids - output_id_set)
    extra = sorted(output_id_set - expected_ids)

    if missing:
        return (
            f"Validation Failed: Missing output for turn_ids {missing}. "
            f"You must return exactly one object per input turn and include the exact 'turn_id'."
        )
    if extra:
        return (
            f"Validation Failed: Unexpected turn_ids {extra}. "
            f"Only return turns from extraction_turns."
        )

    return None


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
    turn_id = expected_turn["turn_id"]

    if not isinstance(turn_data, dict):
        return (
            f"Validation Failed in turn_id '{turn_id}': "
            f"expected object, got {type(turn_data).__name__}"
        )

    raw_idea_units = turn_data.get("idea_units")
    if not isinstance(raw_idea_units, list):
        return f"Validation Failed in turn_id '{turn_id}': expected 'idea_units' list"

    for iu in raw_idea_units:
        error = _validate_idea_unit(iu, turn_id)
        if error:
            return error

    output_sentences = [s for iu in raw_idea_units for s in iu.get("sentences", [])]
    expected_sentences = expected_turn.get("sentences", [])
    expected_counts = Counter(expected_sentences)
    output_counts = Counter(output_sentences)

    if expected_counts != output_counts:
        return (
            f"Validation Failed in turn_id '{turn_id}': "
            f"The sentences returned do not exactly match the input. "
            f"Do not alter, fix typos, or combine sentences. Preserve verbatim."
        )

    return None


def _validate_idea_unit(iu: dict, turn_id: str) -> str | None:
    if not isinstance(iu, dict):
        return (
            f"Validation Failed in turn_id '{turn_id}': "
            f"expected object, got {type(iu).__name__}"
        )

    sentences = iu.get("sentences")
    if not isinstance(sentences, list) or not all(isinstance(s, str) for s in sentences):
        return f"Validation Failed in turn_id '{turn_id}': 'sentences' must be a list of strings"

    category = iu.get("category")
    if category not in _VALID_CATEGORIES:
        return (
            f"Invalid category '{category}' in turn_id '{turn_id}'. "
            f"Must be one of: {', '.join(sorted(_VALID_CATEGORIES))}"
        )

    topic = iu.get("topic")
    if category == "Irrelevant":
        if topic is not None:
            return (
                f"Irrelevant idea unit in turn_id '{turn_id}' must have topic as null, "
                f"got '{topic}'"
            )
    else:
        if not isinstance(topic, str) or not topic.strip():
            return (
                f"Non-Irrelevant idea unit in turn_id '{turn_id}' must have "
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
