# /// script
# dependencies = [
#     "pydantic",
# ]
# ///
"""Split parsed conversation turns into token-based batches for sequential processing."""

import argparse
import json
from pathlib import Path

from models import Batch, CleanedConversation, SpeakerTurn

_TARGET_TOKENS_PER_BATCH = 5000
_CHARS_PER_TOKEN = 4


def prepare_batches(work_dir: Path, cleaned_path: Path) -> dict:
    """Split parsed turns into batches of approximately 5k tokens each.

    Args:
        work_dir: Path to the working directory for storing batches.
        cleaned_path: Path to the cleaned JSON file with parsed turns.

    Returns:
        Status dict with batch_count.
    """
    if not cleaned_path.exists():
        raise Exception(f"Cleaned file not found: {cleaned_path}")

    cleaned = CleanedConversation.model_validate_json(cleaned_path.read_text(encoding="utf-8"))
    if not cleaned.turns:
        raise Exception("No turns to batch")

    batches = _split_into_batches(cleaned.turns)
    batches_dir = work_dir / "batches"
    batches_dir.mkdir(parents=True, exist_ok=True)

    for i, batch in enumerate(batches):
        batch_path = batches_dir / f"batch_{i:03d}.json"
        batch_path.write_text(json.dumps(batch.model_dump(), indent=2, ensure_ascii=False), encoding="utf-8")

    return {"status": "success", "batch_count": len(batches)}


def _split_into_batches(turns: list[SpeakerTurn]) -> list[Batch]:
    target_chars = _TARGET_TOKENS_PER_BATCH * _CHARS_PER_TOKEN
    batches: list[Batch] = []
    current_turns: list[SpeakerTurn] = []
    current_chars = 0
    previous_turn: SpeakerTurn | None = None

    for turn in turns:
        turn_chars = _estimate_turn_chars(turn)

        if current_turns and current_chars + turn_chars > target_chars:
            batches.append(_build_batch(previous_turn, current_turns))
            previous_turn = current_turns[-1]
            current_turns = []
            current_chars = 0

        current_turns.append(turn)
        current_chars += turn_chars

    if current_turns:
        batches.append(_build_batch(previous_turn, current_turns))

    return batches


def _build_batch(previous_turn: SpeakerTurn | None, extraction_turns: list[SpeakerTurn]) -> Batch:
    return Batch(
        previous_turn=previous_turn,
        extraction_turns=extraction_turns,
        expected_turn_count=len(extraction_turns),
    )


_JSON_OVERHEAD_PER_TURN = 80


def _estimate_turn_chars(turn: SpeakerTurn) -> int:
    sentence_chars = sum(len(s) for s in turn.sentences)
    metadata_chars = len(turn.speaker) + len(turn.time) + len(turn.turn_id or "")
    return sentence_chars + metadata_chars + _JSON_OVERHEAD_PER_TURN


def _main() -> None:
    parser = argparse.ArgumentParser(description="Prepare token-based batches from parsed conversation")
    parser.add_argument("work_dir", type=Path, help="Working directory for storing batches")
    parser.add_argument("--cleaned-path", type=Path, required=True, help="Path to cleaned JSON file")
    args = parser.parse_args()

    try:
        if not args.work_dir.exists():
            raise Exception(f"Working directory not found: {args.work_dir}")
        result = prepare_batches(args.work_dir, args.cleaned_path)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))


if __name__ == "__main__":
    _main()
